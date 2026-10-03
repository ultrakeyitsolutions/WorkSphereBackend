import { Router } from 'express';
import { SprintController } from './sprint.controller';
import { validateRequest } from '../../middleware/validateRequest';
import {
    createSprintSchema,
    updateSprintSchema,
    listSprintSchema,
    sprintParamSchema,
    sprintTasksQuerySchema,
} from './sprint.validator';

const router = Router({ mergeParams: true });

// GET /api/projects/:projectId/sprints
router.get('/', validateRequest(listSprintSchema), SprintController.getSprints);

// POST /api/projects/:projectId/sprints
router.post('/', validateRequest(createSprintSchema), SprintController.createSprint);

// GET /api/projects/:projectId/sprints/:sprintId/summary
router.get('/:sprintId/summary', validateRequest(sprintParamSchema), SprintController.getSprintSummary);

// GET /api/projects/:projectId/sprints/:sprintId/tasks
router.get('/:sprintId/tasks', validateRequest(sprintTasksQuerySchema), SprintController.getSprintTasks);

// POST /api/projects/:projectId/sprints/:sprintId/start
router.post('/:sprintId/start', validateRequest(sprintParamSchema), SprintController.startSprint);

// POST /api/projects/:projectId/sprints/:sprintId/complete
router.post('/:sprintId/complete', validateRequest(sprintParamSchema), SprintController.completeSprint);

// GET /api/projects/:projectId/sprints/:sprintId
router.get('/:sprintId', validateRequest(sprintParamSchema), SprintController.getSprintById);

// PATCH /api/projects/:projectId/sprints/:sprintId
router.patch('/:sprintId', validateRequest(updateSprintSchema), SprintController.updateSprint);

// DELETE /api/projects/:projectId/sprints/:sprintId
router.delete('/:sprintId', validateRequest(sprintParamSchema), SprintController.deleteSprint);

export default router;
