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
            case 'week': {
                const startOfWeek = new Date(now);
                const day = startOfWeek.getDay(); // 0 is Sunday, 1 is Monday
                const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
                startOfWeek.setDate(diff);
                startDate = this.getStartOfDay(startOfWeek);
                endDate = this.getEndOfDay(now);
                break;
            }
            case 'month': {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                endDate = this.getEndOfDay(now);
                break;
            }
            case 'last_month': {
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
                endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
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

        return {
            period,
            startDateStr,
            endDateStr,
            startDate,
            endDate,
            timezone,
            days,
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
