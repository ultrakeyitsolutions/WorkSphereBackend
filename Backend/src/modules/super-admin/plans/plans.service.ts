import mongoose from 'mongoose';
import { Plan } from './plans.model';
import { PlanFeatureService } from '../plan-features/plan-features.service';
import { CreatePlanInput, UpdatePlanInput } from './plans.schema';

export class PlanService {

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Builds the enriched plan+entitlements response shape. */
    private static async buildResponse(planId: string) {
        const plan = await Plan.findById(planId).lean();
        const entitlements = await PlanFeatureService.getEntitlementsByPlan(String(planId));

        const formattedEntitlements = entitlements.map((e: any) => ({
            feature: e.featureId?.key,
            name: e.featureId?.name,
            category: e.featureId?.category,
            type: e.featureId?.type,
            unit: e.featureId?.unit,
            enabled: e.enabled,
            limitType: e.limitType,
            value: e.value,
        }));

        return { ...plan, entitlements: formattedEntitlements };
    }

    // ── Create ────────────────────────────────────────────────────────────────
    static async createPlan(dto: CreatePlanInput) {
        // Guard: duplicate name or code
        const existing = await Plan.findOne({
            $or: [{ name: dto.name }, { code: dto.code }],
        });
        if (existing) {
            throw new Error('A plan with this name or code already exists');
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // If becoming default, unset all other defaults
            if (dto.isDefault) {
                await Plan.updateMany({ isDefault: true }, { $set: { isDefault: false } }, { session });
            }

            // Create the Plan document
            const [plan] = await Plan.create(
                [{
                    name: dto.name,
                    code: dto.code,
                    description: dto.description,
                    billingCycle: dto.billingCycle,
                    price: dto.price,
                    currency: dto.currency,
                    trialPeriodDays: dto.trialPeriodDays,
                    isActive: dto.isActive,
                    isDefault: dto.isDefault,
                    isArchived: false,
                }],
                { session }
            );

            // Create PlanFeature entitlements (validates feature IDs, types etc.)
            await PlanFeatureService.createEntitlements(String(plan._id), dto.features, session);

            await session.commitTransaction();

            return this.buildResponse(String(plan._id));
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    // ── Get All ───────────────────────────────────────────────────────────────
    static async getAllPlans(includeArchived = false) {
        const filter = includeArchived ? {} : { isArchived: false };
        const plans = await Plan.find(filter).sort({ createdAt: -1 }).lean();

        // Attach entitlements to each plan
        const results = await Promise.all(
            plans.map(async (plan) => {
                const entitlements = await PlanFeatureService.getEntitlementsByPlan(String(plan._id));
                const formatted = entitlements.map((e: any) => ({
                    feature: e.featureId?.key,
                    name: e.featureId?.name,
                    category: e.featureId?.category,
                    type: e.featureId?.type,
                    unit: e.featureId?.unit,
                    enabled: e.enabled,
                    limitType: e.limitType,
                    value: e.value,
                }));
                return { ...plan, entitlements: formatted };
            })
        );

        return results;
    }

    // ── Get One ───────────────────────────────────────────────────────────────
    static async getPlanById(id: string) {
        const plan = await Plan.findById(id).lean();
        if (!plan) return null;
        return this.buildResponse(id);
    }

    // ── Update ────────────────────────────────────────────────────────────────
    static async updatePlan(id: string, dto: UpdatePlanInput) {
        const plan = await Plan.findById(id);
        if (!plan) throw new Error('Plan not found');
        if (plan.isArchived) throw new Error('Archived plans cannot be edited');

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // If setting as default, unset all others
            if (dto.isDefault) {
                await Plan.updateMany(
                    { isDefault: true, _id: { $ne: id } },
                    { $set: { isDefault: false } },
                    { session }
                );
            }

            // Update plan fields (excluding features)
            const { features, ...planFields } = dto;
            await Plan.findByIdAndUpdate(id, planFields, { session, runValidators: true });

            // If features were provided, replace all entitlements
            if (features && features.length > 0) {
                await PlanFeatureService.replaceEntitlements(id, features, session);
            }

            await session.commitTransaction();
            return this.buildResponse(id);
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    // ── Activate / Deactivate ─────────────────────────────────────────────────
    static async changePlanStatus(id: string, isActive: boolean) {
        const plan = await Plan.findById(id);
        if (!plan) throw new Error('Plan not found');

        // If they want to deactivate, eventually we need to ensure this doesn't break things,
        // but spec says active plans just can't be selected for *new* subscriptions.

        plan.isActive = isActive;
        if (!isActive) {
            plan.isArchived = true;
            if (plan.isDefault) plan.isDefault = false;
        } else {
            plan.isArchived = false;
        }

        await plan.save();
        return this.buildResponse(id);
    }
}
