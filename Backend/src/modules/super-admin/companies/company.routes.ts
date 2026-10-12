import { Router } from 'express';
import multer from 'multer';
import { CompanyController } from './company.controller';

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
});

// ─── Company Routes (mounted under /api/super-admin/create-company) ────────────
// All middleware (authenticate + authorizeRoles + authorizePermissions) is
// applied by the parent super-admin router before these handlers are reached.

// POST   /api/super-admin/create-company/upload-logo → upload logo before or during registration
router.post('/upload-logo', upload.single('file'), CompanyController.uploadLogo);

// POST   /api/super-admin/create-company        → create company + admin (transactional)
router.post('/', CompanyController.create);

// GET    /api/super-admin/create-company        → list all companies
router.get('/', CompanyController.getAll);

// GET    /api/super-admin/create-company/:id    → get single company by ID
router.get('/:id', CompanyController.getOne);

export default router;

