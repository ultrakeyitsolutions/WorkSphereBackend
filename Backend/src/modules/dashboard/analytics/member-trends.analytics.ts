import { Types } from 'mongoose';
import { Task } from '../../tasks/task.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import {
    ResolvedDateRange,
    MemberWorkTrendsData,
    MemberTrendBucket,
} from '../dashboard.types';

export class MemberTrendsAnalytics {
    public static async getTrends(
        companyId: Types.ObjectId,
        userId: Types.ObjectId,
        dateRange: ResolvedDateRange,
        requestedInterval?: 'day' | 'week',
        now = new Date()
    ): Promise<MemberWorkTrendsData> {
        const daysCount = dateRange.days.length;
        const interval: 'day' | 'week' = requestedInterval || (daysCount > 14 ? 'week' : 'day');

        const buckets = this.buildBuckets(dateRange.startDate, dateRange.endDate, interval);

        const taskMatch: any = {
            companyId,
            assignedToId: userId,
            isArchived: { $ne: true },
            isDeleted: { $ne: true },
        };

        const [completedTasks, assignedTasks, trackingSessions] = await Promise.all([
            Task.find({
                ...taskMatch,
                completedDate: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            })
                .select('_id completedDate')
                .lean(),
            Task.find({
                ...taskMatch,
                createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            })
                .select('_id createdAt')
                .lean(),
            TimeTracking.find({
                companyId,
                userId,
                startedAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            })
                .select('startedAt workedSeconds')
                .lean(),
        ]);

        for (const bucket of buckets) {
            const bStart = new Date(bucket.periodStart).getTime();
            const bEnd = new Date(bucket.periodEnd).getTime();

            bucket.tasksCompleted = completedTasks.filter((t) => {
                const comp = t.completedDate ? new Date(t.completedDate).getTime() : 0;
                return comp >= bStart && comp <= bEnd;
            }).length;

            bucket.tasksAssigned = assignedTasks.filter((t) => {
                const created = t.createdAt ? new Date(t.createdAt).getTime() : 0;
                return created >= bStart && created <= bEnd;
            }).length;

            const totalSec = trackingSessions
                .filter((s) => {
                    const st = s.startedAt ? new Date(s.startedAt).getTime() : 0;
                    return st >= bStart && st <= bEnd;
                })
                .reduce((acc, cur) => acc + (cur.workedSeconds || 0), 0);

            bucket.trackedHours = Math.round((totalSec / 3600) * 100) / 100;
        }

        const totalTasksCompleted = buckets.reduce((acc, b) => acc + b.tasksCompleted, 0);
        const totalTrackedHours = Math.round(
            buckets.reduce((acc, b) => acc + b.trackedHours, 0) * 100
        ) / 100;

        return {
            meta: {
                period: dateRange.period,
                startDate: dateRange.startDateStr,
                endDate: dateRange.endDateStr,
                timezone: dateRange.timezone,
                generatedAt: now.toISOString(),
                scope: 'SELF',
                isCompanyWide: false,
                interval,
            },
            summary: {
                totalTasksCompleted,
                totalTrackedHours,
            },
            buckets,
        };
    }

    private static buildBuckets(
        startDate: Date,
        endDate: Date,
        interval: 'day' | 'week'
    ): (MemberTrendBucket & { periodStart: string; periodEnd: string })[] {
        const buckets: (MemberTrendBucket & { periodStart: string; periodEnd: string })[] = [];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        if (interval === 'day') {
            const cursor = new Date(startDate);
            cursor.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            while (cursor <= end) {
                const bStart = new Date(cursor);
                bStart.setHours(0, 0, 0, 0);
                const bEnd = new Date(cursor);
                bEnd.setHours(23, 59, 59, 999);

                const dateStr = `${bStart.getFullYear()}-${String(bStart.getMonth() + 1).padStart(2, '0')}-${String(bStart.getDate()).padStart(2, '0')}`;
                const label = `${monthNames[bStart.getMonth()]} ${String(bStart.getDate()).padStart(2, '0')}`;

                buckets.push({
                    date: dateStr,
                    label,
                    periodStart: bStart.toISOString(),
                    periodEnd: bEnd.toISOString(),
                    tasksCompleted: 0,
                    tasksAssigned: 0,
                    trackedHours: 0,
                });

                cursor.setDate(cursor.getDate() + 1);
            }
        } else {
            // Week interval
            const cursor = new Date(startDate);
            cursor.setHours(0, 0, 0, 0);

            while (cursor <= endDate) {
                const bStart = new Date(cursor);
                bStart.setHours(0, 0, 0, 0);
                const bEnd = new Date(cursor);
                bEnd.setDate(bEnd.getDate() + 6);
                bEnd.setHours(23, 59, 59, 999);
                if (bEnd > endDate) {
                    bEnd.setTime(endDate.getTime());
                }

                const dateStr = `${bStart.getFullYear()}-${String(bStart.getMonth() + 1).padStart(2, '0')}-${String(bStart.getDate()).padStart(2, '0')}`;
                const label = `${monthNames[bStart.getMonth()]} ${bStart.getDate()} - ${monthNames[bEnd.getMonth()]} ${bEnd.getDate()}`;

                buckets.push({
                    date: dateStr,
                    label,
                    periodStart: bStart.toISOString(),
                    periodEnd: bEnd.toISOString(),
                    tasksCompleted: 0,
                    tasksAssigned: 0,
                    trackedHours: 0,
                });

                cursor.setDate(cursor.getDate() + 7);
            }
        }

        return buckets;
    }
}
