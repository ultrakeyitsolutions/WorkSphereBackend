import { Types } from 'mongoose';
import { CompanySettings, DEFAULT_GENERAL_SETTINGS, DEFAULT_FEATURE_FLAGS, DEFAULT_ATTENDANCE_POLICIES, DEFAULT_SECURITY_POLICIES } from './company-settings.model';
import { DEFAULT_COMPANY_THEME } from './company-theme.types';
import { CompanyThemeService } from './company-theme.service';
import { CompanyEmailService } from './company-email.service';
import { ICompanySettingsDocument, UpdateCompanySettingsDto } from './company-settings.types';
import { Company } from '../../super-admin/companies/company.model';
import { AppError } from '../../../utils/AppError';
import { FeatureAccessService, FEATURE_ENTITLEMENT_MAP, FeatureFlagKey } from './feature-access.service';
import { FeatureRevocationService } from './feature-revocation.service';
import { EntitlementService } from '../../../services/entitlement.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';
import { Request } from 'express';

export class CompanySettingsService {
    /**
     * Get or initialize settings for a given company.
     * Backfills with company profile values and safe defaults if document does not exist yet.
     */
    static async getSettings(companyId: string): Promise<ICompanySettingsDocument> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const companyObjId = new Types.ObjectId(companyId);

        let settings = await CompanySettings.findOne({ companyId: companyObjId });

        if (!settings) {
            // Find company to inherit timezone/currency if set
            const company = await Company.findById(companyObjId).lean();
            if (!company) {
                throw AppError.notFound('Company not found');
            }

            const initialGeneral = {
                timezone: company.timezone || DEFAULT_GENERAL_SETTINGS.timezone,
                currency: company.currency || DEFAULT_GENERAL_SETTINGS.currency,
                dateFormat: DEFAULT_GENERAL_SETTINGS.dateFormat,
                language: DEFAULT_GENERAL_SETTINGS.language,
            };

            settings = await CompanySettings.create({
                companyId: companyObjId,
                general: initialGeneral,
                features: { ...DEFAULT_FEATURE_FLAGS },
                attendancePolicies: { ...DEFAULT_ATTENDANCE_POLICIES },
                securityPolicies: { ...DEFAULT_SECURITY_POLICIES },
                theme: { ...DEFAULT_COMPANY_THEME },
                schemaVersion: 1,
            });
        }

        if (!settings.theme) {
            settings.theme = { ...DEFAULT_COMPANY_THEME };
        }

