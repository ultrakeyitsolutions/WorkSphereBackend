import { Router } from 'express';
import { validateRequest } from '../../middleware/validateRequest';
import { createTaskSchema, updateTaskSchema, updateRecurrenceSchema, taskParamSchema, reopenTaskSchema, projectMembersParamSchema, cancelTaskSchema } from './task.validator';
import { createTask, getTaskById, updateTask, deleteTask, getTaskRecurrence, updateTaskRecurrence, deleteTaskRecurrence, reopenTask, getProjectMembers, cancelTask } from './task.controller';
import taskActivityRoutes from '../task-activities/task-activity.routes';
import taskBugRoutes from '../task-bugs/task-bug.routes';
import taskAttachmentRoutes from '../task-attachments/task-attachment.routes';

const router = Router();

// Nested routes for task activities, bugs, and attachments
router.use('/:taskId/activities', taskActivityRoutes);
router.use('/:taskId/bugs', taskBugRoutes);
router.use('/:taskId/attachments', taskAttachmentRoutes);

// POST /api/v1/company/tasks
router.post('/', validateRequest(createTaskSchema), createTask);

// GET /api/v1/company/tasks/:taskId
router.get('/:taskId', validateRequest(taskParamSchema), getTaskById);

// PUT /api/v1/company/tasks/:taskId
router.put('/:taskId', validateRequest(updateTaskSchema), updateTask);

// DELETE /api/v1/company/tasks/:taskId
router.delete('/:taskId', validateRequest(taskParamSchema), deleteTask);

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
