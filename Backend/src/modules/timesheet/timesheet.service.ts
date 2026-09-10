import { Types } from 'mongoose';
import { Attendance, IAttendance } from '../attendance/attendance.model';
import { TimeTracking, ITimeTracking, TrackingState } from '../task-tracking/time-tracking.model';
import { TaskActivity, ActivityType, ITaskActivity } from '../task-activities/task-activity.model';
import { Task } from '../tasks/task.model';
import { Project } from '../companyadmin/projects/project.model';
import { User } from '../users/user.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { CompanyMember } from '../companyadmin/invitations/company-member.model';
import { TimesheetApproval, ITimesheetApproval } from './timesheet-approval.model';
import { TimesheetCorrection } from './timesheet-correction.model';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { AppError } from '../../utils/AppError';
import { TimesheetCalculatorService } from './timesheet-calculator.service';
import {
    TimesheetFilter,
    TimesheetResponse,
    TimesheetUserSummary,
    TimesheetDayData,
    TimesheetHealthSummary,
    AnomalyRecord,
    TimelineEntry,
    ProjectDistribution,
    ComparisonMetric,
    PeriodFilter,
    TimesheetApprovalStatus,
    ProductivityMetrics
} from './timesheet.types';
import { Request } from 'express';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a YYYY-MM-DD string to the UTC start-of-day Date */
function toStartOfDay(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Parse a YYYY-MM-DD string to the UTC end-of-day Date */
function toEndOfDay(dateStr: string): Date {
    return new Date(`${dateStr}T23:59:59.999Z`);
}

/** Convert a Date to a YYYY-MM-DD string in UTC */
function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** Enumerate all calendar days between two UTC Date objects (inclusive) */
function enumerateDays(startDate: Date, endDate: Date): string[] {
    const days: string[] = [];
    const cursor = new Date(startDate);
    cursor.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setUTCHours(0, 0, 0, 0);
    while (cursor <= end) {
        days.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
}

/** Resolve a User document for display (name, email, avatar) */
async function resolveUserProfile(userId: string): Promise<{
    fullName: string;
    email: string;
    avatar: string | null;
}> {
    const user = await User.findById(userId).select('name email').lean();
    return {
        fullName: user ? (user as any).name ?? 'Unknown' : 'Unknown',
        email:    user ? (user as any).email ?? '' : '',
        avatar:   null // avatar not stored on User model; extend when needed
    };
}

// ─── TimesheetService ─────────────────────────────────────────────────────────

export class TimesheetService {

    // ──────────────────────────────────────────────────────────────────────────
    // AUTHORIZATION HELPERS
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Validate that an employeeId belongs to this company.
     * Returns the validated userId string.
     * Throws 403 if it does not belong.
     */
    private static async enforceEmployeeBelongsToCompany(
        companyId: string,
        employeeId: string
    ): Promise<string> {
        const member = await CompanyMember.findOne({
            companyId: new Types.ObjectId(companyId),
            userId: new Types.ObjectId(employeeId)
        }).lean();

        if (!member) {
            throw AppError.forbidden('EMPLOYEE_NOT_IN_COMPANY');
        }
        return employeeId;
    }

    /**
     * For Members: verify they have access to the requested projectId.
     * For Admins: projectId is not access-checked beyond belonging to the company.
     */
    private static async enforceProjectAccess(
        companyId: string,
        userId: string,
        role: string,
        projectId: string
    ): Promise<void> {
        const isAdmin = role === 'Admin' || role === 'SUPER_ADMIN';
        if (isAdmin) {
            // Admin: just verify the project belongs to the company
            const project = await Project.findOne({
                _id: new Types.ObjectId(projectId),
                companyId: new Types.ObjectId(companyId)
            }).lean();
            if (!project) throw AppError.notFound('PROJECT_NOT_FOUND');
            return;
        }

        // Member: must have been granted project access
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) {
            throw AppError.forbidden('UNAUTHORIZED_PROJECT_ACCESS');
        }
    }

    /**
     * Determine the effective target userId for a request.
     * - Member:        always returns their own JWT userId (ignores employeeId)
     * - Company Admin: returns the requested employeeId (validated), or null for "all employees"
     */
    private static async resolveTargetUserId(
        companyId: string,
        requestingUserId: string,
        role: string,
        requestedEmployeeId?: string
    ): Promise<string | null> {
        const isAdmin = role === 'Admin' || role === 'SUPER_ADMIN';

        if (!isAdmin) {
            // Member: always own data — ignore any supplied employeeId
            return requestingUserId;
        }

        if (requestedEmployeeId) {
            return TimesheetService.enforceEmployeeBelongsToCompany(companyId, requestedEmployeeId);
        }

        return null; // Admin with no filter = all company employees
    }

    // ──────────────────────────────────────────────────────────────────────────
    // DATA FETCHING HELPERS
    // ──────────────────────────────────────────────────────────────────────────

    /** Get all active company employee user IDs (paginated) */
    private static async getCompanyEmployeeIds(
        companyId: string,
        page: number,
        pageSize: number
    ): Promise<{ userIds: string[]; total: number }> {
        const [members, total] = await Promise.all([
            CompanyMember.find({
                companyId: new Types.ObjectId(companyId),
                status: 'ACTIVE'
            })
                .select('userId')
                .skip((page - 1) * pageSize)
                .limit(pageSize)
                .lean(),
            CompanyMember.countDocuments({
                companyId: new Types.ObjectId(companyId),
                status: 'ACTIVE'
            })
        ]);
        return {
            userIds: members.map(m => m.userId.toString()),
            total
        };
    }

    /**
     * Core data loader: fetch attendance, tracking sessions, and activities
     * for a set of userIds within a date range.
     */
    private static async loadRawData(
        companyId: string,
        userIds: string[],
        startDate: Date,
        endDate: Date
    ) {
        const companyObjId = new Types.ObjectId(companyId);
        const userObjIds   = userIds.map(id => new Types.ObjectId(id));

        const [attendanceRecords, trackingSessions, activities] = await Promise.all([
            Attendance.find({
                companyId: companyObjId,
                userId: { $in: userObjIds },
                checkInTime: { $gte: startDate, $lte: endDate }
            }).lean(),

            TimeTracking.find({
                companyId: companyObjId,
                userId: { $in: userObjIds },
                startedAt: { $gte: startDate, $lte: endDate }
            }).lean(),

            TaskActivity.find({
                companyId: companyObjId,
                userId: { $in: userObjIds },
                type: {
                    $in: [
                        ActivityType.TASK_STARTED,
                        ActivityType.TASK_PAUSED,
                        ActivityType.TASK_RESUMED,
                        ActivityType.TASK_HELD,
                        ActivityType.TASK_COMPLETED,
                        ActivityType.TASK_CANCELLED
                    ]
                },
                createdAt: { $gte: startDate, $lte: endDate }
            }).lean()
        ]);

        return { attendanceRecords, trackingSessions, activities };
    }

    /**
     * Enrich activities with task titles and project names.
     * Activities come from .lean() so they are plain objects, not Mongoose Documents.
     */
    private static async enrichActivities(
        activities: any[]
    ): Promise<(any & { taskTitle?: string; projectName?: string })[]> {
        if (!activities.length) return [];

        const taskIds    = [...new Set(activities.map((a: any) => a.taskId?.toString()).filter(Boolean))];
        const projectIds = [...new Set(activities.map((a: any) => a.projectId?.toString()).filter(Boolean))];

        const [tasks, projects] = await Promise.all([
            taskIds.length    ? Task.find({ _id: { $in: taskIds } }).select('title').lean()    : [],
            projectIds.length ? Project.find({ _id: { $in: projectIds } }).select('name').lean() : []
        ]);

        const taskMap    = new Map(tasks.map((t: any)    => [t._id.toString(), t.title]));
        const projectMap = new Map(projects.map((p: any) => [p._id.toString(), p.name]));

        return activities.map((a: any) => ({
            ...a,
            taskTitle:   taskMap.get(a.taskId?.toString() ?? '') ?? undefined,
            projectName: projectMap.get(a.projectId?.toString() ?? '') ?? undefined
        }));
    }

    /**
     * Build the complete TimesheetDayData for a single user on a single calendar day.
     */
    private static buildDayData(
        dateKey: string,
        attendance: IAttendance | null,
        sessions: ITimeTracking[],
        activities: (ITaskActivity & { taskTitle?: string; projectName?: string })[],
        projectIdFilter?: string
    ): TimesheetDayData {
        // Filter sessions to a specific project if requested
        const filteredSessions = projectIdFilter
            ? sessions.filter(s => s.projectId?.toString() === projectIdFilter)
            : sessions;

        const metrics   = TimesheetCalculatorService.calculateDayMetrics(attendance, filteredSessions);
        const anomalies = TimesheetCalculatorService.detectAnomalies(
            metrics, attendance, filteredSessions, activities, dateKey
        );
        const health    = TimesheetCalculatorService.calculateHealthSummary(anomalies);
        const timeline  = TimesheetCalculatorService.buildTimeline(attendance, activities);

        return {
            date: dateKey,
            checkInTime:  attendance?.checkInTime.toISOString() ?? null,
            checkOutTime: attendance?.checkOutTime?.toISOString() ?? null,
            timesheetHealth: health,
            anomalies,
            activities: timeline,
            ...metrics
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Main timesheet endpoint handler.
     * Enforces role-based access; Members always get their own data only.
     */
    static async getTimesheetData(
        companyId: string,
        requestingUserId: string,
        role: string,
        filter: TimesheetFilter
    ): Promise<TimesheetResponse> {
        const { startDate, endDate, projectId, page, pageSize } = filter;

        // 1. Resolve which employee(s) to fetch
        const targetUserId = await TimesheetService.resolveTargetUserId(
            companyId, requestingUserId, role, filter.employeeId
        );

        // 2. Enforce project access BEFORE any query
        if (projectId) {
            const checkUserId = targetUserId ?? requestingUserId;
            await TimesheetService.enforceProjectAccess(companyId, checkUserId, role, projectId);
        }

        // 3. Determine userIds to process
        let userIds: string[];
        let total: number;

        if (targetUserId) {
            userIds = [targetUserId];
            total   = 1;
        } else {
            // Admin requesting all employees (paginated)
            const result = await TimesheetService.getCompanyEmployeeIds(companyId, page, pageSize);
            userIds = result.userIds;
            total   = result.total;
        }

        if (!userIds.length) {
            return TimesheetService.emptyResponse(startDate, endDate, page, pageSize);
        }

        // 4. Load raw data
        const { attendanceRecords, trackingSessions, activities } =
            await TimesheetService.loadRawData(companyId, userIds, startDate, endDate);

        // 5. Enrich activities
        const enrichedActivities = await TimesheetService.enrichActivities(activities);

        // 6. Build per-user summaries
        const days = enumerateDays(startDate, endDate);
        const users: TimesheetUserSummary[] = [];

        for (const userId of userIds) {
            const profile = await resolveUserProfile(userId);

            // Group data by day key for this user
            const userAttendance = attendanceRecords.filter(a => a.userId.toString() === userId);
            const userSessions   = trackingSessions.filter(s => s.userId.toString() === userId);
            const userActivities = enrichedActivities.filter(a => a.userId.toString() === userId);

            const attendanceByDay = new Map<string, IAttendance>();
            for (const att of userAttendance) {
                attendanceByDay.set(toDateKey(att.checkInTime), att);
            }

            const sessionsByDay = new Map<string, ITimeTracking[]>();
            for (const session of userSessions) {
                const dk = toDateKey(session.startedAt);
                if (!sessionsByDay.has(dk)) sessionsByDay.set(dk, []);
                sessionsByDay.get(dk)!.push(session);
            }

            const activitiesByDay = new Map<string, (ITaskActivity & { taskTitle?: string; projectName?: string })[]>();
            for (const act of userActivities) {
                const dk = toDateKey(act.createdAt);
                if (!activitiesByDay.has(dk)) activitiesByDay.set(dk, []);
                activitiesByDay.get(dk)!.push(act);
            }

            const dailyHours: Record<string, TimesheetDayData> = {};
            const allAnomalies: AnomalyRecord[] = [];
            let totalProductionHours  = 0;
            let totalBreakHours       = 0;
            let totalIdleHours        = 0;
            let totalOvertimeHours    = 0;
            let totalWorkHours        = 0;

            for (const dateKey of days) {
                const dayData = TimesheetService.buildDayData(
                    dateKey,
                    attendanceByDay.get(dateKey) ?? null,
                    sessionsByDay.get(dateKey) ?? [],
                    activitiesByDay.get(dateKey) ?? [],
                    projectId
                );
                dailyHours[dateKey] = dayData;
                allAnomalies.push(...dayData.anomalies);
                totalProductionHours += dayData.productionHours;
                totalBreakHours      += dayData.breakHours;
                totalIdleHours       += dayData.idleHours;
                totalOvertimeHours   += dayData.overtimeHours;
                totalWorkHours       += dayData.totalWorkHours;
            }

            const overallHealth = TimesheetCalculatorService.calculateHealthSummary(allAnomalies);

            // Round totals to 2dp
            const r = (n: number) => Math.round(n * 100) / 100;

            users.push({
                userId,
                ...profile,
                timesheetHealth: overallHealth,
                dailyHours,
                totalProductionHours:  r(totalProductionHours),
                totalBreakHours:       r(totalBreakHours),
                totalIdleHours:        r(totalIdleHours),
                totalMeetingHours:     0,
                totalEfficientHours:   0,
                totalInefficientHours: 0,
                totalOvertimeHours:    r(totalOvertimeHours),
                totalWorkHours:        r(totalWorkHours)
            });
        }

        // 7. Compute grand totals
        const r = (n: number) => Math.round(n * 100) / 100;
        const grandProductionHours = r(users.reduce((s, u) => s + u.totalProductionHours, 0));
        const grandBreakHours      = r(users.reduce((s, u) => s + u.totalBreakHours,      0));
        const grandIdleHours       = r(users.reduce((s, u) => s + u.totalIdleHours,       0));
        const grandOvertimeHours   = r(users.reduce((s, u) => s + u.totalOvertimeHours,   0));
        const grandWorkHours       = r(users.reduce((s, u) => s + u.totalWorkHours,       0));

        return {
            startDate: startDate.toISOString().slice(0, 10),
            endDate:   endDate.toISOString().slice(0, 10),
            users,
            grandTotalProductionHours: grandProductionHours,
            grandTotalBreakHours:      grandBreakHours,
            grandTotalIdleHours:       grandIdleHours,
            grandTotalMeetingHours:    0,
            grandTotalOvertimeHours:   grandOvertimeHours,
            grandTotalWorkHours:       grandWorkHours,
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        };
    }

    /**
     * Productivity trend — daily metrics array for a user.
     */
    static async getProductivityTrend(
        companyId: string,
        requestingUserId: string,
        role: string,
        filter: TimesheetFilter
    ): Promise<{ date: string; metrics: ProductivityMetrics }[]> {
        const targetUserId = await TimesheetService.resolveTargetUserId(
            companyId, requestingUserId, role, filter.employeeId
        );
        if (!targetUserId) {
            throw AppError.badRequest('employeeId is required for trend data');
        }

        if (filter.projectId) {
            await TimesheetService.enforceProjectAccess(companyId, targetUserId, role, filter.projectId);
        }

        const { attendanceRecords, trackingSessions } = await TimesheetService.loadRawData(
            companyId, [targetUserId], filter.startDate, filter.endDate
        );

        const days = enumerateDays(filter.startDate, filter.endDate);

        const attendanceByDay = new Map<string, IAttendance>();
        for (const att of attendanceRecords) {
            attendanceByDay.set(toDateKey(att.checkInTime), att);
        }

        const sessionsByDay = new Map<string, ITimeTracking[]>();
        for (const session of trackingSessions) {
            const dk = toDateKey(session.startedAt);
            if (!sessionsByDay.has(dk)) sessionsByDay.set(dk, []);
            sessionsByDay.get(dk)!.push(session);
        }

        return days.map(dateKey => {
            const filteredSessions = filter.projectId
                ? (sessionsByDay.get(dateKey) ?? []).filter(s => s.projectId?.toString() === filter.projectId)
                : sessionsByDay.get(dateKey) ?? [];

            const metrics = TimesheetCalculatorService.calculateDayMetrics(
                attendanceByDay.get(dateKey) ?? null,
                filteredSessions
            );
            return { date: dateKey, metrics };
        });
    }

    /**
     * Compare two time periods for a user.
     */
    static async comparePeriods(
        companyId: string,
        requestingUserId: string,
        role: string,
        currentPeriod: PeriodFilter,
        previousPeriod: PeriodFilter,
        employeeId?: string
    ): Promise<ComparisonMetric[]> {
        const targetUserId = await TimesheetService.resolveTargetUserId(
            companyId, requestingUserId, role, employeeId
        );
        if (!targetUserId) {
            throw AppError.badRequest('employeeId is required for period comparison');
        }

        const [currentData, previousData] = await Promise.all([
            TimesheetService.loadRawData(companyId, [targetUserId], currentPeriod.startDate, currentPeriod.endDate),
            TimesheetService.loadRawData(companyId, [targetUserId], previousPeriod.startDate, previousPeriod.endDate)
        ]);

        const calcAgg = (records: IAttendance[], sessions: ITimeTracking[]) => {
            let productionHours = 0, breakHours = 0, totalWorkHours = 0;
            const attByDay = new Map<string, IAttendance>();
            for (const att of records) attByDay.set(toDateKey(att.checkInTime), att);
            const sesByDay = new Map<string, ITimeTracking[]>();
            for (const s of sessions) {
                const dk = toDateKey(s.startedAt);
                if (!sesByDay.has(dk)) sesByDay.set(dk, []);
                sesByDay.get(dk)!.push(s);
            }
            for (const [dk, att] of attByDay) {
                const m = TimesheetCalculatorService.calculateDayMetrics(att, sesByDay.get(dk) ?? []);
                productionHours += m.productionHours;
                breakHours      += m.breakHours;
                totalWorkHours  += m.totalWorkHours;
            }
            return {
                productionHours: Math.round(productionHours * 100) / 100,
                breakHours:      Math.round(breakHours * 100) / 100,
                totalWorkHours:  Math.round(totalWorkHours * 100) / 100,
                productivityScore: TimesheetCalculatorService.safePercentage(productionHours, totalWorkHours)
            };
        };

        const current  = calcAgg(currentData.attendanceRecords, currentData.trackingSessions);
        const previous = calcAgg(previousData.attendanceRecords, previousData.trackingSessions);

        const makeMetric = (metric: string, curr: number, prev: number): ComparisonMetric => {
            const change = prev === 0 ? null : Math.round(((curr - prev) / prev) * 10000) / 100;
            const trend  = change === null ? 'FLAT' : change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'FLAT';
            return { metric, currentValue: curr, previousValue: prev, percentageChange: change, trend };
        };

        return [
            makeMetric('totalWorkHours',    current.totalWorkHours,    previous.totalWorkHours),
            makeMetric('productionHours',   current.productionHours,   previous.productionHours),
            makeMetric('breakHours',        current.breakHours,        previous.breakHours),
            makeMetric('productivityScore', current.productivityScore, previous.productivityScore)
        ];
    }

    /**
     * Project-based time distribution for a user in a date range.
     */
    static async getProjectDistribution(
        companyId: string,
        requestingUserId: string,
        role: string,
        filter: TimesheetFilter
    ): Promise<ProjectDistribution[]> {
        const targetUserId = await TimesheetService.resolveTargetUserId(
            companyId, requestingUserId, role, filter.employeeId
        );
        if (!targetUserId) {
            throw AppError.badRequest('employeeId is required for project distribution');
        }

        const { trackingSessions } = await TimesheetService.loadRawData(
            companyId, [targetUserId], filter.startDate, filter.endDate
        );

        // Accumulate production hours per project
        const projectHours = new Map<string, number>();
        for (const session of trackingSessions) {
            const pId = session.projectId?.toString();
            if (!pId) continue;
            const workMs = session.intervals
                .filter(i => i.type === 'WORK')
                .reduce((sum, i) => {
                    const end = i.endedAt ? i.endedAt.getTime() : Date.now();
                    return sum + Math.max(0, end - i.startedAt.getTime());
                }, 0);
            projectHours.set(pId, (projectHours.get(pId) ?? 0) + workMs);
        }

        if (!projectHours.size) return [];

        const projectIds = Array.from(projectHours.keys());
        const projects   = await Project.find({ _id: { $in: projectIds } }).select('name').lean();
        const nameMap    = new Map(projects.map((p: any) => [p._id.toString(), p.name]));

        const totalMs = Array.from(projectHours.values()).reduce((a, b) => a + b, 0);

        return projectIds
            .map(pId => {
                const hours = TimesheetCalculatorService.msToHours(projectHours.get(pId)!);
                return {
                    projectId: pId,
                    projectName: nameMap.get(pId) ?? 'Unknown Project',
                    totalHours: hours,
                    percentageOfTrackedTime: TimesheetCalculatorService.safePercentage(
                        projectHours.get(pId)!, totalMs
                    )
                };
            })
            .sort((a, b) => b.totalHours - a.totalHours);
    }

    /**
     * Chronological timeline for a single user on a single date.
     * Members can only access their own timeline.
     * Admins can access any employee in the same company.
     */
    static async getTimeline(
        companyId: string,
        requestingUserId: string,
        role: string,
        targetUserId: string,
        date: string
    ): Promise<TimelineEntry[]> {
        const isAdmin = role === 'Admin' || role === 'SUPER_ADMIN';

        if (!isAdmin && targetUserId !== requestingUserId) {
            throw AppError.forbidden('CANNOT_VIEW_ANOTHER_EMPLOYEES_TIMELINE');
        }

        if (isAdmin && targetUserId !== requestingUserId) {
            await TimesheetService.enforceEmployeeBelongsToCompany(companyId, targetUserId);
        }

        const startDate = toStartOfDay(date);
        const endDate   = toEndOfDay(date);

        const { attendanceRecords, activities } = await TimesheetService.loadRawData(
            companyId, [targetUserId], startDate, endDate
        );

        const enriched = await TimesheetService.enrichActivities(activities);
        const attendance = attendanceRecords[0] ?? null;

        return TimesheetCalculatorService.buildTimeline(attendance, enriched);
    }

    /**
     * Get anomalies for a user in a date range.
     */
    static async getAnomalies(
        companyId: string,
        requestingUserId: string,
        role: string,
        filter: TimesheetFilter
    ): Promise<{ date: string; anomalies: AnomalyRecord[] }[]> {
        const targetUserId = await TimesheetService.resolveTargetUserId(
            companyId, requestingUserId, role, filter.employeeId
        );
        if (!targetUserId) {
            throw AppError.badRequest('employeeId is required to fetch anomalies');
        }

        const { attendanceRecords, trackingSessions, activities } = await TimesheetService.loadRawData(
            companyId, [targetUserId], filter.startDate, filter.endDate
        );

        const days = enumerateDays(filter.startDate, filter.endDate);

        const attByDay = new Map<string, IAttendance>();
        for (const att of attendanceRecords) attByDay.set(toDateKey(att.checkInTime), att);

        const sesByDay = new Map<string, ITimeTracking[]>();
        for (const s of trackingSessions) {
            const dk = toDateKey(s.startedAt);
            if (!sesByDay.has(dk)) sesByDay.set(dk, []);
            sesByDay.get(dk)!.push(s);
        }

        const actByDay = new Map<string, ITaskActivity[]>();
        for (const a of activities) {
            const dk = toDateKey(a.createdAt);
            if (!actByDay.has(dk)) actByDay.set(dk, []);
            actByDay.get(dk)!.push(a);
        }

        return days
            .map(dateKey => {
                const metrics = TimesheetCalculatorService.calculateDayMetrics(
                    attByDay.get(dateKey) ?? null,
                    sesByDay.get(dateKey) ?? []
                );
                const anomalies = TimesheetCalculatorService.detectAnomalies(
                    metrics,
                    attByDay.get(dateKey) ?? null,
                    sesByDay.get(dateKey) ?? [],
                    actByDay.get(dateKey) ?? [],
                    dateKey
                );
                return { date: dateKey, anomalies };
            })
            .filter(d => d.anomalies.length > 0);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // APPROVAL WORKFLOW
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Member submits their timesheet for a period.
     * Creates a TimesheetApproval record in SUBMITTED state.
     * Returns 409 if already submitted for the same period.
     */
    static async submitTimesheet(
        companyId: string,
        userId: string,
        periodStartStr: string,
        periodEndStr: string
    ): Promise<ITimesheetApproval> {
        const periodStart = toStartOfDay(periodStartStr);
        const periodEnd   = toEndOfDay(periodEndStr);

        const existing = await TimesheetApproval.findOne({
            companyId: new Types.ObjectId(companyId),
            userId:    new Types.ObjectId(userId),
            periodStart,
            periodEnd
        });

        if (existing) {
            if (existing.status === TimesheetApprovalStatus.LOCKED) {
                throw AppError.conflict('TIMESHEET_PERIOD_LOCKED');
            }
            if (existing.status === TimesheetApprovalStatus.SUBMITTED) {
                throw AppError.conflict('TIMESHEET_ALREADY_SUBMITTED');
            }
        }

        const approval = await TimesheetApproval.findOneAndUpdate(
            {
                companyId: new Types.ObjectId(companyId),
                userId:    new Types.ObjectId(userId),
                periodStart,
                periodEnd
            },
            {
                $set: {
                    status:      TimesheetApprovalStatus.SUBMITTED,
                    submittedAt: new Date()
                },
                $setOnInsert: {
                    companyId: new Types.ObjectId(companyId),
                    userId:    new Types.ObjectId(userId),
                    periodStart,
                    periodEnd
                }
            },
            { upsert: true, new: true }
        );

        return approval!;
    }

    /**
     * Admin approves, rejects, or locks a TimesheetApproval.
     * Verifies the approval belongs to the admin's company.
     */
    static async reviewTimesheet(
        companyId: string,
        adminId: string,
        timesheetId: string,
        action: 'APPROVE' | 'REJECT' | 'LOCK',
        reason?: string
    ): Promise<ITimesheetApproval> {
        const approval = await TimesheetApproval.findOne({
            _id:       new Types.ObjectId(timesheetId),
            companyId: new Types.ObjectId(companyId)
        });

        if (!approval) {
            throw AppError.notFound('TIMESHEET_APPROVAL_NOT_FOUND');
        }

        if (approval.status === TimesheetApprovalStatus.LOCKED) {
            throw AppError.conflict('TIMESHEET_PERIOD_LOCKED');
        }

        if (action === 'REJECT' && (!reason || !reason.trim())) {
            throw AppError.badRequest('REJECTION_REASON_REQUIRED');
        }

        const now = new Date();
        approval.reviewedBy  = new Types.ObjectId(adminId);
        approval.reviewedAt  = now;

        if (action === 'APPROVE') {
            approval.status = TimesheetApprovalStatus.APPROVED;
        } else if (action === 'REJECT') {
            approval.status          = TimesheetApprovalStatus.REJECTED;
            approval.rejectionReason = reason!.trim();
        } else {
            approval.status = TimesheetApprovalStatus.LOCKED;
        }

        await approval.save();
        return approval;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // CORRECTIONS
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Admin creates a manual correction.
     * One of attendanceId, trackingId, or activityId must be provided.
     * Always writes an AuditLog entry — fire-and-forget.
     */
    static async createCorrection(
        companyId: string,
        adminId: string,
        data: {
            userId: string;
            attendanceId?: string;
            trackingId?: string;
            activityId?: string;
            fieldChanged: string;
            originalValue: any;
            newValue: any;
            reason: string;
        },
        req?: Request
    ) {
        if (!data.attendanceId && !data.trackingId && !data.activityId) {
            throw AppError.badRequest('One of attendanceId, trackingId, or activityId is required');
        }

        // Verify the target employee belongs to the same company
        await TimesheetService.enforceEmployeeBelongsToCompany(companyId, data.userId);

        const correction = await TimesheetCorrection.create({
            companyId:     new Types.ObjectId(companyId),
            userId:        new Types.ObjectId(data.userId),
            attendanceId:  data.attendanceId ? new Types.ObjectId(data.attendanceId) : undefined,
            trackingId:    data.trackingId   ? new Types.ObjectId(data.trackingId)   : undefined,
            activityId:    data.activityId   ? new Types.ObjectId(data.activityId)   : undefined,
            fieldChanged:  data.fieldChanged,
            originalValue: data.originalValue,
            newValue:      data.newValue,
            changedBy:     new Types.ObjectId(adminId),
            reason:        data.reason.trim()
        });

        // Audit log — fire-and-forget; never blocks the response
        AuditLogService.log({
            action:       AuditAction.OTHER,
            actorId:      adminId,
            targetUserId: data.userId,
            companyId,
            description:  `Timesheet correction: field "${data.fieldChanged}" changed for user ${data.userId}. Reason: ${data.reason}`,
            metadata: {
                correctionId:  correction._id.toString(),
                fieldChanged:  data.fieldChanged,
                originalValue: data.originalValue,
                newValue:      data.newValue,
                attendanceId:  data.attendanceId,
                trackingId:    data.trackingId,
                activityId:    data.activityId
            },
            req
        });

        return correction;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // UTILITY
    // ──────────────────────────────────────────────────────────────────────────

    private static emptyResponse(
        startDate: Date,
        endDate: Date,
        page: number,
        pageSize: number
    ): TimesheetResponse {
        return {
            startDate: startDate.toISOString().slice(0, 10),
            endDate:   endDate.toISOString().slice(0, 10),
            users:     [],
            grandTotalProductionHours: 0,
            grandTotalBreakHours:      0,
            grandTotalIdleHours:       0,
            grandTotalMeetingHours:    0,
            grandTotalOvertimeHours:   0,
            grandTotalWorkHours:       0,
            pagination: { page, pageSize, total: 0, totalPages: 0 }
        };
    }
}
