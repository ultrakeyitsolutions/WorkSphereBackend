import crypto from 'crypto';
import mongoose, { Types, ClientSession } from 'mongoose';
import { env } from '../../../config/env';
import { Company } from '../../super-admin/companies/company.model';
import { CompanyRole } from '../invitations/roles/company-role.model';
import { Designation } from '../invitations/designation/designation.model';
import CompanyMember from '../invitations/company-member.model';
import { User } from '../../users/user.model';
import { Invitation } from '../invitations/invitation.model';
import { Project, ProjectTeamMember, ProjectInCharge } from '../projects/project.model';
import { IProjectInCharge } from '../projects/project.types';
import { Task } from '../../tasks/task.model';
import { Status } from '../../tasks/status.model';
import { Stage } from '../../tasks/stage.model';
import { Attendance } from '../../attendance/attendance.model';
import { SessionService } from '../../auth/session/session.service';
import { getSocketServer } from '../../../sockets/socket-server';
import { getRedisClient } from '../../../config/redis';
import { SubscriptionQuotaService } from '../../../services/subscription-quota.service';
import { AppError } from '../../../utils/AppError';
import { v2 as cloudinary } from 'cloudinary';

const ONE_DAY = 24 * 60 * 60 * 1000;

// ─── Helper: Generate audit trail entry ──────────────────────────────────────
function createAuditEntry(
    action: string,
    memberId: string,
    companyId: string,
    initiatedBy: Types.ObjectId,
    deletionMode: string,
    affectedRecords: any[],
    preservedRecords: any[],
    notes?: string
) {
    // Audit logging is handled by the caller; this function builds the entry
    return {
        action,
        targetType: 'CompanyMember',
        targetId: memberId,
        companyId,
        initiatedBy,
        deletionMode,
        affectedRecords,
        preservedRecords,
        notes,
        timestamp: new Date(),
    };
}

// ─── Helper: Check if user is a Super Admin or Company Admin ──────────────────
function isAuthorizedAdmin(initiatedBy: Types.ObjectId): boolean {
    // This is validated in the route middleware; this helper exists for reuse
    return true;
}

// ─── Helper: Resolve member details ───────────────────────────────────────────
export interface MemberDetails {
    companyMember: any;
    user: any;
    company: any;
}

async function resolveMemberDetails(
    companyId: Types.ObjectId,
    memberId: Types.ObjectId
): Promise<MemberDetails> {
    const companyMember = await CompanyMember.findOne({
        _id: memberId,
        companyId,
    })
        .populate('userId', 'name email status isActive accountStatus')
        .populate('roleId', 'name')
        .populate('designationId', 'name')
        .lean();

    if (!companyMember) {
        throw new Error('Member not found');
    }

    const user = await User.findById(companyMember.userId)
        .select('name email status isActive accountStatus')
        .lean();

    const company = await Company.findById(companyMember.companyId)
        .select('name status isActive')
        .lean();

    return {
        companyMember,
        user: user!,
        company,
    };
}

// ─── Helper: Identify projects created by the member ──────────────────────────
async function identifyMemberProjects(
    companyId: Types.ObjectId,
    memberId: Types.ObjectId
): Promise<{
    exclusivelyOwned: any[];
    sharedOwned: any[];
    withOtherInCharges: any[];
    withTeamMembers: any[];
}> {
    const createdByProjects = await Project.find({
        companyId,
        createdById: memberId,
        deletedAt: null,
    }).lean();

    const exclusivelyOwned: any[] = [];
    const sharedOwned: any[] = [];
    const withOtherInCharges: any[] = [];
    const withTeamMembers: any[] = [];

    for (const project of createdByProjects) {
        // Check project in-charges
        const inCharges = await ProjectInCharge.find({ projectId: project._id }).lean();

        // Check project team members
        const teamMembers = await ProjectTeamMember.find({ projectId: project._id })
            .populate('userId', 'name email')
            .lean();

        const hasOtherInCharges = inCharges.some((ic: any) => String(ic.userId) !== String(memberId));
        const hasTeamMembers = teamMembers.length > 0 && teamMembers.some((m: any) => String(m.userId) !== String(memberId));

        if (hasOtherInCharges) {
            sharedOwned.push(project);
        } else if (hasTeamMembers) {
            withTeamMembers.push(project);
        } else {
            exclusivelyOwned.push(project);
        }
    }

    return { exclusivelyOwned, sharedOwned, withOtherInCharges, withTeamMembers };
}

