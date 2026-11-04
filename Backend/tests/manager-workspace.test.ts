import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { TeamAccessService } from '../src/modules/manager/services/team-access.service';
import { ManagerAssignmentService } from '../src/modules/manager/services/manager-assignment.service';
import {
    ManagerAssignmentType,
    ManagerAuditAction,
    MANAGER_PERMISSIONS,
} from '../src/modules/manager/constants/manager.constants';
import { FeatureRevocationService } from '../src/modules/companyadmin/settings/feature-revocation.service';

const COMPANY_ID = new Types.ObjectId().toString();
const OTHER_COMPANY_ID = new Types.ObjectId().toString();
const MANAGER_ID = new Types.ObjectId().toString();
const EMPLOYEE_1 = new Types.ObjectId().toString();
const EMPLOYEE_2 = new Types.ObjectId().toString();
const EMPLOYEE_OUTSIDE = new Types.ObjectId().toString();
const TEAM_ALPHA = new Types.ObjectId().toString();
const TEAM_BETA = new Types.ObjectId().toString();
const TEAM_GAMMA_OUTSIDE = new Types.ObjectId().toString();
const PROJECT_1 = new Types.ObjectId().toString();
const PROJECT_2 = new Types.ObjectId().toString();
const PROJECT_OUTSIDE = new Types.ObjectId().toString();

// In-memory mock stores
let assignmentsStore: any[] = [];
let permissionsStore: any[] = [];
let auditStore: any[] = [];
let teamsStore: any[] = [];
let membersStore: any[] = [];

// Sockets and Redis mock
const mockSockets = new Map<string, any>();
const mockIo = {
    sockets: {
        sockets: mockSockets,
    },
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
};

vi.mock('../src/sockets/socket-server', () => ({
    getSocketServer: () => mockIo,
    initSocketServer: vi.fn(),
    default: () => mockIo,
}));

vi.mock('../src/config/redis', () => ({
    getRedisClient: () => ({
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        publish: vi.fn().mockResolvedValue(1),
        subscribe: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
    }),
}));

vi.mock('../src/modules/manager/models/manager-assignment.model', () => {
    return {
        ManagerAssignment: {
            find: vi.fn((query) => ({
                lean: vi.fn().mockImplementation(async () => {
                    return assignmentsStore.filter((a) => {
                        if (query.companyId && a.companyId?.toString() !== query.companyId?.toString()) return false;
                        if (query.managerId && a.managerId?.toString() !== query.managerId?.toString()) return false;
                        if (query.isActive !== undefined && a.isActive !== query.isActive) return false;
                        if (query.teamId && a.teamId?.toString() !== query.teamId?.toString()) return false;
                        return true;
                    });
                }),
                populate: vi.fn().mockReturnThis(),
                sort: vi.fn().mockReturnThis(),
            })),
            findOne: vi.fn((query) => {
                const a = assignmentsStore.find((item) => {
                    if (query._id && item._id?.toString() !== query._id?.toString()) return false;
                    if (query.companyId && item.companyId?.toString() !== query.companyId?.toString()) return false;
                    if (query.managerId && item.managerId?.toString() !== query.managerId?.toString()) return false;
                    if (query.isActive !== undefined && item.isActive !== query.isActive) return false;
                    if (query.assignmentType && item.assignmentType !== query.assignmentType) return false;
                    if (query.teamId && item.teamId?.toString() !== query.teamId?.toString()) return false;
                    if (query.employeeId && item.employeeId?.toString() !== query.employeeId?.toString()) return false;
                    if (query.projectId && item.projectId?.toString() !== query.projectId?.toString()) return false;
                    return true;
                });
                if (!a) {
                    return {
                        populate: vi.fn().mockReturnThis(),
                        lean: vi.fn().mockResolvedValue(null),
                        then: (resolve: any) => Promise.resolve(null).then(resolve),
                    };
                }
                const doc = {
                    ...a,
                    save: vi.fn(async () => {
                        Object.assign(a, doc);
                        return doc;
                    }),
                    toObject: vi.fn(() => ({ ...a })),
                };
                return {
                    populate: vi.fn().mockReturnThis(),
                    lean: vi.fn().mockResolvedValue(a),
                    then: (resolve: any) => Promise.resolve(doc).then(resolve),
                };
            }),
            findById: vi.fn((id) => {
                const a = assignmentsStore.find((item) => item._id?.toString() === id?.toString());
                if (!a) {
                    return {
                        lean: vi.fn().mockResolvedValue(null),
                        then: (resolve: any) => Promise.resolve(null).then(resolve),
                    };
                }
                const doc = {
                    ...a,
                    save: vi.fn(async () => {
                        Object.assign(a, doc);
                        return doc;
                    }),
                    toObject: vi.fn(() => ({ ...a })),
                };
                return {
                    lean: vi.fn().mockResolvedValue(a),
                    then: (resolve: any) => Promise.resolve(doc).then(resolve),
                };
            }),
            create: vi.fn(async (docs) => {
                const list = Array.isArray(docs) ? docs : [docs];
                const created = list.map((d) => ({
                    ...d,
                    _id: d._id || new Types.ObjectId(),
                    isActive: d.isActive !== undefined ? d.isActive : true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }));
                assignmentsStore.push(...created);
                return Array.isArray(docs) ? created : created[0];
            }),
            updateMany: vi.fn(async (query, update) => {
                let count = 0;
                assignmentsStore.forEach((a) => {
                    if (query.companyId && a.companyId?.toString() !== query.companyId?.toString()) return;
                    if (query.managerId && a.managerId?.toString() !== query.managerId?.toString()) return;
                    if (query.teamId && a.teamId?.toString() !== query.teamId?.toString()) return;
                    if (query.isActive !== undefined && a.isActive !== query.isActive) return;
                    Object.assign(a, update.$set || update);
                    count++;
                });
                return { modifiedCount: count };
            }),
            findByIdAndUpdate: vi.fn(async (id, update) => {
                const a = assignmentsStore.find((item) => item._id?.toString() === id?.toString());
                if (a) Object.assign(a, update.$set || update);
                return a;
            }),
        },
    };
});

