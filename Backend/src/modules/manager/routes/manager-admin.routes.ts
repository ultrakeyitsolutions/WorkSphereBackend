import { Router } from 'express';
import { authenticate } from '../../../middleware/auth.middleware';
import { authorizeRoles } from '../../../middleware/authorization.middleware';
import * as ManagerAssignmentController from '../controllers/manager-assignment.controller';

const router = Router();

// Require Company Admin or Super Admin for all manager assignment management routes
router.use(authenticate);
router.use(authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN', 'Admin'));

router.get('/', ManagerAssignmentController.getManagers);
router.post('/promote', ManagerAssignmentController.promoteToManager);
router.post('/transfer-team', ManagerAssignmentController.transferTeamOwnership);

router.get('/:managerId', ManagerAssignmentController.getManagerById);
router.put('/:managerId', ManagerAssignmentController.updateManager);
router.delete('/:managerId', ManagerAssignmentController.deleteManager);
router.post('/:managerId/demote', ManagerAssignmentController.demoteManager);
router.post('/:managerId/suspend', ManagerAssignmentController.suspendManager);
router.post('/:managerId/reinstate', ManagerAssignmentController.reinstateManager);

router.get('/:managerId/assignments', ManagerAssignmentController.getAssignments);
router.post('/:managerId/assignments', ManagerAssignmentController.createAssignment);
router.put('/:managerId/assignments/:assignmentId', ManagerAssignmentController.updateAssignment);
router.delete('/:managerId/assignments/:assignmentId', ManagerAssignmentController.revokeAssignment);

router.get('/:managerId/permissions', ManagerAssignmentController.getPermissions);
router.put('/:managerId/permissions', ManagerAssignmentController.updatePermissions);

router.get('/:managerId/audit', ManagerAssignmentController.getAuditHistory);

export default router;
