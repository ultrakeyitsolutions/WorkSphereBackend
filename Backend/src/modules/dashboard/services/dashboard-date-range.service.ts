import { DashboardPeriod, DashboardQueryDto, ResolvedDateRange } from '../dashboard.types';

export class DashboardDateRangeService {
    public static readonly DEFAULT_TIMEZONE = 'Asia/Kolkata';

    public static resolveTimezone(
        queryTimezone?: string,
        companyTimezone?: string | null,
        userTimezone?: string | null
    ): string {
        if (queryTimezone && typeof queryTimezone === 'string' && queryTimezone.trim()) {
            const tz = queryTimezone.trim();
            if (this.isValidTimezone(tz)) return tz;
        }
        if (companyTimezone && typeof companyTimezone === 'string' && companyTimezone.trim()) {
            const tz = companyTimezone.trim();
            if (this.isValidTimezone(tz)) return tz;
        }
        if (userTimezone && typeof userTimezone === 'string' && userTimezone.trim()) {
            const tz = userTimezone.trim();
            if (this.isValidTimezone(tz)) return tz;
        }
        return this.DEFAULT_TIMEZONE;
    }

    private static isValidTimezone(tz: string): boolean {
        try {
            Intl.DateTimeFormat(undefined, { timeZone: tz });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Converts calendar year, month, day, hour, min, sec, ms in target timezone into the exact UTC Date.
     */
    public static getUtcDateForTimezone(
        year: number,
        month: number, // 1-12
        day: number,
        hour: number,
        min: number,
        sec: number,
        ms: number,
        tz: string
    ): Date {
        try {
            const utcEstimate = new Date(Date.UTC(year, month - 1, day, hour, min, sec, ms));
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
                hourCycle: 'h23',
            });
            const parts = formatter.formatToParts(utcEstimate);
            const partMap: Record<string, string> = {};
            for (const p of parts) partMap[p.type] = p.value;

            const tzAsUtc = Date.UTC(
                parseInt(partMap.year, 10),
                parseInt(partMap.month, 10) - 1,
                parseInt(partMap.day, 10),
                parseInt(partMap.hour, 10),
                parseInt(partMap.minute, 10),
                parseInt(partMap.second, 10),
                ms
            );
            const offset = tzAsUtc - utcEstimate.getTime();
            return new Date(utcEstimate.getTime() - offset);
        } catch {
            return new Date(Date.UTC(year, month - 1, day, hour, min, sec, ms));
        }
    }

