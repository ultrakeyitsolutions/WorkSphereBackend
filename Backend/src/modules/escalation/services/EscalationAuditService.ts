import { Types } from 'mongoose';
import { EscalationAudit } from '../models/EscalationAudit';
import { EscalationAuditAction } from '../constants/escalation.constants';

export interface LogAuditInput {
    companyId: string | Types.ObjectId;
    escalationCaseId?: string | Types.ObjectId | null;
    ruleId?: string | Types.ObjectId | null;
    actorId?: string | Types.ObjectId | null;
    action: EscalationAuditAction;
    previousValue?: any;
    newValue?: any;
    reason?: string | null;
    metadata?: Record<string, any>;
}

export class EscalationAuditService {
    /**
     * Persist an immutable audit record for an escalation action.
     * Fails gracefully without bubbling errors to the caller.
     */
    public static async log(input: LogAuditInput): Promise<void> {
        try {
            await EscalationAudit.create({
                companyId: new Types.ObjectId(input.companyId.toString()),
                escalationCaseId: input.escalationCaseId ? new Types.ObjectId(input.escalationCaseId.toString()) : null,
                ruleId: input.ruleId ? new Types.ObjectId(input.ruleId.toString()) : null,
                actorId: input.actorId ? new Types.ObjectId(input.actorId.toString()) : null,
                action: input.action,
                previousValue: input.previousValue ?? null,
                newValue: input.newValue ?? null,
                reason: input.reason ?? null,
                timestamp: new Date(),
                metadata: input.metadata ?? {},
            });
        } catch (error) {
            console.error('[EscalationAuditService] Failed to write audit record:', error);
        }
    }

    /**
     * Retrieve audit history for a specific escalation case.
     */
    public static async getHistoryForCase(companyId: string, caseId: string) {
        return EscalationAudit.find({
            companyId: new Types.ObjectId(companyId),
            escalationCaseId: new Types.ObjectId(caseId),
        })
            .populate('actorId', 'name email role avatar')
            .sort({ timestamp: -1 })
            .lean();
    }
}
export default EscalationAuditService;
