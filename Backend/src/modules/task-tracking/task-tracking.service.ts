import mongoose from 'mongoose';
import { TimeTracking, TrackingState, IntervalType, ITimeTracking } from './time-tracking.model';
import { Attendance, AttendanceStatus } from '../attendance/attendance.model';
import { Task } from '../tasks/task.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { TaskActivity, ActivityType } from '../task-activities/task-activity.model';

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
}