vi.mock('../src/modules/manager/models/manager-permission.model', () => {
    return {
        ManagerPermission: {
            findOne: vi.fn((query) => {
                const item = permissionsStore.find((p) => {
                    if (query.companyId && p.companyId?.toString() !== query.companyId?.toString()) return false;
                    if (query.managerId && p.managerId?.toString() !== query.managerId?.toString()) return false;
                    return true;
                });
                if (!item) {
                    return {
                        populate: vi.fn().mockReturnThis(),
                        select: vi.fn().mockReturnThis(),
                        lean: vi.fn().mockResolvedValue(null),
                        then: (resolve: any) => Promise.resolve(null).then(resolve),
                    };
                }
                const doc = {
                    ...item,
                    save: vi.fn(async () => {
                        Object.assign(item, doc);
                        return doc;
                    }),
                };
                return {
                    populate: vi.fn().mockReturnThis(),
                    select: vi.fn().mockReturnThis(),
                    lean: vi.fn().mockResolvedValue(item),
                    then: (resolve: any) => Promise.resolve(doc).then(resolve),
                };
            }),
            create: vi.fn(async (doc) => {
                const created = {
                    ...doc,
                    _id: new Types.ObjectId(),
                    isSuspended: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                permissionsStore.push(created);
                return created;
            }),
            findOneAndUpdate: vi.fn(async (query, update, options) => {
                let p = permissionsStore.find(
                    (item) =>
                        item.companyId?.toString() === query.companyId?.toString() &&
                        item.managerId?.toString() === query.managerId?.toString()
                );
                if (!p && options?.upsert) {
                    p = {
                        companyId: query.companyId,
                        managerId: query.managerId,
                        permissions: [],
                        isSuspended: false,
                        _id: new Types.ObjectId(),
                    };
                    permissionsStore.push(p);
                }
                if (p) {
                    if (update.$set) Object.assign(p, update.$set);
                    else Object.assign(p, update);
                }
                return p;
            }),
            updateOne: vi.fn(async (query, update) => {
                const p = permissionsStore.find((item) => {
                    if (query.companyId && item.companyId?.toString() !== query.companyId?.toString()) return false;
                    if (query.managerId && item.managerId?.toString() !== query.managerId?.toString()) return false;
                    return true;
                });
                if (p) {
                    if (update.$set) Object.assign(p, update.$set);
                    else Object.assign(p, update);
                }
                return { modifiedCount: p ? 1 : 0 };
            }),
        },
    };
});

vi.mock('../src/modules/manager/models/manager-audit.model', () => {
    return {
        ManagerAssignmentAudit: {
            create: vi.fn(async (doc) => {
                const created = { ...doc, _id: new Types.ObjectId(), createdAt: new Date() };
                auditStore.push(created);
                return created;
            }),
            find: vi.fn((query) => ({
                populate: vi.fn().mockReturnThis(),
                sort: vi.fn().mockReturnThis(),
                skip: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                lean: vi.fn().mockImplementation(async () => {
                    return auditStore.filter((a) => a.companyId?.toString() === query.companyId?.toString());
                }),
            })),
            countDocuments: vi.fn().mockImplementation(async () => auditStore.length),
        },
    };
});

vi.mock('../src/modules/teams/team.model', () => {
    return {
        Team: {
            find: vi.fn((query) => ({
                select: vi.fn().mockReturnThis(),
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockImplementation(async () => {
                    return teamsStore.filter((t) => {
                        if (query.companyId && t.companyId?.toString() !== query.companyId?.toString()) return false;
                        if (query.$or) {
                            const orMatched = query.$or.some((clause: any) => {
                                if (clause.leadId && t.leadId?.toString() === clause.leadId?.toString()) return true;
                                if (clause.managerIds && Array.isArray(t.managerIds)) {
                                    return t.managerIds.some((m: any) => m?.toString() === clause.managerIds?.toString());
                                }
                                return false;
                            });
                            if (!orMatched) return false;
                        }
                        if (query.leadId && t.leadId?.toString() !== query.leadId?.toString()) return false;
                        if (query._id?.$in) {
                            const ids = query._id.$in.map((id: any) => id?.toString());
                            if (!ids.includes(t._id?.toString())) return false;
                        }
                        if (query.isActive !== undefined && t.isActive !== query.isActive) return false;
                        if (query.isArchived !== undefined && t.isArchived !== query.isArchived) return false;
                        return true;
                    });
                }),
            })),
            findById: vi.fn((id) => ({
                lean: vi.fn().mockImplementation(async () => {
                    return teamsStore.find((t) => t._id?.toString() === id?.toString());
                }),
            })),
        },
    };
});

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: {
        find: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([]),
        })),
        findById: vi.fn(() => ({
            lean: vi.fn().mockResolvedValue(null),
        })),
    },
    ProjectInCharge: {
        find: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([]),
        })),
    },
    ProjectTeamMember: {
        find: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([]),
        })),
    },
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        findOne: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue(null),
        })),
        find: vi.fn(() => ({
            lean: vi.fn().mockResolvedValue([]),
        })),
    },
}));

