import { Types } from 'mongoose';
import { User } from '../users/user.model';
import { CompanyMember } from '../companyadmin/invitations/company-member.model';
import { DateRangeUtil } from './utils/date-range.util';
import { PerformanceRepository } from './repositories/performance.repository';
import { ProductivityService } from './services/productivity.service';
import { TimelineService } from './services/timeline.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { AppError } from '../../utils/AppError';
import { TokenPayload } from '../../utils/tokens';
import {
    DateRangeQuery,
    DailyTrendItemDto,
    PerformanceDailyResponse,
    PerformanceMeetingsResponse,
    PerformanceSummaryResponse,
    PerformanceTasksResponse,
    PerformanceTimelineResponse,
} from './performance.types';

export class PerformanceService {
    /**
     * Resolves complete performance overview summary for a user.
     */
    public static async getPerformanceSummary(
        requester: TokenPayload,
        targetUserId: string,
        query: DateRangeQuery
    ): Promise<PerformanceSummaryResponse> {
        // 1. Verify User & Tenant Access Control
        const targetUser = await this.verifyAndFetchUser(requester, targetUserId);
        const companyId = targetUser.companyId ? targetUser.companyId.toString() : (requester.companyId || '');
        if (!companyId) {
            throw AppError.badRequest('Missing company context');
        }

        // 2. Resolve Date Boundaries
        const period = DateRangeUtil.resolvePeriod(query);

        // 3. Parallel Aggregation Queries via Promise.all()
        const [
            attendanceRes,
            trackingRes,
            taskMetrics,
            projectMetrics,
            meetingRes,
        ] = await Promise.all([
            PerformanceRepository.getAttendanceMetrics(companyId, targetUserId, period.from, period.to),
            PerformanceRepository.getTimeTrackingMetrics(companyId, targetUserId, period.from, period.to),
            PerformanceRepository.getTaskMetrics(companyId, targetUserId, period.from, period.to),
            PerformanceRepository.getProjectMetrics(companyId, targetUserId),
            PerformanceRepository.getMeetingMetrics(companyId, targetUserId, period.from, period.to),
        ]);

        // 4. Deterministic Productivity Score Calculation
        const productivity = ProductivityService.calculateScore(
            attendanceRes.metrics,
            trackingRes.metrics,
            taskMetrics
        );

        // 5. Fetch Role and Designation
        const companyMember = await CompanyMember.findOne({
            companyId: new Types.ObjectId(companyId),
            userId: new Types.ObjectId(targetUserId),
        })
            .populate('roleId', 'name')
            .populate('designationId', 'title name')
            .lean();

        const role = (companyMember?.roleId as any)?.name || (targetUser as any).role?.name || requester.role || 'Member';
        const designation = (companyMember?.designationId as any)?.title || (companyMember?.designationId as any)?.name || null;

        // 6. Audit Log Fire-and-Forget
        try {
            AuditLogService.log({
                companyId: new Types.ObjectId(companyId),
                userId: new Types.ObjectId(requester.userId),
                action: AuditAction.USER_PERFORMANCE_VIEW,
                module: 'PERFORMANCE',
                details: `Viewed performance review for user ${targetUser.name} (${targetUserId})`,
                metadata: { targetUserId, range: period.range, score: productivity.score },
            } as any).catch(() => { });
        } catch (err) {
            // Non-blocking audit log catch
        }

        return {
            user: {
                id: targetUser._id.toString(),
                name: targetUser.name || '',
                email: targetUser.email,
                avatar: (targetUser as any).avatar || null,
                role,
                designation,
                joinDate: targetUser.createdAt,
            },
            period: {
                range: period.range,
                from: period.from.toISOString(),
                to: period.to.toISOString(),
                timezone: period.timezone,
            },
            productivity,
            attendance: attendanceRes.metrics,
            timeTracking: trackingRes.metrics,
            tasks: taskMetrics,
            projects: projectMetrics,
            meetings: meetingRes.metrics,
        };
    }

