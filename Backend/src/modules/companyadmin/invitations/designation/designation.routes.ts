import { Router } from 'express';
import { DesignationController } from './designation.controller';

const router = Router();

// POST   /api/v1/company/designations
router.post('/', DesignationController.create);

// GET    /api/v1/company/designations
router.get('/', DesignationController.list);

// GET    /api/v1/company/designations/:designationId
router.get('/:designationId', DesignationController.getOne);

// PUT    /api/v1/company/designations/:designationId
router.put('/:designationId', DesignationController.update);

// PATCH  /api/v1/company/designations/:designationId/status
router.patch('/:designationId/status', DesignationController.setStatus);

// DELETE /api/v1/company/designations/:designationId
router.delete('/:designationId', DesignationController.delete);

export default router;
