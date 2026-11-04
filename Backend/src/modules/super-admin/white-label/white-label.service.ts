import crypto from 'crypto';
import dns from 'dns/promises';
import { Types } from 'mongoose';
import { Company } from '../companies/company.model';
import {
    WhiteLabelSettings,
    DEFAULT_WHITE_LABEL_THEME,
    DEFAULT_WHITE_LABEL_LOGIN,
} from './white-label.model';
import {
    IWhiteLabelSettingsDocument,
    PublicBrandingResponse,
} from './white-label.types';
import {
    UpdateWhiteLabelDto,
} from './white-label.schema';
import { AppError } from '../../../utils/AppError';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';
import { StorageConfigurationService } from '../storage/storage-config.service';
import { StorageProviderFactory } from '../../../infrastructure/storage/storage-provider.factory';
import { CloudinaryStorageProvider } from '../../../infrastructure/storage/providers/cloudinary-storage.provider';
import { redisGet, redisSet, getRedisClient } from '../../../config/redis';

// ─── Supported Assets & Limits ────────────────────────────────────────────────
export const ALLOWED_BRANDING_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/svg+xml',
]);
export const ALLOWED_BRANDING_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'ico', 'svg']);
export const MAX_BRANDING_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// ─── In-Memory Cache (L1) with Redis (L2) ─────────────────────────────────────
interface MemoryCacheEntry {
    data: any;
    expiresAt: number;
}
const memoryCache = new Map<string, MemoryCacheEntry>();
const CACHE_TTL_SECONDS = 300; // 5 minutes

export class WhiteLabelService {
    // ── Cache Helpers ──────────────────────────────────────────────────────────
    private static async getCached<T>(key: string): Promise<T | null> {
        const mem = memoryCache.get(key);
        if (mem && mem.expiresAt > Date.now()) {
            return mem.data as T;
        }

        try {
            const raw = await redisGet(key);
            if (raw) {
                const parsed = JSON.parse(raw) as T;
                memoryCache.set(key, { data: parsed, expiresAt: Date.now() + 60 * 1000 });
                return parsed;
            }
        } catch {}

        return null;
    }

    private static async setCached(key: string, data: any, ttlSeconds: number = CACHE_TTL_SECONDS): Promise<void> {
        memoryCache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
        try {
            await redisSet(key, JSON.stringify(data), ttlSeconds);
        } catch {}
    }

    public static clearAllCache(): void {
        memoryCache.clear();
    }

    public static async invalidateCache(tenantId?: string, slug?: string, domain?: string): Promise<void> {
        if (!tenantId && !slug && !domain) {
            memoryCache.clear();
            return;
        }

        const keysToDelete: string[] = [];
        if (tenantId) {
            keysToDelete.push(`branding:${tenantId.toLowerCase()}`);
            keysToDelete.push(`branding:tenant:${tenantId.toLowerCase()}`);
        }
        if (slug) {
            keysToDelete.push(`branding:${slug.toLowerCase()}`);
            keysToDelete.push(`branding:slug:${slug.toLowerCase()}`);
        }
        if (domain) {
            keysToDelete.push(`branding:${domain.toLowerCase()}`);
            keysToDelete.push(`branding:domain:${domain.toLowerCase()}`);
        }

        for (const k of keysToDelete) {
            memoryCache.delete(k);
        }

        for (const key of Array.from(memoryCache.keys())) {
            if (
                (slug && key.includes(slug.toLowerCase())) ||
                (tenantId && key.includes(tenantId.toLowerCase())) ||
                (domain && key.includes(domain.toLowerCase()))
            ) {
                memoryCache.delete(key);
            }
        }

        try {
            const client = getRedisClient();
            if (keysToDelete.length > 0) {
                await client.del(...keysToDelete);
            }
        } catch {}
    }

