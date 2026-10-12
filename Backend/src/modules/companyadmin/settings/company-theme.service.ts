/**
 * WorkSphere — Centralized Company Theme Service
 * Authoritative persistence, contrast validation, tenant protection, and subscription-gated updates.
 */

import { Types } from 'mongoose';
import { Request } from 'express';
import { CompanySettings } from './company-settings.model';
import { Company } from '../../super-admin/companies/company.model';
import {
    ICompanyThemeConfig,
    ICompanyThemePalette,
    DEFAULT_COMPANY_THEME,
    DEFAULT_LIGHT_PALETTE,
    DEFAULT_DARK_PALETTE,
    UpdateThemeDto,
    IContrastCheckResult,
} from './company-theme.types';
import { normalizePaletteTokens } from './company-theme.validator';
import { validateThemePaletteContrast } from './color-contrast.utils';
import { CompanyThemeEntitlementService } from './company-theme-entitlement.service';
import { CompanyThemeRealtimeService } from './company-theme-realtime.service';
import { AppError } from '../../../utils/AppError';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';

interface CachedThemeEntry {
    theme: ICompanyThemeConfig;
    cachedAt: number;
}

const themeCache = new Map<string, CachedThemeEntry>();
const THEME_CACHE_TTL_MS = 60 * 1000; // 60s TTL for read scalability

export class CompanyThemeService {
    /**
     * Invalidate in-memory theme cache for a company.
     */
    static invalidateCache(companyId: string): void {
        themeCache.delete(String(companyId));
    }

    /**
     * Clear all cached theme entries across the worker.
     */
    static clearAllCache(): void {
        themeCache.clear();
    }

    /**
     * Retrieve the active theme configuration for a company.
     * Guaranteed backward compatibility: returns default palette if company has not customized its theme.
     * Includes server-authoritative entitlement status for frontend client rendering.
     */
    static async getTheme(companyId: string): Promise<ICompanyThemeConfig> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const normalizedCompanyId = String(companyId);
        const now = Date.now();
        const cached = themeCache.get(normalizedCompanyId);

        if (cached && now - cached.cachedAt < THEME_CACHE_TTL_MS) {
            return cached.theme;
        }

        const companyObjId = new Types.ObjectId(companyId);

        // Fetch company settings and entitlement concurrently
        const [settings, entitlement] = await Promise.all([
            CompanySettings.findOne({ companyId: companyObjId }),
            CompanyThemeEntitlementService.checkEntitlement(companyId),
        ]);

        let customThemeConfigured = false;
        let version = 1;
        let lightPalette = { ...DEFAULT_LIGHT_PALETTE };
        let darkPalette = { ...DEFAULT_DARK_PALETTE };
        let updatedAt: Date | undefined;
        let updatedBy: string | null = null;

        if (settings && settings.theme) {
            version = settings.theme.version || 1;
            updatedAt = settings.theme.updatedAt;
            updatedBy = settings.theme.updatedBy ? String(settings.theme.updatedBy) : null;

            if (settings.theme.light) {
                const rawLight = (settings.theme.light as any).toObject?.() || settings.theme.light;
                lightPalette = { ...DEFAULT_LIGHT_PALETTE, ...rawLight };
            }

            if (settings.theme.dark) {
                const rawDark = (settings.theme.dark as any).toObject?.() || settings.theme.dark;
                darkPalette = { ...DEFAULT_DARK_PALETTE, ...rawDark };
            }

            // Determine whether custom configuration exists beyond default
            customThemeConfigured = Boolean(
                version > 1 ||
                (settings.theme.updatedAt && settings.theme.updatedBy)
            );
        }

        const result: ICompanyThemeConfig = {
            version,
            light: lightPalette,
            dark: darkPalette,
            updatedAt,
            updatedBy,
            customThemeConfigured,
            entitlement: {
                isEntitled: entitlement.isEntitled,
                isReadOnly: entitlement.isReadOnly,
                reasonCode: entitlement.reasonCode,
                message: entitlement.message,
                billingCycle: entitlement.billingCycle,
                planName: entitlement.planName,
                status: entitlement.status,
            },
        };

        // Cache the result
        themeCache.set(normalizedCompanyId, {
            theme: result,
            cachedAt: now,
        });

