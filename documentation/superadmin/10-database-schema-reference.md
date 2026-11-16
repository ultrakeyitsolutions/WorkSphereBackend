# <span style="color: #172554;">10 &mdash; Database Schema Reference & Entity Relational Design</span>

> **Document ID:** WS-DOC-SA-10 &nbsp;|&nbsp; **Category:** Database Design & Data Integrity &nbsp;|&nbsp; **Target Audience:** Database Administrators, Data Architects, Backend Engineers

---

## <span style="color: #1E40AF;">1. Database Architecture & Relational Overview</span>

UWorksphere utilizes **MongoDB 8+ / 9+** modeled through **Mongoose 9.10+**. While MongoDB is inherently a document store, UWorksphere implements a normalized, relational multi-tenant architecture to preserve referential integrity, prevent data duplication, and enable zero-downtime feature expansion.

---

## <span style="color: #1E40AF;">2. Master Entity-Relationship Diagram</span>

```mermaid
erDiagram
    Feature ||--o{ PlanFeature : "configured in"
    Plan ||--o{ PlanFeature : "entitles"
    Plan ||--o{ Subscription : "subscribed by"
    Company ||--o| Subscription : "maintains"
    Company ||--o| User : "primary admin"
    Company ||--o{ User : "employs"
    Company ||--o| CompanySettings : "governed by"
    Company ||--o| WhiteLabelSettings : "branded by"
    Company ||--o{ TenantMembership : "enrolled in"
    User ||--o{ TenantMembership : "member of"
    Role ||--o{ User : "authorizes"
    Permission ||--o{ Role : "composes"
    Company ||--o{ FileModel : "owns assets"
    Subscription ||--o{ SubscriptionEvent : "tracks lifecycle"
    Company ||--o{ AuditLog : "records actions"
    StorageConfiguration ||--o{ StorageConfigurationHistory : "versions"

    Feature {
        string key PK "Unique UPPERCASE identifier"
        string name "Display title"
        string category "Functional category"
        string type "BOOLEAN or LIMIT"
        string unit "COUNT, GB, MB, DAYS, NONE"
        boolean isActive "System-wide switch"
    }

    Plan {
        string code PK "Unique uppercase code"
        string name "Plan title"
        string billingCycle "MONTHLY, YEARLY"
        number price "Base cost"
        string currency "ISO 4217 code"
        boolean isActive "Visibility status"
        boolean isDefault "Onboarding tier"
    }

    PlanFeature {
        ObjectId planId FK "Ref: Plan"
        ObjectId featureId FK "Ref: Feature"
        boolean enabled "Access flag"
        string limitType "NONE, LIMITED, UNLIMITED"
        number value "Numeric ceiling"
    }

    Company {
        string tenantId UK "Unique system tenant ID"
        string slug UK "URL identifier"
        string name "Corporate name"
        string timezone "IANA identifier"
        string currency "ISO 4217 code"
        string status "ACTIVE, SUSPENDED, DELETED"
        ObjectId adminId FK "Ref: User"
        ObjectId subscriptionId FK "Ref: Subscription"
    }

    Subscription {
        ObjectId companyId FK "Ref: Company (Unique 1:1)"
        ObjectId planId FK "Ref: Plan"
        string status "ACTIVE, TRIALING, PAUSED, CANCELLED"
        date currentPeriodStart "Cycle start"
        date currentPeriodEnd "Next renewal"
        boolean isComplimentary "Admin bypass flag"
    }

    FileModel {
        ObjectId companyId FK "Ref: Company"
        ObjectId uploadedBy FK "Ref: User"
        string storageKey "Cloudinary key"
        number size "File size in bytes"
        string mimeType "Validated MIME"
        date deletedAt "Soft delete timestamp"
    }
```

---

## <span style="color: #1E40AF;">3. Schema Definitions & Attribute References</span>

