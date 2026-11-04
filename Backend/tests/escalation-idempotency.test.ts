import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Types } from 'mongoose';
import {
    EscalationCategory,
    EscalationSeverity,
    EscalationCaseStatus,
    EscalationResetPeriod,
    EscalationSourceModule,
    VerificationStatus,
} from '../src/modules/escalation/constants/escalation.constants';
import { EscalationEngine, isDuplicateKeyError } from '../src/modules/escalation/services/EscalationEngine';
import { EscalationProcessor } from '../src/modules/escalation/services/EscalationProcessor';
import { EscalationSchedulerJob } from '../src/modules/escalation/jobs/escalationScheduler';
import { EscalationEvent } from '../src/modules/escalation/models/EscalationEvent';
import { EscalationCase } from '../src/modules/escalation/models/EscalationCase';
import { EscalationLock } from '../src/modules/escalation/models/EscalationLock';
import { EscalationRuleService } from '../src/modules/escalation/services/EscalationRuleService';
import { EscalationNotificationService } from '../src/modules/escalation/services/EscalationNotificationService';
import { EscalationAuditService } from '../src/modules/escalation/services/EscalationAuditService';
import { NotificationEventBus } from '../src/modules/notifications/notification.event-bus';
import Attendance from '../src/modules/attendance/attendance.model';
import CompanySettings from '../src/modules/companyadmin/settings/company-settings.model';
import CompanyMember from '../src/modules/companyadmin/invitations/company-member.model';
import { ProjectTeamMember } from '../src/modules/companyadmin/projects/project.model';
import * as redisModule from '../src/config/redis';

