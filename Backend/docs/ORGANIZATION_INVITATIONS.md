# Organization-Specific Invitation URL & Acceptance Flow

WorkSphere now issues invitations through per-organization subdomains while serving a single shared frontend application and backend.

```
https://{organizationSlug}.uworksphere.com/invite?token={invitationToken}
```

## 1. Root cause analysis — existing invitation URL generation

Before this change, invitation acceptance links were resolved in
`src/modules/companyadmin/invitations/email.service.ts:24` (`resolveInvitationBaseUrl`):

1. Prefer the organization's **verified white-label custom domain** (if present).
2. Otherwise fall back to `env.APP_URL` (central domain).
3. Otherwise fall back to `https://uworksphere.com`.

Problems identified:

- No organization-specific subdomain was generated, so every tenant received
  the same central-domain invite link (`https://uworksphere.com/invite?token=...`).
- URL resolution depended on `env.APP_URL`, which may point at the central
  platform host rather than the inviting organization's subdomain.
- No public endpoint returned organization branding (`logo`, `theme`) together
  with invitation validation, so a shared frontend could not render a per-org
  acceptance experience.
- Public token validation/acceptance endpoints had **no dedicated rate limit**.
- `acceptInvitation`/`registerViaInvitation` did not return an
  organization-scoped redirect context (`redirectTo`, `workspace`, `tenantSlug`).
- Idempotent duplicate acceptance was not guaranteed: re-submitting an already
  accepted invitation returned an error instead of a safe success response.
- Acceptance did not verify an organization hint supplied from the invitation
  URL/hostname against the stored invitation record (the invitation record was
  implicitly authoritative, but callers could not assert tenant scoping).

## 2. Backend implementation

### New env variables (`src/config/env.ts`, `.env.example`)

```
INVITATION_BASE_DOMAIN=uworksphere.com        # wildcard DNS + TLS target
INVITATION_BASE_PROTOCOL=https
INVITATION_FALLBACK_URL=                      # optional central fallback
INVITATION_PREFER_CUSTOM_DOMAIN=false         # opt-in custom domain priority
CORS_ALLOWED_DOMAIN_SUFFIXES=                 # extra trusted frontend domains
```

### New files

- `src/modules/companyadmin/invitations/invitation-url.service.ts`
  - Server-authoritative URL builder: `https://{slug}.{INVITATION_BASE_DOMAIN}`.
  - Slug validation (`isUsableOrganizationSlug`), reserved host guard,
    host-to-slug extraction (`extractOrganizationSlugFromHost`),
    fallback resolution when slug is missing/inactive/invalid,
    optional verified custom-domain preference.
- `src/modules/companyadmin/invitations/invitation.controller.ts`
  - Organization hint extraction from body/query/headers (`organizationId`,
    `organizationSlug`, `tenantSlug`, `x-tenant-slug`, `workspace`).
  - `GET /invitations/organization` public tenant-resolution endpoint
    (branding + invitation base URL).
  - Error responses now honor `AppError.statusCode`.
- `src/modules/companyadmin/invitations/public-invitation.routes.ts`
  - Rate-limited public routes (validate: 60/15min/IP; accept/register:
    15/15min/IP).
- `src/modules/companyadmin/invitations/email.service.ts`
  - Organization-branded email: org logo, display name, theme colors,
    organization-specific `Accept Invitation` link, inviter name, expiry date.

### Changed files

- `src/config/env.ts` — invitation URL + CORS env vars.
- `src/app.ts` — CORS now allows `https://*.{INVITATION_BASE_DOMAIN}` plus
  explicitly configured origins; rejects unknown origins in production.
- `src/middleware/tenant.middleware.ts` — hostname tenant resolution uses
  reserved-host guard; no longer trusts `www/api/app/admin` as tenants.
- `src/modules/super-admin/white-label/white-label.service.ts` — subdomain
  resolution rejects reserved hostnames.
- `src/modules/companyadmin/invitations/invitation.model.ts`
  - Added indexes: `{ status:1, expiresAt:1 }`, `{ companyId:1,
    acceptedUserId:1 }`, `{ invitedByUserId:1, createdAt:-1 }`.
