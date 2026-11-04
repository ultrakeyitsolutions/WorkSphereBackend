import { Router } from 'express';
import { CompanyBillingController } from './company-billing.controller';
import { authenticate } from '../../../middleware/auth.middleware';

const router = Router();

// Ensure all billing endpoints are authenticated
router.use(authenticate);

// GET /api/v1/company/billing/overview
router.get('/overview', CompanyBillingController.getOverview);

// GET /api/v1/company/billing/payments
router.get('/payments', CompanyBillingController.getPaymentHistory);

// GET /api/v1/company/billing/invoices/:attemptId
router.get('/invoices/:attemptId', CompanyBillingController.getInvoice);

// POST /api/v1/company/billing/upgrade
router.post('/upgrade', CompanyBillingController.initiateUpgrade);

// POST /api/v1/company/billing/upgrade-requests
router.post('/upgrade-requests', CompanyBillingController.requestUpgrade);

// GET /api/v1/company/billing/notifications
router.get('/notifications', CompanyBillingController.getNotifications);

export default router;
