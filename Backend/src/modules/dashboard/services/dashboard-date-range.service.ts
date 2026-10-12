import { DashboardPeriod, DashboardQueryDto, ResolvedDateRange } from '../dashboard.types';

export class DashboardDateRangeService {
    public static readonly DEFAULT_TIMEZONE = 'Asia/Kolkata';

    public static resolveTimezone(
        queryTimezone?: string,
        companyTimezone?: string | null,
        userTimezone?: string | null
    ): string {
        if (queryTimezone && typeof queryTimezone === 'string' && queryTimezone.trim()) {
            return queryTimezone.trim();
        }
        if (companyTimezone && typeof companyTimezone === 'string' && companyTimezone.trim()) {
            return companyTimezone.trim();
        }
        if (userTimezone && typeof userTimezone === 'string' && userTimezone.trim()) {
            return userTimezone.trim();
        }
        return this.DEFAULT_TIMEZONE;
    }

    public static resolve(
        query: DashboardQueryDto,
        companyTimezone?: string | null,
        userTimezone?: string | null
    ): ResolvedDateRange {
        const timezone = this.resolveTimezone(query.timezone, companyTimezone, userTimezone);
        const period: DashboardPeriod = query.period || 'today';

        const now = new Date();
        let startDate: Date;
        let endDate: Date;

        switch (period) {
            case 'today': {
                startDate = this.getStartOfDay(now);
                endDate = this.getEndOfDay(now);
                break;
            }
            case 'week':
            case 'this_week': {
                const startOfWeek = new Date(now);
                const day = startOfWeek.getDay(); // 0 is Sunday, 1 is Monday
                const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
                startOfWeek.setDate(diff);
                startDate = this.getStartOfDay(startOfWeek);
                endDate = this.getEndOfDay(now);
                break;
            }
            case 'last_7_days': {
                const past7 = new Date(now);
                past7.setDate(past7.getDate() - 6);
                startDate = this.getStartOfDay(past7);
                endDate = this.getEndOfDay(now);
                break;
            }
            case 'last_30_days': {
                const past30 = new Date(now);
                past30.setDate(past30.getDate() - 29);
                startDate = this.getStartOfDay(past30);
                endDate = this.getEndOfDay(now);
                break;
            }
            case 'month':
            case 'this_month': {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                endDate = this.getEndOfDay(now);
                break;
            }
            case 'last_month': {
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
                endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
                break;
            }
            case 'last_3_months': {
                const past90 = new Date(now);
                past90.setDate(past90.getDate() - 89);
                startDate = this.getStartOfDay(past90);
                endDate = this.getEndOfDay(now);
                break;
            }
            case 'custom': {
                if (query.startDate && query.endDate) {
                    const [sY, sM, sD] = query.startDate.split('-').map(Number);
                    const [eY, eM, eD] = query.endDate.split('-').map(Number);
                    startDate = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
                    endDate = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
                } else if (query.startDate) {
                    const [sY, sM, sD] = query.startDate.split('-').map(Number);
                    startDate = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
                    endDate = this.getEndOfDay(now);
                } else {
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                    endDate = this.getEndOfDay(now);
                }
                break;
            }
            default: {
                startDate = this.getStartOfDay(now);
                endDate = this.getEndOfDay(now);
                break;
            }
        }

        if (isNaN(startDate.getTime())) startDate = this.getStartOfDay(now);
        if (isNaN(endDate.getTime())) endDate = this.getEndOfDay(now);

        const startDateStr = this.formatDate(startDate);
        const endDateStr = this.formatDate(endDate);
        const days = this.generateDaysArray(startDate, endDate);

        // Previous period of equal duration immediately preceding startDate
        const previousPeriod = this.computePreviousPeriod(startDate, endDate);

        return {
            period,
            startDateStr,
            endDateStr,
            startDate,
            endDate,
            timezone,
            days,
            previousStartDate: previousPeriod.startDate,
            previousEndDate: previousPeriod.endDate,
            previousStartDateStr: previousPeriod.startDateStr,
            previousEndDateStr: previousPeriod.endDateStr,
        };
    }

    public static computePreviousPeriod(startDate: Date, endDate: Date): {
        startDate: Date;
        endDate: Date;
        startDateStr: string;
        endDateStr: string;
        days: string[];
    } {
        const durationMs = endDate.getTime() - startDate.getTime();
        const prevEnd = new Date(startDate.getTime() - 1);
        const prevStart = new Date(prevEnd.getTime() - durationMs + 1);

        const normalizedStart = this.getStartOfDay(prevStart);
        const normalizedEnd = this.getEndOfDay(prevEnd);

        return {
            startDate: normalizedStart,
            endDate: normalizedEnd,
            startDateStr: this.formatDate(normalizedStart),
            endDateStr: this.formatDate(normalizedEnd),
            days: this.generateDaysArray(normalizedStart, normalizedEnd),
        };
    }

    public static calculatePercentageChange(
        current: number,
        previous: number
    ): {
        percentageChange: number | null;
        trend: 'UP' | 'DOWN' | 'FLAT';
    } {
        if (previous === 0) {
            return {
                percentageChange: null,
                trend: current > 0 ? 'UP' : 'FLAT',
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

    public static generateDaysArray(start: Date, end: Date): string[] {
        const days: string[] = [];
        const cursor = new Date(start);
        cursor.setHours(0, 0, 0, 0);

        const last = new Date(end);
        last.setHours(0, 0, 0, 0);

        while (cursor <= last) {
            days.push(this.formatDate(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
        return days;
    }
}
