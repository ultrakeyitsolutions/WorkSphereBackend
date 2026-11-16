import { Types } from 'mongoose';
import { Task } from '../../tasks/task.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import {
    ResolvedDateRange,
    CompanyDeliveryTrendsData,
    DeliveryTrendBucket,
} from '../dashboard.types';
import { DashboardDateRangeService } from '../services/dashboard-date-range.service';

export class DeliveryTrendsAnalytics {
    public static async getTrends(
        companyId: Types.ObjectId,
        dateRange: ResolvedDateRange,
        requestedInterval?: 'hour' | 'day' | 'week' | 'month',
        filterProjectId?: Types.ObjectId,
        now = new Date()
    ): Promise<CompanyDeliveryTrendsData> {
        const daysCount = dateRange.days.length;
        let interval: 'day' | 'week' | 'month' = 'day';

        if (requestedInterval === 'month' || requestedInterval === 'week' || requestedInterval === 'day') {
            interval = requestedInterval;
        } else {
            if (daysCount > 60) {
                interval = 'month';
            } else if (daysCount > 14) {
                interval = 'week';
            } else {
                interval = 'day';
            }
        }

        const buckets = this.buildBuckets(dateRange, interval);

        const taskMatch: any = {
            companyId,
            isArchived: { $ne: true },
            isDeleted: { $ne: true },
        };
        if (filterProjectId) {
            taskMatch.projectId = filterProjectId;
        }

        const projectMatch: any = {
            companyId,
            deletedAt: null,
            status: { $ne: ProjectStatus.ARCHIVED },
        };
        if (filterProjectId) {
            projectMatch._id = filterProjectId;
        }

        // Parallel queries for tasks, time tracking, and projects within the entire period
        const [plannedResults, completedResults, timeTrackingResults, projectsDueResults, projectsCompletedResults] = await Promise.all([
            Task.find({
                ...taskMatch,
                dueDate: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            })
                .select('_id dueDate')
                .lean(),
            Task.find({
                ...taskMatch,
                completedDate: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            })
                .select('_id completedDate')
                .lean(),
            TimeTracking.find({
                companyId,
                startedAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
                ...(filterProjectId ? { projectId: filterProjectId } : {}),
            })
                .select('_id startedAt workedSeconds')
                .lean(),
            Project.find({
                ...projectMatch,
                endDate: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            })
                .select('_id endDate')
                .lean(),
            Project.find({
                ...projectMatch,
                status: ProjectStatus.COMPLETED,
                $or: [
                    { actualEndDate: { $gte: dateRange.startDate, $lte: dateRange.endDate } },
                    { actualEndDate: null, updatedAt: { $gte: dateRange.startDate, $lte: dateRange.endDate } },
                ],
            })
                .select('_id actualEndDate updatedAt')
                .lean(),
        ]);

        // Bin records into buckets
        for (const bucket of buckets) {
            const bStart = new Date(bucket.periodStart).getTime();
            const bEnd = new Date(bucket.periodEnd).getTime();

            // Tasks planned & completed
            bucket.plannedTasks = plannedResults.filter((t) => {
                const due = t.dueDate ? new Date(t.dueDate).getTime() : 0;
                return due >= bStart && due <= bEnd;
            }).length;

            bucket.completedTasks = completedResults.filter((t) => {
                const comp = t.completedDate ? new Date(t.completedDate).getTime() : 0;
                return comp >= bStart && comp <= bEnd;
            }).length;

            bucket.completionRate = bucket.plannedTasks > 0
                ? Math.round((bucket.completedTasks / bucket.plannedTasks) * 10000) / 100
                : (bucket.completedTasks > 0 ? 100 : null);

            // Tracked work hours
            const bucketSeconds = timeTrackingResults
                .filter((tt) => {
                    const st = tt.startedAt ? new Date(tt.startedAt).getTime() : 0;
                    return st >= bStart && st <= bEnd;
                })
                .reduce((acc, tt) => acc + (tt.workedSeconds || 0), 0);
            bucket.trackedHours = Math.round((bucketSeconds / 3600) * 100) / 100;

            // Projects planned & completed
            bucket.projectsPlanned = projectsDueResults.filter((p) => {
                const due = p.endDate ? new Date(p.endDate).getTime() : 0;
                return due >= bStart && due <= bEnd;
            }).length;

            bucket.projectsCompleted = projectsCompletedResults.filter((p) => {
                const compDate = p.actualEndDate || (p as any).updatedAt || p.endDate;
                const comp = compDate ? new Date(compDate).getTime() : 0;
                return comp >= bStart && comp <= bEnd;
            }).length;
        }

        const totalPlanned = buckets.reduce((acc, b) => acc + b.plannedTasks, 0);
        const totalCompleted = buckets.reduce((acc, b) => acc + b.completedTasks, 0);
        const overallCompletionRate = totalPlanned > 0
            ? Math.round((totalCompleted / totalPlanned) * 10000) / 100
            : (totalCompleted > 0 ? 100 : null);

        return {
            meta: {
                period: dateRange.period,
                startDate: dateRange.startDateStr,
                endDate: dateRange.endDateStr,
                timezone: dateRange.timezone,
                generatedAt: now.toISOString(),
                scope: 'COMPANY',
                isCompanyWide: true,
                interval,
            },
            summary: {
                totalPlanned,
                totalCompleted,
                overallCompletionRate,
            },
            buckets,
        };
    }

