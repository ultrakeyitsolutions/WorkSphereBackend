import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import {
    getRelativeLuminance,
    getContrastRatio,
    checkWCAG,
    suggestReadableForeground,
    validateThemePaletteContrast,
    blendWithBackground,
    parseColorToRgb,
} from '../src/modules/companyadmin/settings/color-contrast.utils';
import {
    DEFAULT_COMPANY_THEME,
    DEFAULT_LIGHT_PALETTE,
    DEFAULT_DARK_PALETTE,
} from '../src/modules/companyadmin/settings/company-theme.types';
import {
    colorStringSchema,
    modePaletteSchema,
    normalizePaletteTokens,
} from '../src/modules/companyadmin/settings/company-theme.validator';
import { CompanyThemeService } from '../src/modules/companyadmin/settings/company-theme.service';
import { CompanySettings } from '../src/modules/companyadmin/settings/company-settings.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { User } from '../src/modules/users/user.model';
import companySettingsRouter from '../src/modules/companyadmin/settings/company-settings.routes';
import { authenticate } from '../src/middleware/auth.middleware';

// Mock DB Models
vi.mock('../src/modules/companyadmin/settings/company-settings.model', () => ({
    CompanySettings: {
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        create: vi.fn(),
    },
    DEFAULT_GENERAL_SETTINGS: {
        timezone: 'UTC',
        currency: 'USD',
        dateFormat: 'DD/MM/YYYY',
        language: 'en',
    },
    DEFAULT_FEATURE_FLAGS: {
        enableLiveMonitoring: true,
        enableDetailedMonitoring: true,
        enableQuickMeetings: true,
        enableChat: true,
        enableAttendanceAdjustments: true,
        enableTimesheets: true,
        enableTaskAttachments: true,
    },
    DEFAULT_ATTENDANCE_POLICIES: {
        allowSelfServiceCheckIn: true,
        allowAttendanceAdjustments: true,
        requireGeofencing: false,
        requireBiometric: false,
        autoCheckOut: false,
        autoCheckOutTime: '20:00',
        overtimeThresholdMinutes: 480,
        halfDayThresholdMinutes: 240,
    },
    DEFAULT_SECURITY_POLICIES: {
        minPasswordLength: 8,
        enforceAdminMfa: false,
        sessionTimeoutMinutes: 1440,
    },
}));

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: vi.fn(),
        findOne: vi.fn(),
        findByIdAndUpdate: vi.fn(),
    },
}));

vi.mock('../src/modules/users/user.model', () => {
    const UserModel: any = function (this: any, data: any) {
        Object.assign(this, data);
        this._id = new Types.ObjectId();
        this.save = vi.fn().mockResolvedValue(this);
    };
    UserModel.findOne = vi.fn();
    UserModel.findById = vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue({
            _id: new Types.ObjectId(),
            isActive: true,
            status: 'ACTIVE',
            companyId: new Types.ObjectId(),
            role: { name: 'COMPANY_ADMIN' },
        }),
    });
    return { User: UserModel };
});

import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { CompanyThemeEntitlementService } from '../src/modules/companyadmin/settings/company-theme-entitlement.service';

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        findOne: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/features/features.model', () => ({
    Feature: {
        findOne: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/plan-features/plan-features.model', () => ({
    PlanFeature: {
        findOne: vi.fn(),
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn().mockResolvedValue(true),
    },
}));

// Build Test Express App
const app = express();
app.use(express.json());
app.use('/api/v1/company/settings', authenticate, companySettingsRouter);