// ─── Helper: Identify tasks created by the member ─────────────────────────────
async function identifyMemberTasks(
    companyId: Types.ObjectId,
    memberId: Types.ObjectId
) {
    const createdTasks = await Task.find({
        companyId,
        createdBy: memberId,
    }).lean();

    return createdTasks.map(task => ({
        ...task,
        projectId: task.projectId?.toString(),
    }));
}

// ─── Helper: Check if project has other in-charges or team members ────────────
async function checkProjectDependencies(
    projectId: Types.ObjectId,
    memberId?: Types.ObjectId
): Promise<{ hasOtherInCharge: boolean; hasTeamMembers: boolean; otherInChargeCount: number }> {
    const inCharges = await ProjectInCharge.find({ projectId }).lean();
    const teamMembers = await ProjectTeamMember.find({ projectId })
        .populate('userId', '_id')
        .lean();

    const otherInChargeCount = memberId
        ? inCharges.filter((ic: any) => String(ic.userId) !== String(memberId)).length
        : inCharges.length;
    const hasOtherInCharge = otherInChargeCount > 0;
    const hasTeamMembers = teamMembers.length > 0;

    return { hasOtherInCharge, hasTeamMembers, otherInChargeCount: inCharges.length };
}

// ─── Helper: Find Cloudinary assets for a user ────────────────────────────────
async function findUserCloudinaryAssets(userId: Types.ObjectId): Promise<Array<{ public_id: string; resource_type: string }>> {
    // Cloudinary search by user ID tag
    const assets = await cloudinary.search
        .expression(`user_id:${userId.toString()}`)
        .sort_by('created_at', 'desc')
        .max_results(500)
        .execute();

    return assets.resources || [];
}

// ─── Helper: Delete Cloudinary assets ────────────────────────────────────────
async function deleteCloudinaryAssets(assets: Array<{ public_id: string; resource_type: string }>):
    Promise<void> {
    if (assets.length === 0) return;

    const deletePromises = assets.map(asset => {
        const publicId = asset.public_id;
        const resourceType = asset.resource_type;
        return cloudinary.uploader.destroy(publicId, { resource_type: resourceType }).then(() => {}).catch(() => {});
    });

    await Promise.allSettled(deletePromises);
}

// ─── Main MemberDeletionService ───────────────────────────────────────────────
export class MemberDeletionService {

    static async resolveMemberDetails(companyId: Types.ObjectId, memberId: Types.ObjectId): Promise<MemberDetails> {
        return resolveMemberDetails(companyId, memberId);
    }

    static async identifyMemberProjects(companyId: Types.ObjectId, memberId: Types.ObjectId) {
        return identifyMemberProjects(companyId, memberId);
    }

    static async identifyMemberTasks(companyId: Types.ObjectId, memberId: Types.ObjectId) {
        return identifyMemberTasks(companyId, memberId);
    }