    /**
     * Retrieves paginated chronological timeline of employee activities.
     */
    public static async getTimeline(
        requester: TokenPayload,
        targetUserId: string,
        query: DateRangeQuery & { page?: number; limit?: number }
    ): Promise<PerformanceTimelineResponse> {
        const targetUser = await this.verifyAndFetchUser(requester, targetUserId);
        const companyId = targetUser.companyId ? targetUser.companyId.toString() : (requester.companyId || '');
        if (!companyId) throw AppError.badRequest('Missing company context');

        const period = DateRangeUtil.resolvePeriod(query);
        const page = Math.max(1, query.page || 1);
        const limit = Math.min(100, Math.max(1, query.limit || 25));

        const [attendanceRes, trackingRes, taskActivities, meetingRes] = await Promise.all([
            PerformanceRepository.getAttendanceMetrics(companyId, targetUserId, period.from, period.to),
            PerformanceRepository.getTimeTrackingMetrics(companyId, targetUserId, period.from, period.to),
            PerformanceRepository.getTaskActivities(companyId, targetUserId, period.from, period.to),
            PerformanceRepository.getMeetingMetrics(companyId, targetUserId, period.from, period.to),
        ]);

        const allTimelineEvents = TimelineService.buildTimeline(
            attendanceRes.rawLogs,
            trackingRes.rawLogs,
            taskActivities,
            meetingRes.rawLogs
        );

        const total = allTimelineEvents.length;
        const pages = Math.ceil(total / limit) || 1;
        const startIndex = (page - 1) * limit;
        const paginatedEvents = allTimelineEvents.slice(startIndex, startIndex + limit);

        return {
            user: { id: targetUser._id.toString(), name: targetUser.name || '' },
            period: { from: period.from.toISOString(), to: period.to.toISOString() },
            timeline: paginatedEvents,
            pagination: {
                page,
                limit,
                total,
                pages,
            },
        };
    }

    /**
     * Retrieves paginated task breakdown list.
     */
    public static async getTasks(
        requester: TokenPayload,
        targetUserId: string,
        query: DateRangeQuery & { page?: number; limit?: number }
    ): Promise<PerformanceTasksResponse> {
        const targetUser = await this.verifyAndFetchUser(requester, targetUserId);
        const companyId = targetUser.companyId ? targetUser.companyId.toString() : (requester.companyId || '');
        if (!companyId) throw AppError.badRequest('Missing company context');

        const period = DateRangeUtil.resolvePeriod(query);

        const [metrics, detailed] = await Promise.all([
            PerformanceRepository.getTaskMetrics(companyId, targetUserId, period.from, period.to),
            PerformanceRepository.getDetailedTasks(companyId, targetUserId, period.from, period.to, query.page, query.limit),
        ]);

        return {
            user: { id: targetUser._id.toString(), name: targetUser.name || '' },
            metrics,
            tasks: detailed.tasks,
            pagination: {
                page: detailed.page,
                limit: query.limit || 25,
                total: detailed.total,
                pages: detailed.pages,
            },
        };
    }

    /**
     * Retrieves paginated meeting attendance list.
     */
    public static async getMeetings(
        requester: TokenPayload,
        targetUserId: string,
        query: DateRangeQuery & { page?: number; limit?: number }
    ): Promise<PerformanceMeetingsResponse> {
        const targetUser = await this.verifyAndFetchUser(requester, targetUserId);
        const companyId = targetUser.companyId ? targetUser.companyId.toString() : (requester.companyId || '');
        if (!companyId) throw AppError.badRequest('Missing company context');

        const period = DateRangeUtil.resolvePeriod(query);

        const [meetingRes, detailed] = await Promise.all([
            PerformanceRepository.getMeetingMetrics(companyId, targetUserId, period.from, period.to),
            PerformanceRepository.getDetailedMeetings(companyId, targetUserId, period.from, period.to, query.page, query.limit),
        ]);

        return {
            user: { id: targetUser._id.toString(), name: targetUser.name || '' },
            metrics: meetingRes.metrics,
            meetings: detailed.meetings,
            pagination: {
                page: detailed.page,
                limit: query.limit || 25,
                total: detailed.total,
                pages: detailed.pages,
            },
        };
    }

