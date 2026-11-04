import { Response } from 'express';
import { ManagerRequest } from '../middleware/manager-access.middleware';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { ManagerReportService } from '../services/manager-report.service';

export const getTeamPerformanceReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerReportService.getTeamPerformanceReport(scope, req.query as any);
    return res.status(200).json(result);
});

export const getEmployeePerformanceReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerReportService.getEmployeePerformanceReport(scope, req.query as any);
    return res.status(200).json(result);
});

export const getProjectPerformanceReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerReportService.getProjectPerformanceReport(scope, req.query as any);
    return res.status(200).json(result);
});

export const getTaskManagementReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerReportService.getTaskManagementReport(scope, req.query as any);
    return res.status(200).json(result);
});

export const getAttendanceTimesheetReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerReportService.getAttendanceTimesheetReport(scope, req.query as any);
    return res.status(200).json(result);
});

export const getWorkloadDistributionReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerReportService.getWorkloadDistributionReport(scope, req.query as any);
    return res.status(200).json(result);
});

export const getEscalationReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerReportService.getEscalationReport(scope, req.query as any);
    return res.status(200).json(result);
});

export const getTeamActivityReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerReportService.getTeamActivityReport(scope, req.query as any);
    return res.status(200).json(result);
});

export const getDeadlineDeliveryReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerReportService.getDeadlineDeliveryReport(scope, req.query as any);
    return res.status(200).json(result);
});

export const getManagementSummaryReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerReportService.getManagementSummaryReport(scope, req.query as any);
    return res.status(200).json(result);
});

export const exportReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const reportType = (req.query.reportType as string) || 'TEAM_PERFORMANCE';
    const result = await ManagerReportService.exportReport(scope, reportType, req.query as any);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.status(200).send(result.content);
});