vi.mock('../src/modules/companyadmin/invitations/company-member.model', () => ({
    CompanyMember: {
        findOne: vi.fn((query) => {
            const m = membersStore.find((item) => {
                if (query.companyId && item.companyId?.toString() !== query.companyId?.toString()) return false;
                if (query.userId && item.userId?.toString() !== query.userId?.toString()) return false;
                if (query._id && item._id?.toString() !== query._id?.toString()) return false;
                return true;
            });
            if (!m) {
                return {
                    populate: vi.fn().mockReturnThis(),
                    select: vi.fn().mockReturnThis(),
                    lean: vi.fn().mockResolvedValue(null),
                    then: (resolve: any) => Promise.resolve(null).then(resolve),
                };
            }
            const doc = {
                ...m,
                save: vi.fn(async () => {
                    Object.assign(m, doc);
                    return doc;
                }),
            };
            return {
                populate: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue(m),
                then: (resolve: any) => Promise.resolve(doc).then(resolve),
            };
        }),
        findById: vi.fn((id) => ({
            lean: vi.fn().mockImplementation(async () => {
                return membersStore.find((m) => m._id?.toString() === id?.toString());
            }),
            populate: vi.fn().mockReturnThis(),
        })),
        updateOne: vi.fn(async (query, update) => {
            const m = membersStore.find(
                (item) =>
                    (query._id && item._id?.toString() === query._id?.toString()) ||
                    (query.userId && item.userId?.toString() === query.userId?.toString())
            );
            if (m) Object.assign(m, update.$set || update);
            return { modifiedCount: m ? 1 : 0 };
        }),
        countDocuments: vi.fn().mockImplementation(async () => membersStore.length),
    },
}));