    /**
     * Retrieves day-by-day trend metrics across the selected date range.
     */
    public static async getDailyTrends(
        requester: TokenPayload,
        targetUserId: string,
        query: DateRangeQuery
    ): Promise<PerformanceDailyResponse> {
        const targetUser = await this.verifyAndFetchUser(requester, targetUserId);
        const companyId = targetUser.companyId ? targetUser.companyId.toString() : (requester.companyId || '');
        if (!companyId) throw AppError.badRequest('Missing company context');

        const period = DateRangeUtil.resolvePeriod(query);

        const [attendanceRes, trackingRes, meetingRes] = await Promise.all([
            PerformanceRepository.getAttendanceMetrics(companyId, targetUserId, period.from, period.to),
            PerformanceRepository.getTimeTrackingMetrics(companyId, targetUserId, period.from, period.to),
            PerformanceRepository.getMeetingMetrics(companyId, targetUserId, period.from, period.to),
        ]);

        const dailyMap = new Map<string, DailyTrendItemDto>();

        // Initialize dates in range
        const curr = new Date(period.from);
        while (curr.getTime() <= period.to.getTime()) {
            const dateStr = curr.toISOString().split('T')[0];
            dailyMap.set(dateStr, {
                date: dateStr,
                checkedInMinutes: 0,
                trackedMinutes: 0,
                completedTasksCount: 0,
                meetingsCount: 0,
            });
            curr.setDate(curr.getDate() + 1);
        }

        // Map attendance minutes per day
        for (const log of attendanceRes.rawLogs) {
            const dateStr = log.checkInTime.toISOString().split('T')[0];
            const item = dailyMap.get(dateStr);
            if (item) {
                const end = log.checkOutTime || new Date();
                const mins = Math.round((end.getTime() - log.checkInTime.getTime()) / (1000 * 60));
                item.checkedInMinutes += mins;
            }
        }

        // Map tracked minutes per day
        for (const session of trackingRes.rawLogs) {
            if (session.startedAt) {
                const dateStr = session.startedAt.toISOString().split('T')[0];
                const item = dailyMap.get(dateStr);
                if (item) {
                    item.trackedMinutes += Math.round((session.workedSeconds || 0) / 60);
                }
            }
        }

        // Map meeting counts per day
        for (const m of meetingRes.rawLogs) {
            if (m.startTime) {
                const dateStr = new Date(m.startTime).toISOString().split('T')[0];
                const item = dailyMap.get(dateStr);
                if (item) {
                    item.meetingsCount += 1;
                }
            }
        }

        const dailyTrends = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        return {
            user: { id: targetUser._id.toString(), name: targetUser.name || '' },
            period: { from: period.from.toISOString(), to: period.to.toISOString() },
            dailyTrends,
        };
    }

    /**
     * Private helper to verify target user existence and multi-tenant authorization boundaries.
     */
    private static async verifyAndFetchUser(requester: TokenPayload, targetUserId: string) {
        if (!Types.ObjectId.isValid(targetUserId)) {
            throw AppError.badRequest('Invalid user ID parameter');
        }

        const targetUser = await User.findById(targetUserId).lean();
        if (!targetUser) {
            throw AppError.notFound('User not found');
        }

        const isSuperAdmin = requester.role === 'SUPER_ADMIN';
        const isSameUser = requester.userId === targetUserId;
        const isAdmin = ['COMPANY_ADMIN', 'ADMIN'].includes((requester.role || '').toUpperCase());

        if (isSuperAdmin) {
            return targetUser;
        }

        if (isAdmin) {
            // Enforce company tenant isolation
            if (targetUser.companyId && targetUser.companyId.toString() !== requester.companyId) {
                throw AppError.forbidden('Forbidden: User belongs to a different organization');
            }
            return targetUser;
        }

        // Regular Member: can only view their own performance
        if (!isSameUser) {
            throw AppError.forbidden('Forbidden: You are not authorized to view performance details of other members');
        }

        return targetUser;
    }
}
