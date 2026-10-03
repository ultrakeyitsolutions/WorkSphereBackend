import { Router } from 'express';
import { ChatController } from '../../chat/chat.controller';
import { authenticate } from '../../../middleware/auth.middleware';
import wishlistRoutes from '../../wishlist/wishlist.routes';
import sprintRoutes from '../../sprints/sprint.routes';
import releaseRoutes from '../../releases/release.routes';
import { assignSprint, assignRelease, assignSprintRelease, getTasksByProject, createTask } from '../../tasks/task.controller';

const router = Router();

// Authentication required
router.use(authenticate);

// GET /api/projects/:projectId/members
router.get('/:projectId/members', ChatController.getProjectMembers);

// ── Project Tasks endpoints ───────────────────────────────────────────────────
router.get('/:projectId/tasks', getTasksByProject);
router.post('/:projectId/tasks', createTask);

// ── Wishlist, Sprint, Release sub-modules ──────────────────────────────────────
router.use('/:projectId/wishlist', wishlistRoutes);
router.use('/:projectId/sprints', sprintRoutes);
router.use('/:projectId/releases', releaseRoutes);

// ── Task Relationship endpoints ───────────────────────────────────────────────
router.patch('/:projectId/tasks/:taskId/sprint', assignSprint);
router.patch('/:projectId/tasks/:taskId/release', assignRelease);
router.patch('/:projectId/tasks/:taskId/planning', assignSprintRelease);
router.patch('/:projectId/tasks/:taskId/sprint-release', assignSprintRelease);

export default router;
