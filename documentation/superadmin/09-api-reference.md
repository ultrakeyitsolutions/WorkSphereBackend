# <span style="color: #172554;">09 &mdash; SuperAdmin REST API Reference Manual</span>

> **Document ID:** WS-DOC-SA-09 &nbsp;|&nbsp; **Category:** API Specification &nbsp;|&nbsp; **Target Audience:** Backend Developers, Integration Engineers, QA Engineers

---

## <span style="color: #1E40AF;">1. Global API Conventions</span>

- **Base URL:** `https://api.uworksphere.com/api` (Local: `http://localhost:5000/api`)
- **Transport Security:** All production endpoints strictly require `HTTPS`.
- **Authentication:** Dual-token JWT. Pass the access token in the standard HTTP header:
  `Authorization: Bearer <ACCESS_TOKEN>`
- **Content-Type:** `application/json` (except logo/file uploads which require `multipart/form-data`).
- **Standard Success Response Format:**
  ```json
  {
      "success": true,
      "message": "Human readable confirmation",
      "data": { ... }
  }
  ```
- **Standard Error Response Format:**
  ```json
  {
      "success": false,
      "message": "Specific error explanation",
      "code": "ERROR_ENUM_CODE",
      "details": { ... }
  }
  ```

---

## <span style="color: #1E40AF;">2. Feature Management API</span>

### <span style="color: #2563EB;">2.1 List All Features</span>
- **Endpoint:** `GET /api/super-admin/features`
- **Auth:** JWT Access Token (`role: "SUPER_ADMIN"`)
- **Permission:** `FEATURE_MANAGE`
- **Query Parameters:** `activeOnly` (boolean, optional &mdash; e.g. `?activeOnly=true`)
- **Response `200 OK`:**
  ```json
  {
      "success": true,
      "message": "Features retrieved successfully",
      "data": [
          {
              "_id": "66f100000000000000000001",
              "key": "USERS",
              "name": "Active Employees",
              "description": "Number of active employee accounts allowed per company",
              "category": "core",
              "type": "LIMIT",
              "unit": "COUNT",
              "isActive": true,
              "createdAt": "2026-10-23T09:00:00.000Z",
              "updatedAt": "2026-10-23T09:00:00.000Z"
          },
          {
              "_id": "66f100000000000000000002",
              "key": "LIVE_MONITORING",
              "name": "Live Monitoring",
              "description": "Real-time employee activity, presence, and live dashboard monitoring",
              "category": "management",
              "type": "BOOLEAN",
              "unit": "NONE",
              "isActive": true,
              "createdAt": "2026-10-23T09:00:00.000Z",
              "updatedAt": "2026-10-23T09:00:00.000Z"
          }
      ]
  }
  ```

### <span style="color: #2563EB;">2.2 Create New Feature</span>
- **Endpoint:** `POST /api/super-admin/features`
- **Auth:** JWT Access Token (`role: "SUPER_ADMIN"`)
- **Permission:** `FEATURE_MANAGE`
- **Request Body:**
  ```json
  {
      "key": "DOCUMENT_MANAGEMENT",
      "name": "Document Management",
      "description": "Versioned corporate document repository with approval workflows",
      "category": "productivity",
      "type": "BOOLEAN",
      "unit": "NONE",
      "isActive": true
  }
  ```
- **Validation Rules:**
  - `key`: Required string, uppercase, trimmed, unique.
  - `name`: Required string, 2&ndash;100 characters.
  - `type`: Must be either `'BOOLEAN'` or `'LIMIT'`.
  - `unit`: Must be one of `'COUNT'`, `'GB'`, `'MB'`, `'PER_PROJECT'`, `'DAYS'`, `'NONE'`.
- **Response `201 Created`:** Returns the created `Feature` document.
- **Error `409 Conflict`:**
  ```json
  {
      "success": false,
      "message": "Feature with key \"DOCUMENT_MANAGEMENT\" already exists"
  }
  ```