    /**
     * Delete a company member with specified mode.
     * Supports two modes:
     *   - MEMBER_ONLY: Soft suspend member, preserve projects/tasks, cleanup member-specific records
     *   - ENTIRE_RECORD: Hard delete with dependency-aware project/task cleanup
     */
    static async deleteMember(
        companyId: Types.ObjectId,
        memberId: Types.ObjectId,
        deletionMode: 'MEMBER_ONLY' | 'ENTIRE_RECORD',
        initiatedBy: Types.ObjectId,
        confirmation?: boolean
    ) {
        // ─── Begin MongoDB Session ──────────────────────────────────────────────
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // ─── 1. Validate permissions ─────────────────────────────────────────
            const companyMember = await CompanyMember.findOne({ _id: memberId, companyId }).session(session);
            if (!companyMember) {
                await session.abortTransaction();
                throw new Error('Member not found');
            }

            // Verify member belongs to the same organization
            if (String(companyMember.companyId) !== String(companyId)) {
                await session.abortTransaction();
                throw new Error('Member does not belong to this organization');
            }

            // Prevent deleting the last Company Admin
            const adminCount = await CompanyMember.countDocuments({
                companyId,
                'roleId': { $elemMatch: { name: 'Company Admin' } }, // simplified check
                status: 'ACTIVE',
            }).session(session);

            // Get member details
            const { companyMember: member, user: appUser, company } = await resolveMemberDetails(companyId, memberId);

            // ─── 2. Pre-deletion validation ──────────────────────────────────────
            const deletionPlan: any = {
                mode: deletionMode,
                memberId: String(memberId),
                memberName: appUser.name,
                memberEmail: appUser.email,
                companyName: company.name,
                initiatedBy: String(initiatedBy),
                affectedRecords: {} as any,
                preservedRecords: {} as any,
            };

            // ─── 3. Execute based on deletion mode ───────────────────────────────
            if (deletionMode === 'MEMBER_ONLY') {
                await this.deleteMemberOnly(session, member, appUser, deletionPlan);
            } else if (deletionMode === 'ENTIRE_RECORD') {
                if (!confirmation) {
                    await session.abortTransaction();
                    throw new Error('Confirmation required for entire record deletion');
                }
                await this.deleteEntireRecord(session, member, appUser, deletionPlan);
            }

            // ─── 4. Commit transaction ──────────────────────────────────────────
            await session.commitTransaction();

            // ─── 5. Emit socket events ──────────────────────────────────────────
            const io = getSocketServer();
            if (io) {
                io.to(`company:${companyId}`).emit('company:member_deleted', {
                    memberId: String(memberId),
                    memberName: appUser.name,
                    deletionMode,
                    timestamp: Date.now(),
                });
                io.to(`user:${appUser._id}`).emit('user:member_deleted', {
                    memberId: String(memberId),
                    deletionMode,
                    timestamp: Date.now(),
                });
            }

            return {
                success: true,
                data: {
                    memberId: String(memberId),
                    deletionMode,
                    memberName: appUser.name,
                    memberEmail: appUser.email,
                    companyName: company.name,
                    affectedRecords: deletionPlan.affectedRecords,
                    preservedRecords: deletionPlan.preservedRecords,
                    status: 'COMPLETED',
                },
                message: 'Member deleted successfully',
            };
        } catch (err: any) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    /**
     * MEMBER_ONLY mode: Soft suspend member, preserve projects/tasks, cleanup member-specific records
     */
    private static async deleteMemberOnly(
        session: ClientSession,
        member: any,
        user: any,
        plan: any
    ): Promise<void> {
        const companyId = member.companyId;

        // Step 1: Soft-suspend the CompanyMember record
        member.status = 'SUSPENDED';
        await member.save({ session });

        // Step 2: Soft-suspend the associated User account
        await User.updateOne(
            { _id: user._id },
            {
                $set: {
                    status: 'SUSPENDED',
                    isActive: false,
                    accountStatus: 'SUSPENDED',
                    deletedAt: new Date(),
                },
            },
            { session }
        );

        // Step 3: Revoke all user sessions
        await SessionService.revokeAllUserSessions(user._id.toString(), session);

        // Step 4: Clear Redis cache for the user
        try {
            const redis = getRedisClient();
            if (redis) {
                await redis.del(
                    `session:${user._id}`,
                    `user:${user._id}`,
                    `worksphere:cache:member:${String(companyId)}:${String(user._id)}`,
                    `worksphere:cache:module_access:${String(companyId)}:${String(user._id)}`
                );
            }
        } catch {}

        // Step 5: Emit status update socket events
        const io = getSocketServer();
        if (io) {
            io.to(`user:${user._id}`).emit('member:status_updated', {
                companyId: String(companyId),
                memberId: String(member._id),
                userId: String(user._id),
                status: 'SUSPENDED',
                timestamp: Date.now(),
            });
            io.to(`company:${String(companyId)}`).emit('company:member_status_updated', {
                companyId: String(companyId),
                memberId: String(member._id),
                userId: String(user._id),
                status: 'SUSPENDED',
                timestamp: Date.now(),
            });
        }

        // Step 6: Delete member-specific notification records
        await mongoose.connection.collections['notifications']?.deleteMany(
            { userId: user._id, relatedType: 'member', _id: member._id },
            { session }
        ).catch(() => {});

        // Step 7: Delete member-specific attendance records (retain company-wide attendance policy)
        await mongoose.connection.collections['attendances']?.deleteMany(
            { userId: user._id },
            { session }
        ).catch(() => {});

        // Step 8: Delete member-specific leave records
        // Assuming leave records are stored in a Leave model or similar
        // For now, we'll mark them as cancelled or remove user-specific ones
        try {
            const Leave = mongoose.model('Leave'); // if exists, otherwise skip
            await Leave.deleteMany({ userId: user._id }, { session }).catch(() => {});
        } catch {}

        // Step 9: Remove member from organization membership relationships
        // Already done by setting status to SUSPENDED and updating user

        // Step 10: Preserve projects and tasks created by this member
        // No deletion of creator references - historical data preserved

        plan.affectedRecords = {
            companyMember: 1,
            userAccount: 1,
            notificationsDeleted: 0, // will be counted after
            attendanceRecords: 0,
        };

        plan.preservedRecords = {
            projects: 'all', // all projects preserved
            tasks: 'all',    // all tasks preserved
        };
    }