### <span style="color: #2563EB;">3.1 Feature Collection (`features.model.ts`)</span>
- **Collection Name:** `features`
- **Model Name:** `Feature`
- **Purpose:** Central dictionary of all modular capabilities across UWorksphere.
- **Attributes:**
  - `key` (`String`, Required, Unique, Trim, Uppercase): Immutable programmatic identifier (e.g. `'TASK_MANAGEMENT'`, `'STORAGE'`).
  - `name` (`String`, Required, Trim): Display name (e.g. `'Task Management'`).
  - `description` (`String`, Required, Trim): Operational scope text.
  - `category` (`String`, Required, Lowercase): Functional category (`'core'`, `'productivity'`, `'storage'`, `'communication'`, `'analytics'`, `'security'`, `'integrations'`, `'management'`).
  - `type` (`String`, Required, Enum: `['BOOLEAN', 'LIMIT']`): Architectural behavior flag.
  - `unit` (`String`, Required, Enum: `['COUNT', 'GB', 'MB', 'PER_PROJECT', 'DAYS', 'NONE']`): Units of measurement.
  - `isActive` (`Boolean`, Default: `true`): System-wide activation toggle.
- **Indexes:** `{ key: 1 }` (Unique).

### <span style="color: #2563EB;">3.2 Subscription Plan Collection (`plans.model.ts`)</span>
- **Collection Name:** `plans`
- **Model Name:** `Plan`
- **Purpose:** Commercial packaging tiers dictating pricing and billing frequency.
- **Attributes:**
  - `code` (`String`, Required, Unique, Trim, Uppercase): Stable key (`'STARTER'`, `'GROWTH'`, `'ENTERPRISE'`).
  - `name` (`String`, Required, Unique, Trim): Human-readable name.
  - `billingCycle` (`String`, Required, Enum: `['MONTHLY', 'SEMI_ANNUAL', 'YEARLY']`).
  - `price` (`Number`, Required, Min: 0): Base price for the cycle.
  - `currency` (`String`, Required, Trim, Uppercase, Default: `'INR'`).
  - `trialPeriodDays` (`Number`, Default: 0, Min: 0): Evaluation duration.
  - `isActive` (`Boolean`, Default: `true`): Availability flag.
  - `isDefault` (`Boolean`, Default: `false`): Auto-assignment flag for zero-configuration onboarding.
  - `isArchived` (`Boolean`, Default: `false`): Soft-delete flag preserving historic subscriptions.
- **Indexes:** `{ code: 1 }` (Unique), `{ name: 1 }` (Unique).

### <span style="color: #2563EB;">3.3 Plan Features Collection (`plan-features.model.ts`)</span>
- **Collection Name:** `planfeatures`
- **Model Name:** `PlanFeature`
- **Purpose:** Relational join table mapping features to plans with quantitative rules.
- **Attributes:**
  - `planId` (`ObjectId`, Required, Ref: `'Plan'`): Target plan.
  - `featureId` (`ObjectId`, Required, Ref: `'Feature'`): Target feature.
  - `enabled` (`Boolean`, Required, Default: `true`): Boolean access switch.
  - `limitType` (`String`, Required, Enum: `['NONE', 'LIMITED', 'UNLIMITED']`).
  - `value` (`Number`, Nullable, Default: `null`): Numeric ceiling when `limitType === 'LIMITED'`.
- **Indexes:** `{ planId: 1, featureId: 1 }` (**Compound Unique Index**).

### <span style="color: #2563EB;">3.4 Company Collection (`company.model.ts`)</span>
- **Collection Name:** `companies`
- **Model Name:** `Company`
- **Purpose:** Core tenant organization boundary.
- **Attributes:**
  - `tenantId` (`String`, Unique, Sparse, Trim): Global tenant ID (e.g. `'ws_comp_1730952000_abcd'`).
  - `name` (`String`, Required, Trim): Company legal/operating name.
  - `slug` (`String`, Required, Unique, Lowercase, Trim): URL and domain slug.
  - `domain` (`String`, Trim, Lowercase): Primary corporate web domain.
  - `adminId` (`ObjectId`, Ref: `'User'`): Back-patch pointer to the company administrator account.
  - `subscriptionId` (`ObjectId`, Ref: `'Subscription'`): Pointer to the current active subscription.
  - `timezone` (`String`, Trim): Configured IANA timezone (e.g. `'Asia/Kolkata'`).
  - `currency` (`String`, Trim): Configured ISO 4217 currency (e.g. `'INR'`).
  - `status` (`String`, Enum: `['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED']`, Default: `'ACTIVE'`).
  - `billingDiscountEnabled` (`Boolean`, Default: `false`).
  - `billingDiscountPercentage` (`Number`, Default: 0, Min: 0, Max: 100).
  - `suspendedAt`, `suspendedBy`, `deletedAt`, `deletedBy`: Audit tracking fields.
