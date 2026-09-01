import { Feature } from './features.model';
import { PlanFeature } from '../plan-features/plan-features.model';
import { CreateFeatureInput, UpdateFeatureInput } from './features.schema';

export class FeatureService {

    static async createFeature(dto: CreateFeatureInput) {
        const existing = await Feature.findOne({ key: dto.key.toUpperCase() });
        if (existing) {
            throw new Error(`Feature with key "${dto.key}" already exists`);
        }
        return Feature.create(dto);
    }

    static async getAllFeatures(activeOnly = false) {
        const filter = activeOnly ? { isActive: true } : {};
        return Feature.find(filter).sort({ category: 1, name: 1 });
    }

    static async getFeatureById(id: string) {
        return Feature.findById(id);
    }

    static async updateFeature(id: string, dto: UpdateFeatureInput) {
        // Guard: Prevent dangerous type/unit changes if feature is used
        if (dto.type || dto.unit) {
            const inUse = await PlanFeature.exists({ featureId: id });
            if (inUse) {
                throw new Error('FEATURE_IN_USE: Cannot change type or unit because this feature is already assigned to plans.');
            }
        }

        const feature = await Feature.findByIdAndUpdate(id, dto, {
            new: true,
            runValidators: true,
        });
        if (!feature) throw new Error('Feature not found');
        return feature;
    }

    static async changeFeatureStatus(id: string, isActive: boolean) {
        const feature = await Feature.findByIdAndUpdate(id, { isActive }, { new: true });
        if (!feature) throw new Error('Feature not found');
        return feature;
    }

    static async deleteFeature(id: string) {
        // Guard: Prevent deletion of used features
        const inUse = await PlanFeature.exists({ featureId: id });
        if (inUse) {
            throw new Error('FEATURE_IN_USE: Feature is currently used by plans and cannot be deleted. Deactivate it instead.');
        }

        const feature = await Feature.findByIdAndDelete(id);
        if (!feature) throw new Error('Feature not found');
        return feature;
    }
}