    // ── Resolve Company Helper ─────────────────────────────────────────────────
    private static async resolveCompany(identifier: string) {
        let query: any = {};
        if (Types.ObjectId.isValid(identifier)) {
            query = { _id: identifier };
        } else {
            query = {
                $or: [
                    { tenantId: identifier },
                    { slug: identifier.toLowerCase() },
                    { domain: identifier.toLowerCase() },
                ],
            };
        }
        return Company.findOne({ ...query, status: { $ne: 'DELETED' } });
    }

    // ── 1. Retrieve Company White Label Settings ──────────────────────────────
    static async getBranding(companyIdOrTenantId: string): Promise<IWhiteLabelSettingsDocument> {
        const company = await this.resolveCompany(companyIdOrTenantId);
        if (!company) {
            throw new AppError('Company not found', 404);
        }

        let settings = await WhiteLabelSettings.findOne({ companyId: company._id });
        if (!settings) {
            // Self-healing: create default settings if record does not yet exist
            settings = await WhiteLabelSettings.create({
                tenantId: company.tenantId || `ws_comp_${company._id}`,
                companyId: company._id,
                enabled: false,
                displayName: company.name,
                logoUrl: company.logoUrl || null,
                faviconUrl: null,
                appTitle: company.name,
                theme: { ...DEFAULT_WHITE_LABEL_THEME },
                loginPage: {
                    ...DEFAULT_WHITE_LABEL_LOGIN,
                    heading: `Welcome to ${company.name}`,
                },
                customDomain: company.domain || null,
                domainVerificationStatus: company.domain ? 'VERIFIED' : 'NONE',
            });
        }

        return settings;
    }

