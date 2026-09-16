import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { authorizeRoles } from '../../middleware/authorization.middleware';
import {
    getCompanyNotificationPreferences,
    updateCompanyNotificationPreference,
} from './notification-preference.controller';

const router = Router();

// Require authentication and Admin / Company Admin authorization
router.use(authenticate);
router.use(authorizeRoles('COMPANY_ADMIN', 'ADMIN', 'SUPER_ADMIN'));

router.get('/', getCompanyNotificationPreferences);
router.patch('/:type', updateCompanyNotificationPreference);

export default router;