        return settings;
    }

    /**
     * Update permitted company settings with validation, subscription entitlement checks,
     * atomic field patching, profile sync, and audit logging.
     */
    static async updateSettings(
        companyId: string,
        dto: UpdateCompanySettingsDto,
        updatedByUserId: string,
        req?: Request
    ): Promise<ICompanySettingsDocument> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const companyObjId = new Types.ObjectId(companyId);
        const userObjId = updatedByUserId && Types.ObjectId.isValid(updatedByUserId)
            ? new Types.ObjectId(updatedByUserId)
            : null;

        // Ensure company exists
        const company = await Company.findById(companyObjId);
        if (!company) {
            throw AppError.notFound('Company not found');
        }

        // ── 1. Plan Entitlement Verification ─────────────────────────────────
        // Prevent Company Admin from enabling features that are forbidden by Super Admin plan
        if (dto.features) {
            for (const [key, value] of Object.entries(dto.features)) {
                if (value === true) {
                    const entitlementKey = FEATURE_ENTITLEMENT_MAP[key as FeatureFlagKey];
                    if (entitlementKey) {
                        try {
                            const details = await EntitlementService.getEntitlementDetails(companyId, entitlementKey);
                            if (details && !details.enabled) {
                                throw AppError.forbidden(
                                    `Cannot enable '${key}'. This feature is not included in your organization's subscription plan.`
                                );
                            }
                        } catch (err: any) {
                            if (err instanceof AppError) throw err;
                        }
                    }
                }
            }
        }

        // ── 2. Delegate Theme Updates if Present ─────────────────────────────
        if (dto.theme) {
            await CompanyThemeService.updateTheme(companyId, dto.theme, updatedByUserId, req);
        }

        // ── 2b. Delegate Email Updates if Present ────────────────────────────
        if (dto.email) {
            await CompanyEmailService.updateEmailSettings(companyId, dto.email, updatedByUserId, req);
        }

        // ── 3. Build Atomic Update Query ─────────────────────────────────────
        const setQuery: Record<string, any> = {
            updatedBy: userObjId,
        };

        if (dto.general) {
            for (const [k, v] of Object.entries(dto.general)) {
                if (v !== undefined) {
                    setQuery[`general.${k}`] = v;
                }
            }
        }

        if (dto.features) {
            for (const [k, v] of Object.entries(dto.features)) {
                if (v !== undefined) {
                    setQuery[`features.${k}`] = v;
                }
            }
        }

        if (dto.attendancePolicies) {
            for (const [k, v] of Object.entries(dto.attendancePolicies)) {
                if (v !== undefined) {
                    setQuery[`attendancePolicies.${k}`] = v;
                }
            }
        }

        if (dto.securityPolicies) {
            for (const [k, v] of Object.entries(dto.securityPolicies)) {
                if (v !== undefined) {
                    setQuery[`securityPolicies.${k}`] = v;
                }
            }
        }

        // Build $setOnInsert query with dot notation to prevent MongoDB path conflicts with $set
        const setOnInsertQuery: Record<string, any> = {
            schemaVersion: 1,
        };

        for (const [k, v] of Object.entries(DEFAULT_GENERAL_SETTINGS)) {
            if (setQuery[`general.${k}`] === undefined) {
                setOnInsertQuery[`general.${k}`] =
                    k === 'timezone'
                        ? company.timezone || v
                        : k === 'currency'
                          ? company.currency || v
                          : v;
            }
        }

        for (const [k, v] of Object.entries(DEFAULT_FEATURE_FLAGS)) {
            if (setQuery[`features.${k}`] === undefined) {
                setOnInsertQuery[`features.${k}`] = v;
            }
        }

        for (const [k, v] of Object.entries(DEFAULT_ATTENDANCE_POLICIES)) {
            if (setQuery[`attendancePolicies.${k}`] === undefined) {
                setOnInsertQuery[`attendancePolicies.${k}`] = v;
            }
        }

        for (const [k, v] of Object.entries(DEFAULT_SECURITY_POLICIES)) {
            if (setQuery[`securityPolicies.${k}`] === undefined) {
                setOnInsertQuery[`securityPolicies.${k}`] = v;
            }
        }

        setOnInsertQuery['theme'] = DEFAULT_COMPANY_THEME;

        // Upsert company settings safely without path conflicts
        const updatedSettings = await CompanySettings.findOneAndUpdate(
            { companyId: companyObjId },
            {
                $set: setQuery,
                $setOnInsert: setOnInsertQuery,
            },
            {
                new: true,
                upsert: true,
                runValidators: true,
            }
        );

        // ── 3. Synchronize General Profile Properties ─────────────────────────
        const companyUpdates: Record<string, any> = {};
        if (dto.general?.timezone && dto.general.timezone !== company.timezone) {
            companyUpdates.timezone = dto.general.timezone;
        }
        if (dto.general?.currency && dto.general.currency !== company.currency) {
            companyUpdates.currency = dto.general.currency;
        }

        if (Object.keys(companyUpdates).length > 0) {
            await Company.findByIdAndUpdate(companyObjId, { $set: companyUpdates });
        }

        // ── 4. Invalidate In-Memory Feature Flag Cache & Evict Sockets ───────────
        FeatureAccessService.invalidateCache(companyId);

        const disabledFeatures: FeatureFlagKey[] = [];
        if (dto.features) {
            for (const [key, val] of Object.entries(dto.features)) {
                if (val === false) {
                    disabledFeatures.push(key as FeatureFlagKey);
                }
            }
        }

        if (disabledFeatures.length > 0) {
            await FeatureRevocationService.revokeCompanyFeatures(companyId, disabledFeatures);
        }

        // ── 5. Audit Logging ─────────────────────────────────────────────────
        try {
            await AuditLogService.log({
                action: AuditAction.COMPANY_SETTINGS_UPDATED,
                actorId: updatedByUserId || null,
                companyId: String(companyObjId),
                companyName: company.name,
                metadata: {
                    updatedSections: Object.keys(dto),
                    changedFields: Object.keys(setQuery).filter((k) => k !== 'updatedBy'),
                },
                success: true,
                description: `Company settings updated by user ${updatedByUserId}`,
                req,
            });
        } catch {
            // Audit log failure shouldn't fail the transaction
        }

        return updatedSettings;
    }
}
