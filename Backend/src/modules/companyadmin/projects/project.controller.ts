import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { ProjectService } from './project.service';
import { CreateProjectBody, UpdateProjectBody } from './project.validator';

// ─── Shared actor context helper ──────────────────────────────────────────────

function getActor(req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    const companyId = req.user?.companyId;
    const email = req.user?.email ?? '';
    const role = req.user?.role ?? '';
    if (!userId || !companyId) throw AppError.unauthorized('Unauthorized: Missing user context');
    return { userId, companyId, email, role };
}

function getProjectId(req: AuthenticatedRequest): string {
    const id = (req.params as Record<string, string>)['projectId'] ?? '';
    if (!id) throw AppError.unprocessable('projectId is required');
    return id;
}

// ─── POST /api/v1/company/projects ───────────────────────────────────────────

export const createProject = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, companyId, email, role } = getActor(req);
    const project = await ProjectService.createProject(
        req.body as CreateProjectBody,
        userId, companyId, email, role
    );
    return sendSuccess(res, 'Project created successfully', project, 201);
});

// ─── GET /api/v1/company/projects ────────────────────────────────────────────

export const listProjects = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const qs = (val: unknown): string | undefined =>
        typeof val === 'string' ? val : Array.isArray(val) ? val[0] : undefined;

    const result = await ProjectService.listProjects(companyId, {
        page: req.query.page ? parseInt(qs(req.query.page) ?? '1', 10) : undefined,
        limit: req.query.limit ? parseInt(qs(req.query.limit) ?? '20', 10) : undefined,
        status: qs(req.query.status),
        priority: qs(req.query.priority),
        search: qs(req.query.search),
    });
    return sendSuccess(res, 'Projects fetched successfully', result);
});

// ─── GET /api/v1/company/projects/:projectId ─────────────────────────────────

export const getProjectById = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const project = await ProjectService.getProjectById(getProjectId(req), companyId);
    return sendSuccess(res, 'Project fetched successfully', project);
});

// ─── PATCH /api/v1/company/projects/:projectId ───────────────────────────────

export const updateProject = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, companyId, email, role } = getActor(req);
    const result = await ProjectService.updateProject(
        getProjectId(req), companyId,
        req.body as UpdateProjectBody,
        userId, email, role
    );
    return sendSuccess(res, result.message, { id: result.id });
});

// ─── PATCH /api/v1/company/projects/:projectId/archive ───────────────────────

export const archiveProject = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, companyId, email, role } = getActor(req);
    const result = await ProjectService.archiveProject(getProjectId(req), companyId, userId, email, role);
    return sendSuccess(res, result.message, { id: result.id });
});

// ─── PATCH /api/v1/company/projects/:projectId/unarchive ─────────────────────

export const unarchiveProject = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, companyId, email, role } = getActor(req);
    const result = await ProjectService.unarchiveProject(getProjectId(req), companyId, userId, email, role);
    return sendSuccess(res, result.message, { id: result.id });
});

// ─── DELETE /api/v1/company/projects/:projectId ──────────────────────────────

export const permanentDeleteProject = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, companyId, email, role } = getActor(req);
    const result = await ProjectService.permanentDeleteProject(getProjectId(req), companyId, userId, email, role);
    return sendSuccess(res, result.message, null, 200);
});

// ─── PATCH /api/v1/company/projects/:projectId/pin ───────────────────────────

export const pinProject = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, companyId, email, role } = getActor(req);
    const result = await ProjectService.pinProject(getProjectId(req), companyId, userId, email, role);
    return sendSuccess(res, result.message, { id: result.id });
});

// ─── PATCH /api/v1/company/projects/:projectId/unpin ─────────────────────────

export const unpinProject = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, companyId, email, role } = getActor(req);
    const result = await ProjectService.unpinProject(getProjectId(req), companyId, userId, email, role);
    return sendSuccess(res, result.message, { id: result.id });
});

// ─── PATCH /api/v1/company/projects/:projectId/activate ──────────────────────

export const activateProject = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, companyId, email, role } = getActor(req);
    const result = await ProjectService.activateProject(getProjectId(req), companyId, userId, email, role);
    return sendSuccess(res, result.message, { id: result.id });
});

// ─── PATCH /api/v1/company/projects/:projectId/deactivate ────────────────────

export const deactivateProject = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, companyId, email, role } = getActor(req);
    const result = await ProjectService.deactivateProject(getProjectId(req), companyId, userId, email, role);
    return sendSuccess(res, result.message, { id: result.id });
});
