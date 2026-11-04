import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { EscalationCase } from '../models/EscalationCase';
import { EscalationEvent } from '../models/EscalationEvent';
import {
    EscalationCaseStatus,
    EscalationCategory,
} from '../constants/escalation.constants';
import { sendSuccess, sendError } from '../../../utils/response';
import { EscalationController } from './escalation.controller';

export class EscalationReportController {
    /**
     * GET /api/escalations/dashboard
     * Aggregated compliance metrics, level distribution, categories, and trends.
     */
    public static async getDashboard(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            if (!companyId) return sendError(res, 'Company context required', 400);

            const companyObjId = new Types.ObjectId(companyId);
            const { startDate, endDate } = req.query as any;

            const dateMatch: any = {};
            if (startDate) dateMatch.$gte = new Date(`${startDate}T00:00:00.000Z`);
            if (endDate) dateMatch.$lte = new Date(`${endDate}T23:59:59.999Z`);

            const matchStage: any = { companyId: companyObjId };
            if (Object.keys(dateMatch).length > 0) {
                matchStage.createdAt = dateMatch;
            }

            // Status counts aggregation
            const statusAggregation = await EscalationCase.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                    },
                },
            ]);

            const statusCounts: Record<string, number> = {
                pending: 0,
                acknowledged: 0,
                under_review: 0,
                awaiting_employee: 0,
                resolved: 0,
                dismissed: 0,
            };
            let totalCases = 0;
            for (const item of statusAggregation) {
                statusCounts[item._id] = item.count;
                totalCases += item.count;
            }

            // Total violations & unique employees from EscalationEvent
            const eventAggregation = await EscalationEvent.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: null,
                        totalViolations: { $sum: 1 },
                        uniqueEmployees: { $addToSet: '$employeeId' },
                    },
                },
            ]);

            const totalViolations = eventAggregation[0]?.totalViolations || 0;
            const uniqueEmployeesCount = eventAggregation[0]?.uniqueEmployees?.length || 0;

            // Escalation Level Distribution
            const levelAggregation = await EscalationCase.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$escalationLevel',
                        count: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]);

            const levelDistribution = levelAggregation.map((l) => ({
                level: l._id,
                count: l.count,
            }));

            // Category Breakdown
            const categoryAggregation = await EscalationCase.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$category',
                        count: { $sum: 1 },
                        resolvedCount: {
                            $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] },
                        },
                    },
                },
                { $sort: { count: -1 } },
            ]);

            const categoryBreakdown = categoryAggregation.map((c) => ({
                category: c._id,
                count: c.count,
                resolvedCount: c.resolvedCount,
            }));

            // Average Resolution Time (in hours)
            const resolutionTimeAgg = await EscalationCase.aggregate([
                {
                    $match: {
                        ...matchStage,
                        status: EscalationCaseStatus.RESOLVED,
                        resolvedAt: { $ne: null },
                    },
                },
                {
                    $project: {
                        durationHours: {
                            $divide: [
                                { $subtract: ['$resolvedAt', '$createdAt'] },
                                1000 * 60 * 60,
                            ],
                        },
                    },
                },
                {
                    $group: {
                        _id: null,
                        avgDurationHours: { $avg: '$durationHours' },
                    },
                },
            ]);

            const avgResolutionTimeHours = Math.round((resolutionTimeAgg[0]?.avgDurationHours || 0) * 10) / 10;

            // Repeat Violation Employees (employees with >= 2 cases)
            const repeatEmployeesAgg = await EscalationCase.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$employeeId',
                        caseCount: { $sum: 1 },
                        categories: { $addToSet: '$category' },
                        latestCase: { $max: '$createdAt' },
                    },
                },
                { $match: { caseCount: { $gte: 2 } } },
                { $sort: { caseCount: -1 } },
                { $limit: 10 },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user',
                    },
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        employeeId: '$_id',
                        name: '$user.name',
                        email: '$user.email',
                        caseCount: 1,
                        categories: 1,
                        latestCase: 1,
                    },
                },
            ]);

            return sendSuccess(res, 'Escalation dashboard metrics retrieved', {
                summary: {
                    totalViolations,
                    uniqueEmployeesAffected: uniqueEmployeesCount,
                    totalCases,
                    pendingEscalations: statusCounts.pending,
                    acknowledgedCases: statusCounts.acknowledged,
                    casesUnderReview: statusCounts.under_review,
                    awaitingEmployee: statusCounts.awaiting_employee,
                    resolvedCases: statusCounts.resolved,
                    dismissedCases: statusCounts.dismissed,
                    avgResolutionTimeHours,
                },
                levelDistribution,
                categoryBreakdown,
                repeatViolationEmployees: repeatEmployeesAgg,
            });
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to aggregate dashboard metrics', 500);
        }
    }

    /**
     * GET /api/escalations/reports
     * Overview report across all categories and departments.
     */
    public static async getReports(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const companyObjId = new Types.ObjectId(companyId);
            const { startDate, endDate } = req.query as any;

            const matchStage: any = { companyId: companyObjId };
            if (startDate || endDate) {
                matchStage.createdAt = {};
                if (startDate) matchStage.createdAt.$gte = new Date(`${startDate}T00:00:00.000Z`);
                if (endDate) matchStage.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
            }

            const report = await EscalationCase.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$category',
                        total: { $sum: 1 },
                        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                        underReview: { $sum: { $cond: [{ $eq: ['$status', 'under_review'] }, 1, 0] } },
                        resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
                        dismissed: { $sum: { $cond: [{ $eq: ['$status', 'dismissed'] }, 1, 0] } },
                        level1: { $sum: { $cond: [{ $eq: ['$escalationLevel', 1] }, 1, 0] } },
                        level2: { $sum: { $cond: [{ $eq: ['$escalationLevel', 2] }, 1, 0] } },
                        level3: { $sum: { $cond: [{ $eq: ['$escalationLevel', 3] }, 1, 0] } },
                        level4Plus: { $sum: { $cond: [{ $gte: ['$escalationLevel', 4] }, 1, 0] } },
                    },
                },
                { $sort: { total: -1 } },
            ]);

            return sendSuccess(res, 'Escalation reports retrieved', report);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve reports', 500);
        }
    }

    /**
     * GET /api/escalations/reports/:category
     */
    public static async getCategoryReport(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { category } = req.params;

            const cases = await EscalationCase.find({
                companyId: new Types.ObjectId(companyId),
                category,
            })
                .populate('employeeId', 'name email avatar')
                .populate('assignedManager', 'name email')
                .sort({ createdAt: -1 })
                .limit(100)
                .lean();

            return sendSuccess(res, `Report for category ${category}`, cases);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get category report', 500);
        }
    }

    /**
     * GET /api/escalations/employees/:employeeId
     */
    public static async getEmployeeHistory(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { employeeId } = req.params;

            const [cases, events] = await Promise.all([
                EscalationCase.find({
                    companyId: new Types.ObjectId(companyId),
                    employeeId: new Types.ObjectId(employeeId),
                })
                    .populate('assignedManager', 'name email')
                    .sort({ createdAt: -1 })
                    .lean(),
                EscalationEvent.find({
                    companyId: new Types.ObjectId(companyId),
                    employeeId: new Types.ObjectId(employeeId),
                })
                    .sort({ eventTimestamp: -1 })
                    .limit(50)
                    .lean(),
            ]);

            return sendSuccess(res, 'Employee escalation history retrieved', {
                cases,
                events,
            });
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get employee history', 500);
        }
    }

    /**
     * GET /api/escalations/history
     */
    public static async getHistory(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { page = 1, limit = 20 } = req.query as any;

            const pageNum = Math.max(1, Number(page));
            const limitNum = Math.min(100, Math.max(1, Number(limit)));
            const skip = (pageNum - 1) * limitNum;

            const [events, total] = await Promise.all([
                EscalationEvent.find({ companyId: new Types.ObjectId(companyId) })
                    .populate('employeeId', 'name email avatar')
                    .sort({ eventTimestamp: -1 })
                    .skip(skip)
                    .limit(limitNum)
                    .lean(),
                EscalationEvent.countDocuments({ companyId: new Types.ObjectId(companyId) }),
            ]);

            return sendSuccess(res, 'Escalation events history retrieved', {
                events,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum),
                },
            });
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get history', 500);
        }
    }

    /**
     * GET /api/escalations/export
     * Export compliance records to CSV format.
     */
    public static async exportReport(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { category, status, startDate, endDate } = req.query as any;

            const query: any = { companyId: new Types.ObjectId(companyId) };
            if (category) query.category = category;
            if (status) query.status = status;
            if (startDate || endDate) {
                query.createdAt = {};
                if (startDate) query.createdAt.$gte = new Date(`${startDate}T00:00:00.000Z`);
                if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
            }

            const cases = await EscalationCase.find(query)
                .populate('employeeId', 'name email')
                .populate('assignedManager', 'name email')
                .populate('eventId')
                .sort({ createdAt: -1 })
                .limit(2000)
                .lean();

            // Generate clean CSV output
            const headers = [
                'Case ID',
                'Employee Name',
                'Employee Email',
                'Category',
                'Escalation Level',
                'Occurrence Count',
                'Status',
                'Assigned Manager',
                'Resolution Deadline',
                'Resolution Reason',
                'Created Date',
            ];

            const rows = cases.map((c: any) => [
                c._id.toString(),
                `"${(c.employeeId?.name || '').replace(/"/g, '""')}"`,
                `"${(c.employeeId?.email || '').replace(/"/g, '""')}"`,
                c.category,
                c.escalationLevel,
                c.occurrenceCount,
                c.status,
                `"${(c.assignedManager?.name || 'Unassigned').replace(/"/g, '""')}"`,
                c.dueAt ? new Date(c.dueAt).toISOString() : '',
                `"${(c.resolutionReason || '').replace(/"/g, '""')}"`,
                c.createdAt ? new Date(c.createdAt).toISOString() : '',
            ]);

            const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=escalation_report_${new Date().toISOString().split('T')[0]}.csv`
            );
            return res.status(200).send(csvContent);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to export report', 500);
        }
    }
}
export default EscalationReportController;
