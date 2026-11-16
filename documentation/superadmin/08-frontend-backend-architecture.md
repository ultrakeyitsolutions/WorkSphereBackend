# <span style="color: #172554;">08 &mdash; Full-Stack Architecture & SuperAdmin UI/UX Design System</span>

> **Document ID:** WS-DOC-SA-08 &nbsp;|&nbsp; **Category:** System Architecture & UI/UX &nbsp;|&nbsp; **Target Audience:** Frontend Architects, Backend Architects, Product Designers

---

## <span style="color: #1E40AF;">1. System Architecture Overview</span>

UWorksphere implements a decoupled full-stack architecture optimized for high-throughput enterprise SaaS operations:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   FRONTEND (Next.js 15+ App Router)                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ React Hook Form  │  │ TanStack Query   │  │ Tailwind Enterprise  │  │
│  │ (Zod Validation) │  │ (Cache & Mutation│  │ Design System        │  │
│  └─────────┬────────┘  └─────────┬────────┘  └──────────┬───────────┘  │
└────────────┼─────────────────────┼──────────────────────┼──────────────┘
             │                     │                      │
             │           HTTPS REST / WebSocket           │
             ▼                     ▼                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    BACKEND (Express 5.2 TypeScript)                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Middlewares: authenticate -> authorizeRoles -> authorizePerms    │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│  ┌──────────────────┐  ┌────────────┴─────┐  ┌──────────────────────┐  │
│  │ Subsystem Routers│  │ Modular Services │  │ Mongoose 9 Models    │  │
│  │ (/super-admin/*) │  │ (ACID & Inval)   │  │ (Compound Indexes)   │  │
│  └──────────────────┘  └────────────┬─────┘  └──────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
┌───────────────────────────┐                   ┌───────────────────────────┐
│     MongoDB Replica Set   │                   │    Redis Invalidation Bus │
│   (ACID Transactions)     │                   │   (Pub/Sub & TTL Caching) │
└───────────────────────────┘                   └───────────────────────────┘
```

---

## <span style="color: #1E40AF;">2. Frontend Architecture (Next.js 15+ App Router)</span>

The frontend web client resides at `WorkSphereFrontend/frontend-web`.

### <span style="color: #2563EB;">2.1 Routing & Directory Structure</span>
Administrative pages are isolated inside the Next.js App Router:

```
frontend-web/app/superadmin/
├── layout.tsx                     <-- Global SuperAdmin layout with authenticated sidebar
├── page.tsx                       <-- SuperAdmin entry redirect
├── dashboard/                     <-- Executive KPIs, revenue stats, system health
├── companies/                     <-- Tenant company listing, search, filters & actions
├── features/                      <-- Feature catalog manager (CreateFeature / GetFeatures)
├── plans/                         <-- Subscription plans & entitlements matrix
├── subscriptions/                 <-- Company subscription status, overrides & history
├── storage/                       <-- Cloudinary settings, health checks & rollback
├── analytics/                     <-- Cross-tenant usage and attendance trends
├── security/                      <-- Admin MFA policies & session controls
├── audit/                         <-- Platform-wide audit logs & tamper-evident logs
├── impersonation/                 <-- SuperAdmin secure tenant user impersonation
├── system-health/                 <-- Node.js memory, MongoDB latency, Redis ping
└── components/                    <-- Reusable modular UI widgets
    ├── createcompany/             <-- Multi-step company provisioning wizard
    ├── getcompany/                <-- Company details & action drawer
    ├── features/                  <-- Feature creation & editing dialogs
    ├── plans/                     <-- Plan builder & entitlement checkboxes
    └── storage/                   <-- StorageConfigForm, StorageHealthBanner, StorageHistoryTable
```

### <span style="color: #2563EB;">2.2 State Management & Server Synchronization</span>
- **TanStack Query (React Query v5):** All server data is fetched using typed query hooks (e.g. `useGetFeatures`, `useGetPlans`, `useGetCompanies`).
- **Optimistic UI & Cache Invalidation:** Mutations (`useCreatePlan`, `useCreateCompany`, `useCreateFeature`) automatically invalidate query keys (`['features']`, `['plans']`, `['companies']`), triggering instant re-renders.
- **Server Error Mapping:** API validation errors are parsed using `parseApiValidationErrors(err)` and bound directly to individual form fields via `setError(field, { message })`.

---

## <span style="color: #1E40AF;">3. Backend Architecture (Express 5.2 TypeScript)</span>

The backend resides at `WorkSphereBackend/Backend/src`.

### <span style="color: #2563EB;">3.1 Subsystem Modularization</span>
All SuperAdmin logic is consolidated within `Backend/src/modules/super-admin/`:

```
Backend/src/modules/super-admin/
├── super-admin.routes.ts         <-- Master SuperAdmin router with RBAC guard pipeline
├── index.ts                      <-- Sub-router aggregation & public service exports
├── features/                     <-- Feature controller, model, service, schema, types
├── plans/                        <-- Plan controller, model, service, schema, types
├── plan-features/                <-- Plan-feature entitlement relational mapping
├── companies/                    <-- Company controller, model, service, schema, types
├── subscriptions/                <-- Subscription controller, model, service, events, payments
├── storage/                      <-- Cloudinary storage controller, service, history, validator
├── audit/                        <-- Platform audit log controller & query service
├── overview/                     <-- Executive dashboard KPI aggregation
├── system-health/                <-- Diagnostics & memory telemetry
└── white-label/                  <-- Multi-tenant branding, custom domains & theme models
```

### <span style="color: #2563EB;">3.2 Three-Tier RBAC Guard Pipeline</span>
Every request reaching `/api/super-admin/*` must pass through three distinct guard stages:

```typescript
// Backend/src/modules/super-admin/super-admin.routes.ts
// Stage 1 & 2: Token verification & Role authorization
router.use(authenticate, authorizeRoles('SUPER_ADMIN'));

// Stage 3: Granular permission authorization per sub-route
router.use('/plans', authorizePermissions('PLAN_MANAGE'), planRouter);
router.use('/features', authorizePermissions('FEATURE_MANAGE'), featureRouter);
router.use('/storage', authorizePermissions('STORAGE_CONFIG_MANAGE'), storageRouter);
```

---

## <span style="color: #1E40AF;">4. SuperAdmin UI/UX Enterprise Design System</span>

To ensure an enterprise-grade, distraction-free administrative interface, UWorksphere enforces a standardized color hierarchy, clean layouts, and functional iconography.

### <span style="color: #2563EB;">4.1 Enterprise Color Palette</span>

| UI Token | Hex Code | Visual Swatch | Applied Scope |
| :--- | :---: | :---: | :--- |
| **Primary Headings** | `#172554` | <span style="color: #172554; font-weight: bold;">■ Sapphire Navy</span> | Page titles, modal header titles, master statistics values. |
| **Secondary Headings** | `#1E40AF` | <span style="color: #1E40AF; font-weight: bold;">■ Deep Royal Navy</span>| Card header titles, drawer headings, section groupings. |
| **Section Headings** | `#2563EB` | <span style="color: #2563EB; font-weight: bold;">■ Vivid Blue</span> | Tab labels, sub-section headers, active navigation pills. |
| **Success State** | `#16A34A` | <span style="color: #16A34A; font-weight: bold;">■ Forest Green</span> | Active status badges, success toasts, verified domains. |
| **Warning State** | `#D97706` | <span style="color: #D97706; font-weight: bold;">■ Amber Bronze</span> | Quota warning banners (80%), trial expiration alerts. |
| **Danger State** | `#DC2626` | <span style="color: #DC2626; font-weight: bold;">■ Ruby Red</span> | Destructive deletion actions, suspension badges, quota blocks. |
| **Information State** | `#0891B2` | <span style="color: #0891B2; font-weight: bold;">■ Deep Cyan</span> | Contextual helper callouts, plan recommendations. |
| **Page Background** | `#F8FAFC` | <span style="color: #64748B; font-weight: bold;">■ Slate Light 50</span>| Platform-wide canvas background. |
| **Card Background** | `#FFFFFF` | <span style="color: #0F172A; font-weight: bold;">□ Pure White</span> | Surface containers, table wrappers, modals, dropdowns. |
| **Main Body Text** | `#0F172A` | <span style="color: #0F172A; font-weight: bold;">■ Midnight Slate</span>| Primary text, table cell content, input text. |
| **Secondary Text** | `#64748B` | <span style="color: #64748B; font-weight: bold;">■ Slate Muted</span> | Helper text, breadcrumb paths, metadata timestamps. |

### <span style="color: #2563EB;">4.2 UI Design Specifications</span>
- **Breadcrumb Navigation:** Every administrative page displays full hierarchical breadcrumbs (e.g. `SuperAdmin > Companies > ABC Technologies > Subscription`).
- **Meaningful Iconography:** Powered by Lucide React. Every icon directly maps to its functional module (e.g. `Building2` for Companies, `Layers` for Plans, `ToggleLeft` for Features, `Database` for Storage). **Decorative sparkle icons are strictly prohibited.**
- **Enterprise Form Design:** Forms feature clear two-column or stepper layouts, field grouping with dedicated icons, explicit mandatory asterisks (`*`), helper text beneath inputs, and inline server error alerts.
- **Confirmation Modals:** Destructive operations (suspending a company, deleting a plan, rolling back storage) require explicit confirmation dialogs with distinct danger styling (`#DC2626`).

