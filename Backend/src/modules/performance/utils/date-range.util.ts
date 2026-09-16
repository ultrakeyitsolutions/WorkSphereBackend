import { DateRangeQuery, PerformancePeriod, PerformanceRangePreset } from '../performance.types';

export class DateRangeUtil {
    /**
     * Resolves start date (from) and end date (to) for performance calculations.
     * Uses timezone-aware date boundaries. Defaults to 'this_month' if omitted.
     */
    public static resolvePeriod(query: DateRangeQuery): PerformancePeriod {
        const timezone = query.timezone || 'Asia/Kolkata';
        const range: PerformanceRangePreset = query.range || 'this_month';

        const now = new Date();

        let from: Date;
        let to: Date;

        switch (range) {
            case 'today': {
                from = this.getStartOfDay(now);
                to = this.getEndOfDay(now);
                break;
            }
            case 'yesterday': {
                const y = new Date(now);
                y.setDate(y.getDate() - 1);
                from = this.getStartOfDay(y);
                to = this.getEndOfDay(y);
                break;
            }
            case 'this_week': {
                const startOfWeek = new Date(now);
                const day = startOfWeek.getDay(); // 0 is Sunday, 1 is Monday
                const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Monday as start
                startOfWeek.setDate(diff);
                from = this.getStartOfDay(startOfWeek);
                to = this.getEndOfDay(now);
                break;
            }
            case 'last_week': {
                const startOfLastWeek = new Date(now);
                const day = startOfLastWeek.getDay();
                const diff = startOfLastWeek.getDate() - day - 6 + (day === 0 ? -6 : 1);
                startOfLastWeek.setDate(diff);

                const endOfLastWeek = new Date(startOfLastWeek);
                endOfLastWeek.setDate(endOfLastWeek.getDate() + 6);

                from = this.getStartOfDay(startOfLastWeek);
                to = this.getEndOfDay(endOfLastWeek);
                break;
            }
            case 'this_month': {
                from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                to = this.getEndOfDay(now);
                break;
            }
            case 'last_month': {
                from = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
                to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
                break;
            }
            case 'custom': {
                if (query.from && query.to) {
                    from = new Date(query.from);
                    to = new Date(query.to);
                } else if (query.from) {
                    from = new Date(query.from);
                    to = this.getEndOfDay(now);
                } else {
                    from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                    to = this.getEndOfDay(now);
                }
                break;
            }
            default: {
                from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                to = this.getEndOfDay(now);
                break;
            }
        }

        // Safety fallback for invalid date strings
        if (isNaN(from.getTime())) from = new Date(now.getFullYear(), now.getMonth(), 1);
        if (isNaN(to.getTime())) to = this.getEndOfDay(now);

        return {
            range,
            from,
            to,
            timezone,
        };
    }

    private static getStartOfDay(date: Date): Date {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    private static getEndOfDay(date: Date): Date {
        const d = new Date(date);
        d.setHours(23, 59, 59, 999);
        return d;
    }
}
