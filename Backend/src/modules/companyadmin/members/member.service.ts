import { Types } from 'mongoose';
import CompanyMember from '../invitations/company-member.model';
import Invitation from '../invitations/invitation.model';
import User from '../../users/user.model';
import CompanyRole from '../invitations/roles/company-role.model';
import Designation from '../invitations/designation/designation.model';
import { getRedisClient } from '../../../config/redis';
import { getSocketServer } from '../../../sockets/socket-server';
import { SubscriptionQuotaService } from '../../../services/subscription-quota.service';
import { SessionService } from '../../auth/session/session.service';

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

        if (status && status.toUpperCase() !== 'PENDING' && status.toUpperCase() !== 'ALL') {
            memberMatch.status = status.toUpperCase();
        } else if (status && status.toUpperCase() === 'PENDING') {
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

        if (status && status.toUpperCase() !== 'PENDING' && status.toUpperCase() !== 'ALL') {
            invMatch._id = null; // Forces empty result if looking for active/inactive/suspended but examining invites
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
                    avatar: '$user.avatar',
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
                                avatar: { $literal: null },
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
                    avatar: 1,
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

        if (data.name || data.email || data.phoneNumber !== undefined || data.avatar !== undefined) {
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
            if (data.phoneNumber !== undefined) updateFields.phoneNumber = data.phoneNumber;
            if (data.avatar !== undefined) updateFields.avatar = data.avatar;

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

        const validStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];
        const normalizedStatus = status ? status.toUpperCase() : 'ACTIVE';
        if (!validStatuses.includes(normalizedStatus)) {
            throw new Error(`Invalid status: ${status}. Must be one of ${validStatuses.join(', ')}`);
        }

        // If reactivating a non-active member to ACTIVE, enforce user quota
        if (normalizedStatus === 'ACTIVE' && member.status !== 'ACTIVE') {
            await SubscriptionQuotaService.assertQuota(companyId, 'users', 1);
        }

        member.status = normalizedStatus as any;
        await member.save();

        const isActive = normalizedStatus === 'ACTIVE';
        const userStatus = isActive ? 'ACTIVE' : (normalizedStatus === 'SUSPENDED' ? 'SUSPENDED' : 'INACTIVE');
        const userRawId = (member.userId as any)?._id || member.userId;

        if (userRawId) {
            const userUpdate: any = {
                status: userStatus,
                isActive,
            };
            if (isActive) {
                userUpdate.isDeleted = false;
                userUpdate.accountStatus = 'ACTIVE';
                userUpdate.deletedAt = null;
                userUpdate.deletedBy = null;
                userUpdate.deletionReason = null;
            } else if (normalizedStatus === 'SUSPENDED') {
                userUpdate.accountStatus = 'SUSPENDED';
            }
            await User.updateOne(
                { _id: userRawId },
                { $set: userUpdate }
            );

            if (!isActive) {
                await SessionService.revokeAllUserSessions(String(userRawId)).catch(() => {});
            }

            try {
                const redis = getRedisClient();
                if (redis) {
                    const uId = String(userRawId);
                    await redis.del(
                        `session:${uId}`,
                        `user:${uId}`,
                        `worksphere:cache:member:${companyId}:${uId}`,
                        `worksphere:cache:module_access:${companyId}:${uId}`
                    ).catch(() => {});
                }
            } catch {}

            try {
                const io = getSocketServer();
                if (io) {
                    const uId = String(userRawId);
                    io.to(`user:${uId}`).emit('member:status_updated', {
                        companyId,
                        memberId,
                        userId: uId,
                        status: normalizedStatus,
                        isActive,
                        timestamp: Date.now(),
                    });
                    io.to(`company:${companyId}`).emit('company:member_status_updated', {
                        companyId,
                        memberId,
                        userId: uId,
                        status: normalizedStatus,
                        timestamp: Date.now(),
                    });
                    if (!isActive) {
                        io.in(`user:${uId}`).disconnectSockets(true);
                    }
                }
            } catch {}
        }

        return this.getMemberById(companyId, memberId);
    }

    /**
     * Delete/Suspend Member
     */
    static async deleteMember(companyId: string, memberId: string) {
        const member = await CompanyMember.findOne({ _id: memberId, companyId });
        if (!member) {
            throw new Error('Member not found');
        }

        // Soft delete / suspend
        member.status = 'SUSPENDED';
        await member.save();

        const userRawId = (member.userId as any)?._id || member.userId;
        if (userRawId) {
            await User.updateOne(
                { _id: userRawId },
                {
                    $set: {
                        status: 'SUSPENDED',
                        isActive: false,
                        accountStatus: 'SUSPENDED',
                        deletedAt: new Date(),
                    }
                }
            );

            await SessionService.revokeAllUserSessions(String(userRawId)).catch(() => {});

            try {
                const redis = getRedisClient();
                if (redis) {
                    const uId = String(userRawId);
                    await redis.del(
                        `session:${uId}`,
                        `user:${uId}`,
                        `worksphere:cache:member:${companyId}:${uId}`,
                        `worksphere:cache:module_access:${companyId}:${uId}`
                    ).catch(() => {});
                }
            } catch {}

            try {
                const io = getSocketServer();
                if (io) {
                    const uId = String(userRawId);
                    io.to(`user:${uId}`).emit('member:status_updated', {
                        companyId,
                        memberId,
                        userId: uId,
                        status: 'SUSPENDED',
                        isActive: false,
                        timestamp: Date.now(),
                    });
                    io.to(`company:${companyId}`).emit('company:member_status_updated', {
                        companyId,
                        memberId,
                        userId: uId,
                        status: 'SUSPENDED',
                        timestamp: Date.now(),
                    });
                    io.in(`user:${uId}`).disconnectSockets(true);
                }
            } catch {}
        }

        return { message: 'Member successfully suspended' };
    }

    /**
     * Search all company users across all roles (Employee, Manager, Company Admin, etc.)
     * Returns actual role, department, assigned teams, account status
     */
    static async searchAllUsers(companyId: string, search?: string) {
        const compId = new Types.ObjectId(companyId);

        // Fetch all active company members
        const members = await CompanyMember.find({ companyId: compId })
            .populate({
                path: 'userId',
                select: 'name email avatar status accountStatus role employeeId',
                populate: { path: 'role', select: 'name' }
            })
            .populate('roleId', 'name')
            .populate('designationId', 'name')
            .lean();

        // Also fetch all teams in this company to attach assigned team info
        const { Team } = await import('../../teams/team.model');
        const allTeams = await Team.find({ companyId: compId, isArchived: false })
            .select('name leadId managerIds memberIds')
            .lean();

        const searchRegex = search && search.trim() ? new RegExp(search.trim(), 'i') : null;
        const results: any[] = [];

        for (const m of members) {
            const u = m.userId as any;
            if (!u) continue;

            const name = u.name || '';
            const email = u.email || '';
            const empId = u.employeeId || (m as any).employeeId || '';
            const deptName = (m.designationId as any)?.name || (m as any).departmentName || '';

            if (searchRegex) {
                const matches = searchRegex.test(name) || searchRegex.test(email) || searchRegex.test(empId);
                if (!matches) continue;
            }

            // Determine current effective role
            let roleName = 'EMPLOYEE';
            if (u.role?.name) {
                roleName = u.role.name;
            } else if (typeof u.role === 'string') {
                roleName = u.role;
            } else if (m.roleId && (m.roleId as any).name) {
                roleName = (m.roleId as any).name;
            } else if (m.memberType) {
                roleName = m.memberType;
            }

            // Find assigned teams
            const uIdStr = String(u._id);
            const assignedTeams = allTeams.filter((t: any) => {
                const isLead = t.leadId && String(t.leadId) === uIdStr;
                const isManager = (t.managerIds || []).some((mid: any) => String(mid) === uIdStr);
                const isMember = (t.memberIds || []).some((mid: any) => String(mid) === uIdStr);
                return isLead || isManager || isMember;
            }).map((t: any) => ({
                id: t._id,
                name: t.name,
                isLead: Boolean(t.leadId && String(t.leadId) === uIdStr),
                isManager: Boolean((t.managerIds || []).some((mid: any) => String(mid) === uIdStr)),
            }));

            results.push({
                memberId: m._id,
                userId: u._id,
                name,
                email,
                avatar: u.avatar || null,
                employeeId: empId,
                role: roleName.toUpperCase(),
                memberType: m.memberType,
                department: deptName,
                assignedTeams,
                accountStatus: u.accountStatus || u.status || m.status || 'ACTIVE',
                status: m.status || 'ACTIVE',
            });
        }

        return results;
    }

    /**
     * Change user role between EMPLOYEE and MANAGER (or other supported company roles)
     * Keeps user accounts unified - no duplicate accounts created!
     */
    static async changeUserRole(companyId: string, targetUserId: string, newRole: string, actorId: string) {
        const compId = new Types.ObjectId(companyId);
        const userOid = new Types.ObjectId(targetUserId);

        const targetRoleUpper = newRole.trim().toUpperCase();
        if (!['EMPLOYEE', 'MANAGER'].includes(targetRoleUpper)) {
            throw new Error('Unsupported role assignment. Supported roles: EMPLOYEE, MANAGER');
        }

        const member = await CompanyMember.findOne({ companyId: compId, userId: userOid });
        if (!member) {
            throw new Error('User is not an active member of this company');
        }

        const user = await User.findById(userOid);
        if (!user) {
            throw new Error('User record not found');
        }

        const oldMemberType = member.memberType;

        // Find or map the Role document
        const RoleModel = (await import('../../roles/role.model')).Role;
        let roleDoc = await RoleModel.findOne({ name: targetRoleUpper });
        if (!roleDoc && targetRoleUpper === 'EMPLOYEE') {
            roleDoc = await RoleModel.findOne({ name: 'User' });
        }

        if (roleDoc) {
            user.role = roleDoc._id as any;
        }
        await user.save();

        member.memberType = targetRoleUpper as any;
        await member.save();

        // Handle Manager Assignment and Revocation lifecycle
        const { TeamAccessService } = await import('../../manager/services/team-access.service');
        const { FeatureRevocationService } = await import('../settings/feature-revocation.service');

        if (targetRoleUpper === 'MANAGER') {
            const { ManagerAssignmentService } = await import('../../manager/services/manager-assignment.service');
            await ManagerAssignmentService.promoteToManager(companyId, targetUserId, actorId, {
                reason: 'Promoted to Manager by Company Administrator',
            }).catch(() => {});
        } else if (targetRoleUpper === 'EMPLOYEE') {
            const { ManagerAssignmentService } = await import('../../manager/services/manager-assignment.service');
            await ManagerAssignmentService.demoteManager(companyId, targetUserId, actorId, 'Demoted to Employee by Company Administrator').catch(() => {});
            await FeatureRevocationService.revokeManagerAccess(companyId, targetUserId, 'REVOKE_ALL', undefined, undefined, 'Role changed to Employee');
        }

        await TeamAccessService.invalidateScopeCache(companyId, targetUserId);

        try {
            const redis = getRedisClient();
            if (redis) {
                await redis.del(
                    `session:${targetUserId}`,
                    `user:${targetUserId}`,
                    `worksphere:cache:member:${companyId}:${targetUserId}`,
                    `worksphere:cache:module_access:${companyId}:${targetUserId}`
                ).catch(() => {});
            }
        } catch {}

        try {
            const io = getSocketServer();
            if (io) {
                io.to(`user:${targetUserId}`).emit('user:role_updated', {
                    companyId,
                    userId: targetUserId,
                    oldRole: oldMemberType,
                    newRole: targetRoleUpper,
                    timestamp: Date.now(),
                });
                io.to(`company:${companyId}`).emit('company:user_role_updated', {
                    companyId,
                    userId: targetUserId,
                    oldRole: oldMemberType,
                    newRole: targetRoleUpper,
                    timestamp: Date.now(),
                });
            }
        } catch {}

        return {
            success: true,
            userId: targetUserId,
            newRole: targetRoleUpper,
            message: `User role successfully updated to ${targetRoleUpper}`,
        };
    }
}
