import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { CompanySettingsService } from '../src/modules/companyadmin/settings/company-settings.service';
import { FeatureAccessService } from '../src/modules/companyadmin/settings/feature-access.service';
import { CompanySettingsController } from '../src/modules/companyadmin/settings/company-settings.controller';
import { updateCompanySettingsSchema } from '../src/modules/companyadmin/settings/company-settings.validator';
import { requireCompanyFeature } from '../src/middleware/feature-toggle.middleware';
import { AppError } from '../src/utils/AppError';

const MOCK_COMPANY_ID = '64e0a1b2c3d4e5f6a7b8c9d0';
const MOCK_USER_ID = '64e0a1b2c3d4e5f6a7b8c9d1';

const mocks = vi.hoisted(() => ({
    companySettingsFindOne: vi.fn(),
    companySettingsCreate: vi.fn(),
    companySettingsFindOneAndUpdate: vi.fn(),
    companyFindById: vi.fn(),
    companyFindByIdAndUpdate: vi.fn(),
    entitlementHasFeature: vi.fn(),
    entitlementGetDetails: vi.fn(),
    auditLog: vi.fn(),
}));

vi.mock('../src/modules/companyadmin/settings/company-settings.model', async () => {
    const actual = await vi.importActual('../src/modules/companyadmin/settings/company-settings.model') as any;
    return {
        ...actual,
        CompanySettings: {
            findOne: mocks.companySettingsFindOne,
            create: mocks.companySettingsCreate,
            findOneAndUpdate: mocks.companySettingsFindOneAndUpdate,
        },
        default: {
            findOne: mocks.companySettingsFindOne,
            create: mocks.companySettingsCreate,
            findOneAndUpdate: mocks.companySettingsFindOneAndUpdate,
        },
    };
});

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: mocks.companyFindById,
        findByIdAndUpdate: mocks.companyFindByIdAndUpdate,
    },
    default: {
        findById: mocks.companyFindById,
        findByIdAndUpdate: mocks.companyFindByIdAndUpdate,
    },
}));

vi.mock('../src/services/entitlement.service', () => ({
    EntitlementService: {
        hasFeature: mocks.entitlementHasFeature,
        getEntitlementDetails: mocks.entitlementGetDetails,
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: mocks.auditLog,
    },
}));

