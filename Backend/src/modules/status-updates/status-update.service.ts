import { Types } from 'mongoose';
import { StatusUpdate } from './status-update.model';
import {
    CreateStatusUpdateDto,
    UpdateStatusUpdateDto,
    StatusUpdateFilterQuery,
    IStatusUpdateDocument,
} from './status-update.types';
import { AppError } from '../../utils/AppError';
import { NotificationEventBus } from '../notifications/notification.event-bus';
import { User } from '../users/user.model';
import { Team } from '../teams/team.model';
import CompanyMember from '../companyadmin/invitations/company-member.model';

export class StatusUpdateService {
    /**
     * Helper to get today's date formatted as YYYY-MM-DD
     */
    private static getTodayDateString(): string {
        return new Date().toISOString().split('T')[0];
    }

    /**
     * Submit or edit daily status update for an employee.
     * Enforces company tenant isolation and one primary record per employee per day.
     */
    static async submitStatusUpdate(
        companyId: string,
        employeeId: string,
        dto: CreateStatusUpdateDto
    ): Promise<IStatusUpdateDocument> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const dateStr = dto.date ? dto.date.trim() : this.getTodayDateString();

        if (!dto.todayWork || !dto.todayWork.trim()) {
            throw AppError.badRequest('Please describe what you worked on today.');
        }

        const projectIds = (dto.associatedProjects || [])
            .filter((id) => Types.ObjectId.isValid(id))
            .map((id) => new Types.ObjectId(id));

        const taskIds = (dto.associatedTasks || [])
            .filter((id) => Types.ObjectId.isValid(id))
            .map((id) => new Types.ObjectId(id));

        // Check if an update for this date already exists
        let update = await StatusUpdate.findOne({
            companyId: companyObjId,
            employeeId: employeeObjId,
            date: dateStr,
        });

        if (update) {
            // Update existing record
            update.statusCategory = dto.statusCategory || update.statusCategory;
            update.todayWork = dto.todayWork.trim();
            update.currentWork = dto.currentWork !== undefined ? dto.currentWork.trim() : update.currentWork;
            update.nextWork = dto.nextWork !== undefined ? dto.nextWork.trim() : update.nextWork;
            update.blockers = dto.blockers !== undefined ? dto.blockers.trim() : update.blockers;
            update.additionalComments = dto.additionalComments !== undefined ? dto.additionalComments.trim() : update.additionalComments;
            update.associatedProjects = projectIds;
            update.associatedTasks = taskIds;
            update.isEdited = true;
            update.lastEditedAt = new Date();
            await update.save();
        } else {
            // Create new update
            update = await StatusUpdate.create({
                companyId: companyObjId,
                employeeId: employeeObjId,
                date: dateStr,
                statusCategory: dto.statusCategory || 'IN_PROGRESS',
                todayWork: dto.todayWork.trim(),
                currentWork: (dto.currentWork || '').trim(),
                nextWork: (dto.nextWork || '').trim(),
                blockers: (dto.blockers || '').trim(),
                additionalComments: (dto.additionalComments || '').trim(),
                associatedProjects: projectIds,
                associatedTasks: taskIds,
            });
        }

        // Trigger notification if blockers are reported
        if (update.blockers && update.blockers.trim().length > 0) {
            try {
                const user = await User.findById(employeeObjId).select('name email').lean();
                NotificationEventBus.getInstance().publish({
                    type: 'STATUS_UPDATE_BLOCKER_REPORTED' as any,
                    companyId,
                    actorId: employeeId,
                    recipientIds: [], // Event bus or admin notification handlers distribute
                    entityId: update._id.toString(),
                    entityType: 'STATUS_UPDATE',
                    metadata: {
                        date: dateStr,
                        employeeName: user?.name || 'Employee',
                        blockers: update.blockers,
                    },
                });
            } catch (err) {
                // Non-blocking notification emission
                console.error('Failed to dispatch status blocker notification:', err);
            }
        }