- **Indexes:** `{ slug: 1 }` (Unique), `{ tenantId: 1 }` (Unique, Sparse), `{ domain: 1 }`.

### <span style="color: #2563EB;">3.5 Subscription Collection (`subscription.model.ts`)</span>
- **Collection Name:** `subscriptions`
- **Model Name:** `Subscription`
- **Purpose:** Active commercial contract governing tenant feature entitlements.
- **Attributes:**
  - `companyId` (`ObjectId`, Required, Ref: `'Company'`, Unique): One-to-one company linkage.
  - `planId` (`ObjectId`, Required, Ref: `'Plan'`): Currently active plan tier.
  - `status` (`String`, Enum: `['PENDING', 'TRIALING', 'ACTIVE', 'PAUSED', 'PAST_DUE', 'CANCELLED', 'EXPIRED']`).
  - `startedAt` (`Date`, Required): Initial activation timestamp.
  - `currentPeriodStart` (`Date`, Required): Billing cycle window start.
  - `currentPeriodEnd` (`Date`, Required): Billing cycle renewal date.
  - `isComplimentary` (`Boolean`, Default: `false`): SuperAdmin manual override flag.
  - `pricingOverride` (`Number`, Nullable, Default: `null`): Negotiated offline price.
  - `scheduledPlanId` (`ObjectId`, Ref: `'Plan'`): Plan queued for execution at next renewal.
- **Indexes:** `{ companyId: 1 }` (Unique), `{ status: 1 }`.

### <span style="color: #2563EB;">3.6 Storage Configuration Collection (`storage-config.model.ts`)</span>
- **Collection Name:** `storageconfigurations`
- **Model Name:** `StorageConfiguration`
- **Purpose:** Runtime parameters and credentials for active cloud storage engines.
- **Attributes:**
  - `provider` (`String`, Required, Enum: `['BUNNY', 'S3', 'CLOUDFLARE_R2', 'CLOUDINARY', 'OTHER']`).
  - `enabled` (`Boolean`, Default: `true`): Storage availability flag.
  - `configuration` (`Mixed`, Encrypted): Provider credentials (`cloudName`, `apiKey`, `apiSecret`, `deliveryUrl`).
  - `limits` (`Object`): File size constraints (`imageMaxSizeMB`, `documentMaxSizeMB`, etc.).
  - `allowedTypes` (`Object`): Allowed MIME types mapped by category.

---

## <span style="color: #1E40AF;">4. Idempotent Database Seeding Pipeline</span>

UWorksphere implements deterministic, safe, and idempotent database initialization scripts (`npm run db:init` / `Backend/src/database/seeds/index.ts`):

| Seed Module | Script Path | Target Collections | Guarantees & Safety |
| :--- | :--- | :--- | :--- |
| **Permissions** | `seed-permissions.ts` | `permissions` | Inserts all system permission tokens without deleting existing custom tokens. |
| **Roles** | `seed-roles.ts` | `roles` | Bootstraps `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER`, `EMPLOYEE` roles and synchronizes permission arrays. |
| **SuperAdmin** | `seed-super-admin.ts` | `users` | Creates initial administrator from `.env` variables; **never mutates existing passwords in production**. |
| **Features** | `seed-features.ts` | `features` | Idempotently inserts 22 standard features; updates names and categories if catalog evolves. |
| **Plans** | `seed-plans.ts` | `plans`, `planfeatures` | Creates `STARTER`, `GROWTH`, `ENTERPRISE` tiers and upserts their `PlanFeature` matrices. |
| **Settings** | `seed-settings.ts` | `storageconfigurations` | Initializes default Cloudinary/Bunny configuration and notification sounds. |

