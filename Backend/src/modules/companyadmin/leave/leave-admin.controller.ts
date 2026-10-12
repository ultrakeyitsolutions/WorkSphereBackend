import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { LeavePolicyService } from './leave-policy.service';
import { LopDecisionService } from './lop-decision.service';
import { LeaveBalanceService } from './leave-balance.service';
import { LeaveService } from '../../attendance/leave.service';
import { LeaveRequest } from '../../attendance/leave.model';
import { LopDecision } from './lop-decision.model';
import { CompanyLeavePolicy } from './leave-policy.model';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { LeaveType, LeaveDurationType, HalfDayPeriod, LeaveStatus } from '../../attendance/attendance.types';

export class LeaveAdminController {
    // ─── Leave Policies ────────────────────────────────────────────────────────

    static async getPolicies(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            if (!companyId) return sendError(res, 'Company context required', 400);

            const policies = await LeavePolicyService.getCompanyLeavePolicies(companyId);
            return sendSuccess(res, 'Leave policies retrieved successfully', { policies }, 200);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to retrieve leave policies', 500);
        }
    }

    static async upsertPolicy(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            if (!companyId) return sendError(res, 'Company context required', 400);

            const policy = await LeavePolicyService.upsertLeavePolicy(companyId, req.body, userId);
            return sendSuccess(res, 'Leave policy saved successfully', { policy }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to save leave policy', 500);
        }
    }

    static async setEmployeeOverride(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            const policyId = String(req.params.policyId);
            if (!companyId) return sendError(res, 'Company context required', 400);

            const policy = await LeavePolicyService.setEmployeePolicyOverride(
                companyId,
                policyId,
                req.body,
                userId
            );
            return sendSuccess(res, 'Employee leave override saved successfully', { policy }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to save override', 500);
        }
    }

    static async removeEmployeeOverride(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            const policyId = String(req.params.policyId);
            const employeeId = String(req.params.employeeId);
            if (!companyId) return sendError(res, 'Company context required', 400);

            const policy = await LeavePolicyService.removeEmployeePolicyOverride(
                companyId,
                policyId,
                employeeId,
                userId
            );
            return sendSuccess(res, 'Employee leave override removed successfully', { policy }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to remove override', 500);
        }
    }

    // ─── LOP Policies ──────────────────────────────────────────────────────────

    static async getLopPolicy(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            if (!companyId) return sendError(res, 'Company context required', 400);

            const policy = await LeavePolicyService.getOrCreateLopPolicy(companyId);
            return sendSuccess(res, 'LOP policy retrieved successfully', { policy }, 200);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to retrieve LOP policy', 500);
        }
    }

    static async updateLopPolicy(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            if (!companyId) return sendError(res, 'Company context required', 400);

            const policy = await LeavePolicyService.updateLopPolicy(companyId, req.body, userId);
            return sendSuccess(res, 'LOP policy updated successfully', { policy }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to update LOP policy', 500);
        }
    }

    static async setEmployeeLopOverride(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            if (!companyId) return sendError(res, 'Company context required', 400);

            const policy = await LeavePolicyService.setEmployeeLopOverride(companyId, req.body, userId);
            return sendSuccess(res, 'Employee LOP override saved successfully', { policy }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to save LOP override', 500);
        }
    }

    static async removeEmployeeLopOverride(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            const employeeId = String(req.params.employeeId);
            if (!companyId) return sendError(res, 'Company context required', 400);

            const policy = await LeavePolicyService.removeEmployeeLopOverride(companyId, employeeId, userId);
            return sendSuccess(res, 'Employee LOP override removed successfully', { policy }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to remove LOP override', 500);
        }
    }

    // ─── Admin Dashboard Summary ───────────────────────────────────────────────

    static async getAdminDashboardSummary(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            if (!companyId) return sendError(res, 'Company context required', 400);

            const currentMonth = req.query.month
                ? String(req.query.month)
                : new Date().toISOString().slice(0, 7);

            const cId = new Types.ObjectId(companyId);

            const [
                policies,
                pendingLeavesCount,
                excessLeavesCount,
                lopProposedCount,
                lopApprovedList,
                monthLeaves,
            ] = await Promise.all([
                CompanyLeavePolicy.find({ companyId: cId, isActive: true }).lean(),
                LeaveRequest.countDocuments({ companyId: cId, status: LeaveStatus.PENDING }),
                LeaveRequest.countDocuments({ companyId: cId, status: LeaveStatus.PENDING, excessDays: { $gt: 0 } }),
                LopDecision.countDocuments({ companyId: cId, status: 'PROPOSED', month: currentMonth }),
                LopDecision.find({ companyId: cId, status: 'APPROVED', month: currentMonth }).select('finalDeductionAmount lopDays').lean(),
                LeaveRequest.find({
                    companyId: cId,
                    status: LeaveStatus.APPROVED,
                    $or: [
                        { startDate: { $regex: new RegExp(`^${currentMonth}`) } },
                        { 'monthBreakdown.month': currentMonth },
                    ],
                }).select('paidDays unpaidDays lopDays totalDays').lean(),
            ]);

            let totalApprovedPaidDays = 0;
            let totalApprovedUnpaidDays = 0;
            let totalApprovedLopDays = 0;

            for (const l of monthLeaves) {
                totalApprovedPaidDays += l.paidDays || 0;
                totalApprovedUnpaidDays += l.unpaidDays || 0;
                totalApprovedLopDays += l.lopDays || 0;
            }

            let finalizedDeductionTotal = 0;
            for (const d of lopApprovedList) {
                finalizedDeductionTotal += d.finalDeductionAmount || 0;
            }

            return sendSuccess(
                res,
                'Leave management dashboard summary retrieved',
                {
                    month: currentMonth,
                    policies,
                    summary: {
                        pendingRequests: pendingLeavesCount,
                        excessRequests: excessLeavesCount,
                        lopAwaitingReview: lopProposedCount,
                        approvedLopDecisionsCount: lopApprovedList.length,
                        totalApprovedPaidDays,
                        totalApprovedUnpaidDays,
                        totalApprovedLopDays,
                        finalizedDeductionsAmount: finalizedDeductionTotal,
                    },
                },
                200
            );
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to retrieve leave dashboard summary', 500);
        }
    }

    // ─── LOP Decisions Management ──────────────────────────────────────────────

    static async getLopDecisions(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            if (!companyId) return sendError(res, 'Company context required', 400);

            const result = await LopDecisionService.getLopDecisions(companyId, req.query);
            return sendSuccess(res, 'LOP decisions retrieved successfully', result, 200);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to retrieve LOP decisions', 500);
        }
    }

    static async getSingleLopDecision(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const id = String(req.params.id);
            if (!companyId) return sendError(res, 'Company context required', 400);

            const decision = await LopDecision.findOne({
                _id: new Types.ObjectId(id),
                companyId: new Types.ObjectId(companyId),
            })
                .populate('employeeId', 'name email avatar')
                .populate('approvedBy', 'name email')
                .populate('leaveRequestId')
                .lean();

            if (!decision) return sendError(res, 'LOP decision not found', 404);

            return sendSuccess(res, 'LOP decision details retrieved', { decision }, 200);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to retrieve LOP decision', 500);
        }
    }

    static async approveLopDecision(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            const id = String(req.params.id);
            if (!companyId || !userId) return sendError(res, 'Unauthorized', 401);

            const decision = await LopDecisionService.approveLopDecision(
                companyId,
                id,
                userId,
                req.body
            );
            return sendSuccess(res, 'LOP decision approved and finalized successfully', { decision }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to approve LOP decision', 500);
        }
    }

    static async rejectLopDecision(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            const id = String(req.params.id);
            if (!companyId || !userId) return sendError(res, 'Unauthorized', 401);

            const decision = await LopDecisionService.rejectLopDecision(
                companyId,
                id,
                userId,
                req.body.reason
            );
            return sendSuccess(res, 'LOP decision rejected', { decision }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to reject LOP decision', 500);
        }
    }

    // ─── Leave Actions & Previews ──────────────────────────────────────────────

    static async previewLeave(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            if (!companyId || !userId) return sendError(res, 'Unauthorized', 401);

            const preview = await LeaveService.previewLeave(companyId, userId, {
                leaveType: req.query.leaveType as LeaveType,
                durationType: req.query.durationType as LeaveDurationType,
                halfDayPeriod: req.query.halfDayPeriod as HalfDayPeriod,
                startDate: String(req.query.startDate),
                endDate: String(req.query.endDate),
                employeeId: req.query.employeeId ? String(req.query.employeeId) : undefined,
            });

            return sendSuccess(res, 'Leave calculation preview generated', preview, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to generate preview', 500);
        }
    }

    static async approveLeaveWithBreakdown(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            const id = String(req.params.id);
            if (!companyId || !userId) return sendError(res, 'Unauthorized', 401);

            const leave = await LeaveService.approveLeave(companyId, id, userId, req.body);
            return sendSuccess(res, 'Leave approved and balances updated successfully', { leave }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to approve leave', 500);
        }
    }

    static async requestRevision(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            const id = String(req.params.id);
            if (!companyId || !userId) return sendError(res, 'Unauthorized', 401);

            const leave = await LeaveService.requestRevision(companyId, id, userId, req.body);
            return sendSuccess(res, 'Revision requested from employee successfully', { leave }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to request revision', 500);
        }
    }

    static async cancelLeave(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            const id = String(req.params.id);
            if (!companyId || !userId) return sendError(res, 'Unauthorized', 401);

            const leave = await LeaveService.cancelLeave(companyId, id, userId, req.body.reason);
            return sendSuccess(res, 'Leave request cancelled successfully', { leave }, 200);
        } catch (err: any) {
            if (err instanceof AppError) return sendError(res, err.message, err.statusCode);
            return sendError(res, err.message || 'Failed to cancel leave', 500);
        }
    }

    static async getMyBalances(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            if (!companyId || !userId) return sendError(res, 'Unauthorized', 401);

            const balances = await LeaveBalanceService.getEmployeeMonthlyBalances(companyId, userId, {
                month: req.query.month ? String(req.query.month) : undefined,
                year: req.query.year ? String(req.query.year) : undefined,
            });

            return sendSuccess(res, 'Monthly leave balances retrieved', { balances }, 200);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to retrieve leave balances', 500);
        }
    }

    static async getEmployeeBalances(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const employeeId = String(req.params.employeeId);
            if (!companyId) return sendError(res, 'Company context required', 400);

            const balances = await LeaveBalanceService.getEmployeeMonthlyBalances(companyId, employeeId, {
                month: req.query.month ? String(req.query.month) : undefined,
                year: req.query.year ? String(req.query.year) : undefined,
            });

            return sendSuccess(res, 'Employee monthly leave balances retrieved', { balances }, 200);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to retrieve employee balances', 500);
        }
    }

    static async getMyLopDecisions(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            if (!companyId || !userId) return sendError(res, 'Unauthorized', 401);

            const decisions = await LopDecisionService.getMyLopDecisions(companyId, userId, {
                month: req.query.month ? String(req.query.month) : undefined,
                year: req.query.year ? String(req.query.year) : undefined,
            });

            return sendSuccess(res, 'My LOP decisions retrieved', { decisions }, 200);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to retrieve my LOP decisions', 500);
        }
    }
}
export default LeaveAdminController;