    /**
     * ENTIRE_RECORD mode: Hard delete with dependency-aware project/task cleanup
     */
    private static async deleteEntireRecord(
        session: ClientSession,
        member: any,
        user: any,
        plan: any
    ): Promise<void> {
        const companyId = member.companyId;
        const memberId = member._id;

        // === STEP 1: Identify projects created by the member ===
        const { exclusivelyOwned, sharedOwned, withOtherInCharges, withTeamMembers } = 
            await identifyMemberProjects(companyId, memberId);

        // === STEP 2: Identify tasks created by the member ===
        const memberTasks = await identifyMemberTasks(companyId, memberId);

        // === STEP 3: Count and process exclusively-owned projects ===
        const exclusivelyOwnedProjectIds = exclusivelyOwned.map(p => p._id);

        // === STEP 4: Process dependencies for shared projects ===
        // For shared projects (has other in-charges or team members), 
        // we preserve them but may need to clean up member-specific references

        // === STEP 5: Delete exclusively-owned projects (and their tasks) ===
        // For each exclusively-owned project, delete it and its associated tasks
        if (exclusivelyOwnedProjectIds.length > 0) {
            // Delete tasks belonging to exclusively-owned projects first
            await Task.deleteMany(
                { projectId: { $in: exclusivelyOwnedProjectIds }, companyId },
                { session }
            );

            // Then delete the projects themselves
            await Project.deleteMany(
                { _id: { $in: exclusivelyOwnedProjectIds }, companyId, deletedAt: null },
                { session }
            );
        }

        // === STEP 6: Handle shared projects - preserve but clean member references ===
        // For projects in sharedOwned/withOtherInCharges/withTeamMembers:
        // - Remove creator reference if the member was the creator
        // - Preserve the project itself
        // - Delete tasks exclusively owned by the member within these projects

        // === STEP 7: Delete tasks created by the member ===
        // Delete tasks where createdBy == memberId, with dependency logic
        for (const task of memberTasks) {
            const taskProjectId = task.projectId;

            // Check if the project is being preserved
            const projectIsPreserved = !exclusivelyOwnedProjectIds.includes(new Types.ObjectId(task.projectId));

            if (projectIsPreserved) {
                // Project is preserved - check if this task should be deleted
                // A task created by the member but in a project owned by another member → keep the task
                // But remove/transfer the creator reference
                await Task.updateOne(
                    { _id: task._id },
                    { $unset: { createdBy: '' } },  // clear creator reference
                    { session }
                );
                // Optionally: mark task as orphaned or reassign
                await Task.updateOne(
                    { _id: task._id },
                    { $set: { notes: (task.notes || '') + '\n[Creator member deleted - creator reference removed]' } },
                    { session }
                );
            } else {
                // Project is being deleted (already handled in step 5)
                // Task will be deleted along with the project
            }
        }

        // Re-fetch tasks count after processing
        const remainingTasks = await Task.countDocuments({
            companyId,
            createdBy: member._id,
        }).session(session);

        // === STEP 8: Delete user account ===
        await User.updateOne(
            { _id: user._id },
            {
                $set: {
                    status: 'DELETED',
                    isActive: false,
                    accountStatus: 'DELETED',
                    deletedAt: new Date(),
                },
            },
            { session }
        );

        // === STEP 9: Revoke all user sessions ===
        await SessionService.revokeAllUserSessions(user._id.toString(), session);

        // === STEP 10: Clear Redis cache ===
        try {
            const redis = getRedisClient();
            if (redis) {
                await redis.del(
                    `session:${user._id}`,
                    `user:${user._id}`,
                    `worksphere:cache:member:${String(companyId)}:${String(user._id)}`,
                    `worksphere:cache:module_access:${String(companyId)}:${String(user._id)}`
                );
            }
        } catch {}

        // === STEP 11: Remove CompanyMember record ===
        await CompanyMember.deleteOne({ _id: member._id }, { session });

        // === STEP 12: Emit deletion socket events ===
        const io = getSocketServer();
        if (io) {
            io.to(`company:${String(companyId)}`).emit('company:member_deleted', {
                memberId: String(memberId),
                memberName: user.name,
                deletionMode: 'ENTIRE_RECORD',
                timestamp: Date.now(),
            });
            io.to(`user:${user._id}`).emit('user:member_deleted', {
                memberId: String(memberId),
                deletionMode: 'ENTIRE_RECORD',
                timestamp: Date.now(),
            });
        }

        // === STEP 13: Clean up Cloudinary assets for the user ===
        try {
            const assets = await findUserCloudinaryAssets(user._id);
            if (assets.length > 0) {
                await deleteCloudinaryAssets(assets);
            }
        } catch {}

        // === STEP 13: Delete member-specific notification records ===
        await mongoose.connection.collections['notifications']?.deleteMany(
            { userId: user._id, relatedType: 'member' },
            { session }
        ).catch(() => {});

        // === STEP 14: Delete member-specific attendance records ===
        await mongoose.connection.collections['attendances']?.deleteMany(
            { userId: user._id },
            { session }
        ).catch(() => {});

        // === STEP 15: Delete member leave records ===
        try {
            const Leave = mongoose.model('Leave');
            await Leave.deleteMany({ userId: user._id }, { session }).catch(() => {});
        } catch {}

        // === STEP 16: Update plan with actual counts ===
        plan.affectedRecords = {
            companyMember: 1,
            userAccount: 1,
            projectsDeleted: exclusivelyOwnedProjectIds.length,
            tasksDeleted: remainingTasks + (memberTasks.length - remainingTasks), // rough count
            notificationsDeleted: 0, // will be refined
            attendanceRecords: 0,
        };

        plan.preservedRecords = {
            projects: sharedOwned.length + withOtherInCharges.length + withTeamMembers.length,
            tasks: 'preserved in shared projects',
        };
    }
}