describe('Company Theme Customization Backend', () => {
    const companyAId = new Types.ObjectId().toString();
    const companyBId = new Types.ObjectId().toString();

    const companyAdminToken = generateAccessToken({
        userId: 'admin_user_1',
        email: 'admin@companya.com',
        role: 'COMPANY_ADMIN',
        companyId: companyAId,
    });

    const employeeToken = generateAccessToken({
        userId: 'emp_user_2',
        email: 'emp@companya.com',
        role: 'EMPLOYEE',
        companyId: companyAId,
    });

    const superAdminToken = generateAccessToken({
        userId: 'super_admin_3',
        email: 'super@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    beforeEach(() => {
        vi.clearAllMocks();
        CompanyThemeEntitlementService.clearAllCache();
        CompanyThemeService.clearAllCache();

        // Default mock for user lookup in authenticate middleware
        vi.mocked(User.findById).mockReturnValue({
            populate: vi.fn().mockResolvedValue({
                _id: new Types.ObjectId(),
                isActive: true,
                status: 'ACTIVE',
                companyId: new Types.ObjectId(companyAId),
                role: { name: 'COMPANY_ADMIN' },
            }),
        } as any);

        vi.mocked(Company.findById).mockResolvedValue({
            _id: new Types.ObjectId(companyAId),
            name: 'Company A Corp',
            isActive: true,
            status: 'ACTIVE',
        } as any);

        // Default mock for Subscription: Active YEARLY subscription (entitled)
        vi.mocked(Subscription.findOne).mockReturnValue({
            sort: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        _id: new Types.ObjectId(),
                        companyId: new Types.ObjectId(companyAId),
                        status: 'ACTIVE',
                        planId: {
                            _id: new Types.ObjectId(),
                            name: 'Enterprise Plan',
                            billingCycle: 'YEARLY',
                        },
                    }),
                }),
            }),
        } as any);
    });

    // ── 1. Color Contrast & WCAG Calculations ─────────────────────────────────
    describe('WCAG Relative Luminance & Contrast Calculation', () => {
        it('calculates expected luminance for pure white (1.0) and pure black (0.0)', () => {
            expect(getRelativeLuminance('#FFFFFF')).toBeCloseTo(1.0, 2);
            expect(getRelativeLuminance('#000000')).toBeCloseTo(0.0, 2);
        });

        it('calculates maximum contrast ratio 21:1 for black on white', () => {
            const ratio = getContrastRatio('#000000', '#FFFFFF');
            expect(ratio).toBe(21);
        });

        it('calculates ratio 1:1 for identical colors', () => {
            const ratio = getContrastRatio('#3B82F6', '#3B82F6');
            expect(ratio).toBe(1);
        });

        it('verifies standard text contrast threshold (4.5:1) passes or fails correctly', () => {
            const passCheck = checkWCAG('#0F172A', '#FFFFFF', 4.5);
            expect(passCheck.passes).toBe(true);
            expect(passCheck.level).toBe('AAA');

            // Low contrast pairing (light gray on white)
            const failCheck = checkWCAG('#CCCCCC', '#FFFFFF', 4.5);
            expect(failCheck.passes).toBe(false);
            expect(failCheck.level).toBe('Fail');
        });

        it('correctly blends translucent overlay colors with opaque background', () => {
            const blended = blendWithBackground(
                { r: 255, g: 255, b: 255, a: 0.5 },
                { r: 0, g: 0, b: 0 }
            );
            expect(blended.r).toBe(128);
            expect(blended.g).toBe(128);
            expect(blended.b).toBe(128);
        });

        it('suggests readable foreground (white or dark slate)', () => {
            const forDarkBg = suggestReadableForeground('#0A1B30', 4.5);
            expect(forDarkBg).toBe('#FFFFFF');

            const forLightBg = suggestReadableForeground('#F8FAFC', 4.5);
            expect(forLightBg).toBe('#0F172A');
        });

        it('validates that default Light and Dark mode palettes pass all 14 contrast checks', () => {
            const lightResults = validateThemePaletteContrast(DEFAULT_LIGHT_PALETTE, 'light');
            expect(lightResults.every((r) => r.passes)).toBe(true);

            const darkResults = validateThemePaletteContrast(DEFAULT_DARK_PALETTE, 'dark');
            expect(darkResults.every((r) => r.passes)).toBe(true);
        });

        it('detects contrast failures when unreadable foreground/background pairs are provided', () => {
            const invalidPalette = {
                ...DEFAULT_LIGHT_PALETTE,
                buttonPrimaryBackground: '#F0F0F0',
                buttonPrimaryForeground: '#FFFFFF', // White text on white/gray button!
            };
            const results = validateThemePaletteContrast(invalidPalette, 'light');
            const buttonFailure = results.find((r) => r.id === 'button-primary');
            expect(buttonFailure).toBeDefined();
            expect(buttonFailure?.passes).toBe(false);
            expect(buttonFailure?.requiredRatio).toBe(3.0);
            expect(buttonFailure?.suggestedForeground).toBe('#0F172A');
        });
    });

    // ── 2. Color String and Token Validation ──────────────────────────────────
    describe('Color & Token Schema Validation', () => {
        it('accepts valid 6-char, 3-char, 8-char HEX, and rgba colors', () => {
            expect(colorStringSchema.safeParse('#2563EB').success).toBe(true);
            expect(colorStringSchema.safeParse('#FFF').success).toBe(true);
            expect(colorStringSchema.safeParse('#2563EBFF').success).toBe(true);
            expect(colorStringSchema.safeParse('rgba(255, 255, 255, 0.65)').success).toBe(true);
        });

        it('rejects invalid hex characters and malformed colors', () => {
            expect(colorStringSchema.safeParse('#GGGGGG').success).toBe(false);
            expect(colorStringSchema.safeParse('#12345').success).toBe(false);
            expect(colorStringSchema.safeParse('not-a-color').success).toBe(false);
        });

        it('rejects dangerous CSS injection attempts and URL expressions', () => {
            expect(colorStringSchema.safeParse("url('http://attacker.com/leak')").success).toBe(false);
            expect(colorStringSchema.safeParse('expression(alert(1))').success).toBe(false);
            expect(colorStringSchema.safeParse('<script>').success).toBe(false);
            expect(colorStringSchema.safeParse('javascript:void(0)').success).toBe(false);
        });

        it('rejects unrecognized token keys', () => {
            const result = modePaletteSchema.safeParse({
                sidebarBackground: '#FFFFFF',
                unknownTokenName: '#123456',
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0]?.message).toContain('Unrecognized theme token key');
            }
        });

        it('normalizes kebab-case token names to canonical camelCase', () => {
            const raw = {
                'sidebar-background': '#123456',
                'app-background': '#F8FAFC',
                'brand-primary': '#0055FF',
            };
            const normalized = normalizePaletteTokens(raw);
            expect(normalized.sidebarBackground).toBe('#123456');
            expect(normalized.appBackground).toBe('#F8FAFC');
            expect(normalized.brandPrimary).toBe('#0055FF');
        });
    });

    // ── 3. CompanyThemeService Persistence & Merging ──────────────────────────
    describe('CompanyThemeService Persistence & Merging', () => {
        it('returns safe default theme when company has no theme record yet', async () => {
            vi.mocked(CompanySettings.findOne).mockResolvedValue(null);

            const theme = await CompanyThemeService.getTheme(companyAId);
            expect(theme.version).toBe(1);
            expect(theme.light).toEqual(DEFAULT_LIGHT_PALETTE);
            expect(theme.dark).toEqual(DEFAULT_DARK_PALETTE);
        });

        it('supports independent updates to light mode while preserving dark mode', async () => {
            const mockSettings: any = {
                companyId: new Types.ObjectId(companyAId),
                theme: {
                    version: 1,
                    light: { ...DEFAULT_LIGHT_PALETTE },
                    dark: { ...DEFAULT_DARK_PALETTE },
                },
            };
            vi.mocked(CompanySettings.findOne).mockResolvedValue(mockSettings);
            vi.mocked(CompanySettings.findOneAndUpdate).mockResolvedValue(mockSettings);

            const result = await CompanyThemeService.updateTheme(
                companyAId,
                {
                    light: {
                        brandPrimary: '#1D4ED8',
                        brandOnPrimary: '#FFFFFF',
                    },
                },
                'admin_user_1'
            );

            expect(result.version).toBe(2);
            expect(result.light.brandPrimary).toBe('#1D4ED8');
            expect(result.dark.brandPrimary).toBe(DEFAULT_DARK_PALETTE.brandPrimary);
        });

        it('rejects update with 422 structured error when contrast validation fails', async () => {
            const mockSettings: any = {
                companyId: new Types.ObjectId(companyAId),
                theme: { ...DEFAULT_COMPANY_THEME },
            };
            vi.mocked(CompanySettings.findOne).mockResolvedValue(mockSettings);

            await expect(
                CompanyThemeService.updateTheme(
                    companyAId,
                    {
                        light: {
                            buttonPrimaryBackground: '#FFFFFF',
                            buttonPrimaryForeground: '#EEEEEE', // Low contrast!
                        },
                    },
                    'admin_user_1'
                )
            ).rejects.toMatchObject({
                statusCode: 422,
                errors: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'button-primary',
                        passes: false,
                    }),
                ]),
            });
        });

        it('resets theme to WorkSphere defaults and increments version', async () => {
            const mockSettings: any = {
                companyId: new Types.ObjectId(companyAId),
                theme: {
                    version: 3,
                    light: { ...DEFAULT_LIGHT_PALETTE, brandPrimary: '#FF0000' },
                    dark: { ...DEFAULT_DARK_PALETTE },
                },
            };
            vi.mocked(CompanySettings.findOne).mockResolvedValue(mockSettings);
            vi.mocked(CompanySettings.findOneAndUpdate).mockResolvedValue(mockSettings);

            const resetResult = await CompanyThemeService.resetTheme(companyAId, 'admin_user_1');
            expect(resetResult.version).toBe(4);
            expect(resetResult.light.brandPrimary).toBe(DEFAULT_LIGHT_PALETTE.brandPrimary);
        });
    });

    // ── 4. End-to-End API Authorization & Tenant Isolation ───────────────────
    describe('API Authorization & Tenant Isolation', () => {
        it('allows Company Admin to retrieve company theme (GET /theme)', async () => {
            vi.mocked(CompanySettings.findOne).mockResolvedValue({
                companyId: new Types.ObjectId(companyAId),
                theme: DEFAULT_COMPANY_THEME,
            } as any);

            const res = await request(app)
                .get('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${companyAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.version).toBe(1);
            expect(res.body.data.light.sidebarBackground).toBe(DEFAULT_LIGHT_PALETTE.sidebarBackground);
        });

        it('allows Employee to retrieve company theme (read-only)', async () => {
            vi.mocked(User.findById).mockReturnValue({
                populate: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    isActive: true,
                    status: 'ACTIVE',
                    companyId: new Types.ObjectId(companyAId),
                    role: { name: 'EMPLOYEE' },
                }),
            } as any);

            vi.mocked(CompanySettings.findOne).mockResolvedValue({
                companyId: new Types.ObjectId(companyAId),
                theme: DEFAULT_COMPANY_THEME,
            } as any);

            const res = await request(app)
                .get('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.version).toBe(1);
        });

        it('forbids Employee from updating company theme (PUT /theme) with 403', async () => {
            vi.mocked(User.findById).mockReturnValue({
                populate: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    isActive: true,
                    status: 'ACTIVE',
                    companyId: new Types.ObjectId(companyAId),
                    role: { name: 'EMPLOYEE' },
                }),
            } as any);

            const res = await request(app)
                .put('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    light: { brandPrimary: '#1D4ED8' },
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
        });

        it('forbids Employee from resetting company theme (POST /theme/reset) with 403', async () => {
            vi.mocked(User.findById).mockReturnValue({
                populate: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    isActive: true,
                    status: 'ACTIVE',
                    companyId: new Types.ObjectId(companyAId),
                    role: { name: 'EMPLOYEE' },
                }),
            } as any);

            const res = await request(app)
                .post('/api/v1/company/settings/theme/reset')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
        });

        it('rejects unauthenticated requests to theme endpoints with 401', async () => {
            const res = await request(app).get('/api/v1/company/settings/theme');
            expect(res.status).toBe(401);
        });

        it('allows Company Admin to update company theme with valid palette', async () => {
            vi.mocked(CompanySettings.findOne).mockResolvedValue({
                companyId: new Types.ObjectId(companyAId),
                theme: DEFAULT_COMPANY_THEME,
            } as any);
            vi.mocked(CompanySettings.findOneAndUpdate).mockResolvedValue({
                companyId: new Types.ObjectId(companyAId),
            } as any);

            const res = await request(app)
                .put('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    light: {
                        brandPrimary: '#2563EB',
                        brandOnPrimary: '#FFFFFF',
                    },
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.light.brandPrimary).toBe('#2563EB');
        });

        it('enforces strict tenant isolation: non-Super Admin cannot target another company', async () => {
            vi.mocked(CompanySettings.findOne).mockResolvedValue({
                companyId: new Types.ObjectId(companyAId),
                theme: DEFAULT_COMPANY_THEME,
            } as any);

            // User token has companyAId. User maliciously provides ?companyId=companyBId
            const res = await request(app)
                .get(`/api/v1/company/settings/theme?companyId=${companyBId}`)
                .set('Authorization', `Bearer ${companyAdminToken}`);

            expect(res.status).toBe(200);
            // Verify CompanySettings.findOne was invoked with trusted companyAId, NOT companyBId!
            expect(CompanySettings.findOne).toHaveBeenCalledWith({
                companyId: new Types.ObjectId(companyAId),
            });
        });

        it('rejects unknown tokens with 422 Validation Error', async () => {
            const res = await request(app)
                .put('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    light: {
                        unrecognizedTokenKey: '#FFFFFF',
                    },
                });

            expect(res.status).toBe(422);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Validation Error');
        });

        it('tolerates and strips round-tripped metadata keys like companyId and updatedAt', async () => {
            vi.mocked(CompanySettings.findOne).mockResolvedValue({
                companyId: new Types.ObjectId(companyAId),
                theme: DEFAULT_COMPANY_THEME,
            } as any);

            const res = await request(app)
                .put('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    companyId: companyAId,
                    updatedAt: new Date().toISOString(),
                    version: 1,
                    light: {
                        brandPrimary: '#1D4ED8',
                    },
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('rejects malformed and low-contrast palettes with 422 Unprocessable Entity', async () => {
            vi.mocked(CompanySettings.findOne).mockResolvedValue({
                companyId: new Types.ObjectId(companyAId),
                theme: DEFAULT_COMPANY_THEME,
            } as any);

            const res = await request(app)
                .put('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    light: {
                        textPrimary: '#FFFFFF',
                        appBackground: '#FFFFFF', // Zero contrast!
                    },
                });

            expect(res.status).toBe(422);
            expect(res.body.success).toBe(false);
            expect(res.body.errors).toBeDefined();
            expect(res.body.errors.length).toBeGreaterThan(0);
        });

        it('preserves unrelated company settings during theme updates', async () => {
            const originalGeneral = {
                timezone: 'America/New_York',
                currency: 'USD',
                dateFormat: 'YYYY-MM-DD',
                language: 'en',
            };
            const mockSettings: any = {
                companyId: new Types.ObjectId(companyAId),
                general: originalGeneral,
                theme: { ...DEFAULT_COMPANY_THEME },
            };
            vi.mocked(CompanySettings.findOne).mockResolvedValue(mockSettings);
            vi.mocked(CompanySettings.findOneAndUpdate).mockResolvedValue(mockSettings);

            await CompanyThemeService.updateTheme(
                companyAId,
                { light: { brandPrimary: '#1E40AF' } },
                'admin_user_1'
            );

            // Verify general settings was not modified or overwritten
            expect(mockSettings.general).toEqual(originalGeneral);
        });
    });

    // ── 5. Subscription Entitlement, Read-Only Lifecycle & Realtime ──────────
    describe('Subscription Entitlement, Read-Only Lifecycle & Realtime', () => {
        it('allows Active Semi-Annual subscription to update company theme', async () => {
            vi.mocked(Subscription.findOne).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            _id: new Types.ObjectId(),
                            companyId: new Types.ObjectId(companyAId),
                            status: 'ACTIVE',
                            planId: {
                                _id: new Types.ObjectId(),
                                name: 'Growth Semi-Annual',
                                billingCycle: 'SEMI_ANNUAL',
                            },
                        }),
                    }),
                }),
            } as any);

            vi.mocked(CompanySettings.findOne).mockResolvedValue({
                companyId: new Types.ObjectId(companyAId),
                theme: DEFAULT_COMPANY_THEME,
            } as any);

            const res = await request(app)
                .put('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    light: { brandPrimary: '#1E40AF' },
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.entitlement.isEntitled).toBe(true);
            expect(res.body.data.entitlement.reasonCode).toBe('ENTITLED');
        });

        it('blocks Monthly subscription from updating theme with 403 Forbidden', async () => {
            vi.mocked(Subscription.findOne).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            _id: new Types.ObjectId(),
                            companyId: new Types.ObjectId(companyAId),
                            status: 'ACTIVE',
                            planId: {
                                _id: new Types.ObjectId(),
                                name: 'Starter Monthly',
                                billingCycle: 'MONTHLY',
                            },
                        }),
                    }),
                }),
            } as any);

            const res = await request(app)
                .put('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    light: { brandPrimary: '#1E40AF' },
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Semi-Annual or Annual');
        });

        it('blocks Expired subscription from updating theme with 403 Forbidden', async () => {
            vi.mocked(Subscription.findOne).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            _id: new Types.ObjectId(),
                            companyId: new Types.ObjectId(companyAId),
                            status: 'EXPIRED',
                            planId: {
                                _id: new Types.ObjectId(),
                                name: 'Enterprise Annual',
                                billingCycle: 'YEARLY',
                            },
                        }),
                    }),
                }),
            } as any);

            const res = await request(app)
                .put('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    light: { brandPrimary: '#1E40AF' },
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('expired');
        });

        it('blocks Cancelled subscription from updating theme with 403 Forbidden', async () => {
            vi.mocked(Subscription.findOne).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            _id: new Types.ObjectId(),
                            companyId: new Types.ObjectId(companyAId),
                            status: 'CANCELLED',
                            planId: {
                                _id: new Types.ObjectId(),
                                name: 'Enterprise Annual',
                                billingCycle: 'YEARLY',
                            },
                        }),
                    }),
                }),
            } as any);

            const res = await request(app)
                .put('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    light: { brandPrimary: '#1E40AF' },
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('CANCELLED');
        });

        it('preserves saved theme in read-only mode for downgraded / expired company on GET /theme', async () => {
            vi.mocked(Subscription.findOne).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            _id: new Types.ObjectId(),
                            companyId: new Types.ObjectId(companyAId),
                            status: 'EXPIRED',
                            planId: {
                                _id: new Types.ObjectId(),
                                name: 'Enterprise Annual',
                                billingCycle: 'YEARLY',
                            },
                        }),
                    }),
                }),
            } as any);

            // Existing customized palette from when company was annual
            const customizedTheme = {
                version: 4,
                light: { ...DEFAULT_LIGHT_PALETTE, brandPrimary: '#9333EA' },
                dark: { ...DEFAULT_DARK_PALETTE },
                updatedAt: new Date(),
                updatedBy: new Types.ObjectId(),
            };

            vi.mocked(CompanySettings.findOne).mockResolvedValue({
                companyId: new Types.ObjectId(companyAId),
                theme: customizedTheme,
            } as any);

            const res = await request(app)
                .get('/api/v1/company/settings/theme')
                .set('Authorization', `Bearer ${companyAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            // Preserved custom brand color is returned
            expect(res.body.data.light.brandPrimary).toBe('#9333EA');
            expect(res.body.data.version).toBe(4);
            // Clearly marked as read-only and unentitled
            expect(res.body.data.entitlement.isEntitled).toBe(false);
            expect(res.body.data.entitlement.isReadOnly).toBe(true);
            expect(res.body.data.entitlement.reasonCode).toBe('SUBSCRIPTION_EXPIRED');
        });

        it('allows Company Admin to retrieve dedicated entitlement status (GET /theme/entitlement)', async () => {
            vi.mocked(Subscription.findOne).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            _id: new Types.ObjectId(),
                            companyId: new Types.ObjectId(companyAId),
                            status: 'ACTIVE',
                            planId: {
                                _id: new Types.ObjectId(),
                                name: 'Enterprise Annual',
                                billingCycle: 'YEARLY',
                            },
                        }),
                    }),
                }),
            } as any);

            const res = await request(app)
                .get('/api/v1/company/settings/theme/entitlement')
                .set('Authorization', `Bearer ${companyAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.isEntitled).toBe(true);
            expect(res.body.data.isReadOnly).toBe(false);
            expect(res.body.data.billingCycle).toBe('YEARLY');
            expect(res.body.data.planName).toBe('Enterprise Annual');
        });

        it('forbids Employee from querying dedicated GET /theme/entitlement with 403', async () => {
            vi.mocked(User.findById).mockReturnValue({
                populate: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    isActive: true,
                    status: 'ACTIVE',
                    companyId: new Types.ObjectId(companyAId),
                    role: { name: 'EMPLOYEE' },
                }),
            } as any);

            const res = await request(app)
                .get('/api/v1/company/settings/theme/entitlement')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
        });

        it('serves theme reads from in-memory cache without repeating DB queries', async () => {
            const mockSettings: any = {
                companyId: new Types.ObjectId(companyAId),
                theme: {
                    version: 1,
                    light: { ...DEFAULT_LIGHT_PALETTE },
                    dark: { ...DEFAULT_DARK_PALETTE },
                },
            };
            vi.mocked(CompanySettings.findOne).mockResolvedValue(mockSettings);

            // First call hits findOne
            const res1 = await CompanyThemeService.getTheme(companyAId);
            expect(res1.version).toBe(1);
            expect(CompanySettings.findOne).toHaveBeenCalledTimes(1);

            // Second call hits in-memory cache
            const res2 = await CompanyThemeService.getTheme(companyAId);
            expect(res2.version).toBe(1);
            expect(CompanySettings.findOne).toHaveBeenCalledTimes(1);

            // Invalidate cache
            CompanyThemeService.invalidateCache(companyAId);

            // Third call queries DB again
            const res3 = await CompanyThemeService.getTheme(companyAId);
            expect(res3.version).toBe(1);
            expect(CompanySettings.findOne).toHaveBeenCalledTimes(2);
        });
    });
});
