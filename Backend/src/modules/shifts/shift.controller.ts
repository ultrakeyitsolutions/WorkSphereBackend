import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { ShiftService } from './shift.service';
import { EmployeeShiftAssignmentService } from './employee-shift-assignment.service';
import { sendSuccess } from '../../utils/response';

export class ShiftController {
    // ─── Shift CRUD ───────────────────────────────────────────────────────────

    static async createShift(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;

            const shift = await ShiftService.createShift(companyId, userId, req.body);
            return sendSuccess(res, 'Shift created successfully', shift, 201);
        } catch (error) {
            next(error);
        }
    }

    static async getShifts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const result = await ShiftService.getShifts(companyId, req.query as any);
            return sendSuccess(res, 'Shifts retrieved successfully', result, 200);
        } catch (error) {
            next(error);
        }
    }

    static async getShiftById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const shiftId = req.params.shiftId as string;

            const shift = await ShiftService.getShiftById(companyId, shiftId);
            return sendSuccess(res, 'Shift retrieved successfully', shift);
        } catch (error) {
            next(error);
        }
    }

    static async updateShift(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const shiftId = req.params.shiftId as string;

            const updated = await ShiftService.updateShift(companyId, shiftId, userId, req.body);
            return sendSuccess(res, 'Shift updated successfully', updated);
        } catch (error) {
            next(error);
        }
    }

    static async deactivateShift(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const shiftId = req.params.shiftId as string;

            const deactivated = await ShiftService.deactivateShift(companyId, shiftId, userId);
            return sendSuccess(res, 'Shift deactivated successfully', deactivated);
        } catch (error) {
            next(error);
        }
    }

    // ─── Shift Assignments ───────────────────────────────────────────────────

    static async assignShift(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;

            const assignment = await EmployeeShiftAssignmentService.assignShift(
                companyId,
                userId,
                req.body
            );
            return sendSuccess(res, 'Shift assigned to employee successfully', assignment, 201);
        } catch (error) {
            next(error);
        }
    }

    static async bulkAssignShift(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;

            const result = await EmployeeShiftAssignmentService.bulkAssignShift(
                companyId,
                userId,
                req.body
            );
            return sendSuccess(res, `Shift bulk assigned to ${result.assignedCount} employees successfully`, result, 200);
        } catch (error) {
            next(error);
        }
    }

    static async getShiftAssignments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const result = await EmployeeShiftAssignmentService.getShiftAssignments(companyId, req.query as any);
            return sendSuccess(res, 'Shift assignments retrieved successfully', result, 200);
        } catch (error) {
            next(error);
        }
    }

    static async getEmployeeShift(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const employeeId = req.params.employeeId as string;
            const targetDate = req.query.date ? new Date(req.query.date as string) : new Date();

            const shift = await EmployeeShiftAssignmentService.resolveEmployeeShift(
                companyId,
                employeeId,
                targetDate
            );
            return sendSuccess(res, 'Employee current shift resolved successfully', shift);
        } catch (error) {
            next(error);
        }
    }

    static async getEmployeeShiftHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const employeeId = req.params.employeeId as string;

            const history = await EmployeeShiftAssignmentService.getEmployeeShiftHistory(
                companyId,
                employeeId
            );
            return sendSuccess(res, 'Employee shift history retrieved successfully', history);
        } catch (error) {
            next(error);
        }
    }

    static async endAssignment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const assignmentId = req.params.assignmentId as string;
            const reason = req.body.reason as string | undefined;

            const assignment = await EmployeeShiftAssignmentService.endAssignment(
                companyId,
                assignmentId,
                userId,
                reason
            );
            return sendSuccess(res, 'Shift assignment ended successfully', assignment);
        } catch (error) {
            next(error);
        }
    }
}
