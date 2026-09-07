import { Router } from 'express';
import { authorizePermissions } from '../../middleware/authorization.middleware';
import { PermissionsController } from './permissions.controller';

const router = Router();

// PUT /api/v1/company/users/permissions
router.put('/', authorizePermissions('users.permissions.manage'), PermissionsController.updateBulkPermissions);

export default router;