- `src/modules/companyadmin/invitations/invitation.service.ts`
  - `assertInvitationOrganization()` rejects cross-organization hints.
  - `validateToken` returns full organization context (branding, theme,
    inviter, assigned role, expiration).
  - `acceptInvitation` / `registerViaInvitation`:
    - single-use atomic claim (`status PENDING` → `ACCEPTED` + expires check),
    - idempotent duplicate acceptance (returns existing membership/tokens,
      never creates duplicate `CompanyMember`),
    - organization-hint verification,
    - password/account email match against the invited email,
    - organization-scoped JWT (`companyId`, `tenantId`, `tenantSlug`),
    - `redirectTo`, `workspace`, `tenantSlug` in the response.
  - `invite`/`resendInvitation` send organization-branded links via
    `EmailService`.
- `src/modules/companyadmin/invitations/invitation.validator.ts` — optional
  organization hint fields added to accept/register/validate schemas.
- `src/modules/super-admin/super-admin.routes.ts`
  - Super Admin invitation CRUD under
    `/api/super-admin/companies/:companyId/invitations` reusing the existing
    `InvitationService` (no duplicate service/schema).

### Database

No new collection. The existing `invitations` collection already holds
`companyId` (organizationId), `email` (invitedEmail), `roleId` (assignedRole),
`tokenHash`, `status`, `expiresAt`, `acceptedAt`, `acceptedUserId`,
`invitedByUserId`, `createdAt`, `updatedAt`. Indexes added above for
organization ID, status, expiration, and token hash. A migration is only
required to ensure the new indexes exist on existing deployments
(`db:init`/`createIndexes` runs automatically on model bootstrap).

### Security

- Cryptographically secure 48-byte random token, SHA-256 hash stored (`previousTokenHashes` preserved on resend).
- Single-use acceptance via atomic conditional update.
- Token expiration; auto-expire on validation/accept.
- Revocation (`CANCELLED` status) rejected at 410.
- Organization ID verified from the stored invitation record; callers cannot
  switch organizations via URL or payload.
- Email/account match enforced for existing users; email uniqueness enforced for
  new registrations.
- Role/designation validated against the inviting organization.
- Rate limiting on public token validation and acceptance endpoints.
- CORS restricted to trusted organization subdomains and configured origins.
- Hostname used only as a routing hint; never as proof of membership.

## 3. Shared frontend implementation

Added `Frontend/` — a single shared Vite + React + TypeScript application that
serves every `*.uworksphere.com` subdomain.

- `src/lib/tenant.ts` — extracts the organization slug from `window.location.host`
  and resolves branding + invitation base URL via `GET /api/v1/invitations/organization?workspace=...`.
- `src/lib/api.ts` — typed client for `validate`, `accept`, `register`.
- `src/components/InviteAcceptance.tsx` — premium responsive acceptance page:
  org logo, org name, assigned role, inviter, invited email, expiration,
  existing-user accept and new-user register forms, success redirect to the
  organization dashboard.
- `src/App.tsx` — single `/invite` route rendered by the shared app.

The hostname is read client-side only as a routing hint; the backend never
trusts it alone.

## 4. Email template changes

`EmailService.sendInvitationEmail` now renders:

- Organization logo and display name from white-label settings.
- Brand colors (primary/secondary/accent/background/text).
- `Accept Invitation` button pointing to
  `https://{slug}.uworksphere.com/invite?token=...`.
- Inviter name and expiration date.
- Platform fallback sender when custom SMTP is rejected (existing behavior
  preserved).

## 5. Domain, DNS, SSL and deployment

### DNS

Create a wildcard DNS record for the organization subdomains:

```
TYPE    NAME                 VALUE
A/CNAME *.uworksphere.com    <frontend load balancer / hosting target>
```

### TLS

Provision a wildcard TLS certificate for `*.uworksphere.com` (and the apex
`uworksphere.com` for the fallback). Terminate TLS at the edge/load balancer and
forward to the shared frontend + backend.

### Frontend hosting

Serve the `Frontend/` build from the wildcard host. All organization subdomains
point to the same deployment; routing and branding are resolved per-request from
the hostname.

### Backend CORS

`src/app.ts` allows:
- explicitly configured `CORS_ORIGIN` values,
- any origin ending in `.{INVITATION_BASE_DOMAIN}` (e.g. `*.uworksphere.com`),
- optional extra suffixes via `CORS_ALLOWED_DOMAIN_SUFFIXES`.

Unknown origins are rejected in production.

### Cookies / auth

The backend issues bearer access/refresh tokens (JSON). The shared frontend
persists them under `localStorage`; for cookie-based deployments, set
`Domain=.uworksphere.com`, `Secure`, `SameSite=Lax` so tokens work across all
organization subdomains. This repo's backend does not set auth cookies by default.