### <span style="color: #2563EB;">2.3 Update Feature</span>
- **Endpoint:** `PATCH /api/super-admin/features/:id`
- **Auth:** JWT Access Token (`role: "SUPER_ADMIN"`)
- **Permission:** `FEATURE_MANAGE`
- **Request Body:**
  ```json
  {
      "name": "Advanced Document Management",
      "description": "Updated enterprise document repository with multi-tier approvals"
  }
  ```
- **Guard:** If `type` or `unit` is supplied, backend verifies that `PlanFeature.exists({ featureId: id })` is false. If in use, returns `400 Bad Request` with `FEATURE_IN_USE`.

### <span style="color: #2563EB;">2.4 Delete Feature</span>
- **Endpoint:** `DELETE /api/super-admin/features/:id`
- **Auth:** JWT Access Token (`role: "SUPER_ADMIN"`)
- **Permission:** `FEATURE_MANAGE`
- **Guard:** Prevents deletion if feature is assigned to any plan. Recommends deactivation instead.

---

## <span style="color: #1E40AF;">3. Subscription Plan Management API</span>

### <span style="color: #2563EB;">3.1 List All Plans</span>
- **Endpoint:** `GET /api/super-admin/plans`
- **Auth:** JWT Access Token (`role: "SUPER_ADMIN"`)
- **Permission:** `PLAN_MANAGE`
- **Response `200 OK`:** Returns array of plans populated with their relational `PlanFeature` entitlements.

### <span style="color: #2563EB;">3.2 Create Subscription Plan</span>
- **Endpoint:** `POST /api/super-admin/plans`
- **Auth:** JWT Access Token (`role: "SUPER_ADMIN"`)
- **Permission:** `PLAN_MANAGE`
- **Request Body:**
  ```json
  {
      "name": "Professional Tier",
      "code": "PROFESSIONAL",
      "description": "Advanced collaboration, time tracking and unlimited projects",
      "billingCycle": "MONTHLY",
      "price": 999,
      "currency": "INR",
      "trialPeriodDays": 14,
      "isActive": true,
      "isDefault": false,
      "features": [
          {
              "featureId": "66f100000000000000000001",
              "enabled": true,
              "limitType": "LIMITED",
              "value": 25
          },
          {
              "featureId": "66f100000000000000000002",
              "enabled": true,
              "limitType": "NONE",
              "value": null
          }
      ]
  }
  ```
- **Response `201 Created`:** Returns created `Plan` document with populated feature linkages.

---

## <span style="color: #1E40AF;">4. Company Provisioning & Management API</span>

### <span style="color: #2563EB;">4.1 Onboard New Company</span>
- **Endpoint:** `POST /api/super-admin/companies` (or `POST /api/super-admin/create-company`)
- **Auth:** JWT Access Token (`role: "SUPER_ADMIN"`)
- **Permission:** `COMPANY_CREATE`
- **Headers:** `Idempotency-Key: <UUID>` (Optional, highly recommended)
- **Request Body:**
  ```json
  {
      "companyName": "ABC Technologies",
      "companyDomain": "https://abctech.com",
      "companyIndustry": "Information Technology",
      "companySize": "SME",
      "companyEmail": "admin@abctech.com",
      "companyPhone": "+919876543210",
      "website": "https://abctech.com",
      "address": "MG Road",
      "city": "Vijayawada",
      "state": "Andhra Pradesh",
      "country": "India",
      "postalCode": "520001",
      "timezone": "Asia/Kolkata",
      "currency": "INR",
      "planId": "66f200000000000000000001",
      "adminName": "Rajesh Kumar",
      "adminEmail": "rajesh@abctech.com",
      "adminPassword": "TemporaryPassword123!"
  }
  ```