        return result;
    }

    /**
     * Authoritatively updates company theme with:
     * 1. Server-side subscription entitlement verification (Semi-Annual / Annual required)
     * 2. Strict WCAG 2.1 AA/AAA contrast validation
     * 3. Token normalization and safety allowlist
     * 4. Atomic MongoDB persistence
     * 5. Real-time propagation & cross-worker cache eviction
     */
    static async updateTheme(
        companyId: string,
        dto: UpdateThemeDto,
        updatedByUserId: string,
        req?: Request
    ): Promise<ICompanyThemeConfig> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const companyObjId = new Types.ObjectId(companyId);
        const userObjId = updatedByUserId && Types.ObjectId.isValid(updatedByUserId)
            ? new Types.ObjectId(updatedByUserId)
            : null;

        // Ensure target company exists
        const company = await Company.findById(companyObjId);
        if (!company) {
            throw AppError.notFound('Company not found');
        }

        // ── 0. Server-Authoritative Subscription Entitlement Gate ─────────────
        const entitlement = await CompanyThemeEntitlementService.checkEntitlement(companyId);
        if (!entitlement.isEntitled) {
            throw AppError.forbidden(
                entitlement.message || 'Custom company themes require an active Semi-Annual or Annual subscription plan.'
            );
        }

        // Fetch current company settings (or initialize defaults if missing)
        let settings = await CompanySettings.findOne({ companyId: companyObjId });
        if (!settings) {
            settings = await CompanySettings.create({
                companyId: companyObjId,
                theme: { ...DEFAULT_COMPANY_THEME },
                schemaVersion: 1,
            });
        }

        const currentTheme: ICompanyThemeConfig = settings?.theme || { ...DEFAULT_COMPANY_THEME };
        const currentLight: ICompanyThemePalette = {
            ...DEFAULT_LIGHT_PALETTE,
            ...(currentTheme.light ? (currentTheme.light as any).toObject?.() || currentTheme.light : {}),
        };
        const currentDark: ICompanyThemePalette = {
            ...DEFAULT_DARK_PALETTE,
            ...(currentTheme.dark ? (currentTheme.dark as any).toObject?.() || currentTheme.dark : {}),
        };

        // Extract raw inputs (supporting direct light/dark or nested theme.light/theme.dark)
        const rawLight = (dto.light || dto.theme?.light) as Record<string, string> | undefined;
        const rawDark = (dto.dark || dto.theme?.dark) as Record<string, string> | undefined;

        const normalizedLight = normalizePaletteTokens(rawLight);
        const normalizedDark = normalizePaletteTokens(rawDark);

        const hasLightUpdates = Object.keys(normalizedLight).length > 0;
        const hasDarkUpdates = Object.keys(normalizedDark).length > 0;

        if (!hasLightUpdates && !hasDarkUpdates) {
            throw AppError.badRequest('No valid theme tokens provided for update.');
        }

        // Construct proposed merged palettes
        const proposedLight: ICompanyThemePalette = {
            ...currentLight,
            ...normalizedLight,
        };
        const proposedDark: ICompanyThemePalette = {
            ...currentDark,
            ...normalizedDark,
        };

        // ── 1. Authoritative Contrast Validation ──────────────────────────────
        const contrastFailures: IContrastCheckResult[] = [];

        if (hasLightUpdates) {
            const lightChecks = validateThemePaletteContrast(proposedLight, 'light');
            contrastFailures.push(...lightChecks.filter((c) => !c.passes));
        }

        if (hasDarkUpdates) {
            const darkChecks = validateThemePaletteContrast(proposedDark, 'dark');
            contrastFailures.push(...darkChecks.filter((c) => !c.passes));
        }

        if (contrastFailures.length > 0) {
            const formattedErrors = contrastFailures.map((f) => ({
                id: f.id,
                label: f.label,
                mode: f.mode,
                foregroundKey: f.foregroundKey,
                backgroundKey: f.backgroundKey,
                foreground: f.foreground,
                background: f.background,
                actualRatio: f.ratio,
                requiredRatio: f.requiredRatio,
                level: f.level,
                passes: f.passes,
                suggestedForeground: f.suggestedForeground,
                description: f.description,
            }));
            throw AppError.unprocessable(
                `Theme color contrast validation failed: ${contrastFailures.length} color pairing(s) do not meet WCAG accessibility requirements.`,
                formattedErrors
            );
        }

        // ── 2. Atomic MongoDB Partial Update Query ────────────────────────────
        const nextVersion = (currentTheme.version || 1) + 1;
        const updatedAt = new Date();

        const setQuery: Record<string, any> = {
            'theme.version': nextVersion,
            'theme.updatedAt': updatedAt,
            'theme.updatedBy': userObjId,
            updatedBy: userObjId,
        };

        if (hasLightUpdates) {
            setQuery['theme.light'] = proposedLight;
        }

        if (hasDarkUpdates) {
            setQuery['theme.dark'] = proposedDark;
        }

        // Build $setOnInsert for atomic document creation if document didn't exist
        const setOnInsertQuery: Record<string, any> = {
            schemaVersion: 1,
        };
        if (!hasLightUpdates) {
            setOnInsertQuery['theme.light'] = DEFAULT_LIGHT_PALETTE;
        }
        if (!hasDarkUpdates) {
            setOnInsertQuery['theme.dark'] = DEFAULT_DARK_PALETTE;
        }

        await CompanySettings.findOneAndUpdate(
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

        // ── 3. Invalidate Local Cache & Broadcast Event ───────────────────────
        this.invalidateCache(companyId);

        // Non-blocking real-time broadcast across Socket.IO and Redis Pub/Sub
        CompanyThemeRealtimeService.broadcastThemeUpdate(
            companyId,
            nextVersion,
            updatedAt,
            updatedByUserId
        ).catch((broadcastErr) => {
            console.warn('[CompanyThemeService] Realtime broadcast warning:', broadcastErr?.message);
        });

        // ── 4. Audit Logging ─────────────────────────────────────────────────
        try {
            await AuditLogService.log({
                action: AuditAction.COMPANY_THEME_UPDATED,
                actorId: updatedByUserId || null,
                companyId: String(companyObjId),
                companyName: company.name,
                metadata: {
                    version: nextVersion,
                    updatedModes: [hasLightUpdates && 'light', hasDarkUpdates && 'dark'].filter(Boolean),
                    tokenCount: Object.keys(normalizedLight).length + Object.keys(normalizedDark).length,
                },
                success: true,
                description: `Company theme updated to version ${nextVersion} by user ${updatedByUserId}`,
                req,
            });
        } catch {
            // Non-blocking audit log
        }

        return {
            version: nextVersion,
            light: proposedLight,
            dark: proposedDark,
            updatedAt,
            updatedBy: updatedByUserId,
            customThemeConfigured: true,
            entitlement: {
                isEntitled: true,
                isReadOnly: false,
                reasonCode: 'ENTITLED',
                message: 'Company is entitled to custom theme customization on this plan.',
                billingCycle: entitlement.billingCycle,
                planName: entitlement.planName,
                status: entitlement.status,
            },
        };
    }

    /**
     * Resets company theme to standard WorkSphere defaults.
     */
    static async resetTheme(
        companyId: string,
        updatedByUserId: string,
        req?: Request
    ): Promise<ICompanyThemeConfig> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const companyObjId = new Types.ObjectId(companyId);
        const userObjId = updatedByUserId && Types.ObjectId.isValid(updatedByUserId)
            ? new Types.ObjectId(updatedByUserId)
            : null;

        const company = await Company.findById(companyObjId);
        if (!company) {
            throw AppError.notFound('Company not found');
        }

        // Server-authoritative entitlement gate
        const entitlement = await CompanyThemeEntitlementService.checkEntitlement(companyId);
        if (!entitlement.isEntitled) {
            throw AppError.forbidden(
                entitlement.message || 'Custom company themes require an active Semi-Annual or Annual subscription plan.'
            );
        }

        const settings = await CompanySettings.findOne({ companyId: companyObjId });
        const currentVersion = settings?.theme?.version || 1;
        const nextVersion = currentVersion + 1;
        const updatedAt = new Date();

        const defaultTheme: ICompanyThemeConfig = {
            version: nextVersion,
            light: { ...DEFAULT_LIGHT_PALETTE },
            dark: { ...DEFAULT_DARK_PALETTE },
            updatedAt,
            updatedBy: userObjId ? String(userObjId) : null,
        };

        await CompanySettings.findOneAndUpdate(
            { companyId: companyObjId },
            {
                $set: {
                    theme: defaultTheme,
                    updatedBy: userObjId,
                },
            },
            {
                new: true,
                upsert: true,
            }
        );

        // Invalidate cache and broadcast update
        this.invalidateCache(companyId);

        CompanyThemeRealtimeService.broadcastThemeUpdate(
            companyId,
            nextVersion,
            updatedAt,
            updatedByUserId
        ).catch((broadcastErr) => {
            console.warn('[CompanyThemeService] Realtime reset broadcast warning:', broadcastErr?.message);
        });

        try {
            await AuditLogService.log({
                action: AuditAction.COMPANY_THEME_RESET,
                actorId: updatedByUserId || null,
                companyId: String(companyObjId),
                companyName: company.name,
                metadata: { version: nextVersion },
                success: true,
                description: `Company theme reset to WorkSphere defaults (v${nextVersion}) by user ${updatedByUserId}`,
                req,
            });
        } catch {
            // Non-blocking audit log
        }

        return {
            ...defaultTheme,
            customThemeConfigured: false,
            entitlement: {
                isEntitled: true,
                isReadOnly: false,
                reasonCode: 'ENTITLED',
                message: 'Company is entitled to custom theme customization on this plan.',
                billingCycle: entitlement.billingCycle,
                planName: entitlement.planName,
                status: entitlement.status,
            },
        };
    }
}
export default CompanyThemeService;
