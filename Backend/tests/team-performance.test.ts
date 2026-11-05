import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamService } from '../src/modules/teams/team.service';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
    teamFindOne: vi.fn(),
    taskFind: vi.fn(),
}));

vi.mock('../src/modules/teams/team.model', () => ({
    Team: {
        findOne: mocks.teamFindOne,
    },
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        find: mocks.taskFind,
    },
}));

const COMPANY_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TEAM_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const MEMBER_1 = '111111111111111111111111';
const MEMBER_2 = '222222222222222222222222';
const PROJECT_ID = 'cccccccccccccccccccccccc';

const buildChain = (resolved: any) => ({
    populate: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(resolved),
});

describe('TeamService.getTeamPerformance', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        const teamDoc = {
            _id: TEAM_ID,
            name: 'Engineering',
            memberIds: [
                { _id: MEMBER_1, name: 'Alice', email: 'a@x.com', avatar: null, status: 'ACTIVE' },
                { _id: MEMBER_2, name: 'Bob', email: 'b@x.com', avatar: null, status: 'ACTIVE' },
            ],
            projectIds: [{ _id: PROJECT_ID, name: 'Project X', status: 'ACTIVE' }],
        };

        mocks.teamFindOne.mockReturnValue(buildChain(teamDoc));
        mocks.taskFind.mockReturnValue(buildChain([]));
    });

    it('returns zeroed metrics when there are no tasks', async () => {
        const perf = await TeamService.getTeamPerformance(COMPANY_ID, TEAM_ID);

        expect(perf.teamId).toBe(TEAM_ID);
        expect(perf.teamName).toBe('Engineering');
        expect(perf.membersCount).toBe(2);
        expect(perf.projectsCount).toBe(1);
        expect(perf.metrics).toEqual({
            totalTasks: 0,
            completedTasks: 0,
            pendingTasks: 0,
            inProgressTasks: 0,
            overdueTasks: 0,
            completionRate: 0,
        });
    });

    it('counts completed, in-progress, pending and overdue tasks using statusId + completedDate', async () => {
        const now = new Date();
        const overdueDue = new Date(now.getTime() - 86400000); // yesterday

        mocks.taskFind.mockReturnValue(
            buildChain([
                // completed via completedDate
                {
                    _id: 't1', statusId: { name: 'New' }, completedDate: now,
                    dueDate: null, assignedToId: MEMBER_1, projectId: PROJECT_ID,
                },
                // in-progress via status name
                {
                    _id: 't2', statusId: { name: 'In Progress' }, completedDate: null,
                    dueDate: null, assignedToId: MEMBER_2, projectId: PROJECT_ID,
                },
                // pending (not completed, not in-progress)
                {
                    _id: 't3', statusId: { name: 'Todo' }, completedDate: null,
                    dueDate: null, assignedToId: MEMBER_1, projectId: PROJECT_ID,
                },
                // overdue (not completed, due date in past)
                {
                    _id: 't4', statusId: { name: 'Todo' }, completedDate: null,
                    dueDate: overdueDue, assignedToId: MEMBER_2, projectId: PROJECT_ID,
                },
            ])
        );

        const perf = await TeamService.getTeamPerformance(COMPANY_ID, TEAM_ID);

        expect(perf.metrics.totalTasks).toBe(4);
        expect(perf.metrics.completedTasks).toBe(1);
        expect(perf.metrics.inProgressTasks).toBe(1);
        expect(perf.metrics.overdueTasks).toBe(1);
        // pending = total - completed - inProgress = 2 (t3 is plain pending, t4 is overdue pending)
        expect(perf.metrics.pendingTasks).toBe(2);
        expect(perf.metrics.completionRate).toBe(25);
    });

    it('includes tasks assigned to team members OR belonging to team projects', async () => {
        mocks.taskFind.mockReturnValue(buildChain([
            { _id: 't1', statusId: null, completedDate: null, dueDate: null, assignedToId: MEMBER_1, projectId: 'other-project' },
            { _id: 't2', statusId: null, completedDate: null, dueDate: null, assignedToId: 'outsider', projectId: PROJECT_ID },
        ]));

        const perf = await TeamService.getTeamPerformance(COMPANY_ID, TEAM_ID);
        expect(perf.metrics.totalTasks).toBe(2);
    });

    it('throws on invalid teamId', async () => {
        await expect(TeamService.getTeamPerformance(COMPANY_ID, 'not-an-id')).rejects.toThrow('Invalid teamId');
    });
});
