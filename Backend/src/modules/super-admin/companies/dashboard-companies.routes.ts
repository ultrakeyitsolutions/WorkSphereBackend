import { Router } from 'express';
import { DashboardCompaniesController } from './dashboard-companies.controller';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Enforce authentication & SUPER_ADMIN check on all company routes
router.use(requireSuperAdmin);

// GET /api/superadmin/companies
router.get('/', DashboardCompaniesController.listCompanies);

// GET /api/superadmin/companies/:companyId
router.get('/:companyId', DashboardCompaniesController.getCompanyDetails);

// GET /api/superadmin/companies/:companyId/statistics
router.get('/:companyId/statistics', DashboardCompaniesController.getCompanyStatistics);

// GET /api/superadmin/companies/:companyId/users
router.get('/:companyId/users', DashboardCompaniesController.getCompanyUsers);

// GET /api/superadmin/companies/:companyId/projects
router.get('/:companyId/projects', DashboardCompaniesController.getCompanyProjects);

export default router;
