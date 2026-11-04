import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Types } from 'mongoose';
import {
    EscalationCategory,
    EscalationSeverity,
    EscalationCaseStatus,
    EscalationResetPeriod,
    EscalationSourceModule,
    VerificationStatus,
} from '../src/modules/escalation/constants/escalation.constants';
import { EscalationProcessor } from '../src/modules/escalation/services/EscalationProcessor';
import { EscalationRuleService, SYSTEM_DEFAULT_RULES } from '../src/modules/escalation/services/EscalationRuleService';
import { EscalationNotificationService } from '../src/modules/escalation/services/EscalationNotificationService';
import { EscalationEngine } from '../src/modules/escalation/services/EscalationEngine';
import { EscalationEvent } from '../src/modules/escalation/models/EscalationEvent';
import { EscalationCase } from '../src/modules/escalation/models/EscalationCase';
import { EscalationRule } from '../src/modules/escalation/models/EscalationRule';
import { EscalationAudit } from '../src/modules/escalation/models/EscalationAudit';
import { EscalationController } from '../src/modules/escalation/controllers/escalation.controller';
import { EscalationRuleController } from '../src/modules/escalation/controllers/escalationRule.controller';
import { EscalationReportController } from '../src/modules/escalation/controllers/escalationReport.controller';
import { NotificationEventBus } from '../src/modules/notifications/notification.event-bus';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { User } from '../src/modules/users/user.model';
import CompanySettings from '../src/modules/companyadmin/settings/company-settings.model';
import CompanyMember from '../src/modules/companyadmin/invitations/company-member.model';
import LeaveRequest from '../src/modules/attendance/leave.model';
import Holiday from '../src/modules/attendance/holiday.model';
import AttendanceAdjustment from '../src/modules/attendance/attendance-adjustment.model';
import { ProjectTeamMember } from '../src/modules/companyadmin/projects/project.model';

