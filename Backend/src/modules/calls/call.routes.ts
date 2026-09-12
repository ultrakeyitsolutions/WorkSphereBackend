import { Router } from 'express';
import { CallController } from './call.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import { startCallSchema, callIdParamSchema } from './call.validator';

const router = Router();

router.use(authenticate);

// POST /api/calls
router.post('/', validateRequest(startCallSchema), CallController.startCall);

// GET /api/calls
router.get('/', CallController.getHistory);

// GET /api/calls/:callId
router.get('/:callId', validateRequest(callIdParamSchema), CallController.getCall);

export default router;
