import { Router } from 'express';
import { CompanyRoleController } from './company-role.controller';

const router = Router();

// POST   /api/v1/company/roles
router.post('/', CompanyRoleController.create);

// GET    /api/v1/company/roles
router.get('/', CompanyRoleController.list);

// GET    /api/v1/company/roles/:roleId
router.get('/:roleId', CompanyRoleController.getOne);

// PUT    /api/v1/company/roles/:roleId
router.put('/:roleId', CompanyRoleController.update);

// PATCH  /api/v1/company/roles/:roleId/status
router.patch('/:roleId/status', CompanyRoleController.setStatus);

// DELETE /api/v1/company/roles/:roleId
router.delete('/:roleId', CompanyRoleController.delete);

export default router;
