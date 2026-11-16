# <span style="color: #172554;">12 &mdash; Step-by-Step SuperAdmin Operational Playbooks</span>

> **Document ID:** WS-DOC-SA-12 &nbsp;|&nbsp; **Category:** Operational Procedures & Runbooks &nbsp;|&nbsp; **Target Audience:** SuperAdmins, Support Operations, Solution Engineers

---

## <span style="color: #1E40AF;">Workflow A: Create a New Feature</span>

- **Objective:** Register a new system capability in the central catalog for subsequent plan assignment.
- **Prerequisites:** Active SuperAdmin account with `FEATURE_MANAGE` permission.
- **Navigation Path:** SuperAdmin Console &rarr; **Feature Management** (`/superadmin/features`) &rarr; **Create Feature**.
- **Required Fields:**
  - Feature Name: `Asset Management`
  - Feature Key: `asset_management` (stored as `ASSET_MANAGEMENT`)
  - Category: `Productivity`
  - Type: `BOOLEAN`
  - Unit: `NONE`
  - Description: `Track physical company assets, laptop allocations, and hardware serial numbers`
  - Status: `Active` (`true`)

### <span style="color: #2563EB;">Step-by-Step Execution</span>
1. Click **Create Feature** in the top-right header of `/superadmin/features`.
2. Enter **Asset Management** into the **Feature Name** field.
3. Verify that the **Key** field populates or type `ASSET_MANAGEMENT`.
4. From the **Category** dropdown, select `Productivity`.
5. Select **Type** as `BOOLEAN`. (The Unit selector is automatically disabled).
6. Enter the operational scope in the **Description** textarea.
7. Ensure the **Active** toggle switch is checked.
8. Click **Save Feature**.

### <span style="color: #16A34A;">Expected Result</span>
The modal closes with a green toast notification: *"Feature created successfully"*. The feature appears in the catalog table with status `Active`.

### <span style="color: #2563EB;">Validation Checklist</span>
- [ ] Feature displays in `GET /api/super-admin/features`.
- [ ] Document exists in MongoDB `features` collection with uppercase key `ASSET_MANAGEMENT`.
- [ ] Feature is available in the Plan Management assignment checklist.

### <span style="color: #D97706;">Common Errors & Solutions</span>
| Error Symptom | Cause | Solution |
| :--- | :--- | :--- |
| `Feature with key already exists` | Key collision in database | Change key name or search existing inactive features. |
| `Key contains lowercase letters` | Validation constraint | Supply key in uppercase snake_case (`ASSET_MGMT`). |

---

## <span style="color: #1E40AF;">Workflow B: Create a New Subscription Plan</span>

- **Objective:** Introduce a new commercial subscription tier with defined billing frequency and base pricing.
- **Prerequisites:** Catalog features registered in the database.
- **Navigation Path:** SuperAdmin Console &rarr; **Plan Management** (`/superadmin/plans`) &rarr; **Create Plan**.
- **Required Fields & Realistic Values:**
  - Name: `Growth Annual Tier`
  - Code: `GROWTH_ANNUAL`
  - Billing Cycle: `YEARLY`
  - Price: `24999`
  - Currency: `INR`
  - Trial Period Days: `14`
  - Active: `true`
  - Default: `false`

### <span style="color: #2563EB;">Step-by-Step Execution</span>
1. In `/superadmin/plans`, click **Create Plan**.
2. Complete the plan details form with the parameters listed above.
3. Configure the initial feature entitlements in the embedded feature matrix (see Workflow C).
4. Click **Create Plan**.

### <span style="color: #16A34A;">Expected Result</span>
A success confirmation displays: *"Plan Created Successfully"*. The plan appears on the plan dashboard with an active badge.

---

## <span style="color: #1E40AF;">Workflow C: Assign Features to a Plan</span>

- **Objective:** Configure the exact feature toggles and numeric limits for a specific subscription tier.
- **Prerequisites:** Target plan created; feature catalog populated.
- **Navigation Path:** SuperAdmin Console &rarr; **Plan Management** &rarr; Select Plan &rarr; **Configure Entitlements**.
- **Example Values:**
  - `USERS`: Type: `LIMITED`, Value: `50`
  - `PROJECTS`: Type: `LIMITED`, Value: `25`
  - `STORAGE`: Type: `LIMITED`, Value: `50` (GB)
  - `LIVE_MONITORING`: Type: `NONE`, Enabled: `true`
  - `CUSTOM_COMPANY_EMAIL`: Type: `NONE`, Enabled: `false`

### <span style="color: #2563EB;">Step-by-Step Execution</span>
1. Open the plan entitlements editor.
2. For each numeric resource (`USERS`, `STORAGE`, `PROJECTS`), select `LIMITED` and input the quota.
3. For modular tools (`LIVE_MONITORING`, `CHAT`), toggle the switch to **Enabled**.
4. Click **Save Entitlements**.

### <span style="color: #16A34A;">Expected Result</span>
The backend upserts relational `PlanFeature` documents, evicts cached entitlements, and reflects the updated quotas on the plan summary card.

---

## <span style="color: #1E40AF;">Workflow D: Create a Company</span>