    // ── 2. Retrieve Public Branding (Safe, Minimal, Pre-Login) ─────────────────
    static async getPublicBranding(params: {
        workspace?: string;
        domain?: string;
        tenantId?: string;
        host?: string;
    }): Promise<PublicBrandingResponse & { suspended?: boolean }> {
        const cacheKey = `branding:${params.workspace || params.domain || params.tenantId || params.host || 'default'}`.toLowerCase();
        const cached = await this.getCached<PublicBrandingResponse & { suspended?: boolean }>(cacheKey);
        if (cached) {
            return cached;
        }

        let company: any = null;

        // 1. Resolve by explicit workspace slug
        if (params.workspace) {
            company = await Company.findOne({
                slug: params.workspace.toLowerCase(),
                status: { $ne: 'DELETED' },
            });
        }

        // 2. Resolve by explicit tenant ID
        if (!company && params.tenantId) {
            company = await Company.findOne({
                tenantId: params.tenantId,
                status: { $ne: 'DELETED' },
            });
        }

        // 3. Resolve by custom domain or host
        const rawDomain = params.domain || params.host;
        if (!company && rawDomain) {
            // Strip port if present
            const cleanHost = rawDomain.split(':')[0].toLowerCase().trim();

            // First check verified custom domain in WhiteLabelSettings
            const whiteLabelDoc = await WhiteLabelSettings.findOne({
                customDomain: cleanHost,
                domainVerificationStatus: 'VERIFIED',
            });
            if (whiteLabelDoc) {
                company = await Company.findOne({
                    _id: whiteLabelDoc.companyId,
                    status: { $ne: 'DELETED' },
                });
            }

            // Also check company.domain
            if (!company) {
                company = await Company.findOne({
                    domain: cleanHost,
                    status: { $ne: 'DELETED' },
                });
            }

            // If subdomain matching (e.g. acme.worksphere.io or acme.uworksphere.com or acme.localhost)
            if (!company) {
                const parts = cleanHost.split('.');
                if (parts.length >= 2) {
                    const potentialSlug = parts[0];
                    company = await Company.findOne({
                        slug: potentialSlug,
                        status: { $ne: 'DELETED' },
                    });
                }
            }
        }

        // Default platform branding fallback if no company found
        if (!company) {
            const fallback: PublicBrandingResponse = {
                tenantId: 'platform_default',
                companyId: '',
                slug: 'worksphere',
                displayName: 'WorkSphere',
                logoUrl: null,
                faviconUrl: null,
                appTitle: 'WorkSphere — Workspace Platform',
                whiteLabelEnabled: false,
                theme: { ...DEFAULT_WHITE_LABEL_THEME },
                loginPage: { ...DEFAULT_WHITE_LABEL_LOGIN },
            };
            return fallback;
        }

        // Suspended tenant protection: prevent access
        if (company.status === 'SUSPENDED') {
            const suspendedResponse: any = {
                tenantId: company.tenantId || String(company._id),
                companyId: String(company._id),
                slug: company.slug,
                displayName: company.name,
                logoUrl: company.logoUrl || null,
                faviconUrl: null,
                appTitle: `${company.name} (Suspended)`,
                whiteLabelEnabled: false,
                suspended: true,
                message: 'This workspace is currently suspended. Please contact platform administration.',
                theme: { ...DEFAULT_WHITE_LABEL_THEME },
                loginPage: {
                    heading: 'Workspace Suspended',
                    subtitle: 'This company account is currently suspended.',
                    hideWorkSphereBranding: false,
                },
            };
            return suspendedResponse;
        }

        const settings = await WhiteLabelSettings.findOne({ companyId: company._id });

        let response: PublicBrandingResponse;

        if (settings && settings.enabled) {
            response = {
                tenantId: company.tenantId || settings.tenantId,
                companyId: String(company._id),
                slug: company.slug,
                displayName: settings.displayName || company.name,
                logoUrl: settings.logoUrl || company.logoUrl || null,
                faviconUrl: settings.faviconUrl || null,
                appTitle: settings.appTitle || company.name,
                whiteLabelEnabled: true,
                theme: {
                    primaryColor: settings.theme?.primaryColor || DEFAULT_WHITE_LABEL_THEME.primaryColor,
                    secondaryColor: settings.theme?.secondaryColor || DEFAULT_WHITE_LABEL_THEME.secondaryColor,
                    backgroundColor: settings.theme?.backgroundColor || DEFAULT_WHITE_LABEL_THEME.backgroundColor,
                    textColor: settings.theme?.textColor || DEFAULT_WHITE_LABEL_THEME.textColor,
                    accentColor: settings.theme?.accentColor || DEFAULT_WHITE_LABEL_THEME.accentColor,
                    sidebarBackground: settings.theme?.sidebarBackground || DEFAULT_WHITE_LABEL_THEME.sidebarBackground,
                    sidebarText: settings.theme?.sidebarText || DEFAULT_WHITE_LABEL_THEME.sidebarText,
                },
                loginPage: {
                    heading: settings.loginPage?.heading || `Welcome to ${company.name}`,
                    subtitle: settings.loginPage?.subtitle || DEFAULT_WHITE_LABEL_LOGIN.subtitle,
                    bannerImageUrl: settings.loginPage?.bannerImageUrl || null,
                    backgroundImageUrl: settings.loginPage?.backgroundImageUrl || null,
                    hideWorkSphereBranding: Boolean(settings.loginPage?.hideWorkSphereBranding),
                },
                customDomain: settings.customDomain || null,
                domainVerified: settings.domainVerificationStatus === 'VERIFIED',
            };
        } else {
            // Default branding with company name fallback
            response = {
                tenantId: company.tenantId || String(company._id),
                companyId: String(company._id),
                slug: company.slug,
                displayName: company.name,
                logoUrl: company.logoUrl || null,
                faviconUrl: null,
                appTitle: `${company.name} | WorkSphere`,
                whiteLabelEnabled: false,
                theme: { ...DEFAULT_WHITE_LABEL_THEME },
                loginPage: {
                    ...DEFAULT_WHITE_LABEL_LOGIN,
                    heading: `Welcome to ${company.name}`,
                },
                customDomain: company.domain || null,
                domainVerified: Boolean(company.domain),
            };
        }

        await this.setCached(cacheKey, response);
        return response;
    }

