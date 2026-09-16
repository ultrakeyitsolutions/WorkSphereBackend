export interface TimeInterval {
    start: Date;
    end: Date;
}

export class IntervalUtil {
    /**
     * Merges overlapping and contiguous time intervals in O(n log n) time complexity.
     * Prevents double-counting when multiple sessions or meetings overlap.
     *
     * @returns Array of merged non-overlapping TimeInterval objects.
     */
    public static mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
        if (!intervals || intervals.length === 0) return [];

        // Filter invalid intervals where end <= start
        const validIntervals = intervals
            .filter((i) => i.start && i.end && i.end.getTime() > i.start.getTime())
            .map((i) => ({
                start: new Date(i.start),
                end: new Date(i.end),
            }));

        if (validIntervals.length === 0) return [];

        // Sort by start time ascending
        validIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());

        const merged: TimeInterval[] = [validIntervals[0]];

        for (let i = 1; i < validIntervals.length; i++) {
            const current = validIntervals[i];
            const last = merged[merged.length - 1];

            if (current.start.getTime() <= last.end.getTime()) {
                // Overlap detected: extend the end time if current ends later
                if (current.end.getTime() > last.end.getTime()) {
                    last.end = current.end;
                }
            } else {
                // No overlap: add new distinct interval
                merged.push(current);
            }
        }

        return merged;
    }

    /**
     * Calculates the net duration in minutes across merged non-overlapping intervals.
     */
    public static calculateNetMinutes(intervals: TimeInterval[]): number {
        const merged = this.mergeIntervals(intervals);
        let totalMs = 0;

        for (const interval of merged) {
            totalMs += interval.end.getTime() - interval.start.getTime();
        }

        return Math.round(totalMs / (1000 * 60));
    }
}
