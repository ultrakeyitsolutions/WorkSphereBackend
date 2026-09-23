import { Router } from 'express';
import { SuperAdminProjectsController } from './projects.controller';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Enforce authentication & SUPER_ADMIN check on all project routes
router.use(requireSuperAdmin);

// GET /api/superadmin/projects
router.get('/', SuperAdminProjectsController.listProjects);

// GET /api/superadmin/projects/:projectId
router.get('/:projectId', SuperAdminProjectsController.getProjectDetails);

// GET /api/superadmin/projects/:projectId/statistics
router.get('/:projectId/statistics', SuperAdminProjectsController.getProjectStatistics);

export default router;
