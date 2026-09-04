import { Router } from 'express';
import {
    // Modules
    listModules, createModule, updateModule, deleteModule,
    // Stages
    listStages, createStage, updateStage, deleteStage,
    // Statuses
    listStatuses, createStatus, updateStatus, deleteStatus,
    // Templates
    listTemplates, getTemplateById, createTemplate, updateTemplate, deleteTemplate
} from './task-meta.controller';
import { validateRequest } from '../../middleware/validateRequest';
import {
    paramProjectIdSchema,
    paramModuleIdSchema,
    createModuleSchema,
    updateModuleSchema,
    paramStageIdSchema,
    createStageSchema,
    updateStageSchema,
    paramStatusIdSchema,
    createStatusSchema,
    updateStatusSchema,
    paramTemplateIdSchema,
    createTaskTemplateSchema,
    updateTaskTemplateSchema
} from './task-meta.validator';

const router = Router();

// ══════════════════════════════════════════════
//  MODULES  — /api/v1/company/projects/:projectId/modules
// ══════════════════════════════════════════════

router.get('/projects/:projectId/modules', validateRequest(paramProjectIdSchema), listModules);
router.post('/projects/:projectId/modules', validateRequest(createModuleSchema), createModule);
router.put('/projects/:projectId/modules/:moduleId', validateRequest(updateModuleSchema), updateModule);
router.delete('/projects/:projectId/modules/:moduleId', validateRequest(paramModuleIdSchema), deleteModule);

// ══════════════════════════════════════════════
//  STAGES  — /api/v1/company/projects/:projectId/stages
// ══════════════════════════════════════════════

router.get('/projects/:projectId/stages', validateRequest(paramProjectIdSchema), listStages);
router.post('/projects/:projectId/stages', validateRequest(createStageSchema), createStage);
router.put('/projects/:projectId/stages/:stageId', validateRequest(updateStageSchema), updateStage);
router.delete('/projects/:projectId/stages/:stageId', validateRequest(paramStageIdSchema), deleteStage);

// ══════════════════════════════════════════════
//  STATUSES  — /api/v1/company/statuses
// ══════════════════════════════════════════════

router.get('/statuses', listStatuses);
router.post('/statuses', validateRequest(createStatusSchema), createStatus);
router.put('/statuses/:statusId', validateRequest(updateStatusSchema), updateStatus);
router.delete('/statuses/:statusId', validateRequest(paramStatusIdSchema), deleteStatus);

// ══════════════════════════════════════════════
//  TASK TEMPLATES  — /api/v1/company/task-templates
// ══════════════════════════════════════════════

router.get('/task-templates', listTemplates);
router.get('/task-templates/:templateId', validateRequest(paramTemplateIdSchema), getTemplateById);
router.post('/task-templates', validateRequest(createTaskTemplateSchema), createTemplate);
router.put('/task-templates/:templateId', validateRequest(updateTaskTemplateSchema), updateTemplate);
router.delete('/task-templates/:templateId', validateRequest(paramTemplateIdSchema), deleteTemplate);

export default router;
