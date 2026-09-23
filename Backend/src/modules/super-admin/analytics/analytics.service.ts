import { User } from '../../users/user.model';
import { Company } from '../companies/company.model';
import { Project } from '../../companyadmin/projects/project.model';
import { Task } from '../../tasks/task.model';
import { Attendance, AttendanceStatus } from '../../attendance/attendance.model';
import { AuthSession } from '../../auth/session/auth-session.model';
import { FileModel } from '../../files/file.model';
import { Message } from '../../chat/message.model';
import { Call } from '../../calls/call.model';
import { ParsedDateRange } from '../shared/date-range.util';
import {
    GrowthAnalyticsData,
    ProjectsAnalyticsSummary,
    WorkforceAnalyticsData,
    PlatformUsageAnalyticsData,
} from './analytics.types';

export class SuperAdminAnalyticsService {
    /**
     * User growth time-series.
     */
    public static async getUserGrowth(dateRange: ParsedDateRange): Promise<GrowthAnalyticsData> {
        const [total, points] = await Promise.all([
            User.countDocuments({ status: { $ne: 'DEACTIVATED' } }),
            User.aggregate([
                {
                    $match: {
                        createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
                        status: { $ne: 'DEACTIVATED' },
                    },
                },
                {
                    $group: {
                        _id: { $dateToString: { format: dateRange.dateFormat, date: '$createdAt' } },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
        ]);

        return {
            range: dateRange.rangeKey,
            total,
            points: points.map((p: any) => ({
                date: p._id,
                count: p.count,
            })),
        };
    }

    /**
     * Company growth time-series.
     */
    public static async getCompanyGrowth(dateRange: ParsedDateRange): Promise<GrowthAnalyticsData> {
        const [total, points] = await Promise.all([
            Company.countDocuments({ status: { $ne: 'DELETED' } }),
            Company.aggregate([
                {
                    $match: {
                        createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
                        status: { $ne: 'DELETED' },
                    },
                },
                {
                    $group: {
                        _id: { $dateToString: { format: dateRange.dateFormat, date: '$createdAt' } },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
        ]);

        return {
            range: dateRange.rangeKey,
            total,
            points: points.map((p: any) => ({
                date: p._id,
                count: p.count,
            })),
        };
    }

    /**
     * Projects distribution analytics summary.
     */
    public static async getProjectsSummary(): Promise<ProjectsAnalyticsSummary> {
        const [total, byStatusAgg, byPriorityAgg, byTypeAgg] = await Promise.all([
            Project.countDocuments({ deletedAt: null }),
            Project.aggregate([
                { $match: { deletedAt: null } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            Project.aggregate([
                { $match: { deletedAt: null } },
                { $group: { _id: '$priority', count: { $sum: 1 } } },
            ]),
            Project.aggregate([
                { $match: { deletedAt: null } },
                { $group: { _id: '$type', count: { $sum: 1 } } },
            ]),
        ]);

        const byStatus: Record<string, number> = {};
        byStatusAgg.forEach((b: any) => {
            if (b._id) byStatus[b._id] = b.count;
        });

        const byPriority: Record<string, number> = {};
        byPriorityAgg.forEach((b: any) => {
            if (b._id) byPriority[b._id] = b.count;
        });

        const byType: Record<string, number> = {};
        byTypeAgg.forEach((b: any) => {
            if (b._id) byType[b._id] = b.count;
        });

        return {
            total,
            byStatus,
            byPriority,
            byType,
        };
    }

    /**
     * Workforce analytics.
     */
    public static async getWorkforceAnalytics(): Promise<WorkforceAnalyticsData> {
        const [
            totalUsers,
            activeUsers,
            inactiveUsers,
            activeCheckIns,
            totalTasks,
            completedTasks,
        ] = await Promise.all([
            User.countDocuments({ status: { $ne: 'DEACTIVATED' } }),
            User.countDocuments({ status: 'ACTIVE' }),
            User.countDocuments({ status: 'INACTIVE' }),
            Attendance.countDocuments({ status: AttendanceStatus.CHECKED_IN }),
            Task.countDocuments({}),
            Task.countDocuments({ progress: 100 }),
        ]);

        const attendanceRate = totalUsers > 0 ? Math.round((activeCheckIns / totalUsers) * 1000) / 10 : 0;
        const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 1000) / 10 : 0;

        return {
            totalUsers,
            activeUsers,
            inactiveUsers,
            activeCheckIns,
            attendanceRate,
            taskCompletionRate,
        };
    }

    /**
     * Platform usage analytics.
     */
    public static async getPlatformUsage(): Promise<PlatformUsageAnalyticsData> {
        const [activeSessions, fileAgg, totalMessages, totalCalls] = await Promise.all([
            AuthSession.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),
            FileModel.aggregate([
                { $match: { status: 'ACTIVE' } },
                { $group: { _id: null, totalFiles: { $sum: 1 }, totalBytes: { $sum: '$size' } } },
            ]),
            Message.countDocuments({ isDeleted: false }),
            Call.countDocuments({}),
        ]);

        const totalFiles = fileAgg.length > 0 ? fileAgg[0].totalFiles : 0;
        const totalStorageBytes = fileAgg.length > 0 ? fileAgg[0].totalBytes : 0;

        return {
            activeSessions,
            totalFiles,
            totalStorageBytes,
            totalMessages,
            totalCalls,
        };
    }
}
