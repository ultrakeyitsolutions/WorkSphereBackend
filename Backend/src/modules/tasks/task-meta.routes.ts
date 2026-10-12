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
import { getProjectMembers } from './task.controller';
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

import { requireFeature } from '../../middleware/entitlement.middleware';

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
router.post('/projects/:projectId/stages', requireFeature('TASK_WORKFLOWS'), validateRequest(createStageSchema), createStage);
router.put('/projects/:projectId/stages/:stageId', requireFeature('TASK_WORKFLOWS'), validateRequest(updateStageSchema), updateStage);
router.delete('/projects/:projectId/stages/:stageId', requireFeature('TASK_WORKFLOWS'), validateRequest(paramStageIdSchema), deleteStage);

// ══════════════════════════════════════════════
//  STATUSES  — /api/v1/company/statuses
// ══════════════════════════════════════════════

router.get('/statuses', listStatuses);
router.post('/statuses', requireFeature('TASK_WORKFLOWS'), validateRequest(createStatusSchema), createStatus);
router.put('/statuses/:statusId', requireFeature('TASK_WORKFLOWS'), validateRequest(updateStatusSchema), updateStatus);
router.delete('/statuses/:statusId', requireFeature('TASK_WORKFLOWS'), validateRequest(paramStatusIdSchema), deleteStatus);

// ══════════════════════════════════════════════
//  TASK TEMPLATES  — /api/v1/company/task-templates
// ══════════════════════════════════════════════

router.get('/task-templates', requireFeature('TASK_TEMPLATES'), listTemplates);
router.get('/task-templates/:templateId', requireFeature('TASK_TEMPLATES'), validateRequest(paramTemplateIdSchema), getTemplateById);
router.post('/task-templates', requireFeature('TASK_TEMPLATES'), validateRequest(createTaskTemplateSchema), createTemplate);
router.put('/task-templates/:templateId', requireFeature('TASK_TEMPLATES'), validateRequest(updateTaskTemplateSchema), updateTemplate);
router.delete('/task-templates/:templateId', requireFeature('TASK_TEMPLATES'), validateRequest(paramTemplateIdSchema), deleteTemplate);

// ══════════════════════════════════════════════
//  PROJECT MEMBERS  — /api/v1/company/projects/:projectId/members
// (Used by the reopen task flow to list assignable members)
// ══════════════════════════════════════════════

router.get('/projects/:projectId/members', validateRequest(paramProjectIdSchema), getProjectMembers);

export default router;
