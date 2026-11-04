import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { authorizeRoles } from '../../middleware/authorization.middleware';
import * as TeamController from './team.controller';

const router = Router();

router.use(authenticate);

// List and get teams accessible to authenticated users
router.get('/', TeamController.getTeams);
router.get('/:teamId', TeamController.getTeamById);

// Admin / Manager management operations
router.post('/', authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin', 'MANAGER', 'Manager'), TeamController.createTeam);
router.put('/:teamId', authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin', 'MANAGER', 'Manager'), TeamController.updateTeam);
router.delete('/:teamId', authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin'), TeamController.deleteTeam);
router.post('/:teamId/members', authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin', 'MANAGER', 'Manager'), TeamController.addTeamMembers);
router.delete('/:teamId/members', authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin', 'MANAGER', 'Manager'), TeamController.removeTeamMembers);
router.post('/:teamId/projects', authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin', 'MANAGER', 'Manager'), TeamController.linkTeamProjects);
router.delete('/:teamId/projects', authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin', 'MANAGER', 'Manager'), TeamController.unlinkTeamProjects);
router.post('/:teamId/transfer-lead', authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin'), TeamController.transferTeamLead);
router.post('/:teamId/transfer-members', authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin', 'MANAGER', 'Manager'), TeamController.transferTeamMembers);
router.get('/:teamId/performance', authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin', 'MANAGER', 'Manager'), TeamController.getTeamPerformance);

export default router;
