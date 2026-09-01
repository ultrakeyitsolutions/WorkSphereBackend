import { Router } from 'express';
import { CompanyController } from './company.controller';

const router = Router();

// ─── Company Routes (mounted under /api/super-admin/create-company) ────────────
// All middleware (authenticate + authorizeRoles + authorizePermissions) is
// applied by the parent super-admin router before these handlers are reached.

// POST   /api/super-admin/create-company        → create company + admin (transactional)
router.post('/', CompanyController.create);

// GET    /api/super-admin/create-company        → list all companies
router.get('/', CompanyController.getAll);

// GET    /api/super-admin/create-company/:id    → get single company by ID
router.get('/:id', CompanyController.getOne);

export default router;
