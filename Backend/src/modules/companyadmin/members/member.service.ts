import { Types } from 'mongoose';
import CompanyMember from '../invitations/company-member.model';
import Invitation from '../invitations/invitation.model';
import User from '../../users/user.model';
import CompanyRole from '../invitations/roles/company-role.model';
import Designation from '../invitations/designation/designation.model';

export interface GetMembersQuery {
    companyId: string;
    memberType: 'EMPLOYEE' | 'CLIENT' | 'MANAGER';
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    roleId?: string;
    designationId?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export class MemberService {
    /**
     * Get Members (Combines actual members and pending invitations)
     */
    static async getMembers(query: GetMembersQuery) {
        const {
            companyId,
            memberType,
            page = 1,
            limit = 20,
            search,
            status,
            roleId,
            designationId,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = query;

        const skip = (page - 1) * limit;

        // 1. Build match phase for actual members
        const memberMatch: any = {
            companyId: new Types.ObjectId(companyId),
            memberType,
        };

        if (status && status !== 'PENDING') {
            memberMatch.status = status;
        } else if (status === 'PENDING') {
            // Cannot match actual members if asking only for pending
            memberMatch._id = null; // Forces empty result for this branch
        }

        if (roleId) memberMatch.roleId = new Types.ObjectId(roleId);
        if (designationId) memberMatch.designationId = new Types.ObjectId(designationId);

        // 2. Build match phase for pending invitations
        const invMatch: any = {
            companyId: new Types.ObjectId(companyId),
            memberType,
            status: 'PENDING',
        };

        if (status && status !== 'PENDING') {
            invMatch._id = null; // Forces empty result if looking for active/inactive but examining invites
        }

        if (roleId) invMatch.roleId = new Types.ObjectId(roleId);
        if (designationId) invMatch.designationId = new Types.ObjectId(designationId);

        // 3. User search criteria (if search exists, must match name or email)
        const userMatch: any = {};
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            userMatch.$or = [
                { 'user.name': searchRegex },
                { 'user.email': searchRegex },
                { email: searchRegex } // For pending invites
            ];
        }

        // We use aggregation framework to combine them
        const pipeline = [
            // Look up User for company member
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user',
                },
            },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
            // Add invitation data manually if they are actual members, or we can look it up
            {
                $lookup: {
                    from: 'invitations',
                    localField: 'userId',
                    foreignField: 'acceptedUserId',
                    as: 'invitationData'
                }
            },
            {
                $addFields: {
                    invitationRecord: {
                        $filter: {
                            input: "$invitationData",
                            as: "inv",
                            cond: { $eq: ["$$inv.companyId", new Types.ObjectId(companyId)] }
                        }
                    }
                }
            },
            {
                $addFields: {
                    invitation: { $arrayElemAt: ["$invitationRecord", 0] }
                }
            },
            // Lookup permissions to convert ObjectIds to string names
            {
                $lookup: {
                    from: 'permissions',
                    localField: 'user.grantedPermissions',
                    foreignField: '_id',
                    as: 'grantedPermDocs'
                }
            },
            {
                $lookup: {
                    from: 'permissions',
                    localField: 'user.revokedPermissions',
                    foreignField: '_id',
                    as: 'revokedPermDocs'
                }
            },
            // Format actual members
            {
                $project: {
                    _id: 1,
                    userId: '$userId',
                    email: '$user.email',
                    phoneNumber: '$user.phoneNumber',
                    name: '$user.name',
                    roleId: 1,
                    designationId: 1,
                    biometricId: 1,
                    status: 1,
                    sentDate: '$invitation.createdAt',
                    acceptedDate: '$invitation.acceptedAt',
                    userStatus: '$user.status',
                    lastLoginAt: '$user.lastLoginAt',
                    lastLoginStatus: '$user.lastLoginStatus',
                    grantedPermissions: { $ifNull: ['$grantedPermDocs.name', []] },
                    revokedPermissions: { $ifNull: ['$revokedPermDocs.name', []] },
                    createdAt: 1,
                    isInvitation: { $literal: false }
                }
            },
            // Union with Pending Invitations
            {
                $unionWith: {
                    coll: 'invitations',
                    pipeline: [
                        { $match: invMatch },
                        {
                            $project: {
                                _id: 1,
                                userId: { $literal: null },
                                email: '$email',
                                phoneNumber: '$phoneNumber',
                                name: { $literal: null },
                                roleId: 1,
                                designationId: 1,
                                biometricId: { $literal: null },
                                status: '$status', // 'PENDING'
                                sentDate: '$createdAt',
                                acceptedDate: { $literal: null },
                                userStatus: { $literal: 'NOT_REGISTERED' },
                                lastLoginAt: { $literal: null },
                                lastLoginStatus: { $literal: 'NEVER_LOGGED_IN' },
                                grantedPermissions: { $literal: [] },
                                revokedPermissions: { $literal: [] },
                                createdAt: 1,
                                isInvitation: { $literal: true }
                            }
                        }
                    ]
                }
            },
            // Apply search filter
            { $match: userMatch },
            // Lookup Role
            {
                $lookup: {
                    from: 'companyroles',
                    localField: 'roleId',
                    foreignField: '_id',
                    as: 'role'
                }
            },
            { $unwind: { path: '$role', preserveNullAndEmptyArrays: true } },
            // Lookup Designation
            {
                $lookup: {
                    from: 'designations',
                    localField: 'designationId',
                    foreignField: '_id',
                    as: 'designation'
                }
            },
            { $unwind: { path: '$designation', preserveNullAndEmptyArrays: true } },
            // Final projection for output
            {
                $project: {
                    id: '$_id',
                    userId: 1,
                    email: 1,
                    phoneNumber: 1,
                    designation: {
                        id: '$designation._id',
                        name: '$designation.name'
                    },
                    name: 1,
                    role: {
                        id: '$role._id',
                        name: '$role.name'
                    },
                    biometricId: 1,
                    status: 1,
                    sentDate: 1,
                    acceptedDate: 1,
                    userStatus: 1,
                    lastLoginStatus: 1,
                    lastLoginAt: 1,
                    grantedPermissions: 1,
                    revokedPermissions: 1,
                    createdAt: 1,
                    isInvitation: 1
                }
            },
            // Remove the internal _id
            { $unset: ['_id'] }
        ];

