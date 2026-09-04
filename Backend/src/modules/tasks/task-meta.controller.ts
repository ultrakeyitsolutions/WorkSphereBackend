import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { ModuleService } from './module.service';
import { StageService } from './stage.service';
import { StatusService } from './status.service';
import { TaskTemplateService } from './task-template.service';

// ─── Error map helper ─────────────────────────────────────────────────────────
const handleError = (res: Response, error: any) => {
    const map: Record<string, [number, string]> = {
        PROJECT_NOT_FOUND: [404, 'Project not found'],
        MODULE_NOT_FOUND: [404, 'Module not found'],
        STAGE_NOT_FOUND: [404, 'Stage not found'],
        STATUS_NOT_FOUND: [404, 'Status not found'],
        TEMPLATE_NOT_FOUND: [404, 'Template not found'],
        MODULE_ALREADY_EXISTS: [409, 'A module with this name already exists'],
        STAGE_ALREADY_EXISTS: [409, 'A stage with this name already exists'],
        STATUS_ALREADY_EXISTS: [409, 'A status with this name already exists'],
        TEMPLATE_ALREADY_EXISTS: [409, 'A template with this name already exists'],
        CANNOT_DELETE_MASTER_STAGE: [400, 'Cannot delete a system-defined master stage'],
        CANNOT_DELETE_MASTER_STATUS: [400, 'Cannot delete a system-defined master status'],
    };
    const [code, message] = map[error.message] ?? [500, 'Internal server error'];
    return res.status(code).json({ success: false, message });
};

// ══════════════════════════════════════════════
//  MODULE CONTROLLERS
// ══════════════════════════════════════════════

export const listModules = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const projectId = req.params.projectId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await ModuleService.listModules(projectId, companyId);
        return res.status(200).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const createModule = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const userId = req.user?.userId as string;
        const projectId = req.params.projectId as string;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await ModuleService.createModule(projectId, req.body, companyId, userId);
        return res.status(201).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const updateModule = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const moduleId = req.params.moduleId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await ModuleService.updateModule(moduleId, req.body, companyId);
        return res.status(200).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const deleteModule = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const moduleId = req.params.moduleId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await ModuleService.deleteModule(moduleId, companyId);
        return res.status(200).json({ success: true, message: 'Module deleted successfully' });
    } catch (e: any) { return handleError(res, e); }
};

// ══════════════════════════════════════════════
//  STAGE CONTROLLERS
// ══════════════════════════════════════════════

export const listStages = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const projectId = req.params.projectId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await StageService.listStages(projectId, companyId);
        return res.status(200).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const createStage = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const userId = req.user?.userId as string;
        const projectId = req.params.projectId as string;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await StageService.createStage(projectId, req.body, companyId, userId);
        return res.status(201).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const updateStage = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const stageId = req.params.stageId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await StageService.updateStage(stageId, req.body, companyId);
        return res.status(200).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const deleteStage = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const stageId = req.params.stageId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await StageService.deleteStage(stageId, companyId);
        return res.status(200).json({ success: true, message: 'Stage deleted successfully' });
    } catch (e: any) { return handleError(res, e); }
};

// ══════════════════════════════════════════════
//  STATUS CONTROLLERS
// ══════════════════════════════════════════════

export const listStatuses = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await StatusService.listStatuses(companyId);
        return res.status(200).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const createStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const userId = req.user?.userId as string;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await StatusService.createStatus(req.body, companyId, userId);
        return res.status(201).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const updateStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const statusId = req.params.statusId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await StatusService.updateStatus(statusId, req.body, companyId);
        return res.status(200).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const deleteStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const statusId = req.params.statusId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await StatusService.deleteStatus(statusId, companyId);
        return res.status(200).json({ success: true, message: 'Status deleted successfully' });
    } catch (e: any) { return handleError(res, e); }
};

// ══════════════════════════════════════════════
//  TASK TEMPLATE CONTROLLERS
// ══════════════════════════════════════════════

export const listTemplates = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await TaskTemplateService.listTemplates(companyId);
        return res.status(200).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const getTemplateById = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const templateId = req.params.templateId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await TaskTemplateService.getTemplateById(templateId, companyId);
        return res.status(200).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const createTemplate = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const userId = req.user?.userId as string;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await TaskTemplateService.createTemplate(req.body, companyId, userId);
        return res.status(201).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const updateTemplate = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const templateId = req.params.templateId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const data = await TaskTemplateService.updateTemplate(templateId, req.body, companyId);
        return res.status(200).json({ success: true, data });
    } catch (e: any) { return handleError(res, e); }
};

export const deleteTemplate = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId as string;
        const templateId = req.params.templateId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await TaskTemplateService.deleteTemplate(templateId, companyId);
        return res.status(200).json({ success: true, message: 'Template deleted successfully' });
    } catch (e: any) { return handleError(res, e); }
};
