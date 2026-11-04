import mongoose, { Types } from 'mongoose';
import { EscalationEvent } from '../models/EscalationEvent';
import { EscalationCase } from '../models/EscalationCase';
import { EscalationRule } from '../models/EscalationRule';
import {
    EscalationCategory,
    EscalationCaseStatus,
    EscalationAuditAction,
    VerificationStatus,
} from '../constants/escalation.constants';
import {
    StandardEscalationEventPayload,
    IEscalationCaseDocument,
    IEscalationEventDocument,
} from '../types/escalation.types';
import { EscalationRuleService } from './EscalationRuleService';
import { EscalationProcessor } from './EscalationProcessor';
import { EscalationNotificationService } from './EscalationNotificationService';
import { EscalationAuditService } from './EscalationAuditService';
import CompanySettings from '../../companyadmin/settings/company-settings.model';
import CompanyMember from '../../companyadmin/invitations/company-member.model';

export interface EscalationEngineResult {
    processed: boolean;
    caseCreated: boolean;
    caseUpdated: boolean;
    exempted: boolean;
    reason?: string;
    event?: IEscalationEventDocument;
    case?: IEscalationCaseDocument;
}

/**
 * Utility to identify MongoDB E11000 duplicate key errors across driver versions.
 */
export function isDuplicateKeyError(error: any): boolean {
    if (!error) return false;
    return (
        error.code === 11000 ||
        error.code === 11001 ||
        (error.name === 'MongoServerError' && error.code === 11000) ||
        (typeof error.message === 'string' && error.message.includes('E11000'))
    );
}

export class EscalationEngine {
    private static instance: EscalationEngine;

    public static getInstance(): EscalationEngine {
        if (!EscalationEngine.instance) {
            EscalationEngine.instance = new EscalationEngine();
        }
        return EscalationEngine.instance;
    }

    /**
     * Generate a deterministic idempotency key for any business event.
     * Prevents duplicate events across retries and distributed execution.
     */
    public static generateIdempotencyKey(params: {
        companyId: string;
        employeeId: string;
        category: EscalationCategory | string;
        sourceModule: string;
        sourceRecordId: string;
        eventDate: string;
        customKey?: string;
    }): string {
        if (params.customKey && params.customKey.trim().length > 0) {
            return params.customKey.trim();
        }
        return `${params.category}_${params.employeeId}_${params.sourceModule}_${params.sourceRecordId}_${params.eventDate}`.toLowerCase();
    }

