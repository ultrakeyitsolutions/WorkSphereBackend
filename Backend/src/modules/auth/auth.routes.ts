import { Router } from 'express';
import { AuthController } from './auth.controller';
import { ImpersonationController } from '../auth/impersonation.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.post('/refresh', AuthController.refresh);

// Impersonation Routes
router.post('/impersonation/start/:userId', authenticate, ImpersonationController.start);
router.post('/impersonation/stop', authenticate, ImpersonationController.stop);
router.get('/session', authenticate, ImpersonationController.getSession);

export default router;