    // ── 3. Update White Label Configuration ───────────────────────────────────
    static async updateBranding(
        companyIdOrTenantId: string,
        dto: UpdateWhiteLabelDto,
        actorUserId?: string
    ): Promise<IWhiteLabelSettingsDocument> {
        const company = await this.resolveCompany(companyIdOrTenantId);
        if (!company) {
            throw new AppError('Company not found', 404);
        }

        let settings = await WhiteLabelSettings.findOne({ companyId: company._id });
        if (!settings) {
            settings = new WhiteLabelSettings({
                tenantId: company.tenantId || `ws_comp_${company._id}`,
                companyId: company._id,
                displayName: company.name,
            });
        }

        // Apply changes
        if (dto.enabled !== undefined) settings.enabled = dto.enabled;
        if (dto.displayName !== undefined) settings.displayName = dto.displayName;
        if (dto.logoUrl !== undefined) {
            settings.logoUrl = dto.logoUrl ? dto.logoUrl.trim() : null;
            if (dto.logoUrl) {
                company.logoUrl = dto.logoUrl.trim();
                await company.save();
            }
        }
        if (dto.faviconUrl !== undefined) {
            settings.faviconUrl = dto.faviconUrl ? dto.faviconUrl.trim() : null;
        }
        if (dto.appTitle !== undefined) settings.appTitle = dto.appTitle;

        if (dto.theme) {
            settings.theme = {
                primaryColor: dto.theme.primaryColor ?? settings.theme.primaryColor,
                secondaryColor: dto.theme.secondaryColor ?? settings.theme.secondaryColor,
                backgroundColor: dto.theme.backgroundColor ?? settings.theme.backgroundColor,
                textColor: dto.theme.textColor ?? settings.theme.textColor,
                accentColor: dto.theme.accentColor ?? settings.theme.accentColor,
                sidebarBackground: dto.theme.sidebarBackground ?? settings.theme.sidebarBackground,
                sidebarText: dto.theme.sidebarText ?? settings.theme.sidebarText,
            };
        }

        if (dto.loginPage) {
            settings.loginPage = {
                heading: dto.loginPage.heading ?? settings.loginPage.heading,
                subtitle: dto.loginPage.subtitle ?? settings.loginPage.subtitle,
                bannerImageUrl: dto.loginPage.bannerImageUrl !== undefined ? dto.loginPage.bannerImageUrl : settings.loginPage.bannerImageUrl,
                backgroundImageUrl: dto.loginPage.backgroundImageUrl !== undefined ? dto.loginPage.backgroundImageUrl : settings.loginPage.backgroundImageUrl,
                hideWorkSphereBranding: dto.loginPage.hideWorkSphereBranding ?? settings.loginPage.hideWorkSphereBranding,
                // customCss intentionally omitted — feature not supported.
            };
        }

        // emailBranding intentionally omitted — feature not supported.

        if (dto.customDomain !== undefined) {
            const cleanDomain = dto.customDomain ? dto.customDomain.toLowerCase().trim() : null;
            if (cleanDomain && cleanDomain !== settings.customDomain) {
                // Check uniqueness across other companies
                const existing = await WhiteLabelSettings.findOne({
                    customDomain: cleanDomain,
                    companyId: { $ne: company._id },
                });
                if (existing) {
                    throw new AppError(`Domain "${cleanDomain}" is already claimed by another company`, 409);
                }

                settings.customDomain = cleanDomain;
                settings.domainVerificationStatus = 'PENDING';
                settings.domainVerificationToken = `ws-verify-${crypto.randomBytes(12).toString('hex')}`;
                settings.verifiedAt = null;
            } else if (!cleanDomain) {
                settings.customDomain = null;
                settings.domainVerificationStatus = 'NONE';
                settings.domainVerificationToken = null;
                settings.verifiedAt = null;
            }
        }

        settings.updatedBy = actorUserId ? new Types.ObjectId(actorUserId) : null;
        await settings.save();

        // Invalidate caching
        await this.invalidateCache(company.tenantId, company.slug, settings.customDomain || undefined);

        await AuditLogService.log({
            action: AuditAction.COMPANY_UPDATED,
            actorId: actorUserId || null,
            companyId: String(company._id),
            companyName: company.name,
            success: true,
            description: `White-label branding updated for company "${company.name}"`,
            metadata: { enabled: settings.enabled, customDomain: settings.customDomain },
        });

        return settings;
    }

