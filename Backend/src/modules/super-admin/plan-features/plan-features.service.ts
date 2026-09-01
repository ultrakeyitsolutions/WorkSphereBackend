import mongoose from 'mongoose';
import { PlanFeature } from './plan-features.model';
import { Feature } from '../features/features.model';
import { PlanFeatureInput } from './plan-features.types';

export class PlanFeatureService {

    /**
     * Validates and creates PlanFeature records inside an existing session.
     * Must be called within a transaction.
     */
    static async createEntitlements(
        planId: string,
        features: PlanFeatureInput[],
        session: mongoose.ClientSession
    ) {
        const featureIds = features.map((f) => f.featureId);

        // 1. Verify all feature IDs exist
        const existingFeatures = await Feature.find({
            _id: { $in: featureIds },
        }).session(session);

        if (existingFeatures.length !== featureIds.length) {
            throw new Error('One or more feature IDs do not exist.');
        }

        // 2. Verify all features are active
        const inactive = existingFeatures.filter((f) => !f.isActive);
        if (inactive.length > 0) {
            throw new Error(
                `Inactive features cannot be assigned to a plan: ${inactive.map((f) => f.key).join(', ')}`
            );
        }

        // 3. Cross-validate type vs limitType
        const featureMap = new Map(existingFeatures.map((f) => [String(f._id), f]));

        for (const input of features) {
            const feature = featureMap.get(input.featureId);
            if (!feature) continue;

            if (feature.type === 'BOOLEAN' && input.limitType !== 'NONE') {
                throw new Error(
                    `Feature "${feature.key}" is a BOOLEAN feature and cannot have a limitType of ${input.limitType}.`
                );
            }

            if (feature.type === 'LIMIT' && input.limitType === 'NONE') {
                throw new Error(
                    `Feature "${feature.key}" is a LIMIT feature and must have limitType LIMITED or UNLIMITED.`
                );
            }
        }

        // 4. Build PlanFeature documents
        const docs = features.map((input) => ({
            planId,
            featureId: input.featureId,
            enabled: input.enabled,
            limitType: input.limitType,
            value: input.limitType === 'LIMITED' ? (input.value ?? null) : null,
        }));

        return PlanFeature.insertMany(docs, { session });
    }

    /**
     * Replaces all PlanFeature entries for a plan with new ones.
     * Must be called within a transaction.
     */
    static async replaceEntitlements(
        planId: string,
        features: PlanFeatureInput[],
        session: mongoose.ClientSession
    ) {
        // Remove all existing entries for this plan
        await PlanFeature.deleteMany({ planId }, { session });
        // Create the new ones
        return this.createEntitlements(planId, features, session);
    }

    /**
     * Returns all entitlements for a plan, with Feature populated.
     */
    static async getEntitlementsByPlan(planId: string) {
        return PlanFeature.find({ planId })
            .populate('featureId', 'key name description category type unit isActive')
            .lean();
    }

    /**
     * Returns the entitlement for a specific feature key on a plan.
     */
    static async getEntitlementByKey(planId: string, featureKey: string) {
        const feature = await Feature.findOne({ key: featureKey.toUpperCase() });
        if (!feature) return null;

        return PlanFeature.findOne({ planId, featureId: feature._id })
            .populate('featureId', 'key name type unit');
    }
}
