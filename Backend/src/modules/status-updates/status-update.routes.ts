import { Router } from 'express';
import { StatusUpdateController } from './status-update.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireModuleAccess } from '../../middleware/module-access.middleware';

const router = Router();

// Strict Authentication and Module Access Guard
router.use(authenticate);
router.use(requireModuleAccess('status-updates'));

// Member submission & self history
router.post('/', StatusUpdateController.submitStatusUpdate);
router.get('/my-history', StatusUpdateController.getMemberHistory);

// Company Admin monitoring & overview
router.get('/overview', StatusUpdateController.getCompanyOverview);
router.get('/company', StatusUpdateController.getCompanyStatusUpdates);

// Item detail, update & feedback
router.get('/:id', StatusUpdateController.getStatusUpdateById);
router.put('/:id', StatusUpdateController.updateStatusUpdate);
router.post('/:id/feedback', StatusUpdateController.addFeedback);

export default router;