        return await this.getStatusUpdateById(companyId, employeeId, update._id.toString(), true);
    }

    /**
     * Edit existing status update by the owner.
     */
    static async updateStatusUpdate(
        companyId: string,
        employeeId: string,
        updateId: string,
        dto: UpdateStatusUpdateDto
    ): Promise<IStatusUpdateDocument> {
        if (!Types.ObjectId.isValid(updateId)) {
            throw AppError.badRequest('Invalid status update ID format.');
        }

        const update = await StatusUpdate.findOne({
            _id: new Types.ObjectId(updateId),
            companyId: new Types.ObjectId(companyId),
            employeeId: new Types.ObjectId(employeeId),
        });

        if (!update) {
            throw AppError.notFound('Status update not found or you do not have permission to edit it.');
        }

        if (dto.todayWork !== undefined) {
            if (!dto.todayWork.trim()) throw AppError.badRequest('Today’s work cannot be empty.');
            update.todayWork = dto.todayWork.trim();
        }

        if (dto.statusCategory) update.statusCategory = dto.statusCategory;
        if (dto.currentWork !== undefined) update.currentWork = dto.currentWork.trim();
        if (dto.nextWork !== undefined) update.nextWork = dto.nextWork.trim();
        if (dto.blockers !== undefined) update.blockers = dto.blockers.trim();
        if (dto.additionalComments !== undefined) update.additionalComments = dto.additionalComments.trim();

        if (dto.associatedProjects) {
            update.associatedProjects = dto.associatedProjects
                .filter((id) => Types.ObjectId.isValid(id))
                .map((id) => new Types.ObjectId(id));
        }

        if (dto.associatedTasks) {
            update.associatedTasks = dto.associatedTasks
                .filter((id) => Types.ObjectId.isValid(id))
                .map((id) => new Types.ObjectId(id));
        }

        update.isEdited = true;
        update.lastEditedAt = new Date();
        await update.save();

        return await this.getStatusUpdateById(companyId, employeeId, update._id.toString(), true);
    }

    /**
     * Get member's own status update history.
     */
    static async getMemberStatusUpdates(
        companyId: string,
        employeeId: string,
        query: StatusUpdateFilterQuery
    ) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 15));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
            employeeId: new Types.ObjectId(employeeId),
        };

        if (query.date) {
            filter.date = query.date;
        } else if (query.startDate && query.endDate) {
            filter.date = { $gte: query.startDate, $lte: query.endDate };
        } else if (query.startDate) {
            filter.date = { $gte: query.startDate };
        } else if (query.endDate) {
            filter.date = { $lte: query.endDate };
        }

        if (query.statusCategory) {
            filter.statusCategory = query.statusCategory;
        }

        if (query.hasBlockers === true || query.hasBlockers === 'true') {
            filter.blockers = { $exists: true, $ne: '' };
        }

        if (query.search && query.search.trim()) {
            const regex = new RegExp(query.search.trim(), 'i');
            filter.$or = [
                { todayWork: regex },
                { currentWork: regex },
                { nextWork: regex },
                { blockers: regex },
            ];
        }

        const [updates, total] = await Promise.all([
            StatusUpdate.find(filter)
                .sort({ date: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('associatedProjects', 'name color code status')
                .populate('associatedTasks', 'title status priority taskNumber dueDate')
                .populate('feedback.authorId', 'name email avatar role designation')
                .lean(),
            StatusUpdate.countDocuments(filter),
        ]);

        return {
            updates,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get Company Admin high-level Status Overview statistics.
     */
    static async getCompanyStatusOverview(companyId: string, query: { date?: string; startDate?: string; endDate?: string } = {}) {
        const companyObjId = new Types.ObjectId(companyId);
        const targetDate = query.date ? query.date.trim() : this.getTodayDateString();

        // 1. Total active workforce in company (resilient to schema configurations)
        let totalEmployees = 1;
        try {
            const [activeCompanyMembersCount, activeUsersCount] = await Promise.all([
                CompanyMember.countDocuments({ companyId: companyObjId, status: 'ACTIVE' }),
                User.countDocuments({ companyId: companyObjId, isDeleted: false }),
            ]);
            totalEmployees = Math.max(activeCompanyMembersCount, activeUsersCount, 1);
        } catch {
            totalEmployees = Math.max(1, await User.countDocuments({ companyId: companyObjId }));
        }

        // 2. Query date filter
        const dateFilter: Record<string, any> = { companyId: companyObjId };
        if (query.date) {
            dateFilter.date = query.date.trim();
        } else if (query.startDate && query.endDate) {
            dateFilter.date = { $gte: query.startDate.trim(), $lte: query.endDate.trim() };
        } else if (query.startDate) {
            dateFilter.date = { $gte: query.startDate.trim() };
        } else if (query.endDate) {
            dateFilter.date = { $lte: query.endDate.trim() };
        } else {
            dateFilter.date = targetDate;
        }

        // 3. Status updates for the selected period
        const periodUpdates = await StatusUpdate.find(dateFilter).select('employeeId statusCategory blockers').lean();

        const uniqueSubmitters = new Set<string>();
        let completedCount = 0;
        let inProgressCount = 0;
        let pendingCount = 0;
        let blockedCount = 0;

        for (const u of periodUpdates) {
            uniqueSubmitters.add(u.employeeId.toString());
            if (u.statusCategory === 'COMPLETED') completedCount++;
            else if (u.statusCategory === 'IN_PROGRESS') inProgressCount++;
            else if (u.statusCategory === 'PENDING') pendingCount++;
            else if (u.statusCategory === 'BLOCKED') blockedCount++;

            // If explicit blockers text present and not counted yet in blockedCount
            if (u.blockers && u.blockers.trim().length > 0 && u.statusCategory !== 'BLOCKED') {
                blockedCount++;
            }
        }

        const employeesSubmitted = uniqueSubmitters.size;
        const effectiveWorkforce = Math.max(totalEmployees, employeesSubmitted);
        const employeesNotSubmitted = Math.max(0, effectiveWorkforce - employeesSubmitted);

        // 4. All-time status updates in company
        const totalAllTimeUpdates = await StatusUpdate.countDocuments({ companyId: companyObjId });

        return {
            targetDate,
            totalAllTimeUpdates,
            totalPeriodUpdates: periodUpdates.length,
            totalEmployees: effectiveWorkforce,
            employeesSubmitted,
            employeesNotSubmitted,
            completedCount,
            inProgressCount,
            pendingCount,
            blockedCount,
        };
    }

    /**
     * Company Admin monitoring feed: paginated and multi-filter.
     */
    static async getCompanyStatusUpdates(
        companyId: string,
        query: StatusUpdateFilterQuery
    ) {
        const companyObjId = new Types.ObjectId(companyId);
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            companyId: companyObjId,
        };

        // Specific employee filter
        if (query.employeeId && Types.ObjectId.isValid(query.employeeId)) {
            filter.employeeId = new Types.ObjectId(query.employeeId);
        }

        // Team filter: resolve member IDs from Team
        if (query.teamId && Types.ObjectId.isValid(query.teamId)) {
            const team = await Team.findOne({
                _id: new Types.ObjectId(query.teamId),
                companyId: companyObjId,
            }).select('memberIds leadId managerIds').lean();

            if (team) {
                const teamUserIds = [
                    ...(team.memberIds || []),
                    ...(team.managerIds || []),
                    ...(team.leadId ? [team.leadId] : []),
                ];
                filter.employeeId = { $in: teamUserIds };
            }
        }

        // Project filter
        if (query.projectId === 'NONE' || query.projectId === 'UNASSIGNED') {
            filter.$or = [
                { associatedProjects: { $size: 0 } },
                { associatedProjects: { $exists: false } },
            ];
        } else if (query.projectId && Types.ObjectId.isValid(query.projectId)) {
            filter.associatedProjects = new Types.ObjectId(query.projectId);
        }

        // Date filters
        if (query.date) {
            filter.date = query.date;
        } else if (query.startDate && query.endDate) {
            filter.date = { $gte: query.startDate, $lte: query.endDate };
        } else if (query.startDate) {
            filter.date = { $gte: query.startDate };
        } else if (query.endDate) {
            filter.date = { $lte: query.endDate };
        }

        // Status Category filter
        if (query.statusCategory) {
            filter.statusCategory = query.statusCategory;
        }

        // Blockers filter
        if (query.hasBlockers === true || query.hasBlockers === 'true') {
            filter.$or = [
                { statusCategory: 'BLOCKED' },
                { blockers: { $exists: true, $ne: '' } },
            ];
        }

        // Text search
        if (query.search && query.search.trim()) {
            const regex = new RegExp(query.search.trim(), 'i');
            // Check matching users first
            const matchingUsers = await User.find({
                companyId: companyObjId,
                $or: [{ name: regex }, { email: regex }, { designation: regex }],
            }).select('_id').lean();

            const userIds = matchingUsers.map((u) => u._id);

            filter.$or = [
                { employeeId: { $in: userIds } },
                { todayWork: regex },
                { currentWork: regex },
                { nextWork: regex },
                { blockers: regex },
            ];
        }

        const [updates, total] = await Promise.all([
            StatusUpdate.find(filter)
                .sort({ date: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('employeeId', 'name email avatar role designation')
                .populate('associatedProjects', 'name color code status')
                .populate('associatedTasks', 'title status priority taskNumber dueDate')
                .populate('feedback.authorId', 'name email avatar role designation')
                .lean(),
            StatusUpdate.countDocuments(filter),
        ]);

        return {
            updates,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Single status update lookup.
     */
    static async getStatusUpdateById(
        companyId: string,
        userId: string,
        updateId: string,
        isAdmin: boolean
    ): Promise<IStatusUpdateDocument> {
        if (!Types.ObjectId.isValid(updateId)) {
            throw AppError.badRequest('Invalid status update ID format.');
        }

        const update = await StatusUpdate.findOne({
            _id: new Types.ObjectId(updateId),
            companyId: new Types.ObjectId(companyId),
        })
            .populate('employeeId', 'name email avatar role designation')
            .populate('associatedProjects', 'name color code status')
            .populate('associatedTasks', 'title status priority taskNumber dueDate')
            .populate('feedback.authorId', 'name email avatar role designation');

        if (!update) {
            throw AppError.notFound('Status update not found.');
        }

        if (!isAdmin && update.employeeId._id.toString() !== userId && update.employeeId.toString() !== userId) {
            throw AppError.forbidden('You are not authorized to view another employee’s status update.');
        }

        return update;
    }

    /**
     * Add admin or manager feedback to a status update.
     */
    static async addFeedback(
        companyId: string,
        authorId: string,
        authorRole: string,
        updateId: string,
        comment: string
    ): Promise<IStatusUpdateDocument> {
        if (!Types.ObjectId.isValid(updateId)) {
            throw AppError.badRequest('Invalid status update ID format.');
        }

        if (!comment || !comment.trim()) {
            throw AppError.badRequest('Feedback comment cannot be empty.');
        }

        const update = await StatusUpdate.findOne({
            _id: new Types.ObjectId(updateId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!update) {
            throw AppError.notFound('Status update not found.');
        }

        update.feedback.push({
            comment: comment.trim(),
            authorId: new Types.ObjectId(authorId),
            authorRole: authorRole || 'COMPANY_ADMIN',
            createdAt: new Date(),
        });

        await update.save();

        // Dispatch feedback notification to the employee
        try {
            const author = await User.findById(authorId).select('name email avatar').lean();
            NotificationEventBus.getInstance().publish({
                type: 'STATUS_UPDATE_FEEDBACK_ADDED' as any,
                companyId,
                actorId: authorId,
                recipientIds: [update.employeeId.toString()],
                entityId: update._id.toString(),
                entityType: 'STATUS_UPDATE',
                metadata: {
                    date: update.date,
                    authorName: author?.name || 'Administrator',
                    comment: comment.trim(),
                },
            });
        } catch (err) {
            console.error('Failed to dispatch status feedback notification:', err);
        }

        return await this.getStatusUpdateById(companyId, authorId, updateId, true);
    }
}