## 6. API examples

### Invite (Company Admin)
```
POST /api/v1/company/invitations
Authorization: Bearer <admin token>
Body: { members: [{ emailOrPhone: "hire@company-a.com", roleId: "...", designationId: "...", memberType: "EMPLOYEE" }] }
```

Email delivered contains:
```
https://company-a.uworksphere.com/invite?token=XXXXX
```

### Validate invitation (public, used by frontend)
```
GET /api/v1/invitations/validate?token=XXXXX&organizationSlug=company-a
```
Response:
```json
{
  "success": true,
  "data": {
    "invitationId": "...",
    "organizationId": "...",
    "organizationSlug": "company-a",
    "organizationName": "Company A",
    "email": "hire@company-a.com",
    "assignedRole": "Developer",
    "expiresAt": "2026-...",
    "userExists": false,
    "organization": {
      "id": "...", "name": "Company A", "slug": "company-a",
      "logoUrl": "https://cdn.../company-a.png",
      "theme": { "primaryColor": "#FF5722", ... },
      "invitationBaseUrl": "https://company-a.uworksphere.com"
    }
  }
}
```

Cross-organization mismatch returns `403`.

### Accept (existing user)
```
POST /api/v1/invitations/accept
Body: { token: "XXXXX", password: "...", organizationSlug: "company-a" }
```
Response includes `accessToken`, `refreshToken`, `redirectTo: "/dashboard"`,
`workspace: "company-a"`, `tenantSlug: "company-a"`.

### Register (new user)
```
POST /api/v1/invitations/register
Body: { token: "XXXXX", name: "...", password: "...", organizationSlug: "company-a" }
```

### Super Admin invitations
```
POST /api/super-admin/companies/{companyId}/invitations
GET    /api/super-admin/companies/{companyId}/invitations
POST   /api/super-admin/companies/{companyId}/invitations/{invitationId}/resend
POST   /api/super-admin/companies/{companyId}/invitations/{invitationId}/cancel
```

## 7. Test results

`npm test` → **769 tests passed**, 66 files (includes 23 new organization-invitation tests).

Covered: Company A vs Company B distinct URLs, branding per organization,
invalid/expired/revoked/accepted token rejection, cross-organization rejection,
existing-user accept, new-user register, duplicate acceptance idempotency,
wrong-password rejection, org-specific email links, fallback URL, reserved-host
guards.

## 8. Changed files

**Backend**
- `src/config/env.ts`
- `src/app.ts`
- `src/middleware/tenant.middleware.ts`
- `src/modules/companyadmin/invitations/invitation-url.service.ts` (new)
- `src/modules/companyadmin/invitations/invitation.model.ts`
- `src/modules/companyadmin/invitations/invitation.service.ts`
- `src/modules/companyadmin/invitations/invitation.controller.ts`
- `src/modules/companyadmin/invitations/invitation.validator.ts`
- `src/modules/companyadmin/invitations/public-invitation.routes.ts`
- `src/modules/companyadmin/invitations/email.service.ts`
- `src/modules/super-admin/white-label/white-label.service.ts`
- `src/modules/super-admin/super-admin.routes.ts`
- `.env.example`
- `tests/organization-invitation.test.ts` (new)

**Frontend (new)**
- `Frontend/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.env.example`
- `Frontend/src/main.tsx`, `App.tsx`, `styles.css`
- `Frontend/src/lib/tenant.ts`, `src/lib/api.ts`
- `Frontend/src/components/InviteAcceptance.tsx`

## 9. Deployment / migration

1. Deploy the backend with the new env vars (`INVITATION_BASE_DOMAIN=uworksphere.com`,
   `INVITATION_BASE_PROTOCOL=https`, optional `INVITATION_FALLBACK_URL`).
2. Create wildcard DNS `*.uworksphere.com → <frontend target>`.
3. Provision wildcard TLS `*.uworksphere.com` (+ apex).
4. Deploy the shared `Frontend/` build behind the wildcard host; set
   `VITE_API_URL` to the API base (same-origin `/api` if proxied).
5. Add organization subdomains (or custom domain suffixes) to `CORS_ORIGIN` /
   `CORS_ALLOWED_DOMAIN_SUFFIXES` as needed.
6. Restart backend; indexes are created automatically on model bootstrap. No
   data migration is required.
