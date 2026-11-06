import { CompanySettings, DEFAULT_FEATURE_FLAGS } from './company-settings.model';
import { ICompanyFeatureFlags } from './company-settings.types';
import { EntitlementService } from '../../../services/entitlement.service';
import { AppError } from '../../../utils/AppError';

export type FeatureFlagKey = keyof ICompanyFeatureFlags;

export interface FeatureAccessResult {
    allowed: boolean;
    reason?: 'FEATURE_DISABLED' | 'FEATURE_DISABLED_BY_COMPANY' | 'PLAN_UPGRADE_REQUIRED' | 'COMPANY_NOT_FOUND';
    message?: string;
}

export const FEATURE_ENTITLEMENT_MAP: Record<FeatureFlagKey, string | null> = {
    enableLiveMonitoring: 'LIVE_MONITORING',
    enableDetailedMonitoring: 'DETAILED_MONITORING',
    enableQuickMeetings: 'QUICK_MEETINGS',
    enableChat: 'CHAT',
    enableAttendanceAdjustments: 'ADVANCED_TIME_TRACKING',
    enableTimesheets: 'ADVANCED_TIME_TRACKING',
    enableTaskAttachments: 'FILE_ATTACHMENTS',
    enableEscalations: null,
    enableManagerDashboard: null,
};

// In-memory cache for company settings (TTL 15 seconds)
interface CacheEntry {
    features: ICompanyFeatureFlags;
    cachedAt: number;
}

const settingsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 1000;

export class FeatureAccessService {
    /**
     * Clear memory cache for a company's feature flags (called on settings update)
     */
    static invalidateCache(companyId: string): void {
        settingsCache.delete(String(companyId));
    }

    /**
     * Clear entire in-memory feature flag cache (called on subscriber reconnect or cache reset)
     */
    static clearAllCache(): void {
        settingsCache.clear();
    }

    static async getCompanyFeatureFlags(
        companyId: string,
        options: { failClosed?: boolean } = {}
    ): Promise<ICompanyFeatureFlags> {
        const key = String(companyId);
        const cached = settingsCache.get(key);
        const now = Date.now();

        if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
            return cached.features;
        }

        try {
            const settings: any = await Promise.race([
                CompanySettings.findOne({ companyId }).lean(),
                new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
            ]);
            const features: ICompanyFeatureFlags = {
                ...DEFAULT_FEATURE_FLAGS,
                ...(settings?.features || {}),
            };

            settingsCache.set(key, {
                features,
                cachedAt: now,
            });

            return features;
        } catch {
            if (options.failClosed) {
                const disabled = {} as ICompanyFeatureFlags;
                for (const flag of Object.keys(DEFAULT_FEATURE_FLAGS) as FeatureFlagKey[]) {
                    disabled[flag] = false;
                }
                return disabled;
            }
            return { ...DEFAULT_FEATURE_FLAGS };
        }
    }

    /**
     * Multi-tier feature check:
     * 1. Check Company-level toggle in CompanySettings
     * 2. Check Plan-level Entitlement in Subscription
     */
    static async checkAccess(
        companyId: string,
        featureKey: FeatureFlagKey
    ): Promise<FeatureAccessResult> {
        if (!companyId) {
            return {
                allowed: false,
                reason: 'COMPANY_NOT_FOUND',
                message: 'Company context is missing.',
            };
        }

        // Tier 1: Check Plan Entitlement (Subscription validity & Plan Feature Inclusion)
        const entitlementKey = FEATURE_ENTITLEMENT_MAP[featureKey];
        if (entitlementKey) {
            const hasEntitlement = await EntitlementService.hasFeature(companyId, entitlementKey);
            if (!hasEntitlement) {
                return {
                    allowed: false,
                    reason: 'PLAN_UPGRADE_REQUIRED',
                    message: `Your current subscription plan does not include '${featureKey}'. Please upgrade your subscription.`,
                };
            }
        }

        // Tier 2: Check Company Feature Toggle
        const companyFeatures = await this.getCompanyFeatureFlags(companyId, {
            failClosed: featureKey === 'enableManagerDashboard',
        });
        const isEnabledInCompany = companyFeatures[featureKey] ?? true;

        if (!isEnabledInCompany) {
            const message = featureKey === 'enableManagerDashboard'
                ? 'Manager Dashboard is currently disabled by your organization administrator.'
                : `The feature '${featureKey}' has been disabled in your company settings.`;
            return {
                allowed: false,
                reason: 'FEATURE_DISABLED_BY_COMPANY',
                message,
            };
        }

        return { allowed: true };
    }

    /**
     * Convenience method returning boolean
     */
    static async canAccess(companyId: string, featureKey: FeatureFlagKey): Promise<boolean> {
        const result = await this.checkAccess(companyId, featureKey);
        return result.allowed;
    }

    /**
     * Throws an AppError if feature is not accessible
     */
    static async assertAccess(companyId: string, featureKey: FeatureFlagKey): Promise<void> {
        const result = await this.checkAccess(companyId, featureKey);
        if (!result.allowed) {
            if (result.reason === 'PLAN_UPGRADE_REQUIRED') {
                throw AppError.forbidden(result.message || 'Feature not available in your subscription plan');
            }
            throw AppError.forbidden(result.message || 'Feature is disabled for this organization');
        }
    }
}
