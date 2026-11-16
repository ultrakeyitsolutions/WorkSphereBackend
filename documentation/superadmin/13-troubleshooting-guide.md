# <span style="color: #172554;">13 &mdash; Production Diagnostics & Troubleshooting Runbook</span>

> **Document ID:** WS-DOC-SA-13 &nbsp;|&nbsp; **Category:** Diagnostics & Incident Response &nbsp;|&nbsp; **Target Audience:** DevOps Engineers, SuperAdmins, Site Reliability Engineers (SRE)

---

## <span style="color: #1E40AF;">1. Incident Triage & Quick Reference</span>

When a production incident or operational anomaly occurs, locate the symptom in the quick reference matrix:

| Observed Symptom | Primary Root Cause | Immediate Diagnostic Action |
| :--- | :--- | :--- |
| **SuperAdmin Login Returns 403 Forbidden** | User account lacks the `SUPER_ADMIN` role linkage | Run `npm run patch:permissions` or verify role pointer in MongoDB. |
| **Plan Upgrade Does Not Reflect on Client** | Redis invalidation bus disconnected; stale memory cache | Run `EntitlementService.clearAllCache()` or restart backend workers. |
| **Cloudinary File Upload Fails with 500/503** | Storage provider disabled or invalid API Secret | Check `/superadmin/storage/health` and verify credentials via test endpoint. |
| **Company Creation Aborts with 409 Conflict** | Email or slug collision | Check if admin email or company slug is already registered. |
| **Attendance Check-In Skewed by Several Hours** | Non-standard timezone abbreviation configured | Re-save company timezone using a valid IANA identifier (`Asia/Kolkata`). |
| **Razorpay Webhook Fails with 400 Invalid Signature** | Express parsed body before raw signature validation | Verify `express.json({ verify: ... })` captures `req.rawBody`. |

---

## <span style="color: #1E40AF;">2. Troubleshooting Specific Subsystems</span>

### <span style="color: #2563EB;">2.1 Authentication & SuperAdmin Authorization Failures</span>
- **Symptom:** SuperAdmin enters credentials and receives `401 Unauthorized` or `403 Forbidden: Insufficient role permissions`.
- **Root Cause Analysis:**
  1. Verify whether the `SUPER_ADMIN` role exists in the `roles` collection:
     ```javascript
     db.roles.findOne({ name: 'SUPER_ADMIN' })
     ```
  2. Verify that the user document points to this role:
     ```javascript
     db.users.findOne({ email: 'superadmin@worksphere.com' }, { role: 1 })
     ```
- **Automated Fix:**
  Execute the idempotent repair script:
  ```bash
  npm run patch:permissions
  ```

---

### <span style="color: #2563EB;">2.2 Stale Feature Entitlements & Desynchronized Caches</span>
- **Symptom:** A SuperAdmin upgraded a company to the `Growth Plan`, but employees still see `"Upgrade Required"` when accessing the **Live Monitoring** or **Chat** modules.
- **Root Cause Analysis:**
  1. The cluster's Redis connection may have experienced a temporary network partition during the upgrade event, preventing publication of `worksphere:entitlements_invalidated`.
  2. Node.js cluster processes are continuing to serve cached data from their 30-second local memory maps.
- **Automated Fix:**
  SuperAdmins can trigger a force-invalidation via the API or CLI:
  ```bash
  # Execute CLI Entitlement Reconciler
  npx tsx src/scripts/reconcile-entitlements.ts --companyId=<COMPANY_ID>
  ```
  Or trigger an API call to re-save the subscription, which executes `SubscriptionEntitlementSyncService.sync()`.

---

### <span style="color: #2563EB;">2.3 Cloudinary Upload Failures & Storage Health Degradation</span>
- **Symptom:** Users upload files and receive `503 Service Unavailable: File storage service is currently disabled or unconfigured`.
- **Diagnostic Procedure:**
  1. Query the health status endpoint:
     `GET /api/super-admin/storage/health`
  2. Inspect response payload:
     ```json
     {
         "success": false,
         "data": {
             "provider": "CLOUDINARY",
             "status": "UNHEALTHY",
             "message": "Invalid API Key or Cloud Name"
         }
     }
     ```
