import mongoose, { Types } from 'mongoose';
import { User } from '../users/user.model';
import { Project } from '../companyadmin/projects/project.model';
import { Task } from '../tasks/task.model';
import { MeetingStatus } from './meeting.types';
import { ALLOWED_STATUS_TRANSITIONS } from './meeting.constants';

export class MeetingValidationService {
    /**
     * Validate requester user and their company membership
     */
    public static async validateRequester(
        userId: string | Types.ObjectId,
        companyId: string | Types.ObjectId
    ): Promise<{ user: any }> {
        const user = await User.findById(userId).populate('role').lean();
        if (!user) {
            const err: any = new Error('Requester user not found');
            err.statusCode = 404;
            throw err;
        }

        if (!user.isActive || user.status !== 'ACTIVE') {
            const err: any = new Error('Requester user account is not active');
            err.statusCode = 403;
            throw err;
        }

        if (user.companyId && user.companyId.toString() !== companyId.toString()) {
            const err: any = new Error('Requester does not belong to specified company');
            err.statusCode = 403;
            throw err;
        }

        return { user };
    }

    /**
     * Validate all meeting participants:
     * - Must exist
     * - Must be active
     * - MUST belong to the EXACT same company (Tenant Isolation)
     */
    public static async validateParticipants(
        participantIds: (string | Types.ObjectId)[],
        companyId: string | Types.ObjectId,
        requesterId: string | Types.ObjectId
    ): Promise<{ validParticipantIds: Types.ObjectId[]; users: any[] }> {
        // De-duplicate participant IDs and exclude requester if present in input list
        const requesterIdStr = requesterId.toString();
        const uniqueIds = Array.from(
            new Set(
                participantIds
                    .map((id) => (id ? id.toString() : ''))
                    .filter((id) => id && id !== requesterIdStr && Types.ObjectId.isValid(id))
            )
        );

        if (uniqueIds.length === 0) {
            const err: any = new Error('At least one valid participant other than the organizer is required');
            err.statusCode = 400;
            throw err;
        }

        const objectIds = uniqueIds.map((id) => new Types.ObjectId(id));
        const foundUsers = await User.find({ _id: { $in: objectIds } }).lean();

        if (foundUsers.length !== objectIds.length) {
            const foundIdSet = new Set(foundUsers.map((u) => u._id.toString()));
            const missingIds = uniqueIds.filter((id) => !foundIdSet.has(id));
            const err: any = new Error(`One or more participants not found: ${missingIds.join(', ')}`);
            err.statusCode = 404;
            throw err;
        }

        const companyIdStr = companyId.toString();
        for (const user of foundUsers) {
            if (!user.isActive || user.status === 'INACTIVE' || user.status === 'DEACTIVATED') {
                const err: any = new Error(`Participant ${user.name || user.email} is inactive`);
                err.statusCode = 400;
                throw err;
            }

            const userCompanyIdStr = user.companyId ? user.companyId.toString() : '';
            if (userCompanyIdStr !== companyIdStr) {
                const err: any = new Error('CROSS_COMPANY_MEETING_NOT_ALLOWED');
                err.statusCode = 403;
                err.code = 'CROSS_COMPANY_MEETING_NOT_ALLOWED';
                throw err;
            }
        }

        return {
            validParticipantIds: objectIds,
            users: foundUsers,
        };
    }

    /**
     * Validate project association:
     * - Must exist
     * - Must belong to requester's company
     * - Requester must have access to project (admin / in charge / team member)
     */
    public static async validateProject(
        projectId: string | Types.ObjectId,
        companyId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        userRole?: string
    ): Promise<any> {
        if (!Types.ObjectId.isValid(projectId.toString())) {
            const err: any = new Error('Invalid project ID');
            err.statusCode = 400;
            throw err;
        }

        const project = await Project.findOne({
            _id: new Types.ObjectId(projectId.toString()),
            companyId: new Types.ObjectId(companyId.toString()),
        }).lean();

        if (!project) {
            const err: any = new Error('Project not found in your organization');
            err.statusCode = 404;
            throw err;
        }

        // Full access for administrators
        if (
            userRole === 'COMPANY_ADMIN' ||
            userRole === 'Admin' ||
            userRole === 'SUPER_ADMIN'
        ) {
            return project;
        }

        // Check team member or in-charge membership
        const db = mongoose.connection;
        const [isTeamMember, isInCharge] = await Promise.all([
            db.collection('projectteammembers').findOne({
                projectId: project._id,
                userId: new Types.ObjectId(userId.toString()),
            }),
            db.collection('projectincharges').findOne({
                projectId: project._id,
                userId: new Types.ObjectId(userId.toString()),
            }),
        ]);

        if (!isTeamMember && !isInCharge) {
            const err: any = new Error('You do not have access to the selected project');
            err.statusCode = 403;
            throw err;
        }

        return project;
    }

    /**
     * Validate task association:
     * - Must exist
     * - Must belong to requester's company
     * - Must belong to selected project (if project is provided)
     */
    public static async validateTask(
        taskId: string | Types.ObjectId,
        companyId: string | Types.ObjectId,
        projectId?: string | Types.ObjectId | null
    ): Promise<any> {
        if (!Types.ObjectId.isValid(taskId.toString())) {
            const err: any = new Error('Invalid task ID');
            err.statusCode = 400;
            throw err;
        }

        const query: any = {
            _id: new Types.ObjectId(taskId.toString()),
            companyId: new Types.ObjectId(companyId.toString()),
        };

        if (projectId && Types.ObjectId.isValid(projectId.toString())) {
            query.projectId = new Types.ObjectId(projectId.toString());
        }

        const task = await Task.findOne(query).lean();
        if (!task) {
            const err: any = new Error('Task not found or does not belong to the selected project');
            err.statusCode = 404;
            throw err;
        }

        return task;
    }

    /**
     * Validate state machine status transitions
     */
    public static validateStatusTransition(
        currentStatus: MeetingStatus,
        nextStatus: MeetingStatus
    ): void {
        if (currentStatus === nextStatus) {
            return;
        }

        const allowedTransitions = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];
        if (!allowedTransitions.includes(nextStatus)) {
            const err: any = new Error(
                `Invalid meeting status transition from ${currentStatus} to ${nextStatus}`
            );
            err.statusCode = 400;
            throw err;
        }
    }
}
