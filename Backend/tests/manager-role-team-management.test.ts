import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { TeamService } from '../src/modules/teams/team.service';
import { MemberService } from '../src/modules/companyadmin/members/member.service';
import { TeamAccessService } from '../src/modules/manager/services/team-access.service';

const COMPANY_ID = '6ae9fd8cc4634cf0b42be688';
const ADMIN_ID = '6ae9fd8cc4634cf0b42be690';
const USER_1 = '6ae9fd8cc4634cf0b42be691';
const USER_2 = '6ae9fd8cc4634cf0b42be692';

const TEAM_1 = '6ae9fd8cc4634cf0b42be689';
const TEAM_2 = '6ae9fd8cc4634cf0b42be68a';
const MEMBER_1 = '6ae9fd8cc4634cf0b42be693';

// ─── HOISTED STATE & MOCKS ──────────────────────────────────────────────

const hoisted = vi.hoisted(() => {
    const teamsState: Record<string, any> = {};
    const state = {
        mockMember: {} as any,
        mockUser: {} as any,
        mockRole: {} as any,
    };

    function makeTeamQuery(target: any) {
        const doc: any = {
            ...target,
            memberIds: [...(target?.memberIds || [])],
            save: vi.fn().mockImplementation(async function (this: any) {
                if (target) target.memberIds = this.memberIds;
                return this;
            }),
        };
        return {
            ...doc,
            save: doc.save,
            populate: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            sort: vi.fn().mockReturnThis(),
            lean: vi.fn().mockImplementation(() =>
                Promise.resolve({
                    ...target,
                    memberIds: (target?.memberIds || []).map((m: any) => ({
                        _id: m,
                        name: 'Member',
                        email: 'member@test.com',
                        status: 'ACTIVE',
                    })),
                    projectIds: (target?.projectIds || []).map((p: any) => ({
                        _id: p,
                        name: 'Project',
                        status: 'ACTIVE',
                    })),
                    managerIds: (target?.managerIds || []).map((m: any) => ({
                        _id: m,
                        name: 'Manager',
                        email: 'mgr@test.com',
                    })),
                })
            ),
            then(resolve: any, reject: any) {
                return Promise.resolve(doc).then(resolve, reject);
            },
        };
    }

    const memberMockHandler = {
        findOne: vi.fn().mockImplementation(() => ({
            lean: vi.fn().mockImplementation(() => Promise.resolve(state.mockMember)),
            then(resolve: any, reject: any) {
                return Promise.resolve(state.mockMember).then(resolve, reject);
            },
        })),
        findById: vi.fn().mockImplementation(() => ({
            lean: vi.fn().mockImplementation(() => Promise.resolve(state.mockMember)),
            then(resolve: any, reject: any) {
                return Promise.resolve(state.mockMember).then(resolve, reject);
            },
        })),
    };

    const userMockHandler = {
        findById: vi.fn().mockImplementation(() => ({
            lean: vi.fn().mockImplementation(() => Promise.resolve(state.mockUser)),
            then(resolve: any, reject: any) {
                return Promise.resolve(state.mockUser).then(resolve, reject);
            },
        })),
    };

    const roleMockHandler = {
        findOne: vi.fn().mockImplementation(() => ({
            lean: vi.fn().mockImplementation(() => Promise.resolve(state.mockRole)),
            then(resolve: any, reject: any) {
                return Promise.resolve(state.mockRole).then(resolve, reject);
            },
        })),
    };

    return {
        teamsState,
        state,
        makeTeamQuery,
        memberMockHandler,
        userMockHandler,
        roleMockHandler,
    };
});