vi.mock('../src/modules/companyadmin/members/company-member.model', () => ({
    CompanyMember: {
        findOne: vi.fn((query) => {
            const m = membersStore.find((item) => {
                if (query.companyId && item.companyId?.toString() !== query.companyId?.toString()) return false;
                if (query.userId && item.userId?.toString() !== query.userId?.toString()) return false;
                if (query._id && item._id?.toString() !== query._id?.toString()) return false;
                return true;
            });
            if (!m) {
                return {
                    populate: vi.fn().mockReturnThis(),
                    select: vi.fn().mockReturnThis(),
                    lean: vi.fn().mockResolvedValue(null),
                    then: (resolve: any) => Promise.resolve(null).then(resolve),
                };
            }
            const doc = {
                ...m,
                save: vi.fn(async () => {
                    Object.assign(m, doc);
                    return doc;
                }),
            };
            return {
                populate: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue(m),
                then: (resolve: any) => Promise.resolve(doc).then(resolve),
            };
        }),
        findById: vi.fn((id) => ({
            lean: vi.fn().mockImplementation(async () => {
                return membersStore.find((m) => m._id?.toString() === id?.toString());
            }),
            populate: vi.fn().mockReturnThis(),
        })),
        updateOne: vi.fn(async (query, update) => {
            const m = membersStore.find(
                (item) =>
                    (query._id && item._id?.toString() === query._id?.toString()) ||
                    (query.userId && item.userId?.toString() === query.userId?.toString())
            );
            if (m) Object.assign(m, update.$set || update);
            return { modifiedCount: m ? 1 : 0 };
        }),
        countDocuments: vi.fn().mockImplementation(async () => membersStore.length),
    },
}));

vi.mock('../src/modules/users/user.model', () => {
    return {
        User: {
            findById: vi.fn((id) => ({
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockImplementation(async () => ({
                    _id: new Types.ObjectId(id),
                    email: 'test@company.com',
                    fullName: 'Test User',
                    role: { name: 'User' },
                    status: 'ACTIVE',
                })),
            })),
        },
    };
});

