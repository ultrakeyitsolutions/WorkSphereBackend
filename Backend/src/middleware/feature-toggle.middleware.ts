import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../modules/auth/auth.types';
import { FeatureAccessService, FeatureFlagKey } from '../modules/companyadmin/settings/feature-access.service';
import { sendError } from '../utils/response';

const FEATURE_DISPLAY_NAMES: Partial<Record<FeatureFlagKey, string>> = {
    enableManagerDashboard: 'Manager Dashboard',
    enableEscalations: 'Escalations',
    enableLiveMonitoring: 'Live Monitoring',
    enableDetailedMonitoring: 'Detailed Monitoring',
    enableQuickMeetings: 'Quick Meetings',
    enableChat: 'Team Chat',
    enableAttendanceAdjustments: 'Attendance Adjustments',
    enableTimesheets: 'Timesheets',
    enableTaskAttachments: 'Task Attachments',
};

/**
 * Middleware to enforce Company Feature Flag and Subscription Entitlement.
 * Usage: router.use(requireCompanyFeature('enableLiveMonitoring'));
 */
export const requireCompanyFeature = (featureKey: FeatureFlagKey) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;

            // If SUPER_ADMIN without company context is managing system, allow bypass if not in company tenant route
            if (!companyId && req.user?.role === 'SUPER_ADMIN') {
                return next();
            }

            if (!companyId) {
                return sendError(res, 'Company context required for this feature', 403);
            }

            const result = await FeatureAccessService.checkAccess(companyId, featureKey);

            if (!result.allowed) {
                const isCompanyDisabled = result.reason === 'FEATURE_DISABLED_BY_COMPANY';
                const displayName = FEATURE_DISPLAY_NAMES[featureKey] || `Feature '${featureKey}'`;
                const message = isCompanyDisabled
                    ? `${displayName} is currently disabled by your organization administrator.`
                    : result.message || `Feature '${featureKey}' is disabled or not entitled`;

                return res.status(403).json({
                    success: false,
                    code: isCompanyDisabled
                        ? 'FEATURE_DISABLED'
                        : result.reason || 'FEATURE_ACCESS_DENIED',
                    message,
                    errors: { code: result.reason },
                });
            }

            return next();
        } catch (error: any) {
            return sendError(res, error.message || 'Feature access check failed', 500);
        }
    };
};
