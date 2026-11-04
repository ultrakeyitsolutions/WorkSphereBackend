import { Document, Types } from 'mongoose';
import {
    EscalationCategory,
    EscalationSeverity,
    EscalationCaseStatus,
    EscalationResetPeriod,
    EscalationSourceModule,
    EscalationAuditAction,
    VerificationStatus,
} from '../constants/escalation.constants';

// ─── Escalation Rule ─────────────────────────────────────────────────────────

export interface IEscalationLevelConfig {
    level: number;
    name: string;
    notifyRole: string; // 'EMPLOYEE' | 'REPORTING_MANAGER' | 'MANAGER_AND_ADMIN' | 'COMPANY_ADMIN'
    notifyUserIds?: Types.ObjectId[];
    deadlineHours?: number;
}

export interface IEscalationRule {
    companyId: Types.ObjectId;
    ruleName: string;
    category: EscalationCategory;
    description?: string;
    isEnabled: boolean;
    severity: EscalationSeverity;
    gracePeriod: number; // in minutes (e.g. 15 for late check-in)
    thresholds: {
        maxViolationDuration?: number; // minutes
        occurrenceThreshold?: number; // occurrences before escalating to next level
        idleThresholdMinutes?: number;
        breakDurationLimitMinutes?: number;
        reopenCountThreshold?: number;
        projectDelayDays?: number;
        consecutiveDaysThreshold?: number;
        customMetricThreshold?: number;
    };
    escalationLevels: IEscalationLevelConfig[];
    resetPeriod: EscalationResetPeriod;
    notificationRecipients: Types.ObjectId[];
    applicableDepartments: Types.ObjectId[]; // Designation/Department ObjectIds
    applicableEmployees: Types.ObjectId[];   // Specific User ObjectIds (empty = all)
    applicableShifts: Types.ObjectId[];      // Shift ObjectIds (empty = all)
    resolutionDeadline: number;              // in hours
    createdBy?: Types.ObjectId;
    updatedBy?: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IEscalationRuleDocument extends IEscalationRule, Document {}

// ─── Escalation Event ────────────────────────────────────────────────────────

export interface IEscalationEvent {
    companyId: Types.ObjectId;
    employeeId: Types.ObjectId;
    category: EscalationCategory;
    sourceModule: EscalationSourceModule;
    sourceRecordId: string; // e.g. AttendanceId, TaskId, etc.
    ruleId?: Types.ObjectId;
    eventDate: string; // YYYY-MM-DD
    eventTimestamp: Date;
    expectedValue: string;
    actualValue: string;
    violationDuration: number; // in minutes or units
    metadata: Record<string, any>;
    verificationStatus: VerificationStatus;
    idempotencyKey?: string;
    createdAt?: Date;
}

export interface IEscalationEventDocument extends IEscalationEvent, Document {}

// ─── Escalation Case ─────────────────────────────────────────────────────────

export interface INotifiedUserEntry {
    userId: Types.ObjectId;
    role: string;
    notifiedAt: Date;
    level: number;
}

export interface IEmployeeExplanation {
    text: string;
    submittedAt: Date;
}

export interface ISupportingEvidence {
    fileUrl: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    uploadedAt: Date;
}

export interface IManagerComment {
    managerId: Types.ObjectId;
    comment: string;
    createdAt: Date;
}

export interface IEscalationCase {
    companyId: Types.ObjectId;
    employeeId: Types.ObjectId;
    eventId: Types.ObjectId;
    ruleId?: Types.ObjectId;
    category: EscalationCategory;
    escalationLevel: number;
    occurrenceCount: number;
    cycleStartDate: Date;
    cycleEndDate?: Date;
    status: EscalationCaseStatus;
    assignedManager?: Types.ObjectId | null;
    notifiedUsers: INotifiedUserEntry[];
    employeeExplanation?: IEmployeeExplanation | null;
    supportingEvidence: ISupportingEvidence[];
    managerComments: IManagerComment[];
    resolutionReason?: string | null;
    resolvedBy?: Types.ObjectId | null;
    resolvedAt?: Date | null;
    dueAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IEscalationCaseDocument extends IEscalationCase, Document {}

// ─── Escalation Audit ────────────────────────────────────────────────────────

export interface IEscalationAudit {
    companyId: Types.ObjectId;
    escalationCaseId?: Types.ObjectId | null;
    ruleId?: Types.ObjectId | null;
    actorId?: Types.ObjectId | null;
    action: EscalationAuditAction;
    previousValue?: any;
    newValue?: any;
    reason?: string | null;
    timestamp: Date;
    metadata?: Record<string, any>;
}

export interface IEscalationAuditDocument extends IEscalationAudit, Document {}

// ─── Standardized Inbound Event Payload ───────────────────────────────────────

export interface StandardEscalationEventPayload {
    companyId: string;
    employeeId: string;
    category: EscalationCategory;
    sourceModule: EscalationSourceModule;
    sourceRecordId: string;
    eventTimestamp?: Date | string;
    eventDate?: string;
    expectedValue?: string;
    actualValue?: string;
    violationDuration?: number;
    metadata?: Record<string, any>;
    idempotencyKey?: string;
}
