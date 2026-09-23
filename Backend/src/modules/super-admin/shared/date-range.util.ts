import { Request } from 'express';

export type TimeRangeKey = '7d' | '30d' | '90d' | '12m' | 'custom';
export type GroupingInterval = 'day' | 'week' | 'month';

export interface ParsedDateRange {
    startDate: Date;
    endDate: Date;
    rangeKey: TimeRangeKey;
    interval: GroupingInterval;
    dateFormat: string; // Mongo date format string (e.g. '%Y-%m-%d', '%Y-%U', '%Y-%m')
}

/**
 * Standard date range parser for analytics endpoints.
 */
export function parseDateRange(req: Request): ParsedDateRange {
    const rawRange = (req.query.range as string || '').toLowerCase().trim();
    const rawStartDate = req.query.startDate as string;
    const rawEndDate = req.query.endDate as string;

    const now = new Date();
    let startDate = new Date();
    let endDate = new Date(now);
    let rangeKey: TimeRangeKey = '30d';
    let interval: GroupingInterval = 'day';
    let dateFormat = '%Y-%m-%d';

    if (rawStartDate && rawEndDate) {
        const parsedStart = new Date(rawStartDate);
        const parsedEnd = new Date(rawEndDate);
        if (!isNaN(parsedStart.getTime()) && !isNaN(parsedEnd.getTime())) {
            startDate = parsedStart;
            // End of the specified day
            endDate = new Date(parsedEnd);
            endDate.setHours(23, 59, 59, 999);
            rangeKey = 'custom';

            const diffDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays > 90) {
                interval = 'month';
                dateFormat = '%Y-%m';
            } else if (diffDays > 30) {
                interval = 'week';
                dateFormat = '%Y-%U';
            } else {
                interval = 'day';
                dateFormat = '%Y-%m-%d';
            }

            return { startDate, endDate, rangeKey, interval, dateFormat };
        }
    }

    switch (rawRange) {
        case '7d':
            startDate.setDate(now.getDate() - 7);
            startDate.setHours(0, 0, 0, 0);
            rangeKey = '7d';
            interval = 'day';
            dateFormat = '%Y-%m-%d';
            break;
        case '90d':
            startDate.setDate(now.getDate() - 90);
            startDate.setHours(0, 0, 0, 0);
            rangeKey = '90d';
            interval = 'week';
            dateFormat = '%Y-%U';
            break;
        case '12m':
            startDate.setFullYear(now.getFullYear() - 1);
            startDate.setHours(0, 0, 0, 0);
            rangeKey = '12m';
            interval = 'month';
            dateFormat = '%Y-%m';
            break;
        case '30d':
        default:
            startDate.setDate(now.getDate() - 30);
            startDate.setHours(0, 0, 0, 0);
            rangeKey = '30d';
            interval = 'day';
            dateFormat = '%Y-%m-%d';
            break;
    }

    return {
        startDate,
        endDate,
        rangeKey,
        interval,
        dateFormat,
    };
}
