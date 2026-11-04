import { Response } from 'express';
import { ManagerRequest } from '../middleware/manager-access.middleware';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { ManagerInspectionService } from '../services/manager-inspection.service';

export const getEmployees = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerInspectionService.getAccessibleEmployees(scope, {
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        search: req.query.search as string,
    });
    return sendSuccess(res, 'Accessible employees retrieved successfully', result);
});

export const getEmployeeById = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { employeeId } = req.params;
    const result = await ManagerInspectionService.getEmployeeDetails(scope, employeeId as string);
    return sendSuccess(res, 'Employee details retrieved successfully', result);
});

export const getEmployeeTasks = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { employeeId } = req.params;
    const result = await ManagerInspectionService.getEmployeeTasks(scope, employeeId as string);
    return sendSuccess(res, 'Employee tasks retrieved successfully', result);
});

export const getEmployeeAttendance = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { employeeId } = req.params;
    const result = await ManagerInspectionService.getEmployeeAttendance(scope, employeeId as string, {
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
    });
    return sendSuccess(res, 'Employee attendance history retrieved successfully', result);
});

export const getEmployeeTimesheets = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { employeeId } = req.params;
    const result = await ManagerInspectionService.getEmployeeTimesheets(scope, employeeId as string, {
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
    });
    return sendSuccess(res, 'Employee timesheets retrieved successfully', result);
});

export const getEmployeePerformance = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { employeeId } = req.params;
    const result = await ManagerInspectionService.getEmployeePerformance(scope, employeeId as string);
    return sendSuccess(res, 'Employee performance metrics retrieved successfully', result);
});

export const getEmployeeEscalations = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { employeeId } = req.params;
    const result = await ManagerInspectionService.getEmployeeEscalations(scope, employeeId as string);
    return sendSuccess(res, 'Employee escalations retrieved successfully', result);
});