    /**
     * Gets the calendar year, month (1-12), day in the target timezone.
     */
    public static getDatePartsInTimezone(d: Date, tz: string): { year: number; month: number; day: number } {
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            });
            const [year, month, day] = formatter.format(d).split('-').map(Number);
            return { year, month, day };
        } catch {
            return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
        }
    }

    public static formatDateInTimezone(d: Date, tz: string): string {
        const { year, month, day } = this.getDatePartsInTimezone(d, tz);
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    public static resolve(
        query: DashboardQueryDto,
        companyTimezone?: string | null,
        userTimezone?: string | null
    ): ResolvedDateRange {
        const timezone = this.resolveTimezone(query.timezone, companyTimezone, userTimezone);
        let period: DashboardPeriod = (query.period as any) || 'today';
        if ((query.period as any) === '7days') period = 'last_7_days';
        if ((query.period as any) === '30days') period = 'last_30_days';

        const now = new Date();
        const todayParts = this.getDatePartsInTimezone(now, timezone);

        let startDate: Date;
        let endDate: Date;
        let prevStartDate: Date;
        let prevEndDate: Date;

        switch (period) {
            case 'today': {
                startDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, todayParts.day, 0, 0, 0, 0, timezone);
                endDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, todayParts.day, 23, 59, 59, 999, timezone);

                // Previous period: yesterday
                const ydayUtc = new Date(startDate.getTime() - 12 * 3600 * 1000);
                const ydayParts = this.getDatePartsInTimezone(ydayUtc, timezone);
                prevStartDate = this.getUtcDateForTimezone(ydayParts.year, ydayParts.month, ydayParts.day, 0, 0, 0, 0, timezone);
                prevEndDate = this.getUtcDateForTimezone(ydayParts.year, ydayParts.month, ydayParts.day, 23, 59, 59, 999, timezone);
                break;
            }

            case 'yesterday': {
                const ydayAnchor = new Date(now.getTime() - 24 * 3600 * 1000);
                const ydayParts = this.getDatePartsInTimezone(ydayAnchor, timezone);
                startDate = this.getUtcDateForTimezone(ydayParts.year, ydayParts.month, ydayParts.day, 0, 0, 0, 0, timezone);
                endDate = this.getUtcDateForTimezone(ydayParts.year, ydayParts.month, ydayParts.day, 23, 59, 59, 999, timezone);

                // Previous period: day before yesterday
                const dayBeforeAnchor = new Date(startDate.getTime() - 12 * 3600 * 1000);
                const dbParts = this.getDatePartsInTimezone(dayBeforeAnchor, timezone);
                prevStartDate = this.getUtcDateForTimezone(dbParts.year, dbParts.month, dbParts.day, 0, 0, 0, 0, timezone);
                prevEndDate = this.getUtcDateForTimezone(dbParts.year, dbParts.month, dbParts.day, 23, 59, 59, 999, timezone);
                break;
            }

            case 'last_7_days': {
                // Today + preceding 6 days (total 7 days)
                endDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, todayParts.day, 23, 59, 59, 999, timezone);
                const startAnchor = new Date(endDate.getTime() - 6 * 24 * 3600 * 1000);
                const startParts = this.getDatePartsInTimezone(startAnchor, timezone);
                startDate = this.getUtcDateForTimezone(startParts.year, startParts.month, startParts.day, 0, 0, 0, 0, timezone);

                // Previous 7 days
                prevEndDate = new Date(startDate.getTime() - 1);
                const prevStartAnchor = new Date(startDate.getTime() - 7 * 24 * 3600 * 1000);
                const prevStartParts = this.getDatePartsInTimezone(prevStartAnchor, timezone);
                prevStartDate = this.getUtcDateForTimezone(prevStartParts.year, prevStartParts.month, prevStartParts.day, 0, 0, 0, 0, timezone);
                break;
            }

            case 'custom': {
                if (query.startDate && query.endDate) {
                    const [sY, sM, sD] = query.startDate.split('-').map(Number);
                    const [eY, eM, eD] = query.endDate.split('-').map(Number);
                    startDate = this.getUtcDateForTimezone(sY, sM, sD, 0, 0, 0, 0, timezone);
                    endDate = this.getUtcDateForTimezone(eY, eM, eD, 23, 59, 59, 999, timezone);
                } else if (query.startDate) {
                    const [sY, sM, sD] = query.startDate.split('-').map(Number);
                    startDate = this.getUtcDateForTimezone(sY, sM, sD, 0, 0, 0, 0, timezone);
                    endDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, todayParts.day, 23, 59, 59, 999, timezone);
                } else {
                    startDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, todayParts.day, 0, 0, 0, 0, timezone);
                    endDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, todayParts.day, 23, 59, 59, 999, timezone);
                }

                // Compute equal preceding duration
                const durationMs = Math.max(1000, endDate.getTime() - startDate.getTime() + 1);
                prevEndDate = new Date(startDate.getTime() - 1);
                prevStartDate = new Date(prevEndDate.getTime() - durationMs + 1);
                break;
            }

            case 'last_30_days': {
                endDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, todayParts.day, 23, 59, 59, 999, timezone);
                const startAnchor = new Date(endDate.getTime() - 29 * 24 * 3600 * 1000);
                const startParts = this.getDatePartsInTimezone(startAnchor, timezone);
                startDate = this.getUtcDateForTimezone(startParts.year, startParts.month, startParts.day, 0, 0, 0, 0, timezone);

                prevEndDate = new Date(startDate.getTime() - 1);
                const prevStartAnchor = new Date(startDate.getTime() - 30 * 24 * 3600 * 1000);
                const prevStartParts = this.getDatePartsInTimezone(prevStartAnchor, timezone);
                prevStartDate = this.getUtcDateForTimezone(prevStartParts.year, prevStartParts.month, prevStartParts.day, 0, 0, 0, 0, timezone);
                break;
            }

            case 'this_month':
            case 'month': {
                startDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, 1, 0, 0, 0, 0, timezone);
                endDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, todayParts.day, 23, 59, 59, 999, timezone);

                const prevMonth = todayParts.month === 1 ? 12 : todayParts.month - 1;
                const prevYear = todayParts.month === 1 ? todayParts.year - 1 : todayParts.year;
                prevStartDate = this.getUtcDateForTimezone(prevYear, prevMonth, 1, 0, 0, 0, 0, timezone);
                prevEndDate = new Date(startDate.getTime() - 1);
                break;
            }

            case 'last_month': {
                const prevMonth = todayParts.month === 1 ? 12 : todayParts.month - 1;
                const prevYear = todayParts.month === 1 ? todayParts.year - 1 : todayParts.year;
                const lastDayOfPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();

                startDate = this.getUtcDateForTimezone(prevYear, prevMonth, 1, 0, 0, 0, 0, timezone);
                endDate = this.getUtcDateForTimezone(prevYear, prevMonth, lastDayOfPrevMonth, 23, 59, 59, 999, timezone);

                const prevPrevMonth = prevMonth === 1 ? 12 : prevMonth - 1;
                const prevPrevYear = prevMonth === 1 ? prevYear - 1 : prevYear;
                const lastDayOfPrevPrev = new Date(Date.UTC(prevPrevYear, prevPrevMonth, 0)).getUTCDate();
                prevStartDate = this.getUtcDateForTimezone(prevPrevYear, prevPrevMonth, 1, 0, 0, 0, 0, timezone);
                prevEndDate = this.getUtcDateForTimezone(prevPrevYear, prevPrevMonth, lastDayOfPrevPrev, 23, 59, 59, 999, timezone);
                break;
            }

            default: {
                startDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, todayParts.day, 0, 0, 0, 0, timezone);
                endDate = this.getUtcDateForTimezone(todayParts.year, todayParts.month, todayParts.day, 23, 59, 59, 999, timezone);
                prevStartDate = new Date(startDate.getTime() - 24 * 3600 * 1000);
                prevEndDate = new Date(endDate.getTime() - 24 * 3600 * 1000);
                break;
            }
        }

        const startDateStr = this.formatDateInTimezone(startDate, timezone);
        const endDateStr = this.formatDateInTimezone(endDate, timezone);
        const days = this.generateDaysArray(startDate, endDate, timezone);

        const previousStartDateStr = this.formatDateInTimezone(prevStartDate, timezone);
        const previousEndDateStr = this.formatDateInTimezone(prevEndDate, timezone);

        return {
            period,
            startDateStr,
            endDateStr,
            startDate,
            endDate,
            timezone,
            days,
            previousStartDate: prevStartDate,
            previousEndDate: prevEndDate,
            previousStartDateStr,
            previousEndDateStr,
        };
    }

    public static calculatePercentageChange(
        current: number,
        previous: number
    ): {
        percentageChange: number | null;
        trend: 'UP' | 'DOWN' | 'FLAT';
    } {
        if (!Number.isFinite(previous) || previous === 0) {
            return {
                percentageChange: null,
                trend: current > 0 ? 'UP' : current < 0 ? 'DOWN' : 'FLAT',
            };
        }
        const diff = current - previous;
        const change = Math.round((diff / previous) * 10000) / 100;
        const trend = change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'FLAT';
        return {
            percentageChange: change,
            trend,
        };
    }

    public static generateDaysArray(start: Date, end: Date, timezone = this.DEFAULT_TIMEZONE): string[] {
        const days: string[] = [];
        const seen = new Set<string>();

        let cursor = new Date(start.getTime());
        const endTime = end.getTime();

        while (cursor.getTime() <= endTime) {
            const dateStr = this.formatDateInTimezone(cursor, timezone);
            if (!seen.has(dateStr)) {
                seen.add(dateStr);
                days.push(dateStr);
            }
            cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
        }

        const finalEndStr = this.formatDateInTimezone(end, timezone);
        if (!seen.has(finalEndStr)) {
            days.push(finalEndStr);
        }

        return days;
    }

    public static getStartOfDay(d: Date): Date {
        const copy = new Date(d);
        copy.setHours(0, 0, 0, 0);
        return copy;
    }

    public static getEndOfDay(d: Date): Date {
        const copy = new Date(d);
        copy.setHours(23, 59, 59, 999);
        return copy;
    }

    public static formatDate(d: Date): string {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}
