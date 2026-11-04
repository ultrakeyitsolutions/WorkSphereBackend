// ─── Escalation Constants ───────────────────────────────────────────────────

export enum EscalationCategory {
    LATE_CHECK_IN = 'LATE_CHECK_IN',
    BREAK_TIME_EXCEEDED = 'BREAK_TIME_EXCEEDED',
    IDLE_TIME_EXCEEDED = 'IDLE_TIME_EXCEEDED',
    REOPENED_TASK = 'REOPENED_TASK',
    WORK_INEFFICIENCY_DELAY = 'WORK_INEFFICIENCY_DELAY',
    PRODUCTION_HOURS_DISCREPANCY = 'PRODUCTION_HOURS_DISCREPANCY',
    BIOMETRIC_COMPLIANCE = 'BIOMETRIC_COMPLIANCE',
    CUSTOM_POLICY = 'CUSTOM_POLICY',
}

export enum EscalationSeverity {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL',
}

export enum EscalationCaseStatus {
    PENDING = 'pending',
    ACKNOWLEDGED = 'acknowledged',
    UNDER_REVIEW = 'under_review',
    AWAITING_EMPLOYEE = 'awaiting_employee',
    RESOLVED = 'resolved',
    DISMISSED = 'dismissed',
}

export enum EscalationResetPeriod {
    WEEKLY = 'weekly',
    MONTHLY = 'monthly',
    NEVER = 'never',
}

export enum EscalationSourceModule {
    ATTENDANCE = 'ATTENDANCE',
    MONITORING = 'MONITORING',
    TASKS = 'TASKS',
    PROJECTS = 'PROJECTS',
    BIOMETRIC = 'BIOMETRIC',
    CUSTOM = 'CUSTOM',
}

export enum EscalationAuditAction {
    CASE_CREATED = 'CASE_CREATED',
    CASE_ACKNOWLEDGED = 'CASE_ACKNOWLEDGED',
    CASE_ASSIGNED = 'CASE_ASSIGNED',
    CASE_UNDER_REVIEW = 'CASE_UNDER_REVIEW',
    CASE_AWAITING_EMPLOYEE = 'CASE_AWAITING_EMPLOYEE',
    EXPLANATION_SUBMITTED = 'EXPLANATION_SUBMITTED',
    EVIDENCE_UPLOADED = 'EVIDENCE_UPLOADED',
    MANAGER_COMMENT_ADDED = 'MANAGER_COMMENT_ADDED',
    CASE_RESOLVED = 'CASE_RESOLVED',
    CASE_DISMISSED = 'CASE_DISMISSED',
    CASE_OVERRIDDEN = 'CASE_OVERRIDDEN',
    RULE_CREATED = 'RULE_CREATED',
    RULE_UPDATED = 'RULE_UPDATED',
    RULE_STATUS_TOGGLED = 'RULE_STATUS_TOGGLED',
    CYCLE_RESET = 'CYCLE_RESET',
}

export enum VerificationStatus {
    VERIFIED = 'VERIFIED',
    UNVERIFIED = 'UNVERIFIED',
    EXEMPTED = 'EXEMPTED',
}

export const DEFAULT_ESCALATION_LEVELS = [
    { level: 1, name: 'Employee Notification', notifyRole: 'EMPLOYEE', deadlineHours: 24 },
    { level: 2, name: 'Reporting Manager Review', notifyRole: 'REPORTING_MANAGER', deadlineHours: 48 },
    { level: 3, name: 'Manager & Company Admin Escalation', notifyRole: 'MANAGER_AND_ADMIN', deadlineHours: 72 },
    { level: 4, name: 'Executive Leadership Escalation', notifyRole: 'COMPANY_ADMIN', deadlineHours: 96 },
];
