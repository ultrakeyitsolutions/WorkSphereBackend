import { Router } from 'express';
import { SuperAdminPaymentController } from './super-admin-payment.controller';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Enforce authentication & SUPER_ADMIN authorization on all routes
router.use(requireSuperAdmin);

// GET /api/v1/super-admin/payments/export
router.get('/export', SuperAdminPaymentController.exportPayments);

// GET /api/v1/super-admin/payments/companies/:companyId/overview
router.get('/companies/:companyId/overview', SuperAdminPaymentController.getCompanyOverview);

// POST /api/v1/super-admin/payments/companies/:companyId/complimentary-upgrade
router.post('/companies/:companyId/complimentary-upgrade', SuperAdminPaymentController.assignComplimentaryPlan);

// POST /api/v1/super-admin/payments/companies/:companyId/plan-change
router.post('/companies/:companyId/plan-change', SuperAdminPaymentController.createPlanChange);

// POST /api/v1/super-admin/payments/:attemptId/refund
router.post('/:attemptId/refund', SuperAdminPaymentController.refundPayment);

// GET /api/v1/super-admin/payments/:attemptId
router.get('/:attemptId', SuperAdminPaymentController.getPaymentDetails);

// GET /api/v1/super-admin/payments
router.get('/', SuperAdminPaymentController.getPayments);

export default router;
