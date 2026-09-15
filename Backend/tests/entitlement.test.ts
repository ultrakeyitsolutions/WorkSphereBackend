import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { EntitlementService } from '../src/services/entitlement.service';

const COMPANY_ID = '64e0a1b2c3d4e5f6a7b8c9d0';
const PLAN_ID = '64e0a1b2c3d4e5f6a7b8c9d9';
const FEATURE_ID = '64e0a1b2c3d4e5f6a7b8c9d8';

const mocks = vi.hoisted(() => ({
    subscriptionFindOne: vi.fn(),
    featureFindOne: vi.fn(),
    planFeatureFindOne: vi.fn(),
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        findOne: mocks.subscriptionFindOne,
    },
    default: {
        findOne: mocks.subscriptionFindOne,
    },
}));

vi.mock('../src/modules/super-admin/features/features.model', () => ({
    Feature: {
        findOne: mocks.featureFindOne,
    },
    default: {
        findOne: mocks.featureFindOne,
    },
}));

vi.mock('../src/modules/super-admin/plan-features/plan-features.model', () => ({
    PlanFeature: {
        findOne: mocks.planFeatureFindOne,
    },
    default: {
        findOne: mocks.planFeatureFindOne,
    },
}));

describe('EntitlementService - Quick Meetings & Features', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getQuickMeetingLimits', () => {
        it('should return monthly limit 7 for MONTHLY billing cycle', async () => {
            // No custom PlanFeature override
            mocks.subscriptionFindOne.mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        planId: new Types.ObjectId(PLAN_ID),
                        status: 'ACTIVE',
                    }),
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            status: 'ACTIVE',
                            planId: {
                                _id: new Types.ObjectId(PLAN_ID),
                                name: 'Pro Monthly',
                                billingCycle: 'MONTHLY',
                            },
                        }),
                    }),
                }),
            });

            mocks.featureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(FEATURE_ID),
                    key: 'QUICK_MEETINGS',
                }),
            });

            mocks.planFeatureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            });

            const limits = await EntitlementService.getQuickMeetingLimits(COMPANY_ID);

            expect(limits.enabled).toBe(true);
            expect(limits.monthlyLimit).toBe(7);
            expect(limits.isUnlimited).toBe(false);
            expect(limits.billingCycle).toBe('MONTHLY');
            expect(limits.planName).toBe('Pro Monthly');
        });

        it('should return monthly limit 60 for SEMI_ANNUAL billing cycle', async () => {
            mocks.subscriptionFindOne.mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        planId: new Types.ObjectId(PLAN_ID),
                        status: 'ACTIVE',
                    }),
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            status: 'ACTIVE',
                            planId: {
                                _id: new Types.ObjectId(PLAN_ID),
                                name: 'Scale Semi-Annual',
                                billingCycle: 'SEMI_ANNUAL',
                            },
                        }),
                    }),
                }),
            });

            mocks.featureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(FEATURE_ID),
                    key: 'QUICK_MEETINGS',
                }),
            });

            mocks.planFeatureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            });

            const limits = await EntitlementService.getQuickMeetingLimits(COMPANY_ID);

            expect(limits.enabled).toBe(true);
            expect(limits.monthlyLimit).toBe(60);
            expect(limits.isUnlimited).toBe(false);
            expect(limits.billingCycle).toBe('SEMI_ANNUAL');
        });

        it('should return unlimited (-1) for YEARLY billing cycle', async () => {
            mocks.subscriptionFindOne.mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        planId: new Types.ObjectId(PLAN_ID),
                        status: 'ACTIVE',
                    }),
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            status: 'ACTIVE',
                            planId: {
                                _id: new Types.ObjectId(PLAN_ID),
                                name: 'Enterprise Annual',
                                billingCycle: 'YEARLY',
                            },
                        }),
                    }),
                }),
            });

            mocks.featureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(FEATURE_ID),
                    key: 'QUICK_MEETINGS',
                }),
            });

            mocks.planFeatureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            });

            const limits = await EntitlementService.getQuickMeetingLimits(COMPANY_ID);

            expect(limits.enabled).toBe(true);
            expect(limits.monthlyLimit).toBe(-1);
            expect(limits.isUnlimited).toBe(true);
            expect(limits.billingCycle).toBe('YEARLY');
        });

        it('should honor explicit PlanFeature value override if configured', async () => {
            mocks.subscriptionFindOne.mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        planId: new Types.ObjectId(PLAN_ID),
                        status: 'ACTIVE',
                    }),
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            status: 'ACTIVE',
                            planId: {
                                _id: new Types.ObjectId(PLAN_ID),
                                name: 'Custom Plan',
                                billingCycle: 'MONTHLY',
                            },
                        }),
                    }),
                }),
            });

            mocks.featureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(FEATURE_ID),
                    key: 'QUICK_MEETINGS',
                }),
            });

            mocks.planFeatureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    enabled: true,
                    limitType: 'LIMITED',
                    value: 25,
                }),
            });

            const limits = await EntitlementService.getQuickMeetingLimits(COMPANY_ID);

            expect(limits.enabled).toBe(true);
            expect(limits.monthlyLimit).toBe(25);
            expect(limits.isUnlimited).toBe(false);
        });

        it('should return enabled: false if PlanFeature has enabled: false', async () => {
            mocks.subscriptionFindOne.mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        planId: new Types.ObjectId(PLAN_ID),
                        status: 'ACTIVE',
                    }),
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            status: 'ACTIVE',
                            planId: {
                                _id: new Types.ObjectId(PLAN_ID),
                                name: 'Basic Free',
                                billingCycle: 'FREE',
                            },
                        }),
                    }),
                }),
            });

            mocks.featureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(FEATURE_ID),
                    key: 'QUICK_MEETINGS',
                }),
            });

            mocks.planFeatureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    enabled: false,
                    limitType: 'NONE',
                }),
            });

            const limits = await EntitlementService.getQuickMeetingLimits(COMPANY_ID);

            expect(limits.enabled).toBe(false);
            expect(limits.monthlyLimit).toBe(0);
        });
    });

    describe('hasFeature', () => {
        it('should return true when feature is enabled in PlanFeature', async () => {
            mocks.subscriptionFindOne.mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        planId: new Types.ObjectId(PLAN_ID),
                        status: 'ACTIVE',
                    }),
                }),
            });

            mocks.featureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(FEATURE_ID),
                    key: 'GOOGLE_MEET',
                }),
            });

            mocks.planFeatureFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    enabled: true,
                }),
            });

            const hasMeet = await EntitlementService.hasFeature(COMPANY_ID, 'GOOGLE_MEET');
            expect(hasMeet).toBe(true);
        });

        it('should return false when feature is not enabled or plan not active', async () => {
            mocks.subscriptionFindOne.mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(null),
                }),
            });

            const hasMeet = await EntitlementService.hasFeature(COMPANY_ID, 'GOOGLE_MEET');
            expect(hasMeet).toBe(false);
        });
    });
});
