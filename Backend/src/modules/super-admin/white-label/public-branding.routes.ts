import { Router } from 'express';
import { WhiteLabelController } from './white-label.controller';

const router = Router();

// GET /api/v1/public/branding
// GET /api/v1/public/branding/resolve
// Public endpoint for pre-login branding resolution
router.get('/', WhiteLabelController.getPublicBranding);
router.get('/resolve', WhiteLabelController.getPublicBranding);

export default router;
