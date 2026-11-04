import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { EscalationCase } from '../models/EscalationCase';
import { EscalationEvent } from '../models/EscalationEvent';
import { EscalationAuditService } from '../services/EscalationAuditService';
import { EscalationNotificationService } from '../services/EscalationNotificationService';
import {
    EscalationCaseStatus,
    EscalationAuditAction,
} from '../constants/escalation.constants';
import { sendSuccess, sendError } from '../../../utils/response';
import { ProjectTeamMember, ProjectInCharge, Project } from '../../companyadmin/projects/project.model';
import CompanyMember from '../../companyadmin/invitations/company-member.model';

export class EscalationController {
    /**
     * Helper to resolve team employee IDs for a Manager user
     */
    private static async getManagerSubordinateIds(companyId: string, managerUserId: string): Promise<string[]> {
        const managerObjId = new Types.ObjectId(managerUserId);
        const companyObjId = new Types.ObjectId(companyId);

        const subordinateIdsSet = new Set<string>();

        // 1. Projects where this user is the projectManagerId
        const managedProjects = await Project.find({
            companyId: companyObjId,
            projectManagerId: managerObjId,
        }).select('_id').lean();

        // 2. Projects where this user is an In-Charge
        const inChargeEntries = await ProjectInCharge.find({
            userId: managerObjId,
        }).select('projectId').lean();

        const allProjectIds = [
            ...managedProjects.map((p) => p._id),
            ...inChargeEntries.map((ic) => ic.projectId),
        ];

        if (allProjectIds.length > 0) {
            const teamMembers = await ProjectTeamMember.find({
                projectId: { $in: allProjectIds },
            }).select('userId').lean();

            for (const tm of teamMembers) {
                if (tm.userId && tm.userId.toString() !== managerUserId) {
                    subordinateIdsSet.add(tm.userId.toString());
                }
            }
        }

        return Array.from(subordinateIdsSet);
    }