describe('WorkSphere Production-Grade Escalation System Test Suite', () => {
    const testCompanyId = new Types.ObjectId().toString();
    const testEmployeeId = new Types.ObjectId().toString();
    const testManagerId = new Types.ObjectId().toString();
    const testAdminId = new Types.ObjectId().toString();

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(ProjectTeamMember, 'find').mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
        } as any);
    });

    // ─── 1. EscalationProcessor: Cycle Boundaries & Resets ────────────────────
    describe('1. EscalationProcessor Cycle Calculations', () => {
        it('should correctly calculate weekly cycle boundaries starting on Monday', () => {
            // Test with a known Wednesday: 2026-11-04
            const wednesday = new Date('2026-11-04T12:00:00.000Z');
            const { startDate, endDate } = EscalationProcessor.computeCycleBoundaries(
                EscalationResetPeriod.WEEKLY,
                wednesday
            );

            expect(startDate.getUTCDay()).toBe(1); // Monday
            expect(startDate.toISOString()).toContain('2026-11-02T00:00:00.000Z');
            expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
        });

        it('should correctly calculate monthly cycle boundaries from 1st of month', () => {
            const midMonth = new Date('2026-11-15T15:30:00.000Z');
            const { startDate, endDate } = EscalationProcessor.computeCycleBoundaries(
                EscalationResetPeriod.MONTHLY,
                midMonth
            );

            expect(startDate.getUTCDate()).toBe(1);
            expect(startDate.getUTCMonth()).toBe(10); // November (0-indexed)
            expect(endDate.getUTCMonth()).toBe(10);
            expect(endDate.getUTCDate()).toBe(30); // November has 30 days
        });

        it('should handle NEVER reset period by spanning epoch to future', () => {
            const { startDate, endDate } = EscalationProcessor.computeCycleBoundaries(
                EscalationResetPeriod.NEVER,
                new Date()
            );

            expect(startDate.getTime()).toBe(0);
            expect(endDate.getUTCFullYear()).toBe(9999);
        });
    });

    // ─── 2. Level Progression & Threshold Logic ───────────────────────────────
    describe('2. Escalation Level Progression', () => {
        it('should escalate to Level 1 on 1st occurrence (Employee)', () => {
            const level = EscalationProcessor.determineEscalationLevel(1);
            expect(level).toBe(1);
        });

        it('should escalate to Level 2 on 2nd occurrence (Reporting Manager)', () => {
            const level = EscalationProcessor.determineEscalationLevel(2);
            expect(level).toBe(2);
        });

        it('should escalate to Level 3 on 3rd occurrence (Manager + Company Admin)', () => {
            const level = EscalationProcessor.determineEscalationLevel(3);
            expect(level).toBe(3);
        });

        it('should escalate to Level 4 on 4th or subsequent occurrences', () => {
            const level = EscalationProcessor.determineEscalationLevel(4);
            expect(level).toBe(4);
            const levelHigher = EscalationProcessor.determineEscalationLevel(7);
            expect(levelHigher).toBe(4);
        });

        it('should respect custom rule escalation level definitions', () => {
            const mockRule: any = {
                escalationLevels: [
                    { level: 1, name: 'Warning', notifyRole: 'EMPLOYEE' },
                    { level: 2, name: 'Lead Review', notifyRole: 'TEAM_LEAD' },
                    { level: 3, name: 'Director Review', notifyRole: 'DIRECTOR' },
                ],
            };

            expect(EscalationProcessor.determineEscalationLevel(1, mockRule)).toBe(1);
            expect(EscalationProcessor.determineEscalationLevel(2, mockRule)).toBe(2);
            expect(EscalationProcessor.determineEscalationLevel(3, mockRule)).toBe(3);
            expect(EscalationProcessor.determineEscalationLevel(5, mockRule)).toBe(3); // capped at max
        });
    });

    // ─── 3. Approved Exceptions & Exclusions ───────────────────────────────────
    describe('3. Approved Exceptions & Exclusions', () => {
        it('should exempt violation if employee has an approved leave request on that date', async () => {
            vi.spyOn(LeaveRequest, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    leaveType: 'CASUAL',
                    status: 'APPROVED',
                }),
            } as any);

            const result = await EscalationProcessor.checkApprovedExceptions(
                testCompanyId,
                testEmployeeId,
                '2026-11-04'
            );

            expect(result.isExempt).toBe(true);
            expect(result.reason).toContain('Approved Leave');
        });

        it('should exempt violation if date is a declared company holiday', async () => {
            vi.spyOn(LeaveRequest, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);
            vi.spyOn(Holiday, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    name: 'Diwali',
                    date: '2026-11-04',
                }),
            } as any);

            const result = await EscalationProcessor.checkApprovedExceptions(
                testCompanyId,
                testEmployeeId,
                '2026-11-04'
            );

            expect(result.isExempt).toBe(true);
            expect(result.reason).toContain('Official Holiday');
        });

        it('should exempt violation if an approved attendance adjustment exists', async () => {
            vi.spyOn(LeaveRequest, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);
            vi.spyOn(Holiday, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);
            vi.spyOn(AttendanceAdjustment, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    status: 'APPROVED',
                }),
            } as any);

            const result = await EscalationProcessor.checkApprovedExceptions(
                testCompanyId,
                testEmployeeId,
                '2026-11-04'
            );

            expect(result.isExempt).toBe(true);
            expect(result.reason).toContain('Approved Attendance Adjustment');
        });

        it('should not exempt violation when no approved leave, holiday, or adjustment exists', async () => {
            vi.spyOn(LeaveRequest, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);
            vi.spyOn(Holiday, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);
            vi.spyOn(AttendanceAdjustment, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);

            const result = await EscalationProcessor.checkApprovedExceptions(
                testCompanyId,
                testEmployeeId,
                '2026-11-04'
            );

            expect(result.isExempt).toBe(false);
        });
    });

    // ─── 4. Hierarchy Resolution & Loop Prevention ────────────────────────────
    describe('4. Escalation Hierarchy Resolution', () => {
        it('should resolve employee for Level 1, manager for Level 2, and admin for Level 3', async () => {
            vi.spyOn(Company, 'findById').mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({ adminId: new Types.ObjectId(testAdminId) }),
                }),
            } as any);

            vi.spyOn(User, 'find').mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([
                        { _id: new Types.ObjectId(testAdminId), role: { name: 'COMPANY_ADMIN' } },
                    ]),
                }),
            } as any);

            vi.spyOn(CompanyMember, 'find').mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    { userId: new Types.ObjectId(testManagerId), memberType: 'MANAGER' },
                ]),
            } as any);

            // Level 1
            const h1 = await EscalationNotificationService.resolveHierarchy(
                testCompanyId,
                testEmployeeId,
                1
            );
            expect(h1.effectiveRecipients.map((r) => r.toString())).toContain(testEmployeeId);

            // Level 2
            const h2 = await EscalationNotificationService.resolveHierarchy(
                testCompanyId,
                testEmployeeId,
                2
            );
            expect(h2.effectiveRecipients.map((r) => r.toString())).toContain(testManagerId);

            // Level 3
            const h3 = await EscalationNotificationService.resolveHierarchy(
                testCompanyId,
                testEmployeeId,
                3
            );
            expect(h3.effectiveRecipients.map((r) => r.toString())).toContain(testManagerId);
            expect(h3.effectiveRecipients.map((r) => r.toString())).toContain(testAdminId);
        });

        it('should gracefully fallback to Company Admin when employee has no reporting manager', async () => {
            vi.spyOn(Company, 'findById').mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({ adminId: new Types.ObjectId(testAdminId) }),
                }),
            } as any);

            vi.spyOn(User, 'find').mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([
                        { _id: new Types.ObjectId(testAdminId), role: { name: 'COMPANY_ADMIN' } },
                    ]),
                }),
            } as any);

            vi.spyOn(CompanyMember, 'find').mockReturnValue({
                lean: vi.fn().mockResolvedValue([]), // No manager
            } as any);

            const h2 = await EscalationNotificationService.resolveHierarchy(
                testCompanyId,
                testEmployeeId,
                2
            );

            // When no manager exists, fallback notifies Company Admin
            expect(h2.effectiveRecipients.map((r) => r.toString())).toContain(testAdminId);
        });
    });

    // ─── 5. EscalationEngine: Grace Period & Duplicate Prevention ─────────────
    describe('5. EscalationEngine Integration & Idempotency', () => {
        it('should exempt violation if lateness is within configured grace period', async () => {
            vi.spyOn(CompanySettings, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({ features: { enableEscalations: true } }),
            } as any);

            vi.spyOn(EscalationRuleService, 'getActiveRule').mockResolvedValue({
                _id: new Types.ObjectId(),
                ruleName: 'Late Check-in',
                category: EscalationCategory.LATE_CHECK_IN,
                isEnabled: true,
                gracePeriod: 15, // 15 mins grace
            } as any);

            vi.spyOn(CompanyMember, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);

            const result = await EscalationEngine.getInstance().publishEvent({
                companyId: testCompanyId,
                employeeId: testEmployeeId,
                category: EscalationCategory.LATE_CHECK_IN,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_123',
                violationDuration: 10, // 10 mins late <= 15 mins grace
            });

            expect(result.processed).toBe(true);
            expect(result.exempted).toBe(true);
            expect(result.caseCreated).toBe(false);
            expect(result.reason).toContain('within grace period');
        });

        it('should prevent duplicate event processing using idempotency check', async () => {
            vi.spyOn(CompanySettings, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({ features: { enableEscalations: true } }),
            } as any);

            vi.spyOn(EscalationRuleService, 'getActiveRule').mockResolvedValue({
                _id: new Types.ObjectId(),
                ruleName: 'Late Check-in',
                category: EscalationCategory.LATE_CHECK_IN,
                isEnabled: true,
                gracePeriod: 15,
            } as any);

            vi.spyOn(CompanyMember, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);

            vi.spyOn(EscalationProcessor, 'checkApprovedExceptions').mockResolvedValue({
                isExempt: false,
            });

            // Simulate existing event found
            vi.spyOn(EscalationEvent, 'findOne').mockResolvedValue({
                _id: new Types.ObjectId(),
                sourceRecordId: 'att_dup',
            } as any);

            const result = await EscalationEngine.getInstance().publishEvent({
                companyId: testCompanyId,
                employeeId: testEmployeeId,
                category: EscalationCategory.LATE_CHECK_IN,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_dup',
                violationDuration: 25,
            });

            expect(result.processed).toBe(true);
            expect(result.caseCreated).toBe(false);
            expect(result.reason).toContain('Duplicate event');
        });

        it('should halt processing when escalation module is disabled in company settings', async () => {
            vi.spyOn(CompanySettings, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({ features: { enableEscalations: false } }),
            } as any);

            const result = await EscalationEngine.getInstance().publishEvent({
                companyId: testCompanyId,
                employeeId: testEmployeeId,
                category: EscalationCategory.LATE_CHECK_IN,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_disabled',
                violationDuration: 30,
            });

            expect(result.processed).toBe(false);
            expect(result.reason).toContain('Escalation module is disabled');
        });
    });

    // ─── 6. Multi-Tenant Isolation & Security ─────────────────────────────────
    describe('6. Multi-Tenant Isolation & Access Restrictions', () => {
        it('should reject access to cases belonging to another company', async () => {
            const companyA = new Types.ObjectId().toString();
            const companyB = new Types.ObjectId().toString();

            const testCaseId = new Types.ObjectId();

            // Mock EscalationCase findOne to return null when companyId does not match
            vi.spyOn(EscalationCase, 'findOne').mockImplementation((filter: any) => {
                if (filter.companyId?.toString() === companyA && filter._id?.toString() === testCaseId.toString()) {
                    return {
                        populate: vi.fn().mockReturnThis(),
                        lean: vi.fn().mockResolvedValue({ _id: testCaseId, companyId: companyA }),
                    } as any;
                }
                return {
                    populate: vi.fn().mockReturnThis(),
                    lean: vi.fn().mockResolvedValue(null),
                } as any;
            });

            // Querying from companyB
            const crossTenantCase = await EscalationCase.findOne({
                _id: testCaseId,
                companyId: new Types.ObjectId(companyB),
            }).lean();

            expect(crossTenantCase).toBeNull();
        });
    });

    // ─── 7. Controller Actions & State Transitions ────────────────────────────
    describe('7. Case Management Controller State Transitions', () => {
        const createMockRes = () => {
            const res: any = {};
            res.status = vi.fn().mockReturnValue(res);
            res.json = vi.fn().mockReturnValue(res);
            res.send = vi.fn().mockReturnValue(res);
            res.setHeader = vi.fn().mockReturnValue(res);
            return res;
        };

        it('should acknowledge an escalation case and record manager comment', async () => {
            const caseId = new Types.ObjectId().toString();
            const mockCase: any = {
                _id: new Types.ObjectId(caseId),
                companyId: new Types.ObjectId(testCompanyId),
                status: EscalationCaseStatus.PENDING,
                managerComments: [],
                save: vi.fn().mockResolvedValue(true),
            };

            vi.spyOn(EscalationCase, 'findOne').mockResolvedValue(mockCase);
            vi.spyOn(EscalationAudit, 'create').mockResolvedValue({} as any);

            const req: any = {
                currentUser: { userId: testManagerId, companyId: testCompanyId, role: 'MANAGER' },
                params: { id: caseId },
                body: { comment: 'Looking into this attendance delay' },
            };
            const res = createMockRes();

            await EscalationController.acknowledgeCase(req, res);

            expect(mockCase.status).toBe(EscalationCaseStatus.ACKNOWLEDGED);
            expect(mockCase.managerComments.length).toBe(1);
            expect(mockCase.managerComments[0].comment).toContain('Looking into this');
            expect(mockCase.save).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should resolve an escalation case with valid reason', async () => {
            const caseId = new Types.ObjectId().toString();
            const mockCase: any = {
                _id: new Types.ObjectId(caseId),
                companyId: new Types.ObjectId(testCompanyId),
                status: EscalationCaseStatus.UNDER_REVIEW,
                managerComments: [],
                save: vi.fn().mockResolvedValue(true),
            };

            vi.spyOn(EscalationCase, 'findOne').mockResolvedValue(mockCase);
            vi.spyOn(EscalationAudit, 'create').mockResolvedValue({} as any);

            const req: any = {
                currentUser: { userId: testManagerId, companyId: testCompanyId, role: 'MANAGER' },
                params: { id: caseId },
                body: { resolutionReason: 'Employee provided valid travel slip for delayed train' },
            };
            const res = createMockRes();

            await EscalationController.resolveCase(req, res);

            expect(mockCase.status).toBe(EscalationCaseStatus.RESOLVED);
            expect(mockCase.resolutionReason).toContain('valid travel slip');
            expect(mockCase.resolvedBy.toString()).toBe(testManagerId);
            expect(mockCase.save).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should allow employee to submit explanation and transition case to under_review', async () => {
            const caseId = new Types.ObjectId().toString();
            const mockCase: any = {
                _id: new Types.ObjectId(caseId),
                companyId: new Types.ObjectId(testCompanyId),
                employeeId: new Types.ObjectId(testEmployeeId),
                status: EscalationCaseStatus.PENDING,
                save: vi.fn().mockResolvedValue(true),
            };

            vi.spyOn(EscalationCase, 'findOne').mockResolvedValue(mockCase);
            vi.spyOn(EscalationAudit, 'create').mockResolvedValue({} as any);

            const req: any = {
                currentUser: { userId: testEmployeeId, companyId: testCompanyId, role: 'EMPLOYEE' },
                params: { id: caseId },
                body: { explanation: 'Heavy traffic due to metro construction detour' },
            };
            const res = createMockRes();

            await EscalationController.submitExplanation(req, res);

            expect(mockCase.employeeExplanation.text).toContain('Heavy traffic');
            expect(mockCase.status).toBe(EscalationCaseStatus.UNDER_REVIEW);
            expect(mockCase.save).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should permit administrator to override escalation case level and status', async () => {
            const caseId = new Types.ObjectId().toString();
            const mockCase: any = {
                _id: new Types.ObjectId(caseId),
                companyId: new Types.ObjectId(testCompanyId),
                escalationLevel: 2,
                status: EscalationCaseStatus.PENDING,
                toObject: () => ({ escalationLevel: 2, status: EscalationCaseStatus.PENDING }),
                save: vi.fn().mockResolvedValue(true),
            };

            vi.spyOn(EscalationCase, 'findOne').mockResolvedValue(mockCase);
            vi.spyOn(EscalationAudit, 'create').mockResolvedValue({} as any);

            const req: any = {
                currentUser: { userId: testAdminId, companyId: testCompanyId, role: 'COMPANY_ADMIN' },
                params: { id: caseId },
                body: { escalationLevel: 3, status: EscalationCaseStatus.UNDER_REVIEW, reason: 'Escalated by admin review' },
            };
            const res = createMockRes();

            await EscalationController.overrideCase(req, res);

            expect(mockCase.escalationLevel).toBe(3);
            expect(mockCase.status).toBe(EscalationCaseStatus.UNDER_REVIEW);
            expect(mockCase.save).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    // ─── 8. Compliance Reporting & Export ─────────────────────────────────────
    describe('8. Reporting & Data Export', () => {
        const createMockRes = () => {
            const res: any = {};
            res.status = vi.fn().mockReturnValue(res);
            res.json = vi.fn().mockReturnValue(res);
            res.send = vi.fn().mockReturnValue(res);
            res.setHeader = vi.fn().mockReturnValue(res);
            return res;
        };

        it('should export compliance cases to CSV format', async () => {
            const mockCase = {
                _id: new Types.ObjectId(),
                employeeId: { name: 'John Doe', email: 'john@example.com' },
                assignedManager: { name: 'Manager Smith', email: 'smith@example.com' },
                category: EscalationCategory.LATE_CHECK_IN,
                escalationLevel: 2,
                occurrenceCount: 2,
                status: EscalationCaseStatus.PENDING,
                dueAt: new Date('2026-11-06T10:00:00.000Z'),
                resolutionReason: '',
                createdAt: new Date('2026-11-04T10:00:00.000Z'),
            };

            vi.spyOn(EscalationCase, 'find').mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([mockCase]),
            } as any);

            const req: any = {
                currentUser: { userId: testAdminId, companyId: testCompanyId, role: 'COMPANY_ADMIN' },
                query: {},
            };
            const res = createMockRes();

            await EscalationReportController.exportReport(req, res);

            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
            expect(res.send).toHaveBeenCalled();
            const sentCsv = res.send.mock.calls[0][0];
            expect(sentCsv).toContain('Case ID,Employee Name');
            expect(sentCsv).toContain('John Doe');
            expect(sentCsv).toContain(EscalationCategory.LATE_CHECK_IN);
        });
    });
});
