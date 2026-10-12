import { Types } from 'mongoose';
import { Task } from '../../tasks/task.model';
import {
    ResolvedDateRange,
    CompanyDeliveryTrendsData,
    DeliveryTrendBucket,
} from '../dashboard.types';

export class DeliveryTrendsAnalytics {
    public static async getTrends(
        companyId: Types.ObjectId,
        dateRange: ResolvedDateRange,
        requestedInterval?: 'day' | 'week' | 'month',
        filterProjectId?: Types.ObjectId,
        now = new Date()
    ): Promise<CompanyDeliveryTrendsData> {
        const daysCount = dateRange.days.length;
        let interval: 'day' | 'week' | 'month' = requestedInterval || 'day';

        if (!requestedInterval) {
            if (daysCount > 60) {
                interval = 'month';
            } else if (daysCount > 14) {
                interval = 'week';
            } else {
                interval = 'day';
            }
        }

        const buckets = this.buildBuckets(dateRange.startDate, dateRange.endDate, interval);

        const taskMatch: any = {
            companyId,
            isArchived: { $ne: true },
            isDeleted: { $ne: true },
        };
        if (filterProjectId) {
            taskMatch.projectId = filterProjectId;
        }

        // Parallel aggregation for planned (dueDate) and completed (completedDate) tasks in the range
        const [plannedResults, completedResults] = await Promise.all([
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
        ]);

        // Bin tasks into the precomputed buckets
        for (const bucket of buckets) {
            const bStart = new Date(bucket.periodStart).getTime();
            const bEnd = new Date(bucket.periodEnd).getTime();

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
                : null;
        }

        const totalPlanned = buckets.reduce((acc, b) => acc + b.plannedTasks, 0);
        const totalCompleted = buckets.reduce((acc, b) => acc + b.completedTasks, 0);
        const overallCompletionRate = totalPlanned > 0
            ? Math.round((totalCompleted / totalPlanned) * 10000) / 100
            : null;

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
        startDate: Date,
        endDate: Date,
        interval: 'day' | 'week' | 'month'
    ): DeliveryTrendBucket[] {
        const buckets: DeliveryTrendBucket[] = [];
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
                    plannedTasks: 0,
                    completedTasks: 0,
                    completionRate: null,
                });

                cursor.setDate(cursor.getDate() + 1);
            }
        } else if (interval === 'week') {
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
                    plannedTasks: 0,
                    completedTasks: 0,
                    completionRate: null,
                });

                cursor.setDate(cursor.getDate() + 7);
            }
        } else {
            // Month interval
            const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1, 0, 0, 0, 0);

            while (cursor <= endDate) {
                const bStart = new Date(cursor);
                const bEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);

                const dateStr = `${bStart.getFullYear()}-${String(bStart.getMonth() + 1).padStart(2, '0')}`;
                const label = `${monthNames[bStart.getMonth()]} ${bStart.getFullYear()}`;

                buckets.push({
                    date: dateStr,
                    label,
                    periodStart: bStart.toISOString(),
                    periodEnd: bEnd.toISOString(),
                    plannedTasks: 0,
                    completedTasks: 0,
                    completionRate: null,
                });

                cursor.setMonth(cursor.getMonth() + 1);
            }
        }

        return buckets;
    }
}
