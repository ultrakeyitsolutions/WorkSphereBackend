export const WORKSPHERE_ROOT_DOMAIN = (import.meta.env.VITE_WORKSPHERE_ROOT_DOMAIN || 'uworksphere.com').toLowerCase();
export const API_BASE_URL =
  (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

/**
 * Infrastructure hostnames that never resolve to an organization tenant.
 */
const RESERVED_HOSTS = new Set([
  'www', 'api', 'app', 'admin', 'superadmin', 'super-admin', 'auth', 'mail',
  'smtp', 'status', 'support', 'help', 'docs', 'assets', 'static', 'cdn',
  'media', 'invite', 'billing', 'payments',
]);

/**
 * Extracts the organization slug from a shared-subdomain host.
 * Example: 'company-a.uworksphere.com' -> 'company-a'
 * The hostname is only a routing hint — the backend never trusts it alone.
 */
export function extractOrganizationSlug(host?: string | null): string | null {
  if (!host) return null;
  const clean = host.trim().split(':')[0].toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(clean)) return null;

  const base = WORKSPHERE_ROOT_DOMAIN;
  const suffix = `.${base}`;

  // Apex domain or non-matching root domain -> no tenant
  if (clean === base || !clean.endsWith(suffix)) return null;

  const label = clean.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  if (RESERVED_HOSTS.has(label)) return null;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ? label : null;
}

export type TenantResolution = {
  slug: string | null;
  companyId: string | null;
  companyName: string;
  organizationSlug: string | null;
  logoUrl: string | null;
  displayName: string;
  appTitle: string;
  theme: TenantTheme;
  whiteLabelEnabled: boolean;
  invitationBaseUrl: string | null;
  invitationUrlTemplate: string | null;
  suspended: boolean;
  usingFallback: boolean;
};

export type TenantTheme = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
};

export const DEFAULT_TENANT: TenantResolution = {
  slug: null,
  companyId: null,
  companyName: 'WorkSphere',
  organizationSlug: null,
  logoUrl: null,
  displayName: 'WorkSphere',
  appTitle: 'WorkSphere',
  theme: {
    primaryColor: '#3B82F6',
    secondaryColor: '#1E40AF',
    accentColor: '#6366F1',
    backgroundColor: '#F9FAFB',
    textColor: '#111827',
  },
  whiteLabelEnabled: false,
  invitationBaseUrl: null,
  invitationUrlTemplate: null,
  suspended: false,
  usingFallback: true,
};

/** Resolves the current organization from the browser hostname via the API. */
export async function resolveTenant(host?: string | null): Promise<TenantResolution> {
  const slug = extractOrganizationSlug(host ?? window.location.host);

  if (!slug) {
    return { ...DEFAULT_TENANT, usingFallback: true };
  }

  try {
    const url = `${API_BASE_URL}/invitations/organization?workspace=${encodeURIComponent(slug)}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      return { ...DEFAULT_TENANT, organizationSlug: slug, slug };
    }
    const json = await res.json();
    const data = json?.data ?? {};
    return {
      slug: data.slug ?? slug,
      companyId: data.companyId ?? null,
      companyName: data.organizationName ?? data.displayName ?? slug,
      organizationSlug: data.slug ?? slug,
      logoUrl: data.logoUrl ?? null,
      displayName: data.displayName ?? data.companyName ?? slug,
      appTitle: data.appTitle ?? data.companyName ?? slug,
      theme: {
        primaryColor: data.theme?.primaryColor ?? '#3B82F6',
        secondaryColor: data.theme?.secondaryColor ?? '#1E40AF',
        accentColor: data.theme?.accentColor ?? '#6366F1',
        backgroundColor: data.theme?.backgroundColor ?? '#F9FAFB',
        textColor: data.theme?.textColor ?? '#111827',
      },
      whiteLabelEnabled: Boolean(data.whiteLabelEnabled),
      invitationBaseUrl: data.invitationBaseUrl ?? null,
      invitationUrlTemplate: data.invitationUrlTemplate ?? null,
      suspended: Boolean(data.suspended),
      usingFallback: false,
    };
  } catch {
    return { ...DEFAULT_TENANT, organizationSlug: slug, slug };
  }
}
