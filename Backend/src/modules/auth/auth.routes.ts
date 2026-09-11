import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from './auth.controller';
import { MfaController } from './mfa/mfa.controller';
import { SessionController } from './session/session.controller';
import { ImpersonationController } from '../auth/impersonation.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// ── Rate Limiters for MFA Security ───────────────────────────────────────────
const mfaVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 5, // 5 attempts per IP
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many MFA verification attempts. Please wait 15 minutes and try again.',
    },
});

const mfaRecoveryLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many recovery code attempts. Please wait 1 hour and try again.',
    },
});

const mfaSetupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many MFA setup attempts. Please try again later.',
    },
});

// ── Core Auth Routes ─────────────────────────────────────────────────────────
router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.post('/refresh', AuthController.refresh);

// ── MFA Routes ───────────────────────────────────────────────────────────────
// Authenticated setup flow
router.post('/mfa/setup', authenticate, mfaSetupLimiter, MfaController.setup);
router.post('/mfa/setup/verify', authenticate, mfaSetupLimiter, MfaController.verifySetup);
router.get('/mfa/status', authenticate, MfaController.status);
router.post('/mfa/recovery/regenerate', authenticate, MfaController.regenerateRecovery);
router.post('/mfa/disable', authenticate, MfaController.disable);

// Public challenge-based verification during login
router.post('/mfa/verify', mfaVerifyLimiter, MfaController.verify);
router.post('/mfa/recovery', mfaRecoveryLimiter, MfaController.recovery);

// ── Session & Logout Routes ──────────────────────────────────────────────────
router.post('/logout', authenticate, SessionController.logout);
router.post('/logout-all', authenticate, SessionController.logoutAll);
router.get('/sessions', authenticate, SessionController.getSessions);
router.delete('/sessions/:sessionId', authenticate, SessionController.revokeSession);

// ── Impersonation Routes ─────────────────────────────────────────────────────
router.post('/impersonation/start/:userId', authenticate, ImpersonationController.start);
router.post('/impersonation/stop', authenticate, ImpersonationController.stop);
router.get('/session', authenticate, ImpersonationController.getSession);

export default router;