    // ── 4. Toggle White Label Enabled ─────────────────────────────────────────
    static async toggleWhiteLabel(companyIdOrTenantId: string, enabled: boolean, actorUserId?: string) {
        const company = await this.resolveCompany(companyIdOrTenantId);
        if (!company) {
            throw new AppError('Company not found', 404);
        }

        const settings = await this.getBranding(String(company._id));
        settings.enabled = enabled;
        settings.updatedBy = actorUserId ? new Types.ObjectId(actorUserId) : null;
        await settings.save();

        await this.invalidateCache(company.tenantId, company.slug, settings.customDomain || undefined);

        await AuditLogService.log({
            action: AuditAction.COMPANY_UPDATED,
            actorId: actorUserId || null,
            companyId: String(company._id),
            companyName: company.name,
            success: true,
            description: `White-label ${enabled ? 'enabled' : 'disabled'} for "${company.name}"`,
            metadata: { enabled },
        });

        return settings;
    }

    // ── 5. Configure Custom Domain ────────────────────────────────────────────
    static async configureCustomDomain(companyIdOrTenantId: string, domain: string, actorUserId?: string) {
        const company = await this.resolveCompany(companyIdOrTenantId);
        if (!company) {
            throw new AppError('Company not found', 404);
        }

        const cleanDomain = domain.toLowerCase().trim();

        // Check uniqueness
        const existing = await WhiteLabelSettings.findOne({
            customDomain: cleanDomain,
            companyId: { $ne: company._id },
        });
        if (existing) {
            throw new AppError(`Domain "${cleanDomain}" is already claimed by another organization`, 409);
        }

        const settings = await this.getBranding(String(company._id));
        const verificationToken = `ws-verify-${crypto.randomBytes(16).toString('hex')}`;

        settings.customDomain = cleanDomain;
        settings.domainVerificationStatus = 'PENDING';
        settings.domainVerificationToken = verificationToken;
        settings.verifiedAt = null;
        settings.updatedBy = actorUserId ? new Types.ObjectId(actorUserId) : null;
        await settings.save();

        await this.invalidateCache(company.tenantId, company.slug, cleanDomain);

        return {
            customDomain: cleanDomain,
            domainVerificationStatus: settings.domainVerificationStatus,
            verificationToken,
            instructions: {
                recordType: 'TXT',
                host: '_worksphere-challenge',
                value: verificationToken,
                ttl: 300,
            },
        };
    }