    /**
     * GET /api/escalations/cases
     * List escalation cases (scoped to company, with manager team isolation).
     */
    public static async listCases(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            if (!companyId) return sendError(res, 'Company context required', 400);

            const {
                page = 1,
                limit = 20,
                category,
                status,
                employeeId,
                assignedManager,
                severity,
                level,
                startDate,
                endDate,
                search,
                sortBy = 'createdAt',
                sortOrder = 'desc',
            } = req.query as any;

            const query: any = { companyId: new Types.ObjectId(companyId) };

            // Manager Role Scope Enforcement: if user is not SUPER_ADMIN or COMPANY_ADMIN, restrict to their subordinates or assigned cases
            const role = req.currentUser?.role;
            const isFullAdmin = role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN' || role === 'Admin';

            if (!isFullAdmin && req.currentUser) {
                const subordinateIds = await EscalationController.getManagerSubordinateIds(
                    companyId,
                    req.currentUser.userId
                );
                query.$or = [
                    { assignedManager: new Types.ObjectId(req.currentUser.userId) },
                    { employeeId: { $in: subordinateIds.map((id) => new Types.ObjectId(id)) } },
                ];
            }

            if (category) query.category = category;
            if (status) query.status = status;
            if (employeeId) query.employeeId = new Types.ObjectId(employeeId);
            if (assignedManager) query.assignedManager = new Types.ObjectId(assignedManager);
            if (level) query.escalationLevel = Number(level);

            if (startDate || endDate) {
                query.createdAt = {};
                if (startDate) query.createdAt.$gte = new Date(`${startDate}T00:00:00.000Z`);
                if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
            }

            const pageNum = Math.max(1, Number(page));
            const limitNum = Math.min(100, Math.max(1, Number(limit)));
            const skip = (pageNum - 1) * limitNum;

            const sortOptions: any = {};
            sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

            const [cases, total] = await Promise.all([
                EscalationCase.find(query)
                    .populate('employeeId', 'name email avatar')
                    .populate('assignedManager', 'name email avatar')
                    .populate('resolvedBy', 'name email')
                    .populate('eventId')
                    .sort(sortOptions)
                    .skip(skip)
                    .limit(limitNum)
                    .lean(),
                EscalationCase.countDocuments(query),
            ]);

            return sendSuccess(res, 'Escalation cases retrieved', {
                cases,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum),
                },
            });
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to list escalation cases', 500);
        }
    }

    /**
     * GET /api/escalations/cases/:id
     * Retrieve single escalation case with event details and audit history.
     */
    public static async getCaseById(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { id } = req.params as { id: string };

            const escalationCase = await EscalationCase.findOne({
                _id: new Types.ObjectId(id),
                companyId: new Types.ObjectId(companyId),
            })
                .populate('employeeId', 'name email avatar phoneNumber')
                .populate('assignedManager', 'name email avatar')
                .populate('resolvedBy', 'name email')
                .populate('eventId')
                .populate('ruleId')
                .lean();

            if (!escalationCase) {
                return sendError(res, 'Escalation case not found', 404);
            }

            // Manager access check
            const role = req.currentUser?.role;
            const isFullAdmin = role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN' || role === 'Admin';
            if (!isFullAdmin && req.currentUser) {
                const subordinateIds = await EscalationController.getManagerSubordinateIds(
                    companyId!,
                    req.currentUser.userId
                );
                const isAssigned = escalationCase.assignedManager?._id?.toString() === req.currentUser.userId;
                const isSubordinate = subordinateIds.includes(escalationCase.employeeId?._id?.toString());
                const isSelf = escalationCase.employeeId?._id?.toString() === req.currentUser.userId;

                if (!isAssigned && !isSubordinate && !isSelf) {
                    return sendError(res, 'Access denied: Case is outside your authorized scope', 403);
                }
            }

            const auditHistory = await EscalationAuditService.getHistoryForCase(companyId!, id);

            return sendSuccess(res, 'Case details retrieved', {
                case: escalationCase,
                auditHistory,
            });
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve escalation case', 500);
        }
    }

    /**
     * POST /api/escalations/cases/:id/acknowledge
     */
    public static async acknowledgeCase(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { id } = req.params as { id: string };
            const { comment } = req.body;

            const escalationCase = await EscalationCase.findOne({
                _id: new Types.ObjectId(id),
                companyId: new Types.ObjectId(companyId),
            });

            if (!escalationCase) return sendError(res, 'Case not found', 404);

            const previousStatus = escalationCase.status;
            escalationCase.status = EscalationCaseStatus.ACKNOWLEDGED;

            if (comment) {
                escalationCase.managerComments.push({
                    managerId: new Types.ObjectId(req.currentUser!.userId),
                    comment,
                    createdAt: new Date(),
                });
            }

            await escalationCase.save();

            await EscalationAuditService.log({
                companyId: companyId!,
                escalationCaseId: escalationCase._id,
                actorId: req.currentUser!.userId,
                action: EscalationAuditAction.CASE_ACKNOWLEDGED,
                previousValue: { status: previousStatus },
                newValue: { status: escalationCase.status, comment },
                reason: comment || 'Acknowledged by reviewer',
            });

            return sendSuccess(res, 'Escalation case acknowledged', escalationCase);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to acknowledge case', 500);
        }
    }

    /**
     * POST /api/escalations/cases/:id/assign
     */
    public static async assignCase(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { id } = req.params as { id: string };
            const { managerId, comment } = req.body;

            const escalationCase = await EscalationCase.findOne({
                _id: new Types.ObjectId(id),
                companyId: new Types.ObjectId(companyId),
            });

            if (!escalationCase) return sendError(res, 'Case not found', 404);

            const previousManager = escalationCase.assignedManager;
            escalationCase.assignedManager = new Types.ObjectId(managerId);

            if (comment) {
                escalationCase.managerComments.push({
                    managerId: new Types.ObjectId(req.currentUser!.userId),
                    comment,
                    createdAt: new Date(),
                });
            }

            await escalationCase.save();

            await EscalationAuditService.log({
                companyId: companyId!,
                escalationCaseId: escalationCase._id,
                actorId: req.currentUser!.userId,
                action: EscalationAuditAction.CASE_ASSIGNED,
                previousValue: { assignedManager: previousManager },
                newValue: { assignedManager: escalationCase.assignedManager },
                reason: comment || 'Case reassigned by administrator',
            });

            return sendSuccess(res, 'Case reassigned successfully', escalationCase);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to assign case', 500);
        }
    }

    /**
     * POST /api/escalations/cases/:id/resolve
     */
    public static async resolveCase(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { id } = req.params as { id: string };
            const { resolutionReason, comment } = req.body;

            const escalationCase = await EscalationCase.findOne({
                _id: new Types.ObjectId(id),
                companyId: new Types.ObjectId(companyId),
            });

            if (!escalationCase) return sendError(res, 'Case not found', 404);

            const previousStatus = escalationCase.status;
            escalationCase.status = EscalationCaseStatus.RESOLVED;
            escalationCase.resolutionReason = resolutionReason;
            escalationCase.resolvedBy = new Types.ObjectId(req.currentUser!.userId);
            escalationCase.resolvedAt = new Date();

            if (comment) {
                escalationCase.managerComments.push({
                    managerId: new Types.ObjectId(req.currentUser!.userId),
                    comment,
                    createdAt: new Date(),
                });
            }

            await escalationCase.save();

            await EscalationAuditService.log({
                companyId: companyId!,
                escalationCaseId: escalationCase._id,
                actorId: req.currentUser!.userId,
                action: EscalationAuditAction.CASE_RESOLVED,
                previousValue: { status: previousStatus },
                newValue: { status: escalationCase.status, resolutionReason },
                reason: resolutionReason,
            });

            return sendSuccess(res, 'Escalation case marked as resolved', escalationCase);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to resolve case', 500);
        }
    }

    /**
     * POST /api/escalations/cases/:id/dismiss
     */
    public static async dismissCase(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { id } = req.params as { id: string };
            const { dismissalReason, comment } = req.body;

            const escalationCase = await EscalationCase.findOne({
                _id: new Types.ObjectId(id),
                companyId: new Types.ObjectId(companyId),
            });

            if (!escalationCase) return sendError(res, 'Case not found', 404);

            const previousStatus = escalationCase.status;
            escalationCase.status = EscalationCaseStatus.DISMISSED;
            escalationCase.resolutionReason = dismissalReason;
            escalationCase.resolvedBy = new Types.ObjectId(req.currentUser!.userId);
            escalationCase.resolvedAt = new Date();

            if (comment) {
                escalationCase.managerComments.push({
                    managerId: new Types.ObjectId(req.currentUser!.userId),
                    comment,
                    createdAt: new Date(),
                });
            }

            await escalationCase.save();

            await EscalationAuditService.log({
                companyId: companyId!,
                escalationCaseId: escalationCase._id,
                actorId: req.currentUser!.userId,
                action: EscalationAuditAction.CASE_DISMISSED,
                previousValue: { status: previousStatus },
                newValue: { status: escalationCase.status, dismissalReason },
                reason: dismissalReason,
            });

            return sendSuccess(res, 'Escalation case dismissed', escalationCase);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to dismiss case', 500);
        }
    }

    /**
     * POST /api/escalations/cases/:id/override
     * Admin override of level, status, or deadline.
     */
    public static async overrideCase(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { id } = req.params as { id: string };
            const { escalationLevel, status, assignedManager, dueAt, reason } = req.body;

            const escalationCase = await EscalationCase.findOne({
                _id: new Types.ObjectId(id),
                companyId: new Types.ObjectId(companyId),
            });

            if (!escalationCase) return sendError(res, 'Case not found', 404);

            const previousState = escalationCase.toObject();

            if (escalationLevel) escalationCase.escalationLevel = escalationLevel;
            if (status) escalationCase.status = status;
            if (assignedManager !== undefined) {
                escalationCase.assignedManager = assignedManager ? new Types.ObjectId(assignedManager) : null;
            }
            if (dueAt) escalationCase.dueAt = new Date(dueAt);

            await escalationCase.save();

            await EscalationAuditService.log({
                companyId: companyId!,
                escalationCaseId: escalationCase._id,
                actorId: req.currentUser!.userId,
                action: EscalationAuditAction.CASE_OVERRIDDEN,
                previousValue: previousState,
                newValue: escalationCase.toObject(),
                reason,
            });

            return sendSuccess(res, 'Case overridden successfully', escalationCase);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to override case', 500);
        }
    }

    // ─── Employee Facing APIs ──────────────────────────────────────────────────

    /**
     * GET /api/escalations/my-escalations
     * Allows authenticated employee to view only their own escalation cases.
     */
    public static async getMyEscalations(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const userId = req.currentUser?.userId;

            if (!companyId || !userId) return sendError(res, 'Authentication required', 401);

            const { page = 1, limit = 20, status, category } = req.query as any;

            const query: any = {
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(userId),
            };

            if (status) query.status = status;
            if (category) query.category = category;

            const pageNum = Math.max(1, Number(page));
            const limitNum = Math.min(50, Math.max(1, Number(limit)));
            const skip = (pageNum - 1) * limitNum;

            const [cases, total] = await Promise.all([
                EscalationCase.find(query)
                    .populate('eventId')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limitNum)
                    .lean(),
                EscalationCase.countDocuments(query),
            ]);

            return sendSuccess(res, 'My escalations retrieved', {
                cases,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum),
                },
            });
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve my escalations', 500);
        }
    }

    /**
     * GET /api/escalations/my-escalations/:id
     */
    public static async getMyEscalationById(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const userId = req.currentUser?.userId;
            const { id } = req.params as { id: string };

            const escalationCase = await EscalationCase.findOne({
                _id: new Types.ObjectId(id),
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(userId),
            })
                .populate('eventId')
                .populate('assignedManager', 'name email avatar')
                .lean();

            if (!escalationCase) {
                return sendError(res, 'Escalation case not found or unauthorized', 404);
            }

            return sendSuccess(res, 'Escalation details retrieved', escalationCase);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve escalation details', 500);
        }
    }

    /**
     * POST /api/escalations/my-escalations/:id/explanation
     * Submit employee explanation.
     */
    public static async submitExplanation(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const userId = req.currentUser?.userId;
            const { id } = req.params as { id: string };
            const { explanation } = req.body;

            const escalationCase = await EscalationCase.findOne({
                _id: new Types.ObjectId(id),
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(userId),
            });

            if (!escalationCase) {
                return sendError(res, 'Escalation case not found', 404);
            }

            escalationCase.employeeExplanation = {
                text: explanation,
                submittedAt: new Date(),
            };

            // Progress status to under_review once explanation submitted
            if (
                escalationCase.status === EscalationCaseStatus.PENDING ||
                escalationCase.status === EscalationCaseStatus.AWAITING_EMPLOYEE
            ) {
                escalationCase.status = EscalationCaseStatus.UNDER_REVIEW;
            }

            await escalationCase.save();

            await EscalationAuditService.log({
                companyId: companyId!,
                escalationCaseId: escalationCase._id,
                actorId: userId,
                action: EscalationAuditAction.EXPLANATION_SUBMITTED,
                newValue: { explanation },
                reason: 'Employee submitted compliance explanation',
            });

            return sendSuccess(res, 'Explanation submitted successfully', escalationCase);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to submit explanation', 500);
        }
    }

    /**
     * POST /api/escalations/my-escalations/:id/evidence
     * Attach supporting document/evidence.
     */
    public static async uploadEvidence(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const userId = req.currentUser?.userId;
            const { id } = req.params as { id: string };
            const file = req.file;

            if (!file) {
                return sendError(res, 'No evidence file provided', 400);
            }

            const escalationCase = await EscalationCase.findOne({
                _id: new Types.ObjectId(id),
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(userId),
            });

            if (!escalationCase) {
                return sendError(res, 'Escalation case not found', 404);
            }

            // Create base64 or memory-safe mock url if cloud storage not configured for test
            const evidenceEntry = {
                fileUrl: `/api/escalations/cases/${id}/evidence/${encodeURIComponent(file.originalname)}`,
                fileName: file.originalname,
                fileType: file.mimetype,
                fileSize: file.size,
                uploadedAt: new Date(),
            };

            escalationCase.supportingEvidence.push(evidenceEntry);
            await escalationCase.save();

            await EscalationAuditService.log({
                companyId: companyId!,
                escalationCaseId: escalationCase._id,
                actorId: userId,
                action: EscalationAuditAction.EVIDENCE_UPLOADED,
                newValue: evidenceEntry,
                reason: `Uploaded evidence file: ${file.originalname}`,
            });

            return sendSuccess(res, 'Evidence uploaded successfully', evidenceEntry);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to upload evidence', 500);
        }
    }
}
export default EscalationController;
