import { Router } from 'express';
import { validateRequest } from '../../middleware/validateRequest';
import {
    createTaskSchema,
    updateTaskSchema,
    updateRecurrenceSchema,
    taskParamSchema,
    reopenTaskSchema,
    cancelTaskSchema,
    archivedTaskListSchema
} from './task.validator';
import {
    createTask,
    getTaskById,
    updateTask,
    deleteTask,
    getTaskRecurrence,
    updateTaskRecurrence,
    deleteTaskRecurrence,
    reopenTask,
    cancelTask,
    getArchivedTasks,
    archiveTask,
    unarchiveTask
} from './task.controller';
import taskActivityRoutes from '../task-activities/task-activity.routes';
import taskBugRoutes from '../task-bugs/task-bug.routes';
import taskAttachmentRoutes from '../task-attachments/task-attachment.routes';

const router = Router();

// Nested routes for task activities, bugs, and attachments
router.use('/:taskId/activities', taskActivityRoutes);
router.use('/:taskId/bugs', taskBugRoutes);
router.use('/:taskId/attachments', taskAttachmentRoutes);

// GET /api/v1/company/tasks/archived (and /api/v1/member/tasks/archived)
// NOTE: MUST be declared BEFORE /:taskId route to prevent route collision
router.get('/archived', validateRequest(archivedTaskListSchema), getArchivedTasks);

// POST /api/v1/company/tasks
router.post('/', validateRequest(createTaskSchema), createTask);

// GET /api/v1/company/tasks/:taskId
router.get('/:taskId', validateRequest(taskParamSchema), getTaskById);

// PUT /api/v1/company/tasks/:taskId
router.put('/:taskId', validateRequest(updateTaskSchema), updateTask);

// DELETE /api/v1/company/tasks/:taskId
router.delete('/:taskId', validateRequest(taskParamSchema), deleteTask);

// PATCH /api/v1/company/tasks/:taskId/archive
router.patch('/:taskId/archive', validateRequest(taskParamSchema), archiveTask);
router.post('/:taskId/archive', validateRequest(taskParamSchema), archiveTask);

// PATCH /api/v1/company/tasks/:taskId/unarchive
router.patch('/:taskId/unarchive', validateRequest(taskParamSchema), unarchiveTask);
router.post('/:taskId/unarchive', validateRequest(taskParamSchema), unarchiveTask);

// GET /api/v1/company/tasks/:taskId/recurrence
router.get('/:taskId/recurrence', validateRequest(taskParamSchema), getTaskRecurrence);

// PUT /api/v1/company/tasks/:taskId/recurrence
router.put('/:taskId/recurrence', validateRequest(updateRecurrenceSchema), updateTaskRecurrence);

// DELETE /api/v1/company/tasks/:taskId/recurrence
router.delete('/:taskId/recurrence', validateRequest(taskParamSchema), deleteTaskRecurrence);

// POST /api/v1/company/tasks/:taskId/cancel
router.post('/:taskId/cancel', validateRequest(cancelTaskSchema), cancelTask);

// POST /api/v1/company/tasks/:taskId/reopen
// Only available for tasks in Completed or Cancelled state
router.post('/:taskId/reopen', validateRequest(reopenTaskSchema), reopenTask);

export default router;