- **Response `201 Created`:**
  ```json
  {
      "success": true,
      "message": "Company created successfully",
      "data": {
          "company": {
              "_id": "66f300000000000000000001",
              "tenantId": "ws_comp_1730952000000_a1b2c3d4",
              "name": "ABC Technologies",
              "slug": "abc-technologies",
              "companyEmail": "admin@abctech.com",
              "timezone": "Asia/Kolkata",
              "currency": "INR",
              "status": "ACTIVE"
          },
          "admin": {
              "_id": "66f400000000000000000001",
              "name": "Rajesh Kumar",
              "email": "rajesh@abctech.com",
              "role": "COMPANY_ADMIN",
              "status": "ACTIVE"
          },
          "subscription": {
              "planId": "66f200000000000000000001",
              "status": "ACTIVE",
              "currentPeriodEnd": "2026-12-07T04:15:00.000Z"
          }
      }
  }
  ```

### <span style="color: #2563EB;">4.2 Suspend / Reactivate Company</span>
- **Endpoint:** `PATCH /api/super-admin/companies/:companyId/suspend`
- **Request Body:** `{ "reason": "Terms of service violation" }`
- **Endpoint:** `PATCH /api/super-admin/companies/:companyId/activate`
- **Response `200 OK`:** Updates status and immediately terminates tenant active sessions.

---

## <span style="color: #1E40AF;">5. Subscription Assignment & Upgrades API</span>

### <span style="color: #2563EB;">5.1 SuperAdmin Manual Plan Assignment</span>
- **Endpoint:** `POST /api/super-admin/companies/:companyId/subscription/assign-plan`
- **Auth:** JWT Access Token (`role: "SUPER_ADMIN"`)
- **Permission:** `SUBSCRIPTION_MANAGE`
- **Request Body:**
  ```json
  {
      "targetPlanId": "66f200000000000000000003",
      "immediate": true,
      "isComplimentary": false,
      "reason": "Customer upgraded to Enterprise Plan via sales order #SO-9921",
      "pricingOverride": null
  }
  ```
- **Response `200 OK`:**
  ```json
  {
      "success": true,
      "message": "Subscription plan successfully assigned",
      "data": {
          "_id": "66f500000000000000000001",
          "companyId": "66f300000000000000000001",
          "planId": "66f200000000000000000003",
          "status": "ACTIVE",
          "startedAt": "2026-11-07T04:15:00.000Z",
          "currentPeriodEnd": "2027-11-07T04:15:00.000Z"
      }
  }
  ```

---

## <span style="color: #1E40AF;">6. Storage Configuration & Diagnostics API</span>

### <span style="color: #2563EB;">6.1 Get Active Storage Configuration</span>
- **Endpoint:** `GET /api/super-admin/storage/configuration`
- **Auth:** JWT Access Token (`role: "SUPER_ADMIN"`)
- **Response `200 OK`:**
  ```json
  {
      "success": true,
      "message": "Storage configuration retrieved successfully",
      "data": {
          "provider": "CLOUDINARY",
          "enabled": true,
          "configuration": {
              "cloudName": "worksphere-prod",
              "apiKey": "123456789012345",
              "apiSecret": "****************XyZ1",
              "basePath": "worksphere",
              "deliveryUrl": "https://res.cloudinary.com/worksphere-prod"
          },
          "limits": {
              "imageMaxSizeMB": 10,
              "documentMaxSizeMB": 50,
              "audioMaxSizeMB": 25,
              "videoMaxSizeMB": 100
          }
      }
  }
  ```

### <span style="color: #2563EB;">6.2 Test Storage Configuration</span>
- **Endpoint:** `POST /api/super-admin/storage/test`
- **Request Body:**
  ```json
  {
      "provider": "CLOUDINARY",
      "configuration": {
          "cloudName": "worksphere-prod",
          "apiKey": "123456789012345",
          "apiSecret": "aBcDeFgHiJkLmNoPqRsTuVwXyZ1"
      }
  }
  ```
- **Response `200 OK`:**
  ```json
  {
      "success": true,
      "message": "Cloudinary credentials verified successfully via live API ping.",
      "data": { "success": true, "latencyMs": 142 }
  }
  ```

### <span style="color: #2563EB;">6.3 Rollback Storage Configuration</span>
- **Endpoint:** `POST /api/super-admin/storage/rollback/:historyId`
- **Response `200 OK`:** Reverts active credentials to the snapshot preserved in `StorageConfigurationHistory`.