describe('Manager Workspace & Team Access Control Engine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        TeamAccessService.clearAllMemoryCache();
        assignmentsStore = [];
        permissionsStore = [];
        auditStore = [];
        teamsStore = [];
        membersStore = [];

        // Set up teams
        teamsStore = [
            {
                _id: new Types.ObjectId(TEAM_ALPHA),
                companyId: new Types.ObjectId(COMPANY_ID),
                name: 'Team Alpha',
                leadId: new Types.ObjectId(MANAGER_ID),
                memberIds: [new Types.ObjectId(EMPLOYEE_1)],
                projectIds: [new Types.ObjectId(PROJECT_1)],
                isActive: true,
                isArchived: false,
            },
            {
                _id: new Types.ObjectId(TEAM_BETA),
                companyId: new Types.ObjectId(COMPANY_ID),
                name: 'Team Beta',
                leadId: new Types.ObjectId(),
                memberIds: [new Types.ObjectId(EMPLOYEE_2)],
                projectIds: [new Types.ObjectId(PROJECT_2)],
                isActive: true,
                isArchived: false,
            },
            {
                _id: new Types.ObjectId(TEAM_GAMMA_OUTSIDE),
                companyId: new Types.ObjectId(COMPANY_ID),
                name: 'Team Gamma (Outside)',
                leadId: new Types.ObjectId(),
                memberIds: [new Types.ObjectId(EMPLOYEE_OUTSIDE)],
                projectIds: [new Types.ObjectId(PROJECT_OUTSIDE)],
                isActive: true,
                isArchived: false,
            },
        ];

        // Set up company members
        membersStore = [
            {
                _id: new Types.ObjectId(MANAGER_ID),
                userId: new Types.ObjectId(MANAGER_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                memberType: 'MANAGER',
                isActive: true,
                user: { fullName: 'Alice Manager', email: 'alice@company.com' },
            },
            {
                _id: new Types.ObjectId(EMPLOYEE_1),
                userId: new Types.ObjectId(EMPLOYEE_1),
                companyId: new Types.ObjectId(COMPANY_ID),
                memberType: 'EMPLOYEE',
                isActive: true,
                user: { fullName: 'Bob Alpha', email: 'bob@company.com' },
            },
            {
                _id: new Types.ObjectId(EMPLOYEE_2),
                userId: new Types.ObjectId(EMPLOYEE_2),
                companyId: new Types.ObjectId(COMPANY_ID),
                memberType: 'EMPLOYEE',
                isActive: true,
                user: { fullName: 'Charlie Beta', email: 'charlie@company.com' },
            },
        ];

        // Default manager permissions
        permissionsStore = [
            {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(COMPANY_ID),
                managerId: new Types.ObjectId(MANAGER_ID),
                permissions: Object.values(MANAGER_PERMISSIONS),
                isSuspended: false,
            },
        ];
    });

    describe('Scenario A: Normal Manager (Primary Team Assignment)', () => {
        beforeEach(() => {
            assignmentsStore.push({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(COMPANY_ID),
                managerId: new Types.ObjectId(MANAGER_ID),
                assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
                teamId: new Types.ObjectId(TEAM_ALPHA),
                isActive: true,
            });
        });

        it('should resolve access scope to only Team Alpha and its resources', async () => {
            const scope = await TeamAccessService.resolveScope(COMPANY_ID, MANAGER_ID);
            const teamIds = scope.allTeamIds.map(String);
            const empIds = scope.allAccessibleEmployeeIds.map(String);
            const projIds = scope.allAccessibleProjectIds.map(String);

            expect(teamIds).toContain(TEAM_ALPHA);
            expect(teamIds).not.toContain(TEAM_BETA);
            expect(teamIds).not.toContain(TEAM_GAMMA_OUTSIDE);

            expect(empIds).toContain(EMPLOYEE_1);
            expect(empIds).not.toContain(EMPLOYEE_2);
            expect(empIds).not.toContain(EMPLOYEE_OUTSIDE);

            expect(projIds).toContain(PROJECT_1);
            expect(projIds).not.toContain(PROJECT_2);
        });

        it('should grant access to Team Alpha and deny access to Team Beta / Gamma', async () => {
            const canAlpha = await TeamAccessService.canAccessTeam(COMPANY_ID, MANAGER_ID, TEAM_ALPHA);
            const canBeta = await TeamAccessService.canAccessTeam(COMPANY_ID, MANAGER_ID, TEAM_BETA);
            const canGamma = await TeamAccessService.canAccessTeam(COMPANY_ID, MANAGER_ID, TEAM_GAMMA_OUTSIDE);

            expect(canAlpha).toBe(true);
            expect(canBeta).toBe(false);
            expect(canGamma).toBe(false);
        });

        it('should grant access to employee 1 and deny access to employee 2', async () => {
            const canEmp1 = await TeamAccessService.canAccessEmployee(COMPANY_ID, MANAGER_ID, EMPLOYEE_1);
            const canEmp2 = await TeamAccessService.canAccessEmployee(COMPANY_ID, MANAGER_ID, EMPLOYEE_2);

            expect(canEmp1).toBe(true);
            expect(canEmp2).toBe(false);
        });
    });

    describe('Scenario B: Additional Team Access', () => {
        beforeEach(() => {
            // Manager assigned primary Team Alpha + additional Team Beta
            assignmentsStore.push(
                {
                    _id: new Types.ObjectId(),
                    companyId: new Types.ObjectId(COMPANY_ID),
                    managerId: new Types.ObjectId(MANAGER_ID),
                    assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
                    teamId: new Types.ObjectId(TEAM_ALPHA),
                    isActive: true,
                },
                {
                    _id: new Types.ObjectId(),
                    companyId: new Types.ObjectId(COMPANY_ID),
                    managerId: new Types.ObjectId(MANAGER_ID),
                    assignmentType: ManagerAssignmentType.ADDITIONAL_TEAM,
                    teamId: new Types.ObjectId(TEAM_BETA),
                    isActive: true,
                }
            );
        });

        it('should grant access to both Team Alpha and Team Beta, but not Team Gamma', async () => {
            const canAlpha = await TeamAccessService.canAccessTeam(COMPANY_ID, MANAGER_ID, TEAM_ALPHA);
            const canBeta = await TeamAccessService.canAccessTeam(COMPANY_ID, MANAGER_ID, TEAM_BETA);
            const canGamma = await TeamAccessService.canAccessTeam(COMPANY_ID, MANAGER_ID, TEAM_GAMMA_OUTSIDE);

            expect(canAlpha).toBe(true);
            expect(canBeta).toBe(true);
            expect(canGamma).toBe(false);

            const scope = await TeamAccessService.resolveScope(COMPANY_ID, MANAGER_ID);
            const empIds = scope.allAccessibleEmployeeIds.map(String);
            expect(empIds).toContain(EMPLOYEE_1);
            expect(empIds).toContain(EMPLOYEE_2);
            expect(empIds).not.toContain(EMPLOYEE_OUTSIDE);
        });
    });

    describe('Scenario C: Individual Employee Access Without Entire Team Access', () => {
        beforeEach(() => {
            // Manager assigned primary Team Alpha + specifically authorized employee 2 from Team Beta
            assignmentsStore.push(
                {
                    _id: new Types.ObjectId(),
                    companyId: new Types.ObjectId(COMPANY_ID),
                    managerId: new Types.ObjectId(MANAGER_ID),
                    assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
                    teamId: new Types.ObjectId(TEAM_ALPHA),
                    isActive: true,
                },
                {
                    _id: new Types.ObjectId(),
                    companyId: new Types.ObjectId(COMPANY_ID),
                    managerId: new Types.ObjectId(MANAGER_ID),
                    assignmentType: ManagerAssignmentType.INDIVIDUAL_EMPLOYEE,
                    employeeId: new Types.ObjectId(EMPLOYEE_2),
                    isActive: true,
                }
            );
        });

        it('should grant access to Employee 2, but NOT grant access to Team Beta', async () => {
            const canEmp2 = await TeamAccessService.canAccessEmployee(COMPANY_ID, MANAGER_ID, EMPLOYEE_2);
            const canTeamBeta = await TeamAccessService.canAccessTeam(COMPANY_ID, MANAGER_ID, TEAM_BETA);

            expect(canEmp2).toBe(true);
            expect(canTeamBeta).toBe(false);
        });
    });

    describe('Scenario D: Project-Specific Access', () => {
        beforeEach(() => {
            teamsStore.forEach((t) => (t.leadId = new Types.ObjectId()));
            // Manager only granted access to Project 2 (which belongs to Team Beta)
            assignmentsStore.push({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(COMPANY_ID),
                managerId: new Types.ObjectId(MANAGER_ID),
                assignmentType: ManagerAssignmentType.PROJECT_SPECIFIC,
                projectId: new Types.ObjectId(PROJECT_2),
                isActive: true,
            });
        });

        it('should grant access to Project 2 and reject Project 1 and Project Outside', async () => {
            const canProj2 = await TeamAccessService.canAccessProject(COMPANY_ID, MANAGER_ID, PROJECT_2);
            const canProj1 = await TeamAccessService.canAccessProject(COMPANY_ID, MANAGER_ID, PROJECT_1);
            const canProjOut = await TeamAccessService.canAccessProject(COMPANY_ID, MANAGER_ID, PROJECT_OUTSIDE);

            expect(canProj2).toBe(true);
            expect(canProj1).toBe(false);
            expect(canProjOut).toBe(false);
        });
    });

    describe('Scenario E: Access Revocation and Real-Time Invalidation', () => {
        let betaAssignmentId: string;

        beforeEach(() => {
            betaAssignmentId = new Types.ObjectId().toString();
            assignmentsStore.push(
                {
                    _id: new Types.ObjectId(),
                    companyId: new Types.ObjectId(COMPANY_ID),
                    managerId: new Types.ObjectId(MANAGER_ID),
                    assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
                    teamId: new Types.ObjectId(TEAM_ALPHA),
                    isActive: true,
                },
                {
                    _id: new Types.ObjectId(betaAssignmentId),
                    companyId: new Types.ObjectId(COMPANY_ID),
                    managerId: new Types.ObjectId(MANAGER_ID),
                    assignmentType: ManagerAssignmentType.ADDITIONAL_TEAM,
                    teamId: new Types.ObjectId(TEAM_BETA),
                    isActive: true,
                }
            );
        });

        it('should immediately revoke Team Beta access and invalidate scope', async () => {
            // Verify initial access
            expect(await TeamAccessService.canAccessTeam(COMPANY_ID, MANAGER_ID, TEAM_BETA)).toBe(true);

            // Admin revokes assignment
            const revokeRes = await ManagerAssignmentService.revokeAssignment(
                COMPANY_ID,
                MANAGER_ID,
                betaAssignmentId,
                new Types.ObjectId().toString(),
                'Project completed'
            );

            expect(revokeRes.success).toBe(true);

            // Re-check access - Team Beta must be forbidden immediately
            const canBetaAfterRevoke = await TeamAccessService.canAccessTeam(COMPANY_ID, MANAGER_ID, TEAM_BETA);
            const canAlphaAfterRevoke = await TeamAccessService.canAccessTeam(COMPANY_ID, MANAGER_ID, TEAM_ALPHA);

            expect(canBetaAfterRevoke).toBe(false);
            expect(canAlphaAfterRevoke).toBe(true);

            // Audit record should be written
            const audits = await ManagerAssignmentService.getAuditHistory(COMPANY_ID, MANAGER_ID, {});
            expect(audits.records.some((a: any) => a.action === ManagerAuditAction.ASSIGNMENT_REVOKED)).toBe(true);
        });

        it('should broadcast MANAGER_ACCESS revocation to Socket.IO and evict sockets', async () => {
            const socketLeave = vi.fn();
            const socketEmit = vi.fn();
            const mockSocket = {
                id: 'socket-manager-1',
                data: { user: { companyId: COMPANY_ID, userId: MANAGER_ID } },
                leave: socketLeave,
                emit: socketEmit,
            };
            mockSockets.set('socket-manager-1', mockSocket);

            await FeatureRevocationService.revokeManagerAccess(
                COMPANY_ID,
                MANAGER_ID,
                'REVOKE_TEAM',
                TEAM_BETA,
                undefined,
                'Team reassigned'
            );

            expect(socketLeave).toHaveBeenCalledWith(`manager:team:${TEAM_BETA}`);
            expect(socketEmit).toHaveBeenCalledWith('manager:access_revoked', expect.objectContaining({
                action: 'REVOKE_TEAM',
                targetId: TEAM_BETA,
            }));
        });
    });

    describe('Scenario F: Manager Demotion and Suspension', () => {
        beforeEach(() => {
            assignmentsStore.push({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(COMPANY_ID),
                managerId: new Types.ObjectId(MANAGER_ID),
                assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
                teamId: new Types.ObjectId(TEAM_ALPHA),
                isActive: true,
            });
        });

        it('should suspend manager and block all manager dashboard access', async () => {
            const adminId = new Types.ObjectId().toString();
            await ManagerAssignmentService.suspendManager(
                COMPANY_ID,
                MANAGER_ID,
                adminId,
                'Performance inquiry'
            );

            const hasAccess = await TeamAccessService.hasManagerAccess(COMPANY_ID, MANAGER_ID);
            expect(hasAccess).toBe(false);

            // Reinstating should restore access
            await ManagerAssignmentService.reinstateManager(COMPANY_ID, MANAGER_ID, adminId);
            const hasAccessAfter = await TeamAccessService.hasManagerAccess(COMPANY_ID, MANAGER_ID);
            expect(hasAccessAfter).toBe(true);
        });

        it('should demote manager to regular EMPLOYEE and revoke all assignments cleanly', async () => {
            const adminId = new Types.ObjectId().toString();
            const demoteRes = await ManagerAssignmentService.demoteManager(
                COMPANY_ID,
                MANAGER_ID,
                adminId,
                'Organizational restructuring'
            );

            expect(demoteRes.success).toBe(true);

            // Member type must be updated to EMPLOYEE
            const member = membersStore.find((m) => m._id?.toString() === MANAGER_ID);
            expect(member.memberType).toBe('EMPLOYEE');

            // All assignments must be deactivated
            expect(assignmentsStore.every((a) => a.isActive === false)).toBe(true);

            // Manager access must be false
            const hasAccess = await TeamAccessService.hasManagerAccess(COMPANY_ID, MANAGER_ID);
            expect(hasAccess).toBe(false);
        });
    });

    describe('Multi-Tenant Data Isolation', () => {
        beforeEach(() => {
            assignmentsStore.push({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(COMPANY_ID),
                managerId: new Types.ObjectId(MANAGER_ID),
                assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
                teamId: new Types.ObjectId(TEAM_ALPHA),
                isActive: true,
            });
        });

        it('should never grant access to resources under a different company ID', async () => {
            const canOtherCompanyTeam = await TeamAccessService.canAccessTeam(
                OTHER_COMPANY_ID,
                MANAGER_ID,
                TEAM_ALPHA
            );
            expect(canOtherCompanyTeam).toBe(false);

            const scopeOther = await TeamAccessService.resolveScope(OTHER_COMPANY_ID, MANAGER_ID);
            expect(scopeOther.allTeamIds.length).toBe(0);
            expect(scopeOther.allAccessibleEmployeeIds.length).toBe(0);
            expect(scopeOther.allAccessibleProjectIds.length).toBe(0);
        });
    });
});
