import mongoose from 'mongoose';
import { TimeTracking, TrackingState, IntervalType, ITimeTracking } from './time-tracking.model';
import { Attendance, AttendanceStatus } from '../attendance/attendance.model';
import { Task } from '../tasks/task.model';
import { Stage } from '../tasks/stage.model';
import { Status } from '../tasks/status.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { Project, ProjectInCharge } from '../companyadmin/projects/project.model';
import { TaskActivity, ActivityType } from '../task-activities/task-activity.model';
import { TaskExplanationRatingService } from '../task-explanation-rating/task-explanation-rating.service';
import { UserService } from '../users/user.service';
import { AppError } from '../../utils/AppError';

export class TaskTrackingService {
    
    /**
     * Start tracking a task. Enforces attendance, authorization, and single active session.
     */
    static async startTracking(companyId: string, userId: string, taskId: string): Promise<ITimeTracking> {
        // 1. Verify Active Check-In
        const activeAttendance = await Attendance.findOne({
            companyId,
            userId,
            status: AttendanceStatus.CHECKED_IN
        }).lean();
        
        if (!activeAttendance) {
            throw AppError.forbidden('ATTENDANCE_REQUIRED');
        }

        // 2. Verify Task & Project Authorization
        const task = await Task.findOne({ _id: taskId, companyId, isActive: true }).lean();
        if (!task) {
            throw AppError.notFound('TASK_NOT_FOUND_OR_INACTIVE');
        }

        const projectId = task.projectId.toString();
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) {
            throw AppError.forbidden('UNAUTHORIZED_PROJECT_ACCESS');
        }

        // 3. Verify user has rated the task explanation
        const hasRated = await TaskExplanationRatingService.hasUserRatedTask(companyId, userId, taskId);
        if (!hasRated) {
            throw AppError.forbidden('RATING_REQUIRED');
        }

        const startedAt = new Date();

        // 3. Prevent duplicate active tasks using atomic update (find/upsert or transaction).
        // Since we have a partial unique index on active states, attempting to create
        // another active tracking session will throw a MongoDB duplicate key error.
        let trackingSession: ITimeTracking;

        try {
            trackingSession = await TimeTracking.create({
                companyId,
                userId,
                projectId,
                taskId,
                state: TrackingState.TRACKING,
                startedAt,
                workedSeconds: 0,
                intervals: [{
                    type: IntervalType.WORK,
                    startedAt
                }]
            });
        } catch (error: any) {
            // 11000 is MongoServerError for duplicate key
            if (error.code === 11000) {
                const existing = await TimeTracking.findOne({
                    userId,
                    state: { $in: [TrackingState.TRACKING, TrackingState.PAUSED, TrackingState.ON_HOLD] }
                }).lean();
                const err = AppError.conflict('ACTIVE_TASK_EXISTS');
                (err as any).details = { taskId: existing?.taskId.toString() };
                throw err;
            }
            throw error;
        }

        // 4. Record Activity Event
        await TaskActivity.create({
            companyId,
            projectId,
            taskId,
            userId,
            type: ActivityType.TASK_STARTED,
            content: 'Task tracking started.'
        });

