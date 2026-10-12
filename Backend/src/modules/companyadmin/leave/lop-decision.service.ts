import mongoose, { Types } from 'mongoose';
import { LopDecision } from './lop-decision.model';
import { LeaveRequest } from '../../attendance/leave.model';
import { LeaveCalculatorService } from './leave-calculator.service';
import { LeaveEmailService } from './leave-email.service';
import { ApproveLopDecisionDto } from './leave-policy.types';
import { AppError } from '../../../utils/AppError';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';

export class LopDecisionService {
    /**
     * Creates or updates a proposed LOP decision for a leave request.
     */
    static async proposeLopDecision(
        companyId: string,
        employeeId: string,
        leaveRequestId: string,
        month: string,
        lopDays: number,
        dateStr: string
    ) {
        if (lopDays <= 0) return null;

        const cId = new Types.ObjectId(companyId);
        const eId = new Types.ObjectId(employeeId);
        const lId = new Types.ObjectId(leaveRequestId);

        const lopPolicy = await LeaveCalculatorService.resolveLopPolicy(companyId, dateStr, employeeId);
        const calculatedDeduction = await LeaveCalculatorService.calculateLopDeduction(
            companyId,
            employeeId,
            lopDays,
            dateStr
        );

        if (mongoose.connection.readyState !== 1) {
            return {
                _id: new Types.ObjectId(),
                companyId: cId,
                employeeId: eId,
                leaveRequestId: lId,
                month,
                lopDays,
                calculationMethod: lopPolicy.calculationMethod,
                baseSalaryUsed: lopPolicy.customSalary || null,
                divisorUsed: lopPolicy.fixedDivisor,
                currency: lopPolicy.currency,
                calculatedDeductionAmount: calculatedDeduction,
                finalDeductionAmount: calculatedDeduction,
                status: 'PROPOSED',
                isEstimated: true,
                auditTrail: [],
                save: async () => {},
            } as any;
        }

        let decision = await LopDecision.findOne({
            companyId: cId,
            leaveRequestId: lId,
            month,
        });

        if (!decision) {
            decision = await LopDecision.create({
                companyId: cId,
                employeeId: eId,
                leaveRequestId: lId,
                month,
                lopDays,
                calculationMethod: lopPolicy.calculationMethod,
                baseSalaryUsed: lopPolicy.customSalary || null,
                divisorUsed: lopPolicy.fixedDivisor,
                currency: lopPolicy.currency,
                calculatedDeductionAmount: calculatedDeduction,
                finalDeductionAmount: calculatedDeduction,
                status: 'PROPOSED',
                isEstimated: true,
                auditTrail: [
                    {
                        actorId: eId,
                        action: 'PROPOSED',
                        reason: `System calculated proposed LOP for ${lopDays} day(s)`,
                        newAmount: calculatedDeduction,
                        timestamp: new Date(),
                    },
                ],
            });
        } else {
            decision.lopDays = lopDays;
            decision.calculatedDeductionAmount = calculatedDeduction;
            if (decision.status === 'PROPOSED') {
                decision.finalDeductionAmount = calculatedDeduction;
            }
            await decision.save();
        }

        return decision;
    }

    /**
     * Get paginated LOP decisions for Company Admin.
     */
    static async getLopDecisions(
        companyId: string,
        query: {
            status?: string;
            month?: string;
            employeeId?: string;
            page?: number | string;
            limit?: number | string;
        }
    ) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
        };

        if (query.status) {
            filter.status = query.status;
        }
        if (query.month) {
            filter.month = query.month;
        }
        if (query.employeeId) {
            filter.employeeId = new Types.ObjectId(query.employeeId);
        }

        const [decisions, total] = await Promise.all([
            LopDecision.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('employeeId', 'name email avatar')
                .populate('approvedBy', 'name email')
                .populate('leaveRequestId', 'startDate endDate leaveType totalDays status')
                .lean(),
            LopDecision.countDocuments(filter),
        ]);

        return {
            decisions,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get employee's own approved/finalized LOP decisions (Self-service).
     */
    static async getMyLopDecisions(
        companyId: string,
        employeeId: string,
        query: { month?: string; year?: string }
    ) {
        const filter: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
            employeeId: new Types.ObjectId(employeeId),
        };

        if (query.month) {
            filter.month = query.month;
        } else if (query.year) {
            filter.month = { $regex: new RegExp(`^${query.year}-`) };
        }

        const decisions = await LopDecision.find(filter)
            .sort({ month: -1, createdAt: -1 })
            .populate('approvedBy', 'name email')
            .populate('leaveRequestId', 'startDate endDate leaveType totalDays')
            .lean();

        return decisions;
    }

    /**
     * Approve or finalize a proposed LOP decision.
     * Allows admin to optionally adjust final deduction amount with a reason.
     */
    static async approveLopDecision(
        companyId: string,
        decisionId: string,
        actorId: string,
        dto?: ApproveLopDecisionDto
    ) {
        const decision = await LopDecision.findOne({
            _id: new Types.ObjectId(decisionId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!decision) {
            throw AppError.notFound('LOP decision not found.');
        }

        const prevAmount = decision.finalDeductionAmount;
        let adjusted = false;

        if (dto?.finalDeductionAmount != null && dto.finalDeductionAmount >= 0) {
            if (dto.finalDeductionAmount !== prevAmount) {
                adjusted = true;
                decision.finalDeductionAmount = dto.finalDeductionAmount;
                decision.adminOverrideReason = dto.overrideReason?.trim() || 'Admin manual deduction adjustment';
            }
        }

        decision.status = 'APPROVED';
        decision.approvedBy = new Types.ObjectId(actorId);
        decision.approvedAt = new Date();

        decision.auditTrail.push({
            actorId: new Types.ObjectId(actorId),
            action: adjusted ? 'ADJUSTED' : 'APPROVED',
            reason: decision.adminOverrideReason || 'LOP deduction decision finalized and approved',
            previousAmount: prevAmount,
            newAmount: decision.finalDeductionAmount,
            timestamp: new Date(),
        });

        await decision.save();

        // Audit Log
        AuditLogService.log({
            action: AuditAction.COMPANY_SETTINGS_UPDATED,
            actorId,
            targetUserId: decision.employeeId.toString(),
            companyId,
            metadata: {
                lopDecisionId: decision._id.toString(),
                month: decision.month,
                lopDays: decision.lopDays,
                finalDeductionAmount: decision.finalDeductionAmount,
            },
            description: `Finalized LOP decision for employee for ${decision.month} (${decision.lopDays} days, ${decision.currency} ${decision.finalDeductionAmount})`,
        });

        // Trigger LOP decision email asynchronously
        setImmediate(async () => {
            await LeaveEmailService.sendLopDecisionEmail(decision._id.toString());
        });

        return decision;
    }

    /**
     * Reject a proposed LOP decision.
     */
    static async rejectLopDecision(
        companyId: string,
        decisionId: string,
        actorId: string,
        reason?: string
    ) {
        const decision = await LopDecision.findOne({
            _id: new Types.ObjectId(decisionId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!decision) {
            throw AppError.notFound('LOP decision not found.');
        }

        decision.status = 'REJECTED';
        decision.rejectionReason = reason?.trim() || 'LOP decision declined by administrator.';
        decision.approvedBy = new Types.ObjectId(actorId);
        decision.approvedAt = new Date();

        decision.auditTrail.push({
            actorId: new Types.ObjectId(actorId),
            action: 'REJECTED',
            reason: decision.rejectionReason,
            timestamp: new Date(),
        });

        await decision.save();

        return decision;
    }
}
export default LopDecisionService;
