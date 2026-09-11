import { Types } from 'mongoose';
import { Task } from '../../tasks/task.model';
import { Project, ProjectTeamMember, ProjectInCharge } from '../projects/project.model';
import { Attendance, AttendanceStatus } from '../../attendance/attendance.model';

export class MemberDashboardService {
    /**
     * Returns aggregated dashboard statistics for a logged-in member:
     * - My assigned tasks (total + breakdown by priority and completion)
     * - My projects (count + minimal list)
     * - Attendance status today
     * - Overdue tasks count
     */
    static async getStats(companyId: string, userId: string) {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // ── 1. My project IDs ──────────────────────────────────────────────────
        const [teamMemberships, managedProjects, createdProjects] = await Promise.all([
            ProjectTeamMember.find({ userId: uId }).select('projectId').lean(),
            ProjectInCharge.find({ userId: uId }).select('projectId').lean(),
            Project.find({ companyId: cId, createdById: uId, deletedAt: null })
                .select('_id').lean(),
        ]);

        const projectIdSet = new Set<string>();
        teamMemberships.forEach(m => projectIdSet.add(String(m.projectId)));
        managedProjects.forEach(m => projectIdSet.add(String(m.projectId)));
        createdProjects.forEach(p => projectIdSet.add(String(p._id)));

        const myProjectIds = Array.from(projectIdSet).map(id => new Types.ObjectId(id));

        // ── 2. My project list (brief) ─────────────────────────────────────────
        const myProjects = await Project.find({
            _id: { $in: myProjectIds },
            companyId: cId,
            deletedAt: null,
        })
            .select('_id name status priority')
            .limit(10)
            .lean();

        // ── 3. My assigned tasks ───────────────────────────────────────────────
        const assignedTasks = await Task.find({
            companyId: cId,
            assignedToId: uId,
            isDeleted: { $ne: true },
        })
            .select('_id priority completedDate dueDate')
            .lean();

        const taskTotal = assignedTasks.length;
        const taskCompleted = assignedTasks.filter(t => !!(t as any).completedDate).length;
        const taskPending = taskTotal - taskCompleted;
        const taskOverdue = assignedTasks.filter(
            t => !(t as any).completedDate && (t as any).dueDate && new Date((t as any).dueDate) < today
        ).length;

        const tasksByPriority: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
        for (const t of assignedTasks) {
            const p = ((t as any).priority as string) ?? 'MEDIUM';
            tasksByPriority[p] = (tasksByPriority[p] ?? 0) + 1;
        }

        // ── 4. Today's attendance status ───────────────────────────────────────
        const todayAttendance = await Attendance.findOne({
            companyId,
            userId,
            status: AttendanceStatus.CHECKED_IN,
        }).lean();

        return {
            projects: {
                total: myProjectIds.length,
                list: myProjects.map(p => ({
                    id: String(p._id),
                    name: p.name,
                    status: p.status,
                    priority: p.priority,
                })),
            },
            tasks: {
                total: taskTotal,
                completed: taskCompleted,
                pending: taskPending,
                overdue: taskOverdue,
                byPriority: tasksByPriority,
            },
            attendance: {
                isCheckedIn: !!todayAttendance,
                checkInTime: (todayAttendance as any)?.checkInTime ?? null,
            },
        };
    }
}
