import { AppError } from '../../utils/AppError';
import { Task } from '../tasks/task.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { TimeTracking, IntervalType } from '../task-tracking/time-tracking.model';

export class TaskIntelligenceService {
    
    /**
     * Calculate task intelligence and health deterministically.
     */
    static async getTaskIntelligence(companyId: string, userId: string, taskId: string) {
        // 1. Verify Task & Project Authorization
        const task = await Task.findOne({ _id: taskId, companyId, isActive: true }).lean();
        if (!task) {
            throw AppError.notFound('TASK_NOT_FOUND_OR_INACTIVE');
        }

        const projectId = task.projectId.toString();
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) {
            throw AppError.forbidden('UNAUTHORIZED_PROJECT_ACCESS');
        }

        // 2. Aggregate TimeTracking data for this task
        const trackingSessions = await TimeTracking.find({ companyId, taskId }).lean();
        
        let totalWorkedSeconds = 0;
        let totalHoldSeconds = 0;
        let holdCount = 0;
        let topHoldReason = 'OTHER';

        const holdReasonCounts: Record<string, number> = {};

        for (const session of trackingSessions) {
            totalWorkedSeconds += session.workedSeconds || 0;
            
            for (const interval of session.intervals) {
                if (interval.type === IntervalType.HOLD && interval.endedAt) {
                    holdCount++;
                    const duration = Math.floor((interval.endedAt.getTime() - interval.startedAt.getTime()) / 1000);
                    totalHoldSeconds += duration;
                    
                    const reason = interval.reason || 'OTHER';
                    holdReasonCounts[reason] = (holdReasonCounts[reason] || 0) + 1;
                }
            }
        }

        if (Object.keys(holdReasonCounts).length > 0) {
            topHoldReason = Object.keys(holdReasonCounts).reduce((a, b) => holdReasonCounts[a] > holdReasonCounts[b] ? a : b);
        }

        // Add legacy actualHours if present on task model
        if (task.actualHours) {
            totalWorkedSeconds += task.actualHours * 3600;
        }

        // 3. Estimated vs Actual
        let estimatedSeconds = 0;
        if (task.estimatedTime) {
            estimatedSeconds = (task.estimatedTime.hours * 3600) + (task.estimatedTime.minutes * 60);
        }
        
        const remainingSeconds = Math.max(0, estimatedSeconds - totalWorkedSeconds);
        const varianceSeconds = totalWorkedSeconds - estimatedSeconds;
        const overtimeSeconds = Math.max(0, varianceSeconds);

        const progressPercentage = task.progress || 0;
        let timeConsumedPercentage = 0;
        if (estimatedSeconds > 0) {
            timeConsumedPercentage = Math.round((totalWorkedSeconds / estimatedSeconds) * 100);
        } else if (totalWorkedSeconds > 0) {
            timeConsumedPercentage = 100; // No estimate but time consumed
        }

        // 4. Health Calculation
        let healthStatus = 'ON_TRACK';
        let healthScore = 100;
        const reasons: string[] = [];

        // Simple deterministic rule set
        if (progressPercentage === 100) {
            healthStatus = 'COMPLETED';
            healthScore = 100;
            reasons.push('Task is fully completed');
        } else {
            // Deduct score based on variance between time consumed and progress
            if (timeConsumedPercentage > progressPercentage + 20) {
                healthScore -= 20;
                reasons.push(`${timeConsumedPercentage}% of estimated time consumed but progress is only ${progressPercentage}%`);
            }
            
            // Deduct score based on hold time
            if (totalHoldSeconds > 3600) {
                healthScore -= 15;
                reasons.push(`Task has spent ${Math.round(totalHoldSeconds / 60)} minutes on hold`);
            }
            
            // Deduct for overtime
            if (overtimeSeconds > 0) {
                healthScore -= 25;
                reasons.push(`Task is in overtime by ${Math.round(overtimeSeconds / 60)} minutes`);
            }

            if (healthScore <= 40) {
                healthStatus = 'CRITICAL';
            } else if (healthScore <= 70) {
                healthStatus = 'AT_RISK';
            }
        }

        // 5. Deadline Risk
        let deadlineRiskStatus = 'SAFE';
        let availableSeconds = 0;
        let deadlineMessage = 'No deadline specified.';

        if (task.dueDate && healthStatus !== 'COMPLETED') {
            const now = new Date();
            const dueDate = new Date(task.dueDate);
            availableSeconds = Math.max(0, Math.floor((dueDate.getTime() - now.getTime()) / 1000));
            
            if (availableSeconds === 0) {
                deadlineRiskStatus = 'CRITICAL';
                deadlineMessage = 'Task is past its deadline.';
            } else if (remainingSeconds > availableSeconds) {
                deadlineRiskStatus = 'CRITICAL';
                deadlineMessage = 'Remaining estimated work exceeds the available time before the deadline.';
            } else if (remainingSeconds > availableSeconds * 0.8) {
                deadlineRiskStatus = 'WATCH';
                deadlineMessage = 'Remaining estimated work is close to the available time before the deadline.';
            } else {
                deadlineRiskStatus = 'SAFE';
                deadlineMessage = 'Sufficient time remains before the deadline.';
            }
        }

        return {
            taskId,
            projectId,
            time: {
                estimatedSeconds,
                workedSeconds: totalWorkedSeconds,
                remainingSeconds,
                overtimeSeconds
            },
            progress: {
                percentage: progressPercentage
            },
            health: {
                status: healthStatus,
                score: Math.max(0, healthScore),
                reasons
            },
            blocking: {
                holdCount,
                holdSeconds: totalHoldSeconds,
                topReason: topHoldReason
            },
            deadlineRisk: {
                status: deadlineRiskStatus,
                remainingWorkSeconds: remainingSeconds,
                availableSeconds,
                message: deadlineMessage
            }
        };
    }
}
