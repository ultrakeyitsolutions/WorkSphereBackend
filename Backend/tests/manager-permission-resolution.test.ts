import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Types } from 'mongoose';
import { ModuleAccessService } from '../src/modules/companyadmin/module-access/module-access.service';
import { CompanyModuleAccess } from '../src/modules/companyadmin/module-access/module-access.model';
import { CompanyMember } from '../src/modules/companyadmin/invitations/company-member.model';
import { FeatureAccessService } from '../src/modules/companyadmin/settings/feature-access.service';
import { EntitlementService } from '../src/services/entitlement.service';
import { MemberResolutionService } from '../src/modules/companyadmin/members/member-resolution.service';

vi.mock('../src/modules/companyadmin/settings/feature-access.service');
vi.mock('../src/services/entitlement.service');
vi.mock('../src/modules/companyadmin/settings/feature-revocation.service', () => ({
    FeatureRevocationService: {
        revokeCompanyFeature: vi.fn().mockResolvedValue(undefined),
        revokeEmployeeModules: vi.fn().mockResolvedValue(undefined),
        revokeEmployeePermissions: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../src/config/redis', () => ({
    getRedisClient: vi.fn().mockReturnValue(null),
    redisGet: vi.fn().mockResolvedValue(null),
    redisSet: vi.fn().mockResolvedValue(undefined),
}));

describe('Manager Workspace Permission Resolution', () => {
    const companyId = new Types.ObjectId().toString();
    const adminId = new Types.ObjectId().toString();
    const emp1Id = new Types.ObjectId().toString();
    const emp2Id = new Types.ObjectId().toString();

    let docs: any[] = [];
    let members: any[] = [];

    function makeMemberDoc(userId: string, memberId?: string) {
        return {
            _id: memberId ? new Types.ObjectId(memberId) : new Types.ObjectId(),
            companyId: new Types.ObjectId(companyId),
            userId: new Types.ObjectId(userId),
            memberType: 'EMPLOYEE',
            status: 'ACTIVE',
            save: vi.fn().mockImplementation(async function (this: any) { return this; }),
            lean: vi.fn().mockReturnValue(this),
            populate: vi.fn().mockReturnValue(this),
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        docs = [];
        members = [
            makeMemberDoc(emp1Id),
            makeMemberDoc(emp2Id),
        ];

        vi.spyOn(CompanyModuleAccess, 'findOne').mockImplementation((query: any) => {
            const found = docs.find((d) => String(d.companyId) === String(query.companyId));
            if (!found) return Promise.resolve(null) as any;
            return Promise.resolve(found) as any;
        });

        vi.spyOn(CompanyModuleAccess, 'create').mockImplementation((data: any) => {
            const doc = {
                ...data,
                _id: new Types.ObjectId(),
                employeeOverrides: data.employeeOverrides || [],
                auditHistory: data.auditHistory || [],
                save: vi.fn().mockImplementation(async function (this: any) { return this; }),
                markModified: vi.fn(),
            };
            docs.push(doc);
            return Promise.resolve(doc) as any;
        });

        const findOneImpl = vi.fn().mockImplementation((query: any) => {
            const targetId = query.userId || query._id;
            const found = members.find(
                (m) =>
                    String(m.companyId) === String(query.companyId) &&
                    (targetId ? String(m.userId) === String(targetId) || String(m._id) === String(targetId) : true)
            );
            const queryMock: any = {
                lean: vi.fn().mockReturnThis(),
                populate: vi.fn().mockReturnThis(),
                then: (resolve: any) => resolve(found ? found : null),
            };
            return queryMock;
        });
        vi.spyOn(CompanyMember, 'findOne').mockImplementation(findOneImpl);

        vi.spyOn(CompanyMember, 'findById').mockImplementation((id: any) => {
            const found = members.find((m) => String(m._id) === String(id));
            if (!found) return Promise.resolve(null) as any;
            return Promise.resolve(found) as any;
        });

        vi.spyOn(CompanyMember, 'countDocuments').mockResolvedValue(0);

        vi.spyOn(EntitlementService, 'getEntitlementDetails').mockResolvedValue({ enabled: true, limit: null, used: 0 } as any);
        vi.spyOn(FeatureAccessService, 'getCompanyFeatureFlags').mockResolvedValue({ enableManagerDashboard: true } as any);
    });

    it('Org ON + Individual DENY -> Manager disabled', async () => {
        await ModuleAccessService.updateGlobalModuleAccess(companyId, { modules: { manager: true } }, adminId);
        await ModuleAccessService.updateEmployeeModuleAccess(companyId, emp1Id, { overrides: { manager: 'DENY' } }, adminId);
        const access = await ModuleAccessService.getEffectiveMemberModuleAccess(companyId, emp1Id);
        expect(access.effectiveModules.manager).toBe(false);
    });

    it('Org OFF + Individual ALLOW -> Manager enabled', async () => {
        await ModuleAccessService.updateGlobalModuleAccess(companyId, { modules: { manager: false } }, adminId);
        await ModuleAccessService.updateEmployeeModuleAccess(companyId, emp1Id, { overrides: { manager: 'ALLOW' } }, adminId);
        const access = await ModuleAccessService.getEffectiveMemberModuleAccess(companyId, emp1Id);
        expect(access.effectiveModules.manager).toBe(true);
    });

    it('Org ON + Individual INHERIT -> Manager enabled', async () => {
        await ModuleAccessService.updateGlobalModuleAccess(companyId, { modules: { manager: true } }, adminId);
        const access = await ModuleAccessService.getEffectiveMemberModuleAccess(companyId, emp1Id);
        expect(access.effectiveModules.manager).toBe(true);
    });

    it('Org OFF + Individual INHERIT -> Manager disabled', async () => {
        await ModuleAccessService.updateGlobalModuleAccess(companyId, { modules: { manager: false } }, adminId);
        const access = await ModuleAccessService.getEffectiveMemberModuleAccess(companyId, emp1Id);
        expect(access.effectiveModules.manager).toBe(false);
    });

    it('Employee A DENY does not affect Employee B', async () => {
        await ModuleAccessService.updateGlobalModuleAccess(companyId, { modules: { manager: true } }, adminId);
        await ModuleAccessService.updateEmployeeModuleAccess(companyId, emp1Id, { overrides: { manager: 'DENY' } }, adminId);
        const emp1 = await ModuleAccessService.getEffectiveMemberModuleAccess(companyId, emp1Id);
        const emp2 = await ModuleAccessService.getEffectiveMemberModuleAccess(companyId, emp2Id);
        expect(emp1.effectiveModules.manager).toBe(false);
        expect(emp2.effectiveModules.manager).toBe(true);
    });

    it('MemberResolutionService resolves by userId', async () => {
        const resolved = await MemberResolutionService.resolveActiveMember(companyId, emp1Id);
        expect(resolved.userId).toBe(emp1Id);
        expect(resolved.memberId).toBe(String(members[0]._id));
    });

    it('MemberResolutionService resolves by memberId', async () => {
        const memberId = String(members[0]._id);
        const resolved = await MemberResolutionService.resolveActiveMember(companyId, memberId);
        expect(resolved.userId).toBe(emp1Id);
        expect(resolved.memberId).toBe(memberId);
    });

    it('MemberResolutionService throws for non-member', async () => {
        await expect(MemberResolutionService.resolveActiveMember(companyId, new Types.ObjectId().toString())).rejects.toThrow(
            /not an active member/
        );
    });

    it('Missing org setting does not silently grant access', async () => {
        // Create a record WITHOUT manager key in globalSettings
        const record = await CompanyModuleAccess.create({
            companyId: new Types.ObjectId(companyId),
            globalSettings: { dashboard: true, attendance: true },
            employeeOverrides: [],
            auditHistory: [],
            schemaVersion: 1,
        });
        docs.push(record);

        const access = await ModuleAccessService.getEffectiveMemberModuleAccess(companyId, emp1Id);
        expect(access.effectiveModules.manager).toBe(false);
    });
});
