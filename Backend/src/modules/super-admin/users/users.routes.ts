import { Router } from 'express';
import { SuperAdminUsersController } from './users.controller';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Enforce authentication & SUPER_ADMIN authorization on all user routes
router.use(requireSuperAdmin);

// GET /api/superadmin/users
router.get('/', SuperAdminUsersController.listUsers);

// GET /api/superadmin/users/:userId
router.get('/:userId', SuperAdminUsersController.getUserDetails);

// GET /api/superadmin/users/:userId/statistics
router.get('/:userId/statistics', SuperAdminUsersController.getUserStatistics);

// GET /api/superadmin/users/:userId/activity
router.get('/:userId/activity', SuperAdminUsersController.getUserActivity);

// GET /api/superadmin/users/:userId/permissions
router.get('/:userId/permissions', SuperAdminUsersController.getUserPermissions);

export default router;
