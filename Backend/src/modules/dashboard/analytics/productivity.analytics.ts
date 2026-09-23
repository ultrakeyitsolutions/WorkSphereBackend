import { Types } from 'mongoose';
import { CompanyMember } from '../../companyadmin/invitations/company-member.model';
import { User } from '../../users/user.model';
import { Attendance } from '../../attendance/attendance.model';
import { TimeTracking, IntervalType } from '../../task-tracking/time-tracking.model';
import { Task } from '../../tasks/task.model';
import { DashboardScopeContext, EmployeeProductivityResponse, EmployeeProductivityItem } from '../dashboard.types';

export class ProductivityAnalytics {
    public static async getProductivity(context: DashboardScopeContext): Promise<EmployeeProductivityResponse> {
        const { companyId, userId, isCompanyWide, hasUserReview, dateRange, filterTeamId } = context;

        // 1. Company Admin without USER_REVIEW_READ permission
        if (isCompanyWide && !hasUserReview) {
            return {
                enabled: false,
                summary: {
                    averageWorkingMinutes: 0,
                    averageActiveMinutes: 0,
                    averageIdleMinutes: 0,
                    averageBreakMinutes: 0,
                },
                employees: [],
            };
        }

        // 2. Resolve Target Users to compute
        let targetUserIds: Types.ObjectId[] = [];
        const userDisplayMap = new Map<string, { name: string; avatar: string | null }>();

        if (!isCompanyWide) {
            // Employee scope: ONLY themselves
            targetUserIds = [userId];
            const me = await User.findById(userId).select('name avatar').lean();
            if (me) {
                userDisplayMap.set(String(userId), { name: me.name, avatar: (me as any).avatar || null });
            }
        } else {
            // Company Admin scope
            const memberMatch: any = {
                companyId,
                memberType: { $in: ['EMPLOYEE', 'MANAGER'] },
                status: 'ACTIVE',
            };

            if (filterTeamId) {
                memberMatch.userId = filterTeamId;
            }

            const members = await CompanyMember.find(memberMatch)
                .populate<{ userId: { _id: Types.ObjectId; name: string; email: string; avatar?: string; isActive: boolean; status: string } }>(
                    'userId',
                    'name email avatar isActive status'
                )
                .lean();

            const activeMembers = members
                .map((m) => m.userId)
                .filter((u) => u && u.isActive && u.status !== 'DEACTIVATED');

            targetUserIds = activeMembers.map((u) => u._id);
            activeMembers.forEach((u) => {
                userDisplayMap.set(String(u._id), { name: u.name, avatar: (u as any).avatar || null });
            });
        }

        if (targetUserIds.length === 0) {
            return {
                enabled: true,
                summary: {
                    averageWorkingMinutes: 0,
                    averageActiveMinutes: 0,
                    averageIdleMinutes: 0,
                    averageBreakMinutes: 0,
                },
                employees: [],
            };
        }

        // 3. Parallel Aggregations
        const attMatch: any = {
            companyId,
            userId: { $in: targetUserIds },
        };
        const trkMatch: any = {
            companyId,
            userId: { $in: targetUserIds },
        };
        const tskMatch: any = {
            companyId,
            assignedToId: { $in: targetUserIds },
            isArchived: { $ne: true },
        };

        if (dateRange.startDate && dateRange.endDate) {
            attMatch.checkInTime = { $gte: dateRange.startDate, $lte: dateRange.endDate };
            trkMatch.startedAt = { $gte: dateRange.startDate, $lte: dateRange.endDate };
            tskMatch.completedDate = { $gte: dateRange.startDate, $lte: dateRange.endDate };
        } else {
            tskMatch.completedDate = { $ne: null };
        }

        const [attendanceLogs, trackingSessions, completedTasks] = await Promise.all([
            Attendance.find(attMatch).lean(),
            TimeTracking.find(trkMatch).lean(),
            Task.aggregate([
                { $match: tskMatch },
                { $group: { _id: '$assignedToId', count: { $sum: 1 } } },
            ]),
        ]);

        // Attendance minutes
        const attendanceMinutesMap = new Map<string, number>();
        for (const log of attendanceLogs) {
            const uidStr = String(log.userId);
            const start = new Date(log.checkInTime).getTime();
            const end = log.checkOutTime ? new Date(log.checkOutTime).getTime() : Date.now();
            const mins = Math.max(0, Math.round((end - start) / 60000));
            attendanceMinutesMap.set(uidStr, (attendanceMinutesMap.get(uidStr) || 0) + mins);
        }

        // Tracking sessions
        const trackingStatsMap = new Map<string, { workMinutes: number; breakMinutes: number }>();
        for (const session of trackingSessions) {
            const uidStr = String(session.userId);
            const current = trackingStatsMap.get(uidStr) || { workMinutes: 0, breakMinutes: 0 };

            if (session.intervals && Array.isArray(session.intervals)) {
                for (const interval of session.intervals) {
                    const start = new Date(interval.startedAt).getTime();
                    const end = interval.endedAt ? new Date(interval.endedAt).getTime() : Date.now();
                    const mins = Math.max(0, Math.round((end - start) / 60000));

                    if (interval.type === IntervalType.WORK) {
                        current.workMinutes += mins;
                    } else {
                        current.breakMinutes += mins;
                    }
                }
            } else if (session.workedSeconds) {
                current.workMinutes += Math.round(session.workedSeconds / 60);
            }

            trackingStatsMap.set(uidStr, current);
        }

        const completedTasksMap = new Map<string, number>();
        completedTasks.forEach((c) => completedTasksMap.set(String(c._id), c.count));

        let totalWorkingMinutes = 0;
        let totalActiveMinutes = 0;
        let totalIdleMinutes = 0;
        let totalBreakMinutes = 0;

        const employeeList: EmployeeProductivityItem[] = [];

        for (const targetId of targetUserIds) {
            const uidStr = String(targetId);
            const display = userDisplayMap.get(uidStr) || { name: 'Team Member', avatar: null };
            const checkInMins = attendanceMinutesMap.get(uidStr) || 0;
            const trk = trackingStatsMap.get(uidStr) || { workMinutes: 0, breakMinutes: 0 };
            const tasksCompleted = completedTasksMap.get(uidStr) || 0;

            const workingMinutes = Math.max(checkInMins, trk.workMinutes + trk.breakMinutes);
            const activeMinutes = trk.workMinutes;
            const breakMinutes = trk.breakMinutes;
            const idleMinutes = Math.max(0, workingMinutes - activeMinutes - breakMinutes);

            const productivityScore = workingMinutes > 0
                ? Math.min(100, Math.round((activeMinutes / workingMinutes) * 100))
                : 0;

            totalWorkingMinutes += workingMinutes;
            totalActiveMinutes += activeMinutes;
            totalIdleMinutes += idleMinutes;
            totalBreakMinutes += breakMinutes;

            employeeList.push({
                userId: uidStr,
                name: display.name,
                avatar: display.avatar,
                workingMinutes,
                activeMinutes,
                idleMinutes,
                breakMinutes,
                completedTasks: tasksCompleted,
                productivityScore,
            });
        }

        const count = targetUserIds.length;
        const avgWorking = count > 0 ? Math.round(totalWorkingMinutes / count) : 0;
        const avgActive = count > 0 ? Math.round(totalActiveMinutes / count) : 0;
        const avgIdle = count > 0 ? Math.round(totalIdleMinutes / count) : 0;
        const avgBreak = count > 0 ? Math.round(totalBreakMinutes / count) : 0;

        return {
            enabled: true,
            summary: {
                averageWorkingMinutes: avgWorking,
                averageActiveMinutes: avgActive,
                averageIdleMinutes: avgIdle,
                averageBreakMinutes: avgBreak,
            },
            employees: employeeList,
        };
    }
}
