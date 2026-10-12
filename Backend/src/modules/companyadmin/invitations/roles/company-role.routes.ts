import { Router } from 'express';
import { CompanyRoleController } from './company-role.controller';
import { requireFeature } from '../../../../middleware/entitlement.middleware';

const router = Router();

// POST   /api/v1/company/roles
router.post('/', requireFeature('ROLES_PERMISSIONS'), CompanyRoleController.create);

// GET    /api/v1/company/roles
router.get('/', CompanyRoleController.list);

// GET    /api/v1/company/roles/:roleId
router.get('/:roleId', CompanyRoleController.getOne);

// PUT    /api/v1/company/roles/:roleId
router.put('/:roleId', requireFeature('ROLES_PERMISSIONS'), CompanyRoleController.update);

// PATCH  /api/v1/company/roles/:roleId/status
router.patch('/:roleId/status', requireFeature('ROLES_PERMISSIONS'), CompanyRoleController.setStatus);

// DELETE /api/v1/company/roles/:roleId
router.delete('/:roleId', requireFeature('ROLES_PERMISSIONS'), CompanyRoleController.delete);

export default router;