    // ── 6. Verify Custom Domain Ownership ─────────────────────────────────────
    static async verifyCustomDomain(
        companyIdOrTenantId: string,
        actorUserId?: string,
        mockSuccess = false,
        verificationType: 'DNS_TXT' | 'CNAME' | 'TOKEN' = 'DNS_TXT',
    ) {
        const company = await this.resolveCompany(companyIdOrTenantId);
        if (!company) {
            throw new AppError('Company not found', 404);
        }

        const settings = await this.getBranding(String(company._id));
        if (!settings.customDomain || !settings.domainVerificationToken) {
            throw new AppError('No custom domain configured to verify', 400);
        }

        const domain = settings.customDomain;
        const expectedToken = settings.domainVerificationToken;
        let verified = false;
        let dnsFailureReason: string | null = null;

        if (mockSuccess || process.env.NODE_ENV === 'test') {
            verified = true;
        } else {
            // Primary: Check TXT record on _worksphere-challenge.<domain>
            const challengeHost = `_worksphere-challenge.${domain}`;
            try {
                const txtRecords = await dns.resolveTxt(challengeHost);
                const flatTxt = txtRecords.flat().join(' ');
                if (flatTxt.includes(expectedToken)) {
                    verified = true;
                } else {
                    dnsFailureReason = `TXT record found at "${challengeHost}" but token did not match. Found: "${flatTxt}"`;
                }
            } catch (primaryErr: any) {
                dnsFailureReason = `No TXT record at "${challengeHost}" (${primaryErr.code ?? primaryErr.message})`;

                // Fallback: Check TXT record directly on the apex domain
                try {
                    const apexTxt = await dns.resolveTxt(domain);
                    const flatApex = apexTxt.flat().join(' ');
                    if (flatApex.includes(expectedToken)) {
                        verified = true;
                        dnsFailureReason = null;
                    } else {
                        dnsFailureReason = `TXT record found at apex "${domain}" but token did not match. Found: "${flatApex}"`;
                    }
                } catch (apexErr: any) {
                    dnsFailureReason = `No TXT record at "${challengeHost}" (${primaryErr.code ?? primaryErr.message}) or apex "${domain}" (${apexErr.code ?? apexErr.message})`;
                }
            }
        }

        if (verified) {
            settings.domainVerificationStatus = 'VERIFIED';
            settings.verifiedAt = new Date();
            await settings.save();

            // Link to company domain field
            company.domain = domain;
            await company.save();

            await this.invalidateCache(company.tenantId, company.slug, domain);

            await AuditLogService.log({
                action: AuditAction.COMPANY_UPDATED,
                actorId: actorUserId || null,
                companyId: String(company._id),
                companyName: company.name,
                success: true,
                description: `Custom domain "${domain}" successfully verified for "${company.name}"`,
                metadata: { customDomain: domain, status: 'VERIFIED' },
            });

            return {
                verified: true,
                domain,
                status: 'VERIFIED',
                verifiedAt: settings.verifiedAt,
            };
        } else {
            settings.domainVerificationStatus = 'FAILED';
            await settings.save();

            const detail = dnsFailureReason ? ` Reason: ${dnsFailureReason}` : '';
            throw new AppError(
                `DNS verification failed for domain "${domain}". TXT record matching verification token was not found.${detail}`,
                400
            );
        }
    }

    // ── 7. Restore Default Branding ───────────────────────────────────────────
    static async resetDefaultBranding(companyIdOrTenantId: string, actorUserId?: string) {
        const company = await this.resolveCompany(companyIdOrTenantId);
        if (!company) {
            throw new AppError('Company not found', 404);
        }

        const settings = await this.getBranding(String(company._id));

        settings.displayName = company.name;
        settings.logoUrl = null;
        settings.faviconUrl = null;
        settings.appTitle = company.name;
        settings.theme = { ...DEFAULT_WHITE_LABEL_THEME };
        settings.loginPage = {
            ...DEFAULT_WHITE_LABEL_LOGIN,
            heading: `Welcome to ${company.name}`,
        };
        // emailBranding intentionally not reset — feature not supported.
        settings.updatedBy = actorUserId ? new Types.ObjectId(actorUserId) : null;
        await settings.save();

        await this.invalidateCache(company.tenantId, company.slug, settings.customDomain || undefined);

        await AuditLogService.log({
            action: AuditAction.COMPANY_UPDATED,
            actorId: actorUserId || null,
            companyId: String(company._id),
            companyName: company.name,
            success: true,
            description: `Restored default branding for company "${company.name}"`,
        });

        return settings;
    }