- **Objective:** Onboard a new tenant organization into UWorksphere.
- **Prerequisites:** At least one active subscription plan exists.
- **Navigation Path:** SuperAdmin Console &rarr; **Company Management** (`/superadmin/companies`) &rarr; **Create Company**.
- **Required Fields & Example Values:**
  - Company Name: `ABC Technologies`
  - Company Domain: `https://abctech.com`
  - Industry: `Information Technology`
  - Size: `SME`
  - Company Email: `admin@abctech.com`
  - Phone: `+919876543210`
  - Timezone: `Asia/Kolkata`
  - Currency: `INR`
  - Assigned Plan: `Starter Plan`
  - Admin Name: `Rajesh Kumar`
  - Admin Email: `rajesh@abctech.com`
  - Admin Password: `TempPassword2026!#`

### <span style="color: #2563EB;">Step-by-Step Execution</span>
1. Click **Create Company** to launch the two-step onboarding wizard.
2. **Step 1 (Admin Credentials):** Enter Administrator Full Name, Email, and temporary Password. Click **Next Step**.
3. **Step 2 (Company Details):** Enter Company Name, select Company Size (`SME`), select Timezone (`Asia/Kolkata`), Currency (`INR`), and assign the Subscription Plan.
4. Click **Complete Onboarding**.

### <span style="color: #16A34A;">Expected Result</span>
Green success screen displays: *"Company Onboarded Successfully"*. Provides a one-click copy button for the administrator's login credentials.

---

## <span style="color: #1E40AF;">Workflow E: Assign Company Administrator</span>

- **Objective:** Appoint or replace the primary administrative user for a company.
- **Prerequisites:** Tenant company created in database.
- **Navigation Path:** SuperAdmin Console &rarr; **Company Management** &rarr; Select Company &rarr; **Administrators**.
- **Execution:**
  - To reset an existing admin's password: Click **Reset Admin Password**, input new password (`min 8 chars`), and confirm.
  - To reassign: Update `Company.adminId` pointer to another verified user with the `COMPANY_ADMIN` role.

---

## <span style="color: #1E40AF;">Workflow F: Assign Subscription Plan (Manual Upgrade & Billing Sync)</span>

- **Objective:** Manually upgrade a customer's plan offline without duplicate billings.
- **Prerequisites:** Customer contract executed offline.
- **Navigation Path:** SuperAdmin Console &rarr; **Company Management** &rarr; Select Company &rarr; **Subscription Tab** &rarr; **Change Plan**.
- **Execution:**
  1. Select target plan: `Enterprise Plan`.
  2. Toggle **Apply Immediately** to `true`.
  3. Enter reason: `Annual offline enterprise agreement signed`.
  4. Click **Confirm Plan Assignment**.

### <span style="color: #16A34A;">Expected Result</span>
- `Subscription.planId` immediately updates to `Enterprise Plan`.
- `SubscriptionEntitlementSyncService` broadcasts invalidation signals.
- The company's billing dashboard (`/companyadmin/settings/billing`) immediately reflects the Enterprise tier.

---

## <span style="color: #1E40AF;">Workflow G: Configure Cloudinary Storage</span>

- **Objective:** Configure and verify Cloudinary as the active object storage engine.
- **Prerequisites:** Cloudinary account credentials obtained.
- **Navigation Path:** SuperAdmin Console &rarr; **Storage Configuration** (`/superadmin/storage`).
- **Required Fields:**
  - Provider: `CLOUDINARY`
  - Cloud Name: `worksphere-prod`
  - API Key: `123456789012345`
  - API Secret: `your_api_secret_here`
  - Base Directory: `worksphere`
  - Storage Status: `Enabled`
- **Execution:**
  1. Input credentials into the form.
  2. Click **Test Connection**. Verify green status: *"Connection Successful"*.
  3. Click **Save Configuration**.

---

## <span style="color: #1E40AF;">Workflow H: Assign Storage Limits</span>

- **Objective:** Update default upload file size caps.
- **Prerequisites:** Storage configuration active.
- **Navigation Path:** SuperAdmin Console &rarr; **Storage Configuration** &rarr; **Limits Tab**.
- **Execution:** Set `Image Max Size` (10 MB), `Document Max Size` (50 MB), `Video Max Size` (100 MB). Click **Update Limits**.

---

## <span style="color: #1E40AF;">Workflow I: Test Company Feature Access</span>

- **Objective:** Verify that an onboarded company cannot access features outside their plan.
- **Execution:**
  1. Log in as Company Admin (`rajesh@abctech.com`) on Starter Plan.
  2. Attempt to navigate to `/companyadmin/live-monitoring`.
  3. Verify that the UI displays an upgrade prompt and API requests return `403 Forbidden` (`MODULE_NOT_ENTITLED`).

---

## <span style="color: #1E40AF;">Workflow J: Update Company Currency and Time Zone</span>

- **Objective:** Reconfigure corporate timezone or currency for international operations.
- **Navigation Path:** SuperAdmin Console &rarr; **Company Management** &rarr; Select Company &rarr; **Edit Profile**.
- **Execution:**
  1. Change Timezone from `UTC` to `America/New_York`.
  2. Change Currency from `INR` to `USD`.
  3. Click **Save Changes**.
  4. Verify that new attendance logs display in Eastern Time (`ET`) and invoices render with `$`.

