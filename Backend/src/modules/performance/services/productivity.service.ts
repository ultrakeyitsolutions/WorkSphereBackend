import { AttendanceMetricsDto, ProductivityScoreDto, TaskMetricsDto, TimeTrackingMetricsDto } from '../performance.types';

export class ProductivityService {
    /**
     * Pure deterministic function that calculates a normalized productivity score (0-100).
     * 
     * Formula Weights:
     *  - Production Ratio (Work vs Total Tracked): 40%
     *  - Task Completion Rate: 30%
     *  - Attendance Consistency: 15%
     *  - Focus / Low-Idle Factor: 15%
     */
    public static calculateScore(
        attendance: AttendanceMetricsDto,
        tracking: TimeTrackingMetricsDto,
        tasks: TaskMetricsDto
    ): ProductivityScoreDto {
        // 1. Production Score (40% Weight)
        // Ratio of active productive work vs total tracked duration
        let productionRatio = 0;
        if (tracking.totalTrackedMinutes > 0) {
            productionRatio = tracking.workMinutes / tracking.totalTrackedMinutes;
        } else if (attendance.totalCheckedInMinutes > 0) {
            // Fallback if no task tracking: compare work minutes if tracked vs checked-in
            productionRatio = Math.min(1, tracking.workMinutes / (attendance.totalCheckedInMinutes || 1));
        }
        const productionScore = Math.min(100, Math.max(0, Math.round(productionRatio * 100)));

        // 2. Task Completion Score (30% Weight)
        const taskScore = Math.min(100, Math.max(0, Math.round(tasks.completionRatePercentage || 0)));

        // 3. Attendance Consistency Score (15% Weight)
        let attendanceRatio = 0;
        if (attendance.totalDaysInRange > 0) {
            attendanceRatio = attendance.checkedInDays / attendance.totalDaysInRange;
        }
        const attendanceScore = Math.min(100, Math.max(0, Math.round(attendanceRatio * 100)));

        // 4. Focus / Low-Idle Score (15% Weight)
        // Penalizes excessive break and hold times relative to total tracked time
        let focusRatio = 1.0;
        if (tracking.totalTrackedMinutes > 0) {
            const nonWorkMinutes = tracking.breakMinutes + tracking.holdMinutes;
            const nonWorkRatio = nonWorkMinutes / tracking.totalTrackedMinutes;
            focusRatio = Math.max(0, 1 - nonWorkRatio);
        }
        const focusScore = Math.min(100, Math.max(0, Math.round(focusRatio * 100)));

        // Weighted Composite Sum
        const totalScoreRaw =
            productionScore * 0.40 +
            taskScore * 0.30 +
            attendanceScore * 0.15 +
            focusScore * 0.15;

        const score = Math.min(100, Math.max(0, Math.round(totalScoreRaw)));

        // Rating Classification
        let rating: 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'NEEDS_IMPROVEMENT' = 'AVERAGE';
        if (score >= 85) {
            rating = 'EXCELLENT';
        } else if (score >= 70) {
            rating = 'GOOD';
        } else if (score >= 50) {
            rating = 'AVERAGE';
        } else {
            rating = 'NEEDS_IMPROVEMENT';
        }

        return {
            score,
            rating,
            breakdown: {
                productionScore,
                taskScore,
                attendanceScore,
                focusScore,
            },
        };
    }
}
