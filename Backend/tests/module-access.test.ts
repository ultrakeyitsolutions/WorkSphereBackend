import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Types } from 'mongoose';
import { ModuleAccessService } from '../src/modules/companyadmin/module-access/module-access.service';
import { CompanyModuleAccess } from '../src/modules/companyadmin/module-access/module-access.model';
import { CompanyMember } from '../src/modules/companyadmin/invitations/company-member.model';
import { FeatureAccessService } from '../src/modules/companyadmin/settings/feature-access.service';
import { EntitlementService } from '../src/services/entitlement.service';
import { SUPPORTED_MODULES } from '../src/modules/companyadmin/module-access/module-access.constants';
import { requireModuleAccess } from '../src/middleware/module-access.middleware';
import { MemberService } from '../src/modules/companyadmin/members/member.service';
import { User } from '../src/modules/users/user.model';

// Mock dependencies
vi.mock('../src/modules/companyadmin/settings/feature-access.service');
vi.mock('../src/services/entitlement.service');
vi.mock('../src/modules/companyadmin/settings/feature-revocation.service', () => ({
    FeatureRevocationService: {
        revokeCompanyFeature: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../src/config/redis', () => ({
    getRedisClient: vi.fn().mockReturnValue(null),
    redisGet: vi.fn().mockResolvedValue(null),
    redisSet: vi.fn().mockResolvedValue(undefined),
}));

describe('WorkSphere Dynamic Sidebar & Module Access Engine', () => {
    const mockCompanyId = new Types.ObjectId().toString();
    const mockAdminId = new Types.ObjectId().toString();
    const mockEmployee1Id = new Types.ObjectId().toString();
    const mockEmployee2Id = new Types.ObjectId().toString();

    let inMemoryDocs: any[] = [];
    let inMemoryMembers: any[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        inMemoryDocs = [];
        inMemoryMembers = [
            {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(mockCompanyId),
                userId: new Types.ObjectId(mockEmployee1Id),
                memberType: 'EMPLOYEE',
                status: 'ACTIVE',
                save: vi.fn().mockImplementation(async function (this: any) { return this; }),
            },
            {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(mockCompanyId),
                userId: new Types.ObjectId(mockEmployee2Id),
                memberType: 'EMPLOYEE',
                status: 'ACTIVE',
                save: vi.fn().mockImplementation(async function (this: any) { return this; }),
            },
        ];

        // Mock CompanyModuleAccess Mongoose methods
        vi.spyOn(CompanyModuleAccess, 'findOne').mockImplementation((query: any) => {
            const found = inMemoryDocs.find(
                (d) => String(d.companyId) === String(query.companyId)
            );
            if (!found) return Promise.resolve(null) as any;
            return Promise.resolve(found) as any;
        });

        vi.spyOn(CompanyModuleAccess, 'create').mockImplementation((data: any) => {
            const doc = {
                ...data,
                _id: new Types.ObjectId(),
                employeeOverrides: data.employeeOverrides || [],
                auditHistory: data.auditHistory || [],
                save: vi.fn().mockImplementation(async function (this: any) {
                    return this;
                }),
                markModified: vi.fn(),
            };
            inMemoryDocs.push(doc);
            return Promise.resolve(doc) as any;
        });

        vi.spyOn(CompanyMember, 'countDocuments').mockImplementation(async () => {
            return inMemoryMembers.length;
        });

        vi.spyOn(CompanyMember, 'find').mockImplementation((query: any) => {
            const userIds = query?.userId?.$in || query?._id?.$in || [];
            const filtered = inMemoryMembers.filter(
                (m) =>
                    String(m.companyId) === String(query.companyId) &&
                    (userIds.length === 0 || userIds.some((id: any) => String(id) === String(m.userId) || String(id) === String(m._id)))
            );
            const populatedList = filtered.map((f, idx) => ({
                ...f,
                userId: { _id: f.userId, name: `Employee ${idx + 1}`, email: `emp${idx + 1}@example.com` },
                roleId: { name: 'Member' },
                designationId: { name: 'Software Engineer' },
            }));
            const queryObj: any = {
                select: vi.fn().mockResolvedValue(filtered),
                populate: vi.fn().mockResolvedValue(populatedList),
                then: (resolve: any) => resolve(filtered),
            };
            return queryObj as any;
        });

        vi.spyOn(CompanyMember, 'findOne').mockImplementation((query: any) => {
            const targetId = query.userId || query._id;
            const found = inMemoryMembers.find(
                (m) =>
                    String(m.companyId) === String(query.companyId) &&
                    (targetId ? String(m.userId) === String(targetId) || String(m._id) === String(targetId) : true)
            );
            if (!found) return Promise.resolve(null) as any;
            const populated = {
                ...found,
                userId: { _id: found.userId, name: 'John Doe', email: 'john@example.com' },
                roleId: { name: 'Member' },
                designationId: { name: 'Software Engineer' },
                save: vi.fn().mockImplementation(async function (this: any) {
                    found.status = this.status;
                    return this;
                }),
            };
            return {
                ...populated,
                populate: vi.fn().mockResolvedValue(populated),
                then: (resolve: any) => resolve(populated),
            } as any;
        });

        vi.spyOn(CompanyMember, 'aggregate').mockImplementation((pipeline: any[]) => {
            const isCount = pipeline.some((stage) => stage.$count);
            if (isCount) {
                return Promise.resolve([{ total: inMemoryMembers.length }]) as any;
            }
            const sampleRecords = inMemoryMembers.map((m, idx) => ({
                ...m,
                user: {
                    _id: m.userId,
                    name: `Employee ${idx + 1}`,
                    email: `emp${idx + 1}@example.com`,
                },
                role: { name: 'Member' },
                designation: { name: 'Engineer' },
            }));
            return Promise.resolve(sampleRecords) as any;
        });

        // Default: company features all enabled
        vi.mocked(FeatureAccessService.getCompanyFeatureFlags).mockResolvedValue({
            enableLiveMonitoring: true,
            enableDetailedMonitoring: true,
            enableQuickMeetings: true,
            enableChat: true,
            enableAttendanceAdjustments: true,
            enableTimesheets: true,
            enableTaskAttachments: true,
        });

        // Default: plan entitlements all enabled
        vi.mocked(EntitlementService.getEntitlementDetails).mockResolvedValue({
            enabled: true,
            limit: null,
            used: 0,
        } as any);
    });

    describe('1. Global Settings & Metadata', () => {
        it('should initialize and return all 10 supported modules enabled by default', async () => {
            const result = await ModuleAccessService.getGlobalModuleAccess(mockCompanyId);

            expect(result.companyId).toBe(mockCompanyId);
            expect(result.globalSettings.dashboard).toBe(true);
            expect(result.globalSettings.chat).toBe(true);
            expect(result.globalSettings.projects).toBe(true);
            expect(result.globalSettings.tasks).toBe(true);
            expect(result.globalSettings.dropbox).toBe(true);
            expect(result.globalSettings.attendance).toBe(true);
            expect(result.globalSettings.meetings).toBe(true);
            expect(result.globalSettings.timesheet).toBe(true);
            expect(result.globalSettings.calendar).toBe(true);
            expect(result.globalSettings.shifts).toBe(true);
            expect(result.modules.length).toBe(SUPPORTED_MODULES.length);
            expect(result.summary.totalEmployees).toBe(2);
        });

        it('should update global visibility and record audit log', async () => {
            const updated = await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { chat: false, projects: false } },
                mockAdminId
            );

            expect(updated.globalSettings.chat).toBe(false);
            expect(updated.globalSettings.projects).toBe(false);
            expect(updated.globalSettings.tasks).toBe(true);
        });
    });

    describe('2. Individual Employee Overrides & 3-State Model', () => {
        it('should set an individual override to DISABLED for employee 1 while others inherit global', async () => {
            // Global projects is enabled
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { projects: true } },
                mockAdminId
            );

            // Disable projects only for Employee 1
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { projects: 'DISABLED' } },
                mockAdminId
            );

            const emp1Access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            const emp2Access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee2Id
            );

            expect(emp1Access.effectiveModules.projects).toBe(false);
            expect(emp2Access.effectiveModules.projects).toBe(true);
        });

        it('should allow employee ENABLED override when globally disabled (if permitted by company/plan)', async () => {
            // Global tasks is disabled
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { tasks: false } },
                mockAdminId
            );

            // Enable tasks specifically for Employee 1
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { tasks: 'ENABLED' } },
                mockAdminId
            );

            const emp1Access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            const emp2Access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee2Id
            );

            expect(emp1Access.effectiveModules.tasks).toBe(true);
            expect(emp2Access.effectiveModules.tasks).toBe(false);
        });

        it('should retrieve single employee module access details with override breakdown', async () => {
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { dropbox: 'DISABLED' } },
                mockAdminId
            );

            const details = await ModuleAccessService.getSingleEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );

            expect(details.employeeId).toBe(mockEmployee1Id);
            expect(details.overrides.dropbox).toBe('DISABLED');
            expect(details.effectiveAccess.dropbox).toBe(false);
            expect(details.effectiveAccess.dashboard).toBe(true);
            expect(details.overrideCount).toBe(1);
        });

        it('should reset employee override back to INHERIT', async () => {
            // Set override
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { chat: 'DISABLED' } },
                mockAdminId
            );

            // Reset override
            await ModuleAccessService.resetEmployeeOverride(
                mockCompanyId,
                mockEmployee1Id,
                'chat',
                mockAdminId
            );

            const emp1Access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );

            // Global chat is true, so inherited is true
            expect(emp1Access.effectiveModules.chat).toBe(true);
        });
    });

    describe('3. Access Precedence Rules', () => {
        it('should NOT allow employee ENABLED override if Company Feature Flag is disabled', async () => {
            // Company feature flag enableChat is false
            vi.mocked(FeatureAccessService.getCompanyFeatureFlags).mockResolvedValue({
                enableLiveMonitoring: true,
                enableDetailedMonitoring: true,
                enableQuickMeetings: true,
                enableChat: false, // Disabled at company level
                enableAttendanceAdjustments: true,
                enableTimesheets: true,
                enableTaskAttachments: true,
            });

            // Admin tries to enable chat for Employee 1
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { chat: 'ENABLED' } },
                mockAdminId
            );

            const emp1Access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );

            // Precedence rule: company feature flag false overrides employee setting
            expect(emp1Access.effectiveModules.chat).toBe(false);
        });

        it('should NOT allow employee ENABLED override if Subscription Plan Entitlement is disabled', async () => {
            // Plan entitlement for QUICK_MEETINGS is disabled
            vi.mocked(EntitlementService.getEntitlementDetails).mockImplementation(
                async (_cId, entitlement) => {
                    if (entitlement === 'QUICK_MEETINGS') {
                        return { enabled: false, limit: 0, used: 0 } as any;
                    }
                    return { enabled: true, limit: null, used: 0 } as any;
                }
            );

            // Admin enables meetings for Employee 1
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { meetings: 'ENABLED' } },
                mockAdminId
            );

            const emp1Access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );

            // Precedence rule: plan entitlement false overrides employee setting
            expect(emp1Access.effectiveModules.meetings).toBe(false);
        });
    });

    describe('4. Bulk Employee Updates & Tenant Isolation', () => {
        it('should apply bulk override update to selected employees only', async () => {
            const bulkResult = await ModuleAccessService.bulkUpdateEmployeeModuleAccess(
                mockCompanyId,
                {
                    employeeIds: [mockEmployee1Id, mockEmployee2Id],
                    action: 'DISABLE',
                    moduleKey: 'timesheet',
                },
                mockAdminId
            );

            expect(bulkResult.success).toBe(true);
            expect(bulkResult.affectedEmployeesCount).toBe(2);

            const emp1 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            const emp2 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee2Id
            );

            expect(emp1.effectiveModules.timesheet).toBe(false);
            expect(emp2.effectiveModules.timesheet).toBe(false);
        });

        it('should reject bulk update if any employee belongs to another company (tenant isolation)', async () => {
            const alienEmployeeId = new Types.ObjectId().toString();

            await expect(
                ModuleAccessService.bulkUpdateEmployeeModuleAccess(
                    mockCompanyId,
                    {
                        employeeIds: [mockEmployee1Id, alienEmployeeId],
                        action: 'DISABLE',
                        moduleKey: 'chat',
                    },
                    mockAdminId
                )
            ).rejects.toThrow(/do not belong to your company/);
        });
    });

    describe('5. Paginated Employee Listing', () => {
        it('should return paginated list of employees with computed effective access and overrides', async () => {
            const listResult = await ModuleAccessService.getEmployeesModuleAccess({
                companyId: mockCompanyId,
                page: 1,
                limit: 10,
            });

            expect(listResult.employees.length).toBe(2);
            expect(listResult.total).toBe(2);
            expect(listResult.employees[0].effectiveAccess.dashboard).toBe(true);
        });
    });

    describe('6. Module Catalog API', () => {
        it('should return all 16 supported modules with complete display metadata and categories', () => {
            const catalog = ModuleAccessService.getModuleCatalog();

            expect(catalog.totalModules).toBe(16);
            expect(catalog.modules.length).toBe(16);
            expect(catalog.categories).toContain('Core');
            expect(catalog.categories).toContain('Collaboration');
            expect(catalog.categories).toContain('Management');
            expect(catalog.categories).toContain('Productivity');

            const keys = catalog.modules.map((m) => m.key);
            expect(keys).toContain('dashboard');
            expect(keys).toContain('live-monitoring');
            expect(keys).toContain('detailed-monitoring');
            expect(keys).toContain('leave');
            expect(keys).toContain('reports');
            expect(keys).toContain('user-reviews');
            expect(keys).toContain('status-updates');
        });
    });

    describe('7. Selected Members Access & Mixed-State Analysis', () => {
        it('should accurately compute ALL_ENABLED, ALL_DISABLED, and MIXED aggregate states', async () => {
            // Member 1: enable chat, disable leave
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { chat: 'ENABLED', leave: 'DISABLED' } },
                mockAdminId
            );

            // Member 2: disable chat, disable leave
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee2Id,
                { overrides: { chat: 'DISABLED', leave: 'DISABLED' } },
                mockAdminId
            );

            const result = await ModuleAccessService.getSelectedMembersModuleAccess(
                mockCompanyId,
                [mockEmployee1Id, mockEmployee2Id]
            );

            expect(result.members.length).toBe(2);
            expect(result.summary.totalSelected).toBe(2);

            // Chat: Member 1 is ENABLED, Member 2 is DISABLED -> MIXED
            expect(result.aggregate.chat.state).toBe('MIXED');
            expect(result.aggregate.chat.enabledCount).toBe(1);
            expect(result.aggregate.chat.disabledCount).toBe(1);

            // Leave: Both are DISABLED -> ALL_DISABLED
            expect(result.aggregate.leave.state).toBe('ALL_DISABLED');
            expect(result.aggregate.leave.enabledCount).toBe(0);
            expect(result.aggregate.leave.disabledCount).toBe(2);

            // Dashboard: Both inherit enabled -> ALL_ENABLED
            expect(result.aggregate.dashboard.state).toBe('ALL_ENABLED');
            expect(result.aggregate.dashboard.enabledCount).toBe(2);
            expect(result.aggregate.dashboard.disabledCount).toBe(0);
        });

        it('should reject selection containing members from another organization', async () => {
            const foreignId = new Types.ObjectId().toString();

            await expect(
                ModuleAccessService.getSelectedMembersModuleAccess(mockCompanyId, [
                    mockEmployee1Id,
                    foreignId,
                ])
            ).rejects.toThrow(/do not belong to your company/);
        });
    });

    describe('8. Server-Side Route Enforcement Middleware', () => {
        it('should bypass module restriction for COMPANY_ADMIN and SUPER_ADMIN', async () => {
            const middleware = requireModuleAccess('live-monitoring');

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            const reqAdmin: any = {
                user: { role: 'COMPANY_ADMIN', companyId: mockCompanyId, userId: mockAdminId },
                currentUser: { role: 'COMPANY_ADMIN', companyId: mockCompanyId, userId: mockAdminId },
            };
            const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };

            await middleware(reqAdmin, res, next);
            expect(nextCalled).toBe(true);
        });

        it('should return 403 Forbidden for regular member if module is disabled', async () => {
            // Disable live-monitoring for employee 1
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { 'live-monitoring': 'DISABLED' } },
                mockAdminId
            );

            const middleware = requireModuleAccess('live-monitoring');

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            let statusCode = 200;
            let responseBody: any = null;
            const res: any = {
                status: (code: number) => {
                    statusCode = code;
                    return {
                        json: (data: any) => {
                            responseBody = data;
                        },
                    };
                },
            };

            const reqEmployee: any = {
                user: { role: 'EMPLOYEE', companyId: mockCompanyId, userId: mockEmployee1Id },
                currentUser: { role: 'EMPLOYEE', companyId: mockCompanyId, userId: mockEmployee1Id },
            };

            await middleware(reqEmployee, res, next);
            expect(nextCalled).toBe(false);
            expect(statusCode).toBe(403);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('restricted');
        });
    });

    describe('9. Status Updates Dual-Write and Persistence Investigation', () => {
        it('should synchronize CompanyMember and User collections on status update', async () => {
            const memberDoc = inMemoryMembers[0];
            const updateOneSpy = vi.spyOn(User, 'updateOne').mockResolvedValue({ acknowledged: true, modifiedCount: 1 } as any);
            vi.spyOn(MemberService, 'getMemberById').mockImplementation(async () => ({
                id: memberDoc._id,
                status: 'INACTIVE',
            }) as any);

            const updated = await MemberService.updateMemberStatus(
                mockCompanyId,
                String(memberDoc._id),
                'INACTIVE'
            );

            expect(memberDoc.status).toBe('INACTIVE');
            expect(updateOneSpy).toHaveBeenCalledWith(
                { _id: memberDoc.userId },
                { $set: { status: 'INACTIVE', isActive: false } }
            );
            expect(updated.status).toBe('INACTIVE');
        });
    });

    describe('10. Core Precedence Rules & Explicit False Preservation', () => {
        it('1. Global enabled with no member override -> Enabled', async () => {
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { attendance: true } },
                mockAdminId
            );

            const access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            expect(access.effectiveModules.attendance).toBe(true);
        });

        it('2. Global disabled with no member override -> Disabled', async () => {
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { attendance: false } },
                mockAdminId
            );

            const access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            expect(access.effectiveModules.attendance).toBe(false);
        });

        it('3. Global enabled with explicit member disable -> Disabled', async () => {
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { projects: true } },
                mockAdminId
            );
            // Explicitly disable for employee 1 using boolean false
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { modules: { projects: false } },
                mockAdminId
            );

            const access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            expect(access.effectiveModules.projects).toBe(false);
        });

        it('4. Global disabled with explicit member enable -> Enabled (when policy permits)', async () => {
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { tasks: false } },
                mockAdminId
            );
            // Explicitly enable for employee 1 using boolean true
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { modules: { tasks: true } },
                mockAdminId
            );

            const access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            expect(access.effectiveModules.tasks).toBe(true);
        });

        it('5. Global disabled with explicit member enable -> Disabled when subscription restricts it', async () => {
            // Subscription entitlement for CHAT disabled
            vi.mocked(EntitlementService.getEntitlementDetails).mockImplementation(async (cId, ent) => {
                if (ent === 'CHAT') return { enabled: false, limit: null, used: 0 } as any;
                return { enabled: true, limit: null, used: 0 } as any;
            });

            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { chat: false } },
                mockAdminId
            );
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { chat: 'ENABLED' } },
                mockAdminId
            );

            const access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            // Mandatory restriction prevents override from granting access
            expect(access.effectiveModules.chat).toBe(false);

            // Restore entitlement mock
            vi.mocked(EntitlementService.getEntitlementDetails).mockResolvedValue({
                enabled: true,
                limit: null,
                used: 0,
            } as any);
        });

        it('6. Multiple members with different overrides resolve independently', async () => {
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { dropbox: true } },
                mockAdminId
            );

            // Employee 1: disabled
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { dropbox: 'DISABLED' } },
                mockAdminId
            );
            // Employee 2: inherits global (no override)

            const emp1 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            const emp2 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee2Id
            );

            expect(emp1.effectiveModules.dropbox).toBe(false);
            expect(emp2.effectiveModules.dropbox).toBe(true);
        });

        it('7. Updating global settings preserves existing explicit member overrides', async () => {
            // Employee 1 explicitly enabled for timesheet
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { timesheet: 'ENABLED' } },
                mockAdminId
            );
            // Employee 2 explicitly disabled for timesheet
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee2Id,
                { overrides: { timesheet: 'DISABLED' } },
                mockAdminId
            );

            // Global update toggles timesheet off
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { timesheet: false } },
                mockAdminId
            );

            const emp1 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            const emp2 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee2Id
            );

            // Overrides are preserved!
            expect(emp1.effectiveModules.timesheet).toBe(true);
            expect(emp2.effectiveModules.timesheet).toBe(false);
        });

        it('8. Updating one member override does not affect other members', async () => {
            // Global calendar is true
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { calendar: true } },
                mockAdminId
            );

            // Change Employee 1 only
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { calendar: 'DISABLED' } },
                mockAdminId
            );

            const emp1 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            const emp2 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee2Id
            );

            expect(emp1.effectiveModules.calendar).toBe(false);
            expect(emp2.effectiveModules.calendar).toBe(true);
        });

        it('9. Invalidate member access cache is called on global and member updates', async () => {
            const invalidateSpy = vi.spyOn(ModuleAccessService, 'invalidateMemberAccessCache');

            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { shifts: false } },
                mockAdminId
            );
            expect(invalidateSpy).toHaveBeenCalledWith(mockCompanyId);

            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { shifts: 'ENABLED' } },
                mockAdminId
            );
            expect(invalidateSpy).toHaveBeenCalledWith(mockCompanyId, [mockEmployee1Id]);
        });
    });

    describe('11. Affected Modules & Robust Authorization Suite', () => {
        it('4. Live Monitoring: honors member override when permitted by plan and company', async () => {
            // Enable feature flag and entitlement
            vi.spyOn(FeatureAccessService, 'getCompanyFeatureFlags').mockResolvedValue({
                enableLiveMonitoring: true,
            } as any);
            vi.spyOn(EntitlementService, 'getEntitlementDetails').mockResolvedValue({
                enabled: true,
                limit: null,
            } as any);

            // Globally disabled
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { 'live-monitoring': false } },
                mockAdminId
            );

            // Employee 1 explicitly enabled
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { 'live-monitoring': 'ENABLED' } },
                mockAdminId
            );

            const emp1 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            const emp2 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee2Id
            );

            expect(emp1.effectiveModules['live-monitoring']).toBe(true);
            expect(emp2.effectiveModules['live-monitoring']).toBe(false);
        });

        it('5. Detailed Monitoring: honors member override when permitted by plan and company', async () => {
            vi.spyOn(FeatureAccessService, 'getCompanyFeatureFlags').mockResolvedValue({
                enableDetailedMonitoring: true,
            } as any);
            vi.spyOn(EntitlementService, 'getEntitlementDetails').mockResolvedValue({
                enabled: true,
                limit: null,
            } as any);

            // Globally enabled, employee 2 explicitly disabled
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { 'detailed-monitoring': true } },
                mockAdminId
            );
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee2Id,
                { overrides: { 'detailed-monitoring': 'DISABLED' } },
                mockAdminId
            );

            const emp1 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            const emp2 = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee2Id
            );

            expect(emp1.effectiveModules['detailed-monitoring']).toBe(true);
            expect(emp2.effectiveModules['detailed-monitoring']).toBe(false);
        });

        it('6. User Review Links: honors global setting and overrides independently', async () => {
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { 'user-reviews': true } },
                mockAdminId
            );

            const defaultAccess = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            expect(defaultAccess.effectiveModules['user-reviews']).toBe(true);

            // Explicit disable override
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { 'user-reviews': 'DISABLED' } },
                mockAdminId
            );

            const disabledAccess = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            expect(disabledAccess.effectiveModules['user-reviews']).toBe(false);
        });

        it('7. Status Updates: correctly preserves overrides and global defaults', async () => {
            await ModuleAccessService.updateGlobalModuleAccess(
                mockCompanyId,
                { modules: { 'status-updates': false } },
                mockAdminId
            );

            const initial = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            expect(initial.effectiveModules['status-updates']).toBe(false);

            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { 'status-updates': 'ENABLED' } },
                mockAdminId
            );

            const enabledAccess = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            expect(enabledAccess.effectiveModules['status-updates']).toBe(true);
        });

        it('8. Subscription-restricted modules cannot be overridden by members', async () => {
            // Subscription blocks LIVE_MONITORING
            vi.spyOn(EntitlementService, 'getEntitlementDetails').mockImplementation(async (_, ent) => {
                if (ent === 'LIVE_MONITORING') return { enabled: false, limit: 0 };
                return { enabled: true, limit: null };
            });

            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { 'live-monitoring': 'ENABLED' } },
                mockAdminId
            );

            const access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );
            expect(access.effectiveModules['live-monitoring']).toBe(false);
        });

        it('9. Direct API authorization rejects non-authorized member with 403', async () => {
            await ModuleAccessService.updateEmployeeModuleAccess(
                mockCompanyId,
                mockEmployee1Id,
                { overrides: { 'detailed-monitoring': 'DISABLED' } },
                mockAdminId
            );

            const middleware = requireModuleAccess('detailed-monitoring');
            let statusCode = 200;
            const res: any = {
                status: (code: number) => {
                    statusCode = code;
                    return { json: vi.fn() };
                },
            };
            const next = vi.fn();

            const req: any = {
                user: { role: 'EMPLOYEE', companyId: mockCompanyId, userId: mockEmployee1Id },
                currentUser: { role: 'EMPLOYEE', companyId: mockCompanyId, userId: mockEmployee1Id },
            };

            await middleware(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(statusCode).toBe(403);
        });

        it('10. Unknown module keys are never silently treated as enabled', async () => {
            const access = await ModuleAccessService.getEffectiveMemberModuleAccess(
                mockCompanyId,
                mockEmployee1Id
            );

            // Unknown module key should not exist or be falsy
            expect((access.effectiveModules as any)['unknown-module']).toBeUndefined();
        });
    });
});