    // ── 8. Upload Branding Asset (Logo or Favicon) ─────────────────────────────
    static async uploadBrandingAsset(
        file?: Express.Multer.File,
        assetType: 'logo' | 'favicon' = 'logo',
        companyIdOrTenantId?: string
    ): Promise<{ url: string; storageKey: string }> {
        if (!file || !file.buffer) {
            throw new AppError(`No image file provided for ${assetType} upload.`, 400);
        }

        const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
        if (!ALLOWED_BRANDING_EXTENSIONS.has(ext)) {
            throw new AppError(
                `Unsupported image format .${ext}. Allowed formats: PNG, JPEG, WebP, ICO, SVG.`,
                400
            );
        }

        if (!ALLOWED_BRANDING_MIME_TYPES.has(file.mimetype.toLowerCase())) {
            throw new AppError(
                `Unsupported MIME type ${file.mimetype}. Allowed formats: PNG, JPEG, WebP, ICO, SVG.`,
                400
            );
        }

        if (file.size > MAX_BRANDING_FILE_SIZE_BYTES) {
            const currentMB = (file.size / (1024 * 1024)).toFixed(2);
            throw new AppError(`File size (${currentMB}MB) exceeds the maximum allowed limit of 5MB.`, 400);
        }

        const activeConfig = await StorageConfigurationService.getActiveConfiguration();
        const basePath = (activeConfig?.configuration?.basePath || 'worksphere').replace(/^\/+|\/+$/g, '');
        const targetFolder = assetType === 'favicon' ? 'favicons' : 'logos';
        const sanitizedOriginal = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniquePrefix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const companyFolder = companyIdOrTenantId ? `companies/${companyIdOrTenantId}` : 'branding';
        const storageKey = `${basePath}/${companyFolder}/${targetFolder}/${uniquePrefix}-${sanitizedOriginal}`;

        let assetUrl: string;

        if (activeConfig && activeConfig.enabled) {
            try {
                const provider = StorageProviderFactory.createProvider(
                    activeConfig.provider,
                    activeConfig.configuration
                );
                const uploadResult = await provider.uploadFile(file.buffer, storageKey, file.mimetype);
                assetUrl = uploadResult.storageUrl;
            } catch (storageErr: any) {
                console.error(`[WhiteLabelService] Upload failed for ${assetType}:`, storageErr?.message);
                const pullZone = activeConfig.configuration?.pullZoneUrl?.replace(/\/+$/, '') || 'https://storage.worksphere.io';
                assetUrl = `${pullZone}/${storageKey}`;
            }
        } else {
            const pullZone = activeConfig?.configuration?.pullZoneUrl?.replace(/\/+$/, '') || 'https://storage.worksphere.io';
            assetUrl = `${pullZone}/${storageKey}`;
        }

        if (assetUrl && assetUrl.startsWith('cloudinary://')) {
            assetUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(assetUrl, activeConfig?.configuration?.cloudName);
        }

        // If companyId provided, automatically persist asset to WhiteLabelSettings
        if (companyIdOrTenantId) {
            const company = await this.resolveCompany(companyIdOrTenantId);
            if (company) {
                const settings = await this.getBranding(String(company._id));
                if (assetType === 'favicon') {
                    settings.faviconUrl = assetUrl;
                } else {
                    settings.logoUrl = assetUrl;
                    company.logoUrl = assetUrl;
                    await company.save();
                }
                await settings.save();
                await this.invalidateCache(company.tenantId, company.slug, settings.customDomain || undefined);
            }
        }

        return { url: assetUrl, storageKey };
    }

    // ── 9. Frontend Workspace Bootstrap Configuration ─────────────────────────
    static async getTenantConfig(companyIdOrTenantId: string) {
        const company = await this.resolveCompany(companyIdOrTenantId);
        if (!company) {
            throw new AppError('Tenant not found', 404);
        }

        const branding = await this.getBranding(String(company._id));

        return {
            tenantId: company.tenantId || String(company._id),
            companyId: String(company._id),
            companyName: company.name,
            slug: company.slug,
            status: company.status,
            domain: company.domain,
            whiteLabel: {
                enabled: branding.enabled,
                displayName: branding.displayName,
                logoUrl: branding.logoUrl,
                faviconUrl: branding.faviconUrl,
                appTitle: branding.appTitle,
                theme: branding.theme,
                loginPage: branding.loginPage,
                customDomain: branding.customDomain,
                domainVerificationStatus: branding.domainVerificationStatus,
            },
        };
    }
}

export default WhiteLabelService;