    private static buildBuckets(
        dateRange: ResolvedDateRange,
        interval: 'day' | 'week' | 'month'
    ): DeliveryTrendBucket[] {
        const buckets: DeliveryTrendBucket[] = [];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const tz = dateRange.timezone;

        if (interval === 'day') {
            // Build 1 bucket per day using dateRange.days
            for (const dayStr of dateRange.days) {
                const [y, m, d] = dayStr.split('-').map(Number);
                const bStart = DashboardDateRangeService.getUtcDateForTimezone(y, m, d, 0, 0, 0, 0, tz);
                const bEnd = DashboardDateRangeService.getUtcDateForTimezone(y, m, d, 23, 59, 59, 999, tz);

                const label = `${monthNames[m - 1]} ${String(d).padStart(2, '0')}`;

                buckets.push({
                    date: dayStr,
                    label,
                    periodStart: bStart.toISOString(),
                    periodEnd: bEnd.toISOString(),
                    plannedTasks: 0,
                    completedTasks: 0,
                    completionRate: null,
                    trackedHours: 0,
                    projectsPlanned: 0,
                    projectsCompleted: 0,
                });
            }
        } else if (interval === 'week') {
            let cursor = new Date(dateRange.startDate.getTime());
            while (cursor.getTime() <= dateRange.endDate.getTime()) {
                const bStart = new Date(cursor.getTime());
                const bEnd = new Date(Math.min(cursor.getTime() + 7 * 24 * 3600 * 1000 - 1, dateRange.endDate.getTime()));

                const sParts = DashboardDateRangeService.getDatePartsInTimezone(bStart, tz);
                const eParts = DashboardDateRangeService.getDatePartsInTimezone(bEnd, tz);

                const dateStr = `${sParts.year}-${String(sParts.month).padStart(2, '0')}-${String(sParts.day).padStart(2, '0')}`;
                const label = `${monthNames[sParts.month - 1]} ${sParts.day} - ${monthNames[eParts.month - 1]} ${eParts.day}`;

                buckets.push({
                    date: dateStr,
                    label,
                    periodStart: bStart.toISOString(),
                    periodEnd: bEnd.toISOString(),
                    plannedTasks: 0,
                    completedTasks: 0,
                    completionRate: null,
                    trackedHours: 0,
                    projectsPlanned: 0,
                    projectsCompleted: 0,
                });

                cursor = new Date(cursor.getTime() + 7 * 24 * 3600 * 1000);
            }
        } else {
            // Month interval
            let cursor = new Date(dateRange.startDate.getTime());
            while (cursor.getTime() <= dateRange.endDate.getTime()) {
                const parts = DashboardDateRangeService.getDatePartsInTimezone(cursor, tz);
                const bStart = DashboardDateRangeService.getUtcDateForTimezone(parts.year, parts.month, 1, 0, 0, 0, 0, tz);
                const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
                const bEnd = DashboardDateRangeService.getUtcDateForTimezone(parts.year, parts.month, lastDay, 23, 59, 59, 999, tz);

                const dateStr = `${parts.year}-${String(parts.month).padStart(2, '0')}`;
                const label = `${monthNames[parts.month - 1]} ${parts.year}`;

                buckets.push({
                    date: dateStr,
                    label,
                    periodStart: bStart.toISOString(),
                    periodEnd: bEnd.toISOString(),
                    plannedTasks: 0,
                    completedTasks: 0,
                    completionRate: null,
                    trackedHours: 0,
                    projectsPlanned: 0,
                    projectsCompleted: 0,
                });

                // Advance cursor by ~31 days
                cursor = new Date(bEnd.getTime() + 1000);
            }
        }

        return buckets;
    }
}
