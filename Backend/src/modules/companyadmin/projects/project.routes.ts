import { Router } from 'express';
import { validateRequest } from '../../../middleware/validateRequest';
import { authorizePermissions } from '../../../middleware/authorization.middleware';
import {
    createProjectSchema,
    updateProjectSchema,
    listProjectsSchema,
    projectParamSchema,
} from './project.validator';
import {
    createProject,
    listProjects,
    getProjectById,
    updateProject,
    archiveProject,
    unarchiveProject,
    permanentDeleteProject,
    pinProject,
    unpinProject,
    activateProject,
    deactivateProject,
} from './project.controller';
import {
    getEmployeeSelector,
    getManagerSelector,
    getClientSelector,
} from './project-selector.controller';
import { getTaskContext, getTasksByProject, createTask } from '../../tasks/task.controller';

const router = Router();

// ── Selector routes — MUST be registered before /:projectId routes ─────────────

// GET /api/v1/company/projects/selectors/employees
router.get('/selectors/employees', getEmployeeSelector);

// GET /api/v1/company/projects/selectors/managers
router.get('/selectors/managers', getManagerSelector);

// GET /api/v1/company/projects/selectors/clients
router.get('/selectors/clients', getClientSelector);


// ── POST   /api/v1/company/projects              Create project ────────────────
router.post(
    '/',
    authorizePermissions('PROJECT_CREATE'),
    validateRequest(createProjectSchema),
    createProject
);

// ── GET    /api/v1/company/projects              List projects ──────────────────
router.get(
    '/',
    validateRequest(listProjectsSchema),
    listProjects
);

// ── GET    /api/v1/company/projects/:projectId   View detail ────────────────────
router.get(
    '/:projectId',
    validateRequest(projectParamSchema),
    getProjectById
);

// ── GET    /api/v1/company/projects/:projectId/task-context ──────────────────────
router.get(
    '/:projectId/task-context',
    validateRequest(projectParamSchema),
    getTaskContext
);

// ── GET    /api/v1/company/projects/:projectId/tasks ─────────────────────────────
router.get(
    '/:projectId/tasks',
    validateRequest(projectParamSchema),
    getTasksByProject
);

// ── POST   /api/v1/company/projects/:projectId/tasks ─────────────────────────────
router.post(
    '/:projectId/tasks',
    validateRequest(projectParamSchema),
    createTask
);

// ── PATCH  /api/v1/company/projects/:projectId   Edit project ───────────────────
router.patch(
    '/:projectId',
    authorizePermissions('PROJECT_UPDATE'),
    validateRequest(updateProjectSchema),
    updateProject
);

// ── PATCH  /api/v1/company/projects/:projectId/archive ───────────────────────────
router.patch(
    '/:projectId/archive',
    authorizePermissions('PROJECT_UPDATE'),
    validateRequest(projectParamSchema),
    archiveProject
);

// ── PATCH  /api/v1/company/projects/:projectId/unarchive ─────────────────────────
router.patch(
    '/:projectId/unarchive',
    authorizePermissions('PROJECT_UPDATE'),
    validateRequest(projectParamSchema),
    unarchiveProject
);

// ── DELETE /api/v1/company/projects/:projectId   Permanent delete ────────────────
router.delete(
    '/:projectId',
    authorizePermissions('PROJECT_DELETE'),
    validateRequest(projectParamSchema),
    permanentDeleteProject
);

// ── PATCH  /api/v1/company/projects/:projectId/pin ───────────────────────────────
router.patch(
    '/:projectId/pin',
    validateRequest(projectParamSchema),
    pinProject
);

// ── PATCH  /api/v1/company/projects/:projectId/unpin ─────────────────────────────
router.patch(
    '/:projectId/unpin',
    validateRequest(projectParamSchema),
    unpinProject
);

// ── PATCH  /api/v1/company/projects/:projectId/activate ──────────────────────────
router.patch(
    '/:projectId/activate',
    authorizePermissions('PROJECT_UPDATE'),
    validateRequest(projectParamSchema),
    activateProject
);

// ── PATCH  /api/v1/company/projects/:projectId/deactivate ────────────────────────
router.patch(
    '/:projectId/deactivate',
    authorizePermissions('PROJECT_UPDATE'),
    validateRequest(projectParamSchema),
    deactivateProject
);

export default router;