describe('WorkSphere Escalation Engine Idempotency & Concurrency Test Suite', () => {
    const testCompanyId = new Types.ObjectId().toString();
    const testEmployeeId = new Types.ObjectId().toString();
    const testManagerId = new Types.ObjectId().toString();

    const mockRule = {
        _id: new Types.ObjectId(),
        ruleName: 'Missing Check-Out Rule',
        category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
        isEnabled: true,
        severity: EscalationSeverity.MEDIUM,
        gracePeriod: 0,
        resetPeriod: EscalationResetPeriod.MONTHLY,
        resolutionDeadline: 24,
        escalationLevels: [
            { level: 1, name: 'Employee Alert', notifyRole: 'EMPLOYEE', deadlineHours: 24 },
            { level: 2, name: 'Manager Alert', notifyRole: 'REPORTING_MANAGER', deadlineHours: 24 },
        ],
        notificationRecipients: [],
        applicableDepartments: [],
        applicableEmployees: [],
        applicableShifts: [],
    };

    beforeEach(() => {
        vi.restoreAllMocks();

        // Standard mocks for baseline escalation flow
        vi.spyOn(CompanySettings, 'findOne').mockReturnValue({
            lean: vi.fn().mockResolvedValue({ features: { enableEscalations: true } }),
        } as any);

        vi.spyOn(CompanyMember, 'findOne').mockReturnValue({
            lean: vi.fn().mockResolvedValue(null),
        } as any);

        vi.spyOn(ProjectTeamMember, 'find').mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
        } as any);

        vi.spyOn(EscalationRuleService, 'getActiveRule').mockResolvedValue(mockRule as any);

        vi.spyOn(EscalationProcessor, 'checkApprovedExceptions').mockResolvedValue({
            isExempt: false,
        });

        vi.spyOn(EscalationProcessor, 'calculateOccurrenceCount').mockResolvedValue(1);

        vi.spyOn(EscalationNotificationService, 'resolveHierarchy').mockResolvedValue({
            level: 1,
            employeeId: new Types.ObjectId(testEmployeeId),
            reportingManagerIds: [new Types.ObjectId(testManagerId)],
            companyAdminIds: [],
            effectiveRecipients: [new Types.ObjectId(testEmployeeId)],
        });

        vi.spyOn(EscalationNotificationService, 'notifyEscalation').mockResolvedValue();
        vi.spyOn(EscalationAuditService, 'log').mockResolvedValue();
    });

    afterEach(() => {
        EscalationSchedulerJob.stop();
        vi.restoreAllMocks();
    });

    // ─── 1. Deterministic Idempotency Key Generation ──────────────────────────
    describe('1. Deterministic Idempotency Key Generation', () => {
        it('should generate consistent deterministic keys for the same business event', () => {
            const key1 = EscalationEngine.generateIdempotencyKey({
                companyId: testCompanyId,
                employeeId: testEmployeeId,
                category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_record_999',
                eventDate: '2026-11-03',
            });

            const key2 = EscalationEngine.generateIdempotencyKey({
                companyId: testCompanyId,
                employeeId: testEmployeeId,
                category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_record_999',
                eventDate: '2026-11-03',
            });

            expect(key1).toBe(key2);
            expect(key1).toBe(
                `${EscalationCategory.PRODUCTION_HOURS_DISCREPANCY}_${testEmployeeId}_${EscalationSourceModule.ATTENDANCE}_att_record_999_2026-11-03`.toLowerCase()
            );
        });

        it('should preserve and trim custom idempotency keys when provided', () => {
            const customKey = 'missing_checkout_att_record_999';
            const resolved = EscalationEngine.generateIdempotencyKey({
                companyId: testCompanyId,
                employeeId: testEmployeeId,
                category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_record_999',
                eventDate: '2026-11-03',
                customKey: `  ${customKey}  `,
            });

            expect(resolved).toBe(customKey);
        });
    });

    // ─── 2. Same Event Processed Repeatedly (Retries & Repeated Scheduler) ────
    describe('2. Same Event Processed Repeatedly', () => {
        it('should create event & case on first call, then gracefully skip duplicates on subsequent calls', async () => {
            const eventId = new Types.ObjectId();
            const caseId = new Types.ObjectId();

            const mockCreatedDoc = {
                _id: eventId,
                companyId: new Types.ObjectId(testCompanyId),
                employeeId: new Types.ObjectId(testEmployeeId),
                category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                idempotencyKey: 'missing_checkout_att_101',
            };

            const mockCaseDoc = {
                _id: caseId,
                companyId: new Types.ObjectId(testCompanyId),
                employeeId: new Types.ObjectId(testEmployeeId),
                eventId,
                status: EscalationCaseStatus.PENDING,
            };

            // First pass: Event does not exist in DB yet
            let dbStore: any = null;

            vi.spyOn(EscalationEvent, 'findOne').mockImplementation((filter: any) => {
                if (dbStore) return Promise.resolve(dbStore) as any;
                return Promise.resolve(null) as any;
            });

            vi.spyOn(EscalationEvent, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
                if (!dbStore) {
                    dbStore = { ...mockCreatedDoc };
                    return Promise.resolve({
                        value: dbStore,
                        lastErrorObject: { updatedExisting: false },
                    }) as any;
                }
                return Promise.resolve({
                    value: dbStore,
                    lastErrorObject: { updatedExisting: true },
                }) as any;
            });

            vi.spyOn(EscalationCase, 'create').mockResolvedValue(mockCaseDoc as any);

            const payload = {
                companyId: testCompanyId,
                employeeId: testEmployeeId,
                category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_101',
                eventDate: '2026-11-03',
                idempotencyKey: 'missing_checkout_att_101',
            };

            // 1st Execution (First time detection)
            const result1 = await EscalationEngine.getInstance().publishEvent(payload);
            expect(result1.processed).toBe(true);
            expect(result1.caseCreated).toBe(true);
            expect(result1.event).toBeDefined();
            expect(EscalationNotificationService.notifyEscalation).toHaveBeenCalledTimes(1);

            // 2nd Execution (Retry / Next scheduler tick 60s later)
            const result2 = await EscalationEngine.getInstance().publishEvent(payload);
            expect(result2.processed).toBe(true);
            expect(result2.caseCreated).toBe(false);
            expect(result2.reason).toContain('Duplicate event');
            // Notification must NOT be sent again
            expect(EscalationNotificationService.notifyEscalation).toHaveBeenCalledTimes(1);

            // 3rd Execution (Third retry)
            const result3 = await EscalationEngine.getInstance().publishEvent(payload);
            expect(result3.processed).toBe(true);
            expect(result3.caseCreated).toBe(false);
            expect(EscalationNotificationService.notifyEscalation).toHaveBeenCalledTimes(1);
        });
    });

    // ─── 3. Concurrent Scheduler Execution & E11000 Duplicate Key Handling ───
    describe('3. Duplicate-Key Races (E11000) Handled as Already-Processed', () => {
        it('should correctly identify MongoDB E11000 error variants', () => {
            expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
            expect(isDuplicateKeyError({ name: 'MongoServerError', code: 11000 })).toBe(true);
            expect(
                isDuplicateKeyError(
                    new Error(
                        'E11000 duplicate key error collection: WorkSphere.escalationevents index: companyId_1_idempotencyKey_1'
                    )
                )
            ).toBe(true);
            expect(isDuplicateKeyError({ code: 12345, message: 'General connection error' })).toBe(false);
            expect(isDuplicateKeyError(null)).toBe(false);
        });

        it('should catch E11000 duplicate key race error and treat it as a processed duplicate without failing', async () => {
            const eventId = new Types.ObjectId();
            const existingEventDoc = {
                _id: eventId,
                companyId: new Types.ObjectId(testCompanyId),
                idempotencyKey: 'missing_checkout_att_race',
            };

            // Fast path findOne returns null first (simulating both threads passing check simultaneously)
            let findOneCalls = 0;
            vi.spyOn(EscalationEvent, 'findOne').mockImplementation((filter: any) => {
                findOneCalls++;
                if (findOneCalls === 1) return Promise.resolve(null) as any;
                // When queried for resolution after race, return the winning event doc
                return Promise.resolve(existingEventDoc) as any;
            });

            // Simulate findOneAndUpdate throwing MongoDB E11000 duplicate key error during race
            const duplicateKeyError = new Error(
                'E11000 duplicate key error collection: WorkSphere.escalationevents index: companyId_1_idempotencyKey_1 dup key: { companyId: ObjectId("..."), idempotencyKey: "missing_checkout_att_race" }'
            );
            (duplicateKeyError as any).code = 11000;

            vi.spyOn(EscalationEvent, 'findOneAndUpdate').mockRejectedValue(duplicateKeyError);

            const result = await EscalationEngine.getInstance().publishEvent({
                companyId: testCompanyId,
                employeeId: testEmployeeId,
                category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_race',
                eventDate: '2026-11-03',
                idempotencyKey: 'missing_checkout_att_race',
            });

            // Must NOT fail or return processed: false
            expect(result.processed).toBe(true);
            expect(result.caseCreated).toBe(false);
            expect(result.reason).toContain('Duplicate event already processed');
            expect(result.event).toBeDefined();
            expect(result.event?._id).toEqual(eventId);
            // Must NOT notify
            expect(EscalationNotificationService.notifyEscalation).not.toHaveBeenCalled();
        });
    });

    // ─── 4. Distributed Scheduler Locking (Multiple Backend Instances) ────────
    describe('4. Distributed Scheduler Locking', () => {
        it('should acquire Redis distributed lock when Redis is ready', async () => {
            const mockRedis = {
                status: 'ready',
                set: vi.fn().mockResolvedValue('OK'),
                eval: vi.fn().mockResolvedValue(1),
            };
            vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

            const acquired = await EscalationSchedulerJob.acquireLock('lock:test:scheduler', 55);
            expect(acquired).toBe(true);
            expect(mockRedis.set).toHaveBeenCalledWith(
                'lock:test:scheduler',
                expect.any(String),
                'EX',
                55,
                'NX'
            );

            await EscalationSchedulerJob.releaseLock('lock:test:scheduler');
            expect(mockRedis.eval).toHaveBeenCalled();
        });

        it('should reject acquisition when Redis lock is already held by another instance', async () => {
            const mockRedis = {
                status: 'ready',
                set: vi.fn().mockResolvedValue(null), // Null means lock already held
            };
            vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

            const acquired = await EscalationSchedulerJob.acquireLock('lock:test:scheduler', 55);
            expect(acquired).toBe(false);
        });

        it('should fallback to MongoDB atomic lock when Redis is unavailable', async () => {
            // Redis unavailable
            vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(null as any);

            // Mock MongoDB EscalationLock
            vi.spyOn(EscalationLock, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
                const owner = update.$set.owner;
                return Promise.resolve({
                    lockKey: 'lock:test:mongo',
                    owner,
                    expiresAt: update.$set.expiresAt,
                }) as any;
            });
            vi.spyOn(EscalationLock, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as any);

            const acquired = await EscalationSchedulerJob.acquireLock('lock:test:mongo', 55);
            expect(acquired).toBe(true);
            expect(EscalationLock.findOneAndUpdate).toHaveBeenCalled();

            await EscalationSchedulerJob.releaseLock('lock:test:mongo');
            expect(EscalationLock.deleteOne).toHaveBeenCalledWith({
                lockKey: 'lock:test:mongo',
                owner: expect.any(String),
            });
        });

        it('should reject MongoDB lock when another instance holds an unexpired lock', async () => {
            vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(null as any);

            // Simulate E11000 duplicate key on EscalationLock
            const mongoDupError = new Error('E11000 duplicate key error index: lockKey_1');
            (mongoDupError as any).code = 11000;
            vi.spyOn(EscalationLock, 'findOneAndUpdate').mockRejectedValue(mongoDupError);

            const acquired = await EscalationSchedulerJob.acquireLock('lock:test:mongo_busy', 55);
            expect(acquired).toBe(false);
        });
    });

    // ─── 5. Notification Deduplication ────────────────────────────────────────
    describe('5. Notification Deduplication', () => {
        it('should send notification exactly once and deduplicate subsequent calls', async () => {
            const eventId = new Types.ObjectId();
            const caseId = new Types.ObjectId();

            let callCount = 0;
            vi.spyOn(EscalationEvent, 'findOne').mockImplementation(() => {
                if (callCount > 0) {
                    return Promise.resolve({ _id: eventId }) as any;
                }
                return Promise.resolve(null) as any;
            });

            vi.spyOn(EscalationEvent, 'findOneAndUpdate').mockImplementation(() => {
                callCount++;
                return Promise.resolve({
                    value: { _id: eventId },
                    lastErrorObject: { updatedExisting: false },
                }) as any;
            });

            vi.spyOn(EscalationCase, 'create').mockResolvedValue({
                _id: caseId,
                companyId: new Types.ObjectId(testCompanyId),
                eventId,
            } as any);

            const payload = {
                companyId: testCompanyId,
                employeeId: testEmployeeId,
                category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_notif_test',
                idempotencyKey: 'missing_checkout_att_notif_test',
            };

            await EscalationEngine.getInstance().publishEvent(payload);
            expect(EscalationNotificationService.notifyEscalation).toHaveBeenCalledTimes(1);

            // Repeat call
            await EscalationEngine.getInstance().publishEvent(payload);
            expect(EscalationNotificationService.notifyEscalation).toHaveBeenCalledTimes(1);
        });

        it('should prevent case reminder notification spam in scheduler passes', async () => {
            const caseId = new Types.ObjectId();
            const urgentCases = [
                {
                    _id: caseId,
                    companyId: new Types.ObjectId(testCompanyId),
                    employeeId: new Types.ObjectId(testEmployeeId),
                    category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                    status: EscalationCaseStatus.PENDING,
                    dueAt: new Date(Date.now() + 1000 * 60 * 60), // Due in 1 hour
                    notifiedUsers: [{ userId: new Types.ObjectId(testManagerId) }],
                },
            ];

            vi.spyOn(EscalationCase, 'find').mockReturnValue({
                limit: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(urgentCases),
                }),
            } as any);

            const publishSpy = vi.spyOn(NotificationEventBus.getInstance(), 'publish').mockReturnValue();

            // First reminder pass: sends reminder
            await EscalationSchedulerJob.processCaseReminders();
            expect(publishSpy).toHaveBeenCalledTimes(1);

            // Second reminder pass (e.g. 60 seconds later): should be deduplicated
            await EscalationSchedulerJob.processCaseReminders();
            expect(publishSpy).toHaveBeenCalledTimes(1);
        });
    });

    // ─── 6. Legitimate New Checkout Events ────────────────────────────────────
    describe('6. Legitimate New Events Handled Independently', () => {
        it('should independently process distinct attendance records for different employees', async () => {
            const empA = new Types.ObjectId().toString();
            const empB = new Types.ObjectId().toString();

            const eventAId = new Types.ObjectId();
            const eventBId = new Types.ObjectId();

            vi.spyOn(EscalationEvent, 'findOne').mockResolvedValue(null);

            vi.spyOn(EscalationEvent, 'findOneAndUpdate')
                .mockResolvedValueOnce({
                    value: { _id: eventAId },
                    lastErrorObject: { updatedExisting: false },
                } as any)
                .mockResolvedValueOnce({
                    value: { _id: eventBId },
                    lastErrorObject: { updatedExisting: false },
                } as any);

            vi.spyOn(EscalationCase, 'create')
                .mockResolvedValueOnce({ _id: new Types.ObjectId(), eventId: eventAId } as any)
                .mockResolvedValueOnce({ _id: new Types.ObjectId(), eventId: eventBId } as any);

            const resA = await EscalationEngine.getInstance().publishEvent({
                companyId: testCompanyId,
                employeeId: empA,
                category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_emp_A',
                idempotencyKey: 'missing_checkout_att_emp_A',
            });

            const resB = await EscalationEngine.getInstance().publishEvent({
                companyId: testCompanyId,
                employeeId: empB,
                category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                sourceModule: EscalationSourceModule.ATTENDANCE,
                sourceRecordId: 'att_emp_B',
                idempotencyKey: 'missing_checkout_att_emp_B',
            });

            expect(resA.processed).toBe(true);
            expect(resA.caseCreated).toBe(true);

            expect(resB.processed).toBe(true);
            expect(resB.caseCreated).toBe(true);

            expect(EscalationNotificationService.notifyEscalation).toHaveBeenCalledTimes(2);
        });
    });

    // ─── 7. Missing Checkout Scheduler Flow ───────────────────────────────────
    describe('7. detectMissingCheckouts Scheduler Flow', () => {
        it('should correctly report scanned, created, and duplicateSkipped stats', async () => {
            const att1 = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(testCompanyId),
                employeeId: new Types.ObjectId(testEmployeeId),
                date: '2026-11-03',
                actual: { firstCheckIn: new Date(), lastCheckOut: null },
                scheduled: { endTime: new Date(Date.now() - 2 * 60 * 60 * 1000) },
                isFinalized: false,
            };

            vi.spyOn(Attendance, 'find').mockReturnValue({
                limit: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([att1]),
                }),
            } as any);

            // First run: event created
            vi.spyOn(EscalationEngine.getInstance(), 'publishEvent').mockResolvedValueOnce({
                processed: true,
                caseCreated: true,
                caseUpdated: false,
                exempted: false,
            });

            const stats1 = await EscalationSchedulerJob.detectMissingCheckouts();
            expect(stats1.scanned).toBe(1);
            expect(stats1.created).toBe(1);
            expect(stats1.duplicateSkipped).toBe(0);

            // Second run: duplicate skipped
            vi.spyOn(EscalationEngine.getInstance(), 'publishEvent').mockResolvedValueOnce({
                processed: true,
                caseCreated: false,
                caseUpdated: false,
                exempted: false,
                reason: 'Duplicate event already processed (idempotency match)',
            });

            const stats2 = await EscalationSchedulerJob.detectMissingCheckouts();
            expect(stats2.scanned).toBe(1);
            expect(stats2.created).toBe(0);
            expect(stats2.duplicateSkipped).toBe(1);
            expect(stats2.failed).toBe(0);
        });
    });
});