- **Resolution:**
  1. Verify Cloudinary credentials in the Cloudinary Console.
  2. Navigate to `/superadmin/storage`, re-enter the API Secret, and click **Test Connection**.
  3. If newly applied credentials broke the service, execute a rollback to the last working snapshot:
     `POST /api/super-admin/storage/rollback/:historyId`

---

### <span style="color: #2563EB;">2.4 Company Onboarding Transaction Abortions</span>
- **Symptom:** Submitting the `CreateCompany` form returns a `400 Bad Request` or generic error toast.
- **Diagnostic Procedure:**
  1. Inspect backend Pino logs for transaction rollback messages:
     ```
     [CompanyService] Transaction aborted: A user with email "admin@company.com" already exists
     ```
  2. Check if a soft-deleted company still holds the desired URL slug:
     ```javascript
     db.companies.findOne({ slug: 'desired-slug' })
     ```
- **Resolution:**
  - If the email is in use by another tenant or former employee, choose a unique email address.
  - If the slug is taken by an inactive or deleted company, permanently purge the conflicting record or customize the new company's slug.

---

### <span style="color: #2563EB;">2.5 Timezone & Daylight Saving Time (DST) Inconsistencies</span>
- **Symptom:** Attendance check-ins for US employees show timestamps shifted by 1 hour during spring/autumn transitions.
- **Root Cause:** Company timezone was set to a legacy manual offset or abbreviation (e.g. `UTC-5`) rather than an IANA location identifier (`America/New_York`).
- **Resolution:**
  1. Update the company's timezone to `America/New_York` using `PATCH /api/super-admin/companies/:id`.
  2. The V8 Intl engine automatically computes the -4 hour offset during Daylight Saving Time and -5 hour offset during Standard Time.

---

## <span style="color: #1E40AF;">3. Diagnostic CLI Scripts & Tools</span>

UWorksphere includes native diagnostic CLI tools located in `Backend/src/scripts`:

```bash
# 1. Run Complete Database Verification (Audits indexes, roles, orphan records)
npm run db:verify

# 2. Re-seed Missing Core Features & Roles Idempotently
npm run db:seed

# 3. Dry-run Inspection of Database Seeds (Zero Mutations)
npm run db:seed:dry-run

# 4. Reconcile Company Feature Entitlements
npx tsx src/scripts/reconcile-entitlements.ts

# 5. Backfill Default Company Settings
npm run seed:company-settings
```

---

## <span style="color: #1E40AF;">4. Master Error Codes Reference Table</span>

| HTTP Code | Platform Error Code | Meaning | Remediation Action |
| :---: | :--- | :--- | :--- |
| **`400`** | `VALIDATION_ERROR` | Request payload failed Zod schema check | Review field constraints (e.g. string length, URL format). |
| **`401`** | `TOKEN_EXPIRED` | JWT access token expired | Refresh token via `/api/auth/refresh-token` or log in again. |
| **`403`** | `INSUFFICIENT_ROLE` | User does not have `SUPER_ADMIN` role | Verify role assignments in `users` collection. |
| **`403`** | `MODULE_NOT_ENTITLED` | Company plan does not include this feature | Upgrade company subscription or grant manual override. |
| **`403`** | `PLAN_LIMIT_REACHED` | Quantitative quota exhausted (users/storage)| Upgrade subscription plan or purge unneeded assets. |
| **`404`** | `TENANT_NOT_FOUND` | `companyId` does not match any record | Verify company ObjectId or check for soft-deletion. |
| **`409`** | `DUPLICATE_KEY` | Unique constraint violation (slug, email) | Ensure company slug and admin email are unique globally. |
| **`503`** | `STORAGE_UNAVAILABLE` | Active storage provider offline or disabled | Check Cloudinary API health and credentials in SuperAdmin. |

