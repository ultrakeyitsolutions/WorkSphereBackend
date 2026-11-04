import { Types } from 'mongoose';
import { EntitlementService } from './entitlement.service';
import { FeatureAccessService, FeatureFlagKey, FEATURE_ENTITLEMENT_MAP } from '../modules/companyadmin/settings/feature-access.service';
import { CompanyThemeEntitlementService } from '../modules/companyadmin/settings/company-theme-entitlement.service';
import { CompanyEmailEntitlementService } from '../modules/companyadmin/settings/company-email-entitlement.service';
import { FeatureRevocationService } from '../modules/companyadmin/settings/feature-revocation.service';
import { AuditLogService } from '../modules/audit-logs/audit-log.service';
import { AuditAction } from '../modules/audit-logs/audit-log.types';
import { getSocketServer } from '../sockets/socket-server';
import { Plan } from '../modules/super-admin/plans/plans.model';
import { PlanFeature } from '../modules/super-admin/plan-features/plan-features.model';
import { Feature } from '../modules/super-admin/features/features.model';

export interface EntitlementSyncOptions {
    companyId: string;
    fromPlanId?: string | Types.ObjectId | null;
    toPlanId: string | Types.ObjectId;
    actorId?: string | Types.ObjectId | null;
    action: AuditAction;
    reason?: string;
    effectiveDate?: Date;
    isComplimentary?: boolean;
    paymentRef?: string;
    metadata?: Record<string, any>;
}

export class SubscriptionEntitlementSyncService {
    /**
     * Authoritative atomic multi-tier cache invalidation, audit logging,
     * Socket.IO real-time notification, and feature revocation across workers.
     */
    static async sync(options: EntitlementSyncOptions): Promise<void> {
        const companyId = String(options.companyId);
        const toPlanIdStr = String(options.toPlanId);
        const fromPlanIdStr = options.fromPlanId ? String(options.fromPlanId) : null;

        // 1. Invalidate all local caches across sub-services
        CompanyThemeEntitlementService.invalidateCache(companyId);
        CompanyEmailEntitlementService.invalidateCache(companyId);
        FeatureAccessService.invalidateCache(companyId);
        EntitlementService.invalidateCache(companyId);

        // 2. Resolve plan details for audit logging and feature diffing
        let fromPlanName = 'None';
        let toPlanName = 'Selected Plan';

        try {
            const toPlanQuery = Plan.findById(toPlanIdStr);
            const toPlan = toPlanQuery && typeof toPlanQuery.lean === 'function' ? await toPlanQuery.lean() : (await toPlanQuery);
            if (toPlan) toPlanName = toPlan.name;

            if (fromPlanIdStr) {
                const fromPlanQuery = Plan.findById(fromPlanIdStr);
                const fromPlan = fromPlanQuery && typeof fromPlanQuery.lean === 'function' ? await fromPlanQuery.lean() : (await fromPlanQuery);
                if (fromPlan) fromPlanName = fromPlan.name;
            }
        } catch {
            // Non-blocking fallback
        }

        // 3. Diff features to detect any revoked/lost capabilities
        if (fromPlanIdStr && fromPlanIdStr !== toPlanIdStr) {
            try {
                await this.detectAndRevokeLostFeatures(companyId, fromPlanIdStr, toPlanIdStr);
            } catch (err: any) {
                console.warn(`[SubscriptionEntitlementSyncService] Feature revocation diff error: ${err?.message}`);
            }
        }

        // 4. Record structured audit log
        try {
            AuditLogService.log({
                action: options.action,
                actorId: options.actorId ? String(options.actorId) : 'SYSTEM',
                companyId,
                metadata: {
                    fromPlanId: fromPlanIdStr,
                    fromPlanName,
                    toPlanId: toPlanIdStr,
                    toPlanName,
                    isComplimentary: !!options.isComplimentary,
                    reason: options.reason || null,
                    paymentRef: options.paymentRef || null,
                    effectiveDate: options.effectiveDate || new Date(),
                    ...(options.metadata || {}),
                },
                success: true,
                description: `Subscription plan updated for company ${companyId}: ${fromPlanName} -> ${toPlanName} (${options.action})`,
            });
        } catch {
            // Non-blocking fallback
        }

        // 5. Broadcast real-time Socket.IO notification to all active company members
        try {
            const io = getSocketServer();
            if (io) {
                const room = `company:${companyId}`;
                const payload = {
                    companyId,
                    planId: toPlanIdStr,
                    planName: toPlanName,
                    action: options.action,
                    isComplimentary: !!options.isComplimentary,
                    timestamp: Date.now(),
                };

                io.to(room).emit('company:subscription_updated', payload);
                io.to(room).emit('company:entitlements_updated', payload);
            }
        } catch {
            // Socket broadcasting is best-effort
        }
    }

    /**
     * Diffs previous plan features against target plan features and triggers
     * immediate socket eviction for features that were removed.
     */
    private static async detectAndRevokeLostFeatures(
        companyId: string,
        fromPlanId: string,
        toPlanId: string
    ): Promise<void> {
        let prevPfs: any[] = [];
        let newPfs: any[] = [];
        let allFeatures: any[] = [];

        try {
            const prevQuery = PlanFeature.find({ planId: new Types.ObjectId(fromPlanId), enabled: true });
            prevPfs = prevQuery && typeof prevQuery.lean === 'function' ? await prevQuery.lean() : (await prevQuery || []);

            const newQuery = PlanFeature.find({ planId: new Types.ObjectId(toPlanId), enabled: true });
            newPfs = newQuery && typeof newQuery.lean === 'function' ? await newQuery.lean() : (await newQuery || []);

            const fQuery = Feature.find({ isActive: true });
            allFeatures = fQuery && typeof fQuery.lean === 'function' ? await fQuery.lean() : (await fQuery || []);
        } catch {
            return;
        }

        const newFeatureIdSet = new Set((newPfs || []).map((pf) => String(pf.featureId)));
        const featureIdToKeyMap = new Map<string, string>();
        for (const f of allFeatures || []) {
            featureIdToKeyMap.set(String(f._id), f.key);
        }

        const lostFeatureKeys: string[] = [];
        for (const prevPf of prevPfs || []) {
            const fIdStr = String(prevPf.featureId);
            if (!newFeatureIdSet.has(fIdStr)) {
                const fKey = featureIdToKeyMap.get(fIdStr);
                if (fKey) {
                    lostFeatureKeys.push(fKey);
                }
            }
        }

        if (lostFeatureKeys.length === 0) return;

        // Map lost entitlement keys to FeatureFlagKeys for Socket.IO eviction
        const flagsToRevoke: FeatureFlagKey[] = [];
        for (const [flagKey, entitlementKey] of Object.entries(FEATURE_ENTITLEMENT_MAP)) {
            if (entitlementKey && lostFeatureKeys.includes(entitlementKey)) {
                flagsToRevoke.push(flagKey as FeatureFlagKey);
            }
        }

        if (flagsToRevoke.length > 0) {
            await FeatureRevocationService.revokeCompanyFeatures(companyId, flagsToRevoke);
        }
    }
}