        // Apply sorts, skips, limits using facet for total count
        const sortObj: any = {};
        sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

        const paginatedPipeline = [
            { $match: memberMatch },
            ...pipeline,
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [
                        { $sort: sortObj },
                        { $skip: skip },
                        { $limit: limit }
                    ]
                }
            }
        ];

        const [result] = await CompanyMember.aggregate(paginatedPipeline);
        const total = result.metadata[0]?.total || 0;
        const data = result.data;

        return {
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            }
        };
    }

    /**
     * Get Member by ID
     */
    static async getMemberById(companyId: string, memberId: string) {
        const member = await CompanyMember.findOne({
            _id: memberId,
            companyId
        })
            .populate('userId', 'name email phoneNumber avatar status lastLoginAt lastLoginStatus grantedPermissions revokedPermissions')
            .populate('roleId', 'name')
            .populate('designationId', 'name');

        if (!member) {
            throw new Error('Member not found');
        }

        // Get invitation info
        const invitation = await Invitation.findOne({
            acceptedUserId: member.userId,
            companyId
        }) as any;

        const user: any = member.userId;
        const role: any = member.roleId;
        const designation: any = member.designationId;

        return {
            id: member._id,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phoneNumber: user.phoneNumber,
                avatar: user.avatar,
                status: user.status,
                lastLoginAt: user.lastLoginAt,
                grantedPermissions: (user.grantedPermissions || []).map((p: any) => p.name || p),
                revokedPermissions: (user.revokedPermissions || []).map((p: any) => p.name || p)
            },
            company: {
                id: companyId
            },
            role: {
                id: role?._id,
                name: role?.name
            },
            designation: {
                id: designation?._id,
                name: designation?.name
            },
            biometricId: member.biometricId,
            status: member.status,
            invitation: invitation ? {
                status: invitation.status,
                sentAt: invitation.createdAt,
                acceptedAt: invitation.acceptedAt
            } : null,
            lastLoginStatus: user.lastLoginStatus || 'NEVER_LOGGED_IN'
        };
    }

    /**
     * Update Member
     */
    static async updateMember(companyId: string, memberId: string, data: any) {
        const member = await CompanyMember.findOne({ _id: memberId, companyId });
        if (!member) {
            throw new Error('Member not found');
        }

        // Validate Role
        if (data.roleId) {
            const role = await CompanyRole.findOne({ _id: data.roleId, companyId });
            if (!role || !role.isActive) {
                throw new Error('Invalid or inactive role');
            }
            member.roleId = new Types.ObjectId(data.roleId);
        }

        // Validate Designation
        if (data.designationId) {
            const desig = await Designation.findOne({ _id: data.designationId, companyId });
            if (!desig || !desig.isActive) {
                throw new Error('Invalid or inactive designation');
            }
            member.designationId = new Types.ObjectId(data.designationId);
        }

        // Validate Biometric ID
        if (data.biometricId !== undefined) {
            if (data.biometricId) {
                const existing = await CompanyMember.findOne({
                    companyId,
                    biometricId: data.biometricId,
                    _id: { $ne: memberId }
                });
                if (existing) {
                    throw new Error('Biometric ID already in use');
                }
                member.biometricId = data.biometricId;
            } else {
                member.biometricId = null;
            }
        }

        await member.save();

        if (data.name || data.email || data.phoneNumber) {
            const updateFields: any = {};
            if (data.name) updateFields.name = data.name;
            if (data.email) {
                const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);
                if (!isValidEmail) throw new Error('Invalid email format');

                const existingUser = await User.findOne({ email: data.email, _id: { $ne: member.userId } });
                if (existingUser) {
                    throw new Error('Email is already used by another user or member');
                }
                updateFields.email = data.email;
            }
            if (data.phoneNumber) updateFields.phoneNumber = data.phoneNumber;

            await User.updateOne({ _id: member.userId }, { $set: updateFields });
        }

        return this.getMemberById(companyId, memberId);
    }

    /**
     * Update member status
     */
    static async updateMemberStatus(companyId: string, memberId: string, status: string) {
        const member = await CompanyMember.findOne({ _id: memberId, companyId });
        if (!member) {
            throw new Error('Member not found');
        }

        member.status = status as any;
        await member.save();

        return this.getMemberById(companyId, memberId);
    }

    /**
     * Delete/Deactivate Member
     */
    static async deleteMember(companyId: string, memberId: string) {
        const member = await CompanyMember.findOne({ _id: memberId, companyId });
        if (!member) {
            throw new Error('Member not found');
        }

        // Soft delete
        member.status = 'INACTIVE';
        await member.save();

        return { message: 'Member successfully deactivated' };
    }
}
