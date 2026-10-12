import { Router } from 'express';
import { LeaveAdminController } from './leave-admin.controller';
import { validateRequest } from '../../../middleware/validateRequest';
import { authorizeRoles } from '../../../middleware/authorization.middleware';
import {
    upsertLeavePolicySchema,
    updateLopPolicySchema,
    setEmployeePolicyOverrideSchema,
    setEmployeeLopOverrideSchema,
    leavePreviewSchema,
    approveLeaveWithBreakdownSchema,
    requestLeaveRevisionSchema,
    approveLopDecisionSchema,
} from './leave-admin.validator';

const router = Router();

// ─── Self-Service Endpoints (Any Authenticated Member) ─────────────────────────
router.get('/my-balances', LeaveAdminController.getMyBalances);
router.get('/my-lop-decisions', LeaveAdminController.getMyLopDecisions);
router.get('/preview', validateRequest(leavePreviewSchema), LeaveAdminController.previewLeave);
router.patch('/requests/:id/cancel', LeaveAdminController.cancelLeave);

// ─── Leave Policy Management (Admin Only) ──────────────────────────────────────
router.get(
    '/policies',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    LeaveAdminController.getPolicies
);
router.post(
    '/policies',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(upsertLeavePolicySchema),
    LeaveAdminController.upsertPolicy
);
router.post(
    '/policies/:policyId/overrides',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(setEmployeePolicyOverrideSchema),
    LeaveAdminController.setEmployeeOverride
);
router.delete(
    '/policies/:policyId/overrides/:employeeId',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    LeaveAdminController.removeEmployeeOverride
);

// ─── LOP Policy Management (Admin Only) ────────────────────────────────────────
router.get(
    '/lop-policy',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    LeaveAdminController.getLopPolicy
);
router.put(
    '/lop-policy',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(updateLopPolicySchema),
    LeaveAdminController.updateLopPolicy
);
router.post(
    '/lop-policy/overrides',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(setEmployeeLopOverrideSchema),
    LeaveAdminController.setEmployeeLopOverride
);
router.delete(
    '/lop-policy/overrides/:employeeId',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    LeaveAdminController.removeEmployeeLopOverride
);

// ─── Admin Review & Management (Admin Only) ────────────────────────────────────
router.get(
    '/admin/dashboard',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    LeaveAdminController.getAdminDashboardSummary
);
router.get(
    '/admin/lop-decisions',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    LeaveAdminController.getLopDecisions
);
router.get(
    '/admin/lop-decisions/:id',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    LeaveAdminController.getSingleLopDecision
);
router.patch(
    '/admin/lop-decisions/:id/approve',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(approveLopDecisionSchema),
    LeaveAdminController.approveLopDecision
);
router.patch(
    '/admin/lop-decisions/:id/reject',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    LeaveAdminController.rejectLopDecision
);
router.get(
    '/admin/employees/:employeeId/balances',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    LeaveAdminController.getEmployeeBalances
);
router.patch(
    '/admin/requests/:id/approve-breakdown',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(approveLeaveWithBreakdownSchema),
    LeaveAdminController.approveLeaveWithBreakdown
);
router.post(
    '/admin/requests/:id/request-revision',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(requestLeaveRevisionSchema),
    LeaveAdminController.requestRevision
);

export default router;