        return trackingSession;
    }

    /**
     * Get the current active tracking session for a user.
     */
    static async getCurrentTracking(companyId: string, userId: string): Promise<ITimeTracking | null> {
        return await TimeTracking.findOne({
            companyId,
            userId,
            state: { $in: [TrackingState.TRACKING, TrackingState.PAUSED, TrackingState.ON_HOLD] }
        }).lean();
    }

    /**
     * Get task tracking info by taskId for the authenticated user.
     */
    static async getTrackingByTask(companyId: string, userId: string, taskId: string): Promise<ITimeTracking | null> {
        return await TimeTracking.findOne({
            companyId,
            userId,
            taskId
        }).sort({ createdAt: -1 }).lean();
    }

    /**
     * Common helper for validating task/project access.
     */
    private static async validateTaskAccess(companyId: string, userId: string, taskId: string) {
        const task = await Task.findOne({ _id: taskId, companyId, isActive: true }).lean();
        if (!task) throw AppError.notFound('TASK_NOT_FOUND_OR_INACTIVE');

        const projectId = task.projectId.toString();
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('UNAUTHORIZED_PROJECT_ACCESS');

        return task;
    }

    /**
     * Pause an active tracking session.
     */
    static async pauseTracking(companyId: string, userId: string, taskId: string): Promise<ITimeTracking> {
        await this.validateTaskAccess(companyId, userId, taskId);

        const session = await TimeTracking.findOne({ companyId, userId, taskId, state: TrackingState.TRACKING });
        if (!session) throw AppError.conflict('TRACKING_SESSION_NOT_FOUND_OR_INVALID_STATE');

        const originalState = session.state;
        const now = new Date();
        const activeInterval = session.intervals[session.intervals.length - 1];

        if (activeInterval && activeInterval.type === IntervalType.WORK && !activeInterval.endedAt) {
            activeInterval.endedAt = now;
            const workedDuration = Math.floor((now.getTime() - activeInterval.startedAt.getTime()) / 1000);
            session.workedSeconds += Math.max(0, workedDuration);
        }

        session.state = TrackingState.PAUSED;
        session.intervals.push({ type: IntervalType.BREAK, startedAt: now });

        const updated = await TimeTracking.findOneAndUpdate(
            { _id: session._id, state: originalState, __v: session.__v },
            {
                $set: { state: session.state, intervals: session.intervals, workedSeconds: session.workedSeconds },
                $inc: { __v: 1 }
            },
            { new: true }
        );

        if (!updated) throw AppError.conflict('CONCURRENT_MODIFICATION');

        await TaskActivity.create({
            companyId, projectId: session.projectId, taskId, userId,
            type: ActivityType.TASK_PAUSED, content: 'Task tracking paused.'
        });

        return updated;
    }

    /**
     * Put an active tracking session on hold.
     */
    static async holdTracking(companyId: string, userId: string, taskId: string, reason: string): Promise<ITimeTracking> {
        if (!reason || reason.trim() === '') {
            throw AppError.badRequest('HOLD_REASON_REQUIRED');
        }

        await this.validateTaskAccess(companyId, userId, taskId);

        const session = await TimeTracking.findOne({ companyId, userId, taskId, state: TrackingState.TRACKING });
        if (!session) throw AppError.conflict('TRACKING_SESSION_NOT_FOUND_OR_INVALID_STATE');

        const originalState = session.state;
        const now = new Date();
        const activeInterval = session.intervals[session.intervals.length - 1];

        if (activeInterval && activeInterval.type === IntervalType.WORK && !activeInterval.endedAt) {
            activeInterval.endedAt = now;
            const workedDuration = Math.floor((now.getTime() - activeInterval.startedAt.getTime()) / 1000);
            session.workedSeconds += Math.max(0, workedDuration);
        }

        session.state = TrackingState.ON_HOLD;
        session.intervals.push({ type: IntervalType.HOLD, startedAt: now, reason: reason.trim() });

        const updated = await TimeTracking.findOneAndUpdate(
            { _id: session._id, state: originalState, __v: session.__v },
            {
                $set: { state: session.state, intervals: session.intervals, workedSeconds: session.workedSeconds },
                $inc: { __v: 1 }
            },
            { new: true }
        );

        if (!updated) throw AppError.conflict('CONCURRENT_MODIFICATION');

        await TaskActivity.create({
            companyId, projectId: session.projectId, taskId, userId,
            type: ActivityType.TASK_HELD, content: `Task tracking on hold. Reason: ${reason}`
        });

        return updated;
    }

    /**
     * Resume a paused or held tracking session.
     */
    static async resumeTracking(companyId: string, userId: string, taskId: string): Promise<ITimeTracking> {
        await this.validateTaskAccess(companyId, userId, taskId);

        const session = await TimeTracking.findOne({ 
            companyId, userId, taskId, 
            state: { $in: [TrackingState.PAUSED, TrackingState.ON_HOLD] } 
        });
        if (!session) throw AppError.conflict('TRACKING_SESSION_NOT_FOUND_OR_INVALID_STATE');

        const originalState = session.state;
        const now = new Date();
        const activeInterval = session.intervals[session.intervals.length - 1];

        if (activeInterval && !activeInterval.endedAt) {
            activeInterval.endedAt = now; // Do not add duration to workedSeconds for BREAK/HOLD
        }

        session.state = TrackingState.TRACKING;
        session.intervals.push({ type: IntervalType.WORK, startedAt: now });

        const updated = await TimeTracking.findOneAndUpdate(
            { _id: session._id, state: originalState, __v: session.__v },
            {
                $set: { state: session.state, intervals: session.intervals }, // no change to workedSeconds
                $inc: { __v: 1 }
            },
            { new: true }
        );

        if (!updated) throw AppError.conflict('CONCURRENT_MODIFICATION');

        await TaskActivity.create({
            companyId, projectId: session.projectId, taskId, userId,
            type: ActivityType.TASK_RESUMED, content: 'Task tracking resumed.'
        });

        return updated;
    }

    /**
     * Complete a tracking session.
     */
    static async completeTracking(companyId: string, userId: string, taskId: string): Promise<ITimeTracking> {
        await this.validateTaskAccess(companyId, userId, taskId);

        const session = await TimeTracking.findOne({ 
            companyId, userId, taskId, 
            state: { $in: [TrackingState.TRACKING, TrackingState.PAUSED, TrackingState.ON_HOLD] } 
        });
        if (!session) throw AppError.conflict('TRACKING_SESSION_NOT_FOUND_OR_INVALID_STATE');

        const originalState = session.state;
        const now = new Date();
        const activeInterval = session.intervals[session.intervals.length - 1];

        if (activeInterval && !activeInterval.endedAt) {
            activeInterval.endedAt = now;
            if (originalState === TrackingState.TRACKING) {
                const workedDuration = Math.floor((now.getTime() - activeInterval.startedAt.getTime()) / 1000);
                session.workedSeconds += Math.max(0, workedDuration);
            }
        }

        session.state = TrackingState.COMPLETED;
        session.endedAt = now;

        const updated = await TimeTracking.findOneAndUpdate(
            { _id: session._id, state: originalState, __v: session.__v },
            {
                $set: { 
                    state: session.state, 
                    endedAt: session.endedAt,
                    intervals: session.intervals, 
                    workedSeconds: session.workedSeconds 
                },
                $inc: { __v: 1 }
            },
            { new: true }
        );

        if (!updated) throw AppError.conflict('CONCURRENT_MODIFICATION');

        await TaskActivity.create({
            companyId, projectId: session.projectId, taskId, userId,
            type: ActivityType.TASK_COMPLETED, content: 'Task tracking completed.'
        });

        // Advance task to completed stage and set completedDate
        const completedStage = await Stage.findOne({ 
            projectId: session.projectId, 
            name: { $regex: /^completed$/i } 
        }).lean();
        const completedStatus = await Status.findOne({ 
            companyId, 
            name: { $regex: /^completed$/i } 
        }).lean();

        const updateFields: any = { completedDate: now };
        if (completedStage) updateFields.stageId = completedStage._id;
        if (completedStatus) updateFields.statusId = completedStatus._id;
        await Task.updateOne({ _id: taskId }, { $set: updateFields });

        return updated;
    }

    /**
     * Admin hold — put a member's active tracking session on hold on their behalf.
     * The caller (adminId) must be role 'Admin', a ProjectInCharge, or the project owner.
     *
     * POST /api/v1/company/task-tracking/admin-hold
     * Body: { taskId, targetUserId, reason }
     */
    static async adminHoldTracking(
        companyId: string,
        adminId: string,
        taskId: string,
        targetUserId: string | undefined,
        reason: string
    ): Promise<ITimeTracking> {
        if (!reason || reason.trim() === '') {
            throw AppError.badRequest('HOLD_REASON_REQUIRED');
        }

        // 1. Verify caller has admin/manager authority
        const isAdmin = await UserService.hasPermission(adminId, 'TASK_HOLD_OVERRIDE');
        if (!isAdmin) {
            // Fallback: check if caller is ProjectInCharge or project owner
            const task = await Task.findOne({ _id: taskId, companyId, isActive: true }).lean();
            if (!task) throw AppError.notFound('TASK_NOT_FOUND_OR_INACTIVE');

            const project = await Project.findOne({ _id: task.projectId, companyId }).lean();
            if (!project) throw AppError.notFound('PROJECT_NOT_FOUND');

            const isOwner = project.createdById?.toString() === adminId;
            const isInCharge = await ProjectInCharge.exists({ projectId: task.projectId, userId: adminId });

            if (!isOwner && !isInCharge) {
                throw AppError.forbidden('ADMIN_OR_MANAGER_REQUIRED');
            }
        }

        // 2. Verify the task exists within this company
        const task = await Task.findOne({ _id: taskId, companyId, isActive: true }).lean();
        if (!task) throw AppError.notFound('TASK_NOT_FOUND_OR_INACTIVE');

        // 3. Find the tracking session (either for specific targetUserId or any active/paused session on this task)
        const sessionQuery: any = {
            companyId,
            taskId,
            state: { $in: [TrackingState.TRACKING, TrackingState.PAUSED] }
        };
        if (targetUserId) {
            sessionQuery.userId = targetUserId;
        }

        const session = await TimeTracking.findOne(sessionQuery);

        if (!session) {
            throw AppError.conflict('NO_ACTIVE_TRACKING_SESSION_FOR_TASK');
        }

        // 4. Transition to ON_HOLD
        const originalState = session.state;
        const now = new Date();
        const activeInterval = session.intervals[session.intervals.length - 1];

        if (activeInterval && !activeInterval.endedAt) {
            activeInterval.endedAt = now;
            if (activeInterval.type === IntervalType.WORK) {
                const workedDuration = Math.floor((now.getTime() - activeInterval.startedAt.getTime()) / 1000);
                session.workedSeconds += Math.max(0, workedDuration);
            }
        }

        session.state = TrackingState.ON_HOLD;
        session.intervals.push({ type: IntervalType.HOLD, startedAt: now, reason: reason.trim() });

        const updated = await TimeTracking.findOneAndUpdate(
            { _id: session._id, state: originalState, __v: session.__v },
            {
                $set: { state: session.state, intervals: session.intervals, workedSeconds: session.workedSeconds },
                $inc: { __v: 1 }
            },
            { new: true }
        );

        if (!updated) throw AppError.conflict('CONCURRENT_MODIFICATION');

        // 5. Log task activity (shows who placed the hold)
        await TaskActivity.create({
            companyId,
            projectId: session.projectId,
            taskId,
            userId: adminId,
            type: ActivityType.TASK_HELD,
            content: `Task placed on hold by admin on behalf of member. Reason: ${reason.trim()}`
        });

        return updated;
    }
}