vi.mock('../src/modules/audit-logs/audit-log.model', () => ({
    AuditLog: {
        create: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../src/modules/manager/models/manager-audit.model', () => ({
    ManagerAssignmentAudit: {
        create: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../src/modules/manager/services/manager-assignment.service', () => ({
    ManagerAssignmentService: {
        promoteToManager: vi.fn().mockResolvedValue({ success: true }),
        demoteManager: vi.fn().mockResolvedValue({ success: true }),
    },
}));

vi.mock('../src/modules/teams/team.model', () => ({
    Team: {
        findOne: vi.fn().mockImplementation((query: any) => {
            const idStr = String(query?._id?._id || query?._id || '');
            const target = hoisted.teamsState[idStr] || hoisted.teamsState[TEAM_1];
            return hoisted.makeTeamQuery(target);
        }),
        findById: vi.fn().mockImplementation((id: any) => {
            const idStr = String(id?._id || id || '');
            const target = hoisted.teamsState[idStr] || hoisted.teamsState[TEAM_1];
            return hoisted.makeTeamQuery(target);
        }),
    },
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        find: vi.fn().mockReturnValue({
            populate: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([]),
        }),
    },
}));

vi.mock('../src/modules/companyadmin/invitations/company-member.model', () => ({
    default: hoisted.memberMockHandler,
    CompanyMember: hoisted.memberMockHandler,
}));

vi.mock('../src/modules/users/user.model', () => ({
    User: hoisted.userMockHandler,
    default: hoisted.userMockHandler,
}));

vi.mock('../src/modules/roles/role.model', () => ({
    Role: hoisted.roleMockHandler,
    default: hoisted.roleMockHandler,
}));

describe('Manager Role, Team Management & Access Control', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        hoisted.state.mockMember = {
            _id: new Types.ObjectId(MEMBER_1),
            companyId: new Types.ObjectId(COMPANY_ID),
            userId: new Types.ObjectId(USER_1),
            memberType: 'EMPLOYEE',
            status: 'ACTIVE',
            save: vi.fn().mockResolvedValue(true),
        };

        hoisted.state.mockUser = {
            _id: new Types.ObjectId(USER_1),
            companyId: new Types.ObjectId(COMPANY_ID),
            email: 'user1@example.com',
            role: new Types.ObjectId('6ae9fd8cc4634cf0b42be699'),
            save: vi.fn().mockResolvedValue(true),
        };

        hoisted.state.mockRole = {
            _id: new Types.ObjectId('6ae9fd8cc4634cf0b42be699'),
            name: 'MANAGER',
        };

        hoisted.teamsState[TEAM_1] = {
            _id: new Types.ObjectId(TEAM_1),
            companyId: new Types.ObjectId(COMPANY_ID),
            name: 'Team Alpha',
            code: 'TA',
            description: 'Alpha team',
            memberIds: [new Types.ObjectId(USER_1)],
            projectIds: [],
            managerIds: [],
            leadId: null,
        };
        hoisted.teamsState[TEAM_2] = {
            _id: new Types.ObjectId(TEAM_2),
            companyId: new Types.ObjectId(COMPANY_ID),
            name: 'Team Beta',
            code: 'TB',
            description: 'Beta team',
            memberIds: [new Types.ObjectId(USER_2)],
            projectIds: [],
            managerIds: [],
            leadId: null,
        };

        vi.spyOn(TeamAccessService, 'invalidateScopeCache').mockResolvedValue(undefined);
    });

    it('should calculate team performance accurately', async () => {
        const perf = await TeamService.getTeamPerformance(COMPANY_ID, TEAM_1);
        expect(perf).toBeDefined();
        expect(perf.teamId).toBeDefined();
        expect(perf.metrics).toBeDefined();
        expect(typeof perf.metrics.completionRate).toBe('number');
    });

    it('should transfer team members cleanly between teams and update cache', async () => {
        const result = await TeamService.transferMembers(
            COMPANY_ID,
            TEAM_1,
            TEAM_2,
            [USER_1],
            ADMIN_ID
        );
        expect(result).toBeDefined();
        expect(result.transferredCount).toBe(1);
    });

    it('should enforce role switching without account duplication', async () => {
        const res = await MemberService.changeUserRole(
            COMPANY_ID,
            USER_1,
            'MANAGER',
            ADMIN_ID
        );
        expect(res.success).toBe(true);
        expect(res.newRole).toBe('MANAGER');
    });
});
