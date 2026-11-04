import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../../middleware/auth.middleware';
import { authorizeRoles } from '../../../middleware/authorization.middleware';
import { validateRequest } from '../../../middleware/validateRequest';
import { EscalationController } from '../controllers/escalation.controller';
import { EscalationRuleController } from '../controllers/escalationRule.controller';
import { EscalationReportController } from '../controllers/escalationReport.controller';
import {
    createRuleRequestSchema,
    updateRuleRequestSchema,
    toggleRuleStatusRequestSchema,
    caseAcknowledgeRequestSchema,
    caseAssignRequestSchema,
    caseResolveRequestSchema,
    caseDismissRequestSchema,
    caseOverrideRequestSchema,
    caseExplanationRequestSchema,
} from '../validators/escalation.validator';

const router = Router();

// Configure multer memory storage with strict 10MB limit and allowed file types
const evidenceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowedMimes = [
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPG, PNG, WEBP, PDF, and DOC/DOCX files are supported.'));
        }
    },
});

// All escalation routes require authentication
router.use(authenticate);

// ─── Employee Self-Service Compliance Routes ─────────────────────────────────
// Allows any authenticated employee to view and respond to their own escalations
router.get('/my-escalations', EscalationController.getMyEscalations);
router.get('/my-escalations/:id', EscalationController.getMyEscalationById);
router.post(
    '/my-escalations/:id/explanation',
    validateRequest(caseExplanationRequestSchema),
    EscalationController.submitExplanation
);
router.post(
    '/my-escalations/:id/evidence',
    evidenceUpload.single('file'),
    EscalationController.uploadEvidence
);

// ─── Analytics, Reports & Export (Company Admin & Manager) ───────────────────
router.get(
    '/dashboard',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'),
    EscalationReportController.getDashboard
);
router.get(
    '/reports',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'),
    EscalationReportController.getReports
);
router.get(
    '/reports/:category',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'),
    EscalationReportController.getCategoryReport
);
router.get(
    '/employees/:employeeId',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'),
    EscalationReportController.getEmployeeHistory
);
router.get(
    '/history',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'),
    EscalationReportController.getHistory
);
router.get(
    '/export',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN'),
    EscalationReportController.exportReport
);

// ─── Compliance Rules (Company Admin Only) ───────────────────────────────────
router.get(
    '/rules',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN'),
    EscalationRuleController.listRules
);
router.post(
    '/rules',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN'),
    validateRequest(createRuleRequestSchema),
    EscalationRuleController.createRule
);
router.get(
    '/rules/:id',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN'),
    EscalationRuleController.getRuleById
);
router.put(
    '/rules/:id',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN'),
    validateRequest(updateRuleRequestSchema),
    EscalationRuleController.updateRule
);
router.patch(
    '/rules/:id/status',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN'),
    validateRequest(toggleRuleStatusRequestSchema),
    EscalationRuleController.toggleStatus
);

// ─── Case Management (Company Admin & Authorized Managers) ───────────────────
router.get(
    '/cases',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'),
    EscalationController.listCases
);
router.get(
    '/cases/:id',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'),
    EscalationController.getCaseById
);
router.post(
    '/cases/:id/acknowledge',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'),
    validateRequest(caseAcknowledgeRequestSchema),
    EscalationController.acknowledgeCase
);
router.post(
    '/cases/:id/assign',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN'),
    validateRequest(caseAssignRequestSchema),
    EscalationController.assignCase
);
router.post(
    '/cases/:id/resolve',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'),
    validateRequest(caseResolveRequestSchema),
    EscalationController.resolveCase
);
router.post(
    '/cases/:id/dismiss',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'),
    validateRequest(caseDismissRequestSchema),
    EscalationController.dismissCase
);
router.post(
    '/cases/:id/override',
    authorizeRoles('Admin', 'SUPER_ADMIN', 'COMPANY_ADMIN'),
    validateRequest(caseOverrideRequestSchema),
    EscalationController.overrideCase
);

export default router;