describe('WorkSphere Company Settings & Feature Access Engine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        FeatureAccessService.invalidateCache(MOCK_COMPANY_ID);
    });

    describe('Validation Schema (Zod)', () => {
        it('should pass valid full settings update', () => {
            const payload = {
                body: {
                    general: {
                        timezone: 'Asia/Kolkata',
                        currency: 'INR',
                        dateFormat: 'DD/MM/YYYY',
                        language: 'en',
                    },
                    features: {
                        enableLiveMonitoring: true,
                        enableDetailedMonitoring: true,
                        enableQuickMeetings: true,
                        enableChat: false,
                        enableAttendanceAdjustments: true,
                        enableTimesheets: true,
                        enableTaskAttachments: true,
                    },
                    attendancePolicies: {
                        allowSelfServiceCheckIn: true,
                        allowAttendanceAdjustments: true,
                        requireGeofencing: false,
                        requireBiometric: false,
                        autoCheckOut: true,
                        autoCheckOutTime: '19:30',
                        overtimeThresholdMinutes: 540,
                        halfDayThresholdMinutes: 240,
                    },
                    securityPolicies: {
                        minPasswordLength: 10,
                        enforceAdminMfa: true,
                        sessionTimeoutMinutes: 720,
                    },
                },
            };

            const result = updateCompanySettingsSchema.safeParse(payload);
            expect(result.success).toBe(true);
        });

        it('should reject unknown fields (strict schema)', () => {
            const payload = {
                body: {
                    general: {
                        timezone: 'UTC',
                        unknownField: 'malicious',
                    },
                },
            };

            const result = updateCompanySettingsSchema.safeParse(payload);
            expect(result.success).toBe(false);
        });

        it('should reject invalid dateFormat enum', () => {
            const payload = {
                body: {
                    general: {
                        dateFormat: 'INVALID_FORMAT',
                    },
                },
            };

            const result = updateCompanySettingsSchema.safeParse(payload);
            expect(result.success).toBe(false);
        });

        it('should reject minPasswordLength below minimum (8)', () => {
            const payload = {
                body: {
                    securityPolicies: {
                        minPasswordLength: 4,
                    },
                },
            };

            const result = updateCompanySettingsSchema.safeParse(payload);
            expect(result.success).toBe(false);
        });
    });

    describe('CompanySettingsService.getSettings', () => {
        it('should return existing company settings', async () => {
            const existingDoc = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(MOCK_COMPANY_ID),
                general: { timezone: 'Asia/Kolkata', currency: 'INR', dateFormat: 'DD/MM/YYYY', language: 'en' },
                features: { enableLiveMonitoring: true, enableDetailedMonitoring: true },
            };

            mocks.companySettingsFindOne.mockResolvedValue(existingDoc);

            const result = await CompanySettingsService.getSettings(MOCK_COMPANY_ID);
            expect(result).toEqual(existingDoc);
            expect(mocks.companySettingsFindOne).toHaveBeenCalledWith({ companyId: new Types.ObjectId(MOCK_COMPANY_ID) });
        });

        it('should auto-initialize default settings if document does not exist', async () => {
            mocks.companySettingsFindOne.mockResolvedValue(null);
            mocks.companyFindById.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(MOCK_COMPANY_ID),
                    name: 'Acme Corp',
                    timezone: 'Europe/London',
                    currency: 'GBP',
                }),
            });

            const createdDoc = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(MOCK_COMPANY_ID),
                general: { timezone: 'Europe/London', currency: 'GBP', dateFormat: 'DD/MM/YYYY', language: 'en' },
            };
            mocks.companySettingsCreate.mockResolvedValue(createdDoc);

            const result = await CompanySettingsService.getSettings(MOCK_COMPANY_ID);
            expect(result).toEqual(createdDoc);
            expect(mocks.companySettingsCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    companyId: new Types.ObjectId(MOCK_COMPANY_ID),
                    general: expect.objectContaining({ timezone: 'Europe/London', currency: 'GBP' }),
                })
            );
        });

        it('should throw 400 if companyId is invalid', async () => {
            await expect(CompanySettingsService.getSettings('invalid-id')).rejects.toThrow(AppError);
        });
    });

    describe('CompanySettingsService.updateSettings', () => {
        it('should update permitted fields and record audit log', async () => {
            mocks.companyFindById.mockResolvedValue({
                _id: new Types.ObjectId(MOCK_COMPANY_ID),
                name: 'Acme Corp',
                timezone: 'UTC',
                currency: 'USD',
            });

            const updatedDoc = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(MOCK_COMPANY_ID),
                general: { timezone: 'Asia/Kolkata', currency: 'INR' },
                features: { enableChat: false },
            };
            mocks.companySettingsFindOneAndUpdate.mockResolvedValue(updatedDoc);
            mocks.companyFindByIdAndUpdate.mockResolvedValue({});

            const result = await CompanySettingsService.updateSettings(
                MOCK_COMPANY_ID,
                {
                    general: { timezone: 'Asia/Kolkata', currency: 'INR' },
                    features: { enableChat: false },
                },
                MOCK_USER_ID
            );

            expect(result).toEqual(updatedDoc);
            expect(mocks.companyFindByIdAndUpdate).toHaveBeenCalledWith(
                new Types.ObjectId(MOCK_COMPANY_ID),
                { $set: { timezone: 'Asia/Kolkata', currency: 'INR' } }
            );
            expect(mocks.auditLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'COMPANY_SETTINGS_UPDATED',
                    companyId: MOCK_COMPANY_ID,
                    actorId: MOCK_USER_ID,
                })
            );
        });

        it('should block enabling a feature if plan entitlement is disabled', async () => {
            mocks.companyFindById.mockResolvedValue({
                _id: new Types.ObjectId(MOCK_COMPANY_ID),
                name: 'Acme Corp',
            });

            mocks.entitlementGetDetails.mockResolvedValue({
                enabled: false,
                limitType: 'NONE',
                value: null,
            });

            await expect(
                CompanySettingsService.updateSettings(
                    MOCK_COMPANY_ID,
                    {
                        features: { enableLiveMonitoring: true },
                    },
                    MOCK_USER_ID
                )
            ).rejects.toThrow(/subscription plan/);
        });
    });

    describe('FeatureAccessService', () => {
        beforeEach(() => {
            FeatureAccessService.invalidateCache(MOCK_COMPANY_ID);
        });

        it('should allow access when feature is enabled in company and plan', async () => {
            mocks.companySettingsFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    features: { enableLiveMonitoring: true },
                }),
            });
            mocks.entitlementHasFeature.mockResolvedValue(true);
            mocks.entitlementGetDetails.mockResolvedValue({ enabled: true });

            const result = await FeatureAccessService.checkAccess(MOCK_COMPANY_ID, 'enableLiveMonitoring');
            expect(result.allowed).toBe(true);
        });

        it('should deny access when feature is disabled by company setting', async () => {
            mocks.companySettingsFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    features: { enableLiveMonitoring: false },
                }),
            });

            const result = await FeatureAccessService.checkAccess(MOCK_COMPANY_ID, 'enableLiveMonitoring');
            expect(result.allowed).toBe(false);
            expect(result.reason).toBe('FEATURE_DISABLED_BY_COMPANY');
        });

        it('should deny access when feature is not included in subscription plan', async () => {
            mocks.companySettingsFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    features: { enableQuickMeetings: true },
                }),
            });
            mocks.entitlementHasFeature.mockResolvedValue(false);
            mocks.entitlementGetDetails.mockResolvedValue({ enabled: false });

            const result = await FeatureAccessService.checkAccess(MOCK_COMPANY_ID, 'enableQuickMeetings');
            expect(result.allowed).toBe(false);
            expect(result.reason).toBe('PLAN_UPGRADE_REQUIRED');
        });
    });

    describe('requireCompanyFeature Middleware', () => {
        beforeEach(() => {
            FeatureAccessService.invalidateCache(MOCK_COMPANY_ID);
            mocks.entitlementHasFeature.mockResolvedValue(true);
        });

        it('should call next() when feature is allowed', async () => {
            mocks.companySettingsFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    features: { enableChat: true },
                }),
            });
            mocks.entitlementGetDetails.mockResolvedValue({ enabled: true });

            const middleware = requireCompanyFeature('enableChat');
            const req: any = { currentUser: { companyId: MOCK_COMPANY_ID } };
            const res: any = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn(),
            };
            const next = vi.fn();

            await middleware(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should return 403 when feature is disabled', async () => {
            mocks.companySettingsFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    features: { enableChat: false },
                }),
            });

            const middleware = requireCompanyFeature('enableChat');
            const req: any = { currentUser: { companyId: MOCK_COMPANY_ID } };
            const res: any = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn(),
            };
            const next = vi.fn();

            await middleware(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    errors: { code: 'FEATURE_DISABLED_BY_COMPANY' },
                })
            );
        });
    });

    describe('CompanySettingsController', () => {
        it('should return 200 and data on GET /settings', async () => {
            const settingsData = {
                companyId: MOCK_COMPANY_ID,
                general: { timezone: 'UTC', currency: 'USD' },
            };
            vi.spyOn(CompanySettingsService, 'getSettings').mockResolvedValue(settingsData as any);

            const req: any = { currentUser: { companyId: MOCK_COMPANY_ID } };
            const res: any = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn(),
            };

            await CompanySettingsController.getSettings(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                message: 'Company settings retrieved successfully',
                data: settingsData,
            });
        });

        it('should return 200 and updated data on PUT /settings', async () => {
            const updatedData = {
                companyId: MOCK_COMPANY_ID,
                general: { timezone: 'Asia/Kolkata', currency: 'INR' },
            };
            vi.spyOn(CompanySettingsService, 'updateSettings').mockResolvedValue(updatedData as any);

            const req: any = {
                currentUser: { companyId: MOCK_COMPANY_ID, userId: MOCK_USER_ID },
                body: { general: { timezone: 'Asia/Kolkata', currency: 'INR' } },
            };
            const res: any = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn(),
            };

            await CompanySettingsController.updateSettings(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                message: 'Company settings updated successfully',
                data: updatedData,
            });
        });
    });
});
