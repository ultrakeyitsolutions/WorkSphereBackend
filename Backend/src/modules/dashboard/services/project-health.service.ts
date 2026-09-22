import { ProjectHealthItem, ProjectHealthStatus } from '../dashboard.types';

export interface ProjectHealthInput {
    projectId: string;
    projectName: string;
    endDate: Date | string | null;
    totalTasks: number;
    completedTasks: number;
    overdueTasks: number;
    progressPercentage: number;
    unresolvedBlockers?: number;
    isEmployeeScope?: boolean;
    myTasks?: number;
    myCompletedTasks?: number;
    myOverdueTasks?: number;
    myProgressPercentage?: number;
}

export const PROJECT_HEALTH_CONFIG = {
    overdueTaskThreshold: 3,
    criticalOverdueTaskThreshold: 8,
    deadlineWarningDays: 3,
    minimumExpectedProgressRatio: 0.7,
};

export class ProjectHealthService {
    public static evaluate(project: ProjectHealthInput, now = new Date()): ProjectHealthItem {
        const reasons: string[] = [];
        let isDelayed = false;
        let isAtRisk = false;

        const endDate = project.endDate ? new Date(project.endDate) : null;
        const total = project.totalTasks || 0;
        const completed = project.completedTasks || 0;
        const overdue = project.overdueTasks || 0;
        const progress = project.progressPercentage || (total > 0 ? (completed / total) * 100 : 0);
        const blockers = project.unresolvedBlockers || 0;

        if (project.isEmployeeScope) {
            // For Employee: Focus on their assigned tasks and personal progress
            const myOverdue = project.myOverdueTasks || 0;
            const myProgress = project.myProgressPercentage || 0;

            if (myOverdue > 0) {
                reasons.push(`You have ${myOverdue} overdue task${myOverdue > 1 ? 's' : ''}`);
                isAtRisk = true;
            } else {
                reasons.push('Your tasks are on track');
            }

            return {
                projectId: project.projectId,
                projectName: project.projectName,
                status: isAtRisk ? 'at_risk' : 'on_track',
                reasons,
                myProgressPercentage: myProgress,
                myOverdueTasks: myOverdue,
            };
        }

        // Company-wide Project Evaluation
        if (endDate && endDate < now && progress < 100) {
            isDelayed = true;
            const formattedDate = endDate.toISOString().split('T')[0];
            reasons.push(`Deadline passed on ${formattedDate}`);
        }

        if (overdue >= PROJECT_HEALTH_CONFIG.criticalOverdueTaskThreshold) {
            isDelayed = true;
            reasons.push(`${overdue} overdue tasks (exceeds critical threshold)`);
        } else if (overdue >= PROJECT_HEALTH_CONFIG.overdueTaskThreshold) {
            isAtRisk = true;
            reasons.push(`${overdue} overdue tasks`);
        } else if (overdue > 0) {
            reasons.push(`${overdue} overdue task${overdue > 1 ? 's' : ''}`);
        }

        if (endDate && endDate >= now) {
            const diffMs = endDate.getTime() - now.getTime();
            const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

            if (daysRemaining <= PROJECT_HEALTH_CONFIG.deadlineWarningDays) {
                const expectedProgress = PROJECT_HEALTH_CONFIG.minimumExpectedProgressRatio * 100;
                if (progress < expectedProgress) {
                    isAtRisk = true;
                    reasons.push(
                        `Deadline is within ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} with only ${Math.round(progress)}% progress`
                    );
                }
            }
        }

        if (blockers > 0) {
            isAtRisk = true;
            reasons.push(`${blockers} unresolved blocker${blockers > 1 ? 's' : ''}`);
        }

        let status: ProjectHealthStatus = 'on_track';
        if (isDelayed) {
            status = 'delayed';
        } else if (isAtRisk) {
            status = 'at_risk';
        } else {
            reasons.push('Project is on schedule');
        }

        return {
            projectId: project.projectId,
            projectName: project.projectName,
            status,
            reasons,
        };
    }
}