    /**
     * Publishes a standardized compliance/escalation event to the central engine.
     * Guaranteed to be exception-safe (never crashes caller).
     */
    public async publishEvent(
        payload: StandardEscalationEventPayload
    ): Promise<EscalationEngineResult> {
        try {
            const {
                companyId,
                employeeId,
                category,
                sourceModule,
                sourceRecordId,
                expectedValue = '',
                actualValue = '',
                violationDuration = 0,
                metadata = {},
                idempotencyKey,
                eventDate: explicitEventDate,
            } = payload;

            // 1. Basic Validation
            if (!companyId || !employeeId || !category || !sourceModule || !sourceRecordId) {
                console.warn('[EscalationEngine] Event rejected: Missing required fields', JSON.stringify({
                    action: 'EVENT_REJECTED',
                    companyId,
                    employeeId,
                    category,
                    sourceModule,
                    sourceRecordId,
                }));
                return {
                    processed: false,
                    caseCreated: false,
                    caseUpdated: false,
                    exempted: false,
                    reason: 'Missing required escalation event fields',
                };
            }

            const companyObjId = new Types.ObjectId(companyId);
            const employeeObjId = new Types.ObjectId(employeeId);

            // 2. Check Company Admin feature toggle (is escalation enabled for this company?)
            const settings = await CompanySettings.findOne({ companyId: companyObjId }).lean();
            if (settings?.features && (settings.features as any).enableEscalations === false) {
                console.log('[EscalationEngine] Escalation module disabled in company settings', JSON.stringify({
                    action: 'EVENT_SKIPPED_MODULE_DISABLED',
                    companyId,
                }));
                return {
                    processed: false,
                    caseCreated: false,
                    caseUpdated: false,
                    exempted: false,
                    reason: 'Escalation module is disabled in company settings',
                };
            }

            // 3. Find the Active Escalation Rule for this category
            const rule = await EscalationRuleService.getActiveRule(companyId, category);
            if (!rule || !rule.isEnabled) {
                return {
                    processed: false,
                    caseCreated: false,
                    caseUpdated: false,
                    exempted: false,
                    reason: `No active escalation rule configured for category ${category}`,
                };
            }

            // 4. Check applicability (applicableEmployees, applicableDepartments, applicableShifts)
            const member = await CompanyMember.findOne({
                companyId: companyObjId,
                userId: employeeObjId,
            }).lean();

            if (rule.applicableEmployees && rule.applicableEmployees.length > 0) {
                const isEmployeeApplicable = rule.applicableEmployees.some(
                    (id: any) => id.toString() === employeeId
                );
                if (!isEmployeeApplicable) {
                    return {
                        processed: false,
                        caseCreated: false,
                        caseUpdated: false,
                        exempted: true,
                        reason: 'Employee not in rule applicable employees list',
                    };
                }
            }

            if (rule.applicableDepartments && rule.applicableDepartments.length > 0 && member?.designationId) {
                const isDeptApplicable = rule.applicableDepartments.some(
                    (id: any) => id.toString() === member.designationId.toString()
                );
                if (!isDeptApplicable) {
                    return {
                        processed: false,
                        caseCreated: false,
                        caseUpdated: false,
                        exempted: true,
                        reason: 'Employee designation not in rule applicable departments list',
                    };
                }
            }

            // 5. Check Grace Period (if applicable to category, e.g. LATE_CHECK_IN)
            if (category === EscalationCategory.LATE_CHECK_IN && rule.gracePeriod > 0) {
                if (violationDuration <= rule.gracePeriod) {
                    return {
                        processed: true,
                        caseCreated: false,
                        caseUpdated: false,
                        exempted: true,
                        reason: `Violation duration (${violationDuration}m) within grace period (${rule.gracePeriod}m)`,
                    };
                }
            }

            // 6. Calculate deterministic eventTimestamp and eventDate
            const eventTimestamp = payload.eventTimestamp ? new Date(payload.eventTimestamp) : new Date();
            const eventDate =
                explicitEventDate ||
                (metadata?.cycleDate as string) ||
                eventTimestamp.toISOString().split('T')[0];

            // 7. Resolve Deterministic Idempotency Key
            const resolvedIdempotencyKey = EscalationEngine.generateIdempotencyKey({
                companyId,
                employeeId,
                category,
                sourceModule,
                sourceRecordId,
                eventDate,
                customKey: idempotencyKey,
            });

            // 8. Check Exclusions and Approved Exceptions (leave, holidays, attendance adjustment)
            const exceptionCheck = await EscalationProcessor.checkApprovedExceptions(
                companyId,
                employeeId,
                eventDate
            );

            if (exceptionCheck.isExempt) {
                console.log('[EscalationEngine] Event exempted due to approved exception', JSON.stringify({
                    action: 'EVENT_EXEMPTED',
                    companyId,
                    employeeId,
                    category,
                    sourceRecordId,
                    idempotencyKey: resolvedIdempotencyKey,
                    reason: exceptionCheck.reason,
                }));

                // Record the event as EXEMPTED using atomic upsert to avoid duplicate key exceptions on audit log
                let exemptedEvent: any = null;
                try {
                    const upsertExempt: any = await EscalationEvent.findOneAndUpdate(
                        {
                            companyId: companyObjId,
                            idempotencyKey: resolvedIdempotencyKey,
                        },
                        {
                            $setOnInsert: {
                                companyId: companyObjId,
                                employeeId: employeeObjId,
                                category,
                                sourceModule,
                                sourceRecordId,
                                ruleId: rule._id,
                                eventDate,
                                eventTimestamp,
                                expectedValue,
                                actualValue,
                                violationDuration,
                                metadata: { ...metadata, exceptionReason: exceptionCheck.reason },
                                verificationStatus: VerificationStatus.EXEMPTED,
                                idempotencyKey: resolvedIdempotencyKey,
                            },
                        },
                        { upsert: true, new: true }
                    );
                    exemptedEvent = upsertExempt?.value || upsertExempt;
                } catch (exemptErr) {
                    if (isDuplicateKeyError(exemptErr)) {
                        exemptedEvent = await EscalationEvent.findOne({
                            companyId: companyObjId,
                            idempotencyKey: resolvedIdempotencyKey,
                        });
                    }
                }

                return {
                    processed: true,
                    caseCreated: false,
                    caseUpdated: false,
                    exempted: true,
                    reason: exceptionCheck.reason,
                    event: exemptedEvent || undefined,
                };
            }

            // 9. Fast-Path Idempotency Check: Query existing verified event
            const existingEvent = await EscalationEvent.findOne({
                companyId: companyObjId,
                $or: [
                    { idempotencyKey: resolvedIdempotencyKey },
                    { employeeId: employeeObjId, category, eventDate, sourceRecordId },
                ],
            });

            if (existingEvent) {
                console.log('[EscalationEngine] Event skipped (duplicate detected via query)', JSON.stringify({
                    action: 'EVENT_DUPLICATE_SKIPPED',
                    companyId,
                    employeeId,
                    category,
                    sourceRecordId,
                    idempotencyKey: resolvedIdempotencyKey,
                    eventId: existingEvent._id.toString(),
                    reason: 'Existing event already registered',
                }));

                return {
                    processed: true,
                    caseCreated: false,
                    caseUpdated: false,
                    exempted: false,
                    reason: 'Duplicate event already processed (idempotency match)',
                    event: existingEvent,
                };
            }

            // 10. Atomic Upsert for Verified EscalationEvent
            // Handles concurrent threads gracefully without duplicate key failures
            let createdEvent: IEscalationEventDocument | null = null;
            let isNewEvent = true;

            try {
                const upsertRes: any = await EscalationEvent.findOneAndUpdate(
                    {
                        companyId: companyObjId,
                        idempotencyKey: resolvedIdempotencyKey,
                    },
                    {
                        $setOnInsert: {
                            companyId: companyObjId,
                            employeeId: employeeObjId,
                            category,
                            sourceModule,
                            sourceRecordId,
                            ruleId: rule._id,
                            eventDate,
                            eventTimestamp,
                            expectedValue,
                            actualValue,
                            violationDuration,
                            metadata,
                            verificationStatus: VerificationStatus.VERIFIED,
                            idempotencyKey: resolvedIdempotencyKey,
                        },
                    },
                    {
                        upsert: true,
                        new: true,
                        includeResultMetadata: true,
                    }
                );

                if (upsertRes && 'value' in upsertRes) {
                    createdEvent = upsertRes.value;
                    isNewEvent = !upsertRes.lastErrorObject?.updatedExisting;
                } else if (upsertRes && '_id' in upsertRes) {
                    // Direct document returned (mocks or standard driver fallback)
                    createdEvent = upsertRes;
                    isNewEvent = true;
                } else {
                    createdEvent = await EscalationEvent.findOne({
                        companyId: companyObjId,
                        idempotencyKey: resolvedIdempotencyKey,
                    });
                    isNewEvent = false;
                }
            } catch (upsertError: any) {
                if (isDuplicateKeyError(upsertError)) {
                    // Concurrent execution won the insert race: treat as duplicate already processed
                    console.log('[EscalationEngine] Event duplicate key race (E11000) resolved safely', JSON.stringify({
                        action: 'EVENT_DUPLICATE_RACE_RESOLVED',
                        companyId,
                        employeeId,
                        category,
                        sourceRecordId,
                        idempotencyKey: resolvedIdempotencyKey,
                    }));

                    createdEvent = await EscalationEvent.findOne({
                        companyId: companyObjId,
                        $or: [
                            { idempotencyKey: resolvedIdempotencyKey },
                            { employeeId: employeeObjId, category, eventDate, sourceRecordId },
                        ],
                    });
                    isNewEvent = false;
                } else {
                    throw upsertError;
                }
            }

            // If this event was not newly inserted, skip case creation and notification
            if (!isNewEvent || !createdEvent) {
                console.log('[EscalationEngine] Event skipped (atomic duplicate detection)', JSON.stringify({
                    action: 'EVENT_DUPLICATE_SKIPPED',
                    companyId,
                    employeeId,
                    category,
                    sourceRecordId,
                    idempotencyKey: resolvedIdempotencyKey,
                    eventId: createdEvent?._id?.toString(),
                    reason: 'Atomic upsert matched existing event',
                }));

                return {
                    processed: true,
                    caseCreated: false,
                    caseUpdated: false,
                    exempted: false,
                    reason: 'Duplicate event already processed (idempotency match)',
                    event: createdEvent || undefined,
                };
            }

            // 11. Calculate Cycle Boundaries & Occurrence Count
            const { startDate: cycleStartDate, endDate: cycleEndDate } =
                EscalationProcessor.computeCycleBoundaries(rule.resetPeriod, eventTimestamp);

            const occurrenceCount = await EscalationProcessor.calculateOccurrenceCount(
                companyId,
                employeeId,
                category,
                cycleStartDate,
                cycleEndDate
            );

            // 12. Determine Escalation Level
            const escalationLevel = EscalationProcessor.determineEscalationLevel(
                occurrenceCount,
                rule
            );

            // 13. Calculate Due Date (Resolution Deadline)
            const deadlineHours = rule.resolutionDeadline || 48;
            const dueAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);

            // 14. Resolve Hierarchy & Target Recipients
            const hierarchy = await EscalationNotificationService.resolveHierarchy(
                companyId,
                employeeId,
                escalationLevel,
                rule
            );

            const assignedManager = hierarchy.reportingManagerIds[0] || hierarchy.companyAdminIds[0] || null;

            const notifiedUsersList = hierarchy.effectiveRecipients.map((uid) => ({
                userId: uid,
                role: hierarchy.companyAdminIds.some((aid) => aid.equals(uid))
                    ? 'COMPANY_ADMIN'
                    : hierarchy.reportingManagerIds.some((mid) => mid.equals(uid))
                        ? 'REPORTING_MANAGER'
                        : 'EMPLOYEE',
                notifiedAt: new Date(),
                level: escalationLevel,
            }));

            // 15. Create Escalation Case (with atomic idempotency protection)
            let escalationCase: IEscalationCaseDocument;
            try {
                escalationCase = await EscalationCase.create({
                    companyId: companyObjId,
                    employeeId: employeeObjId,
                    eventId: createdEvent._id,
                    ruleId: rule._id,
                    category,
                    escalationLevel,
                    occurrenceCount,
                    cycleStartDate,
                    cycleEndDate,
                    status: EscalationCaseStatus.PENDING,
                    assignedManager,
                    notifiedUsers: notifiedUsersList,
                    employeeExplanation: null,
                    supportingEvidence: [],
                    managerComments: [],
                    dueAt,
                });
            } catch (caseErr: any) {
                if (isDuplicateKeyError(caseErr)) {
                    console.log('[EscalationEngine] EscalationCase duplicate key resolved safely', JSON.stringify({
                        action: 'CASE_DUPLICATE_RACE_RESOLVED',
                        companyId,
                        eventId: createdEvent._id.toString(),
                    }));
                    const existingCase = await EscalationCase.findOne({
                        companyId: companyObjId,
                        eventId: createdEvent._id,
                    });
                    return {
                        processed: true,
                        caseCreated: false,
                        caseUpdated: false,
                        exempted: false,
                        reason: 'Case already existed for event',
                        event: createdEvent,
                        case: existingCase || undefined,
                    };
                }
                throw caseErr;
            }

            // 16. Dispatch Notifications (Only once for new cases)
            await EscalationNotificationService.notifyEscalation(
                escalationCase,
                createdEvent,
                hierarchy,
                true
            );

            // 17. Record Immutable Audit Record
            await EscalationAuditService.log({
                companyId,
                escalationCaseId: escalationCase._id,
                ruleId: rule._id,
                actorId: employeeId,
                action: EscalationAuditAction.CASE_CREATED,
                newValue: {
                    caseId: escalationCase._id,
                    level: escalationLevel,
                    occurrenceCount,
                    category,
                    assignedManager,
                    notifiedUsersCount: notifiedUsersList.length,
                },
                reason: `Automatic compliance escalation for ${category} (Occurrence #${occurrenceCount}, Level ${escalationLevel})`,
            });

            // 18. Structured Success Log
            console.log('[EscalationEngine] Event and Case created successfully', JSON.stringify({
                action: 'EVENT_CREATED',
                companyId,
                employeeId,
                category,
                sourceRecordId,
                idempotencyKey: resolvedIdempotencyKey,
                eventId: createdEvent._id.toString(),
                caseId: escalationCase._id.toString(),
                level: escalationLevel,
                occurrenceCount,
            }));

            return {
                processed: true,
                caseCreated: true,
                caseUpdated: false,
                exempted: false,
                event: createdEvent,
                case: escalationCase,
            };
        } catch (error: any) {
            if (isDuplicateKeyError(error)) {
                console.log('[EscalationEngine] Top-level duplicate key resolved gracefully', JSON.stringify({
                    action: 'EVENT_DUPLICATE_TOP_LEVEL_CAUGHT',
                    companyId: payload?.companyId,
                    idempotencyKey: payload?.idempotencyKey,
                    error: error.message,
                }));
                return {
                    processed: true,
                    caseCreated: false,
                    caseUpdated: false,
                    exempted: false,
                    reason: 'Duplicate event already processed (idempotency match)',
                };
            }

            console.error('[EscalationEngine] Event processing error:', JSON.stringify({
                action: 'EVENT_FAILED',
                companyId: payload?.companyId,
                employeeId: payload?.employeeId,
                category: payload?.category,
                sourceRecordId: payload?.sourceRecordId,
                error: error?.message || 'Internal escalation processing error',
            }));
            return {
                processed: false,
                caseCreated: false,
                caseUpdated: false,
                exempted: false,
                reason: error?.message || 'Internal escalation processing error',
            };
        }
    }
}
export default EscalationEngine;
