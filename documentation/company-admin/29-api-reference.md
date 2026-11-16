# <span style="color: #065F46;">29 &mdash; REST API Architecture & Complete Endpoint Reference</span>

---

### <span style="color: #047857;">Document Metadata</span>
- **Module:** Enterprise RESTful Web Services & Endpoint Catalog
- **Target Audience:** API Consumers, Integration Engineers & Frontend Developers
- **Document Version:** 2.4.0
- **Classification:** Enterprise Technical Specification

---

## <span style="color: #047857;">1. API Gateway Global Standards</span>

All UWorksphere APIs adhere to standard REST architectural constraints:
- **Base URL:** `https://api.worksphere.com/api` (aliased under `/api/v1`)
- **Transport Security:** Strict TLS 1.3 HTTPS enforcement.
- **Authentication:** Bearer JSON Web Token in header: `Authorization: Bearer <JWT_ACCESS_TOKEN>`.
- **Tenant Context:** Read from the authenticated JWT token payload (`companyId`). Clients must never supply raw company IDs in query parameters or request bodies.
- **Standard Response Envelope:**
  ```json
  {
    "success": true,
    "message": "Operation executed successfully",
    "data": { ... }
  }
  ```
- **Standard Error Envelope:**
  ```json
  {
    "success": false,
    "message": "Error description string",
    "code": "ERROR_CONSTANT_KEY",
    "details": { ... }
  }
  ```

---

## <span style="color: #047857;">2. Complete Endpoint Reference Catalog</span>

---

### <span style="color: #0F766E;">2.1 Authentication & Profile Endpoints</span>

#### `POST /api/v1/auth/login`
- **Purpose:** Authenticate user credentials and return access and refresh tokens.
- **Public / Unauthenticated:** Yes.
- **Request Body:**
  ```json
  { "email": "admin@apextechnologies.com", "password": "SuperSecretPassword123!" }
  ```
- **Success (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "user": { "id": "6640...", "name": "Rajesh Sharma", "email": "...", "role": "COMPANY_ADMIN" },
      "company": { "id": "6641...", "name": "Apex Global", "logoUrl": "..." },
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "eyJhbGciOi..."
    }
  }
  ```

#### `GET /api/v1/user/profile/me`
- **Purpose:** Retrieve authenticated user profile, designation, department, and permissions.
- **Authorization:** Bearer Token.

---

### <span style="color: #0F766E;">2.2 Member & Team Management Endpoints</span>

| HTTP Method | Route | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/company/members` | List company members with pagination, category, and search filters. | Admin, Manager |
| `PATCH` | `/api/v1/company/members/:id` | Update member designation, role, or biometric identifier. | Company Admin |
| `PATCH` | `/api/v1/company/members/:id/status`| Toggle active/inactive status of member. | Company Admin |
| `POST` | `/api/v1/company/member-deletion/execute`| Execute soft or permanent offboarding of member. | Company Admin |
| `POST` | `/api/v1/company/invitations` | Dispatch invitation to new employee or manager. | Admin, Manager |
| `POST` | `/api/v1/company/invitations/bulk` | Bulk issue multiple invitations in single request. | Admin, Manager |
| `POST` | `/api/v1/company/invitations/:id/resend`| Cycle token and resend invitation email. | Company Admin |
| `DELETE`| `/api/v1/company/invitations/:id` | Cancel / revoke pending invitation. | Company Admin |
| `GET` | `/api/v1/company/teams` | List organizational teams with leads and project counts. | Admin, Manager |
| `POST` | `/api/v1/company/teams` | Create new operational squad/team. | Company Admin |
| `GET` | `/api/v1/company/teams/:id/performance`| Retrieve team task velocity and overdue analytics. | Admin, Manager |
| `PATCH` | `/api/v1/company/teams/:id/lead` | Transfer team leadership to new manager. | Company Admin |

---

### <span style="color: #0F766E;">2.3 Project & Task Management Endpoints</span>

| HTTP Method | Route | Description | Required Role / Permission |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/company/projects` | List projects (scoped to company or assigned teams). | `projects.view` |
| `POST` | `/api/v1/company/projects` | Create new project with teams and milestones. | `projects.create` |
| `GET` | `/api/v1/company/projects/:id` | Retrieve detailed project dossier and health indicators. | `projects.view` |
| `PUT` | `/api/v1/company/projects/:id` | Update project dates, description, priority, or manager.| `projects.edit` |
| `POST` | `/api/v1/company/projects/:id/archive` | Archive completed or cancelled project. | `projects.archive` |
| `GET` | `/api/v1/company/tasks` | Query Kanban tasks with status, stage, and assignee filters.| `tasks.view` |
| `POST` | `/api/v1/company/tasks` | Create task, bug, or user story deliverable. | `tasks.create` |
| `PUT` | `/api/v1/company/tasks/:id` | Update task title, description, or estimated time. | `tasks.update` |
| `PATCH` | `/api/v1/company/tasks/:id/assign` | Reassign task owner. | `tasks.assign` |
| `PATCH` | `/api/v1/company/tasks/:id/stage` | Transition task across Kanban workflow stages. | `tasks.update` |
| `POST` | `/api/v1/company/tasks/:id/reopen` | Reopen completed task with mandatory reason string. | Manager, QA Lead |
| `POST` | `/api/v1/company/tasks/:id/checklist`| Append subtask checklist item to task. | Contributor |

---

### <span style="color: #0F766E;">2.4 Attendance, Shift & Timesheet Endpoints</span>

| HTTP Method | Route | Description | Notes |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/company/attendance/status` | Current live punch status of authenticated user. | Returns `isCheckedIn`, current shift, timers. |
| `POST` | `/api/v1/company/attendance/check-in` | Record arrival punch; evaluates shift & lateness. | Idempotent within 5s window. |
| `POST` | `/api/v1/company/attendance/check-out`| Record departure punch; calculates net worked minutes.| Evaluates overtime / early departure. |
| `POST` | `/api/v1/company/attendance/break-start`| Pause active work timer; begin break counter. | Rejects if not checked in. |
| `POST` | `/api/v1/company/attendance/break-end` | Resume active work timer; conclude break. | Rejects if not on break. |
| `GET` | `/api/v1/company/attendance/summary` | Company-wide daily attendance summary for admin. | Presents, Absents, Leaves, Lates. |
| `POST` | `/api/v1/company/attendance/adjustments`| Submit punch correction request. | Requires past date & explanation. |
| `POST` | `/api/v1/company/attendance/adjustments/:id/resolve`| Manager approves or rejects attendance adjustment.| Recalculates day hours on approval. |
| `GET` | `/api/v1/company/shifts` | List active shift schedules and rosters. | Daytime & overnight shift configurations. |
| `POST` | `/api/v1/company/shifts` | Create custom shift schedule with grace periods. | Company Admin exclusive. |

---

### <span style="color: #0F766E;">2.5 Calendar, Quick Meetings & Google Meet Endpoints</span>

| HTTP Method | Route | Description | Enforcing Service |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/company/calendar/oauth/connect`| Exchange Google auth code for encrypted tokens. | `CalendarOAuthService.connectProvider` |
| `GET` | `/api/v1/company/calendar/oauth/status` | Check Google / Microsoft connection health. | `CalendarOAuthService.getIntegrationStatus` |
| `GET` | `/api/v1/meetings` | List scheduled meetings and calendar events. | Scoped to company / invited user. |
| `POST` | `/api/v1/meetings` | Schedule meeting; invokes Google Calendar API. | Generates authentic Google Meet link. |
| `POST` | `/api/v1/meetings/quick` | Instant video call creation; copies Meet URL. | In-app / clipboard delivery. |
| `DELETE`| `/api/v1/meetings/:id` | Cancel scheduled conference and alert attendees. | Removes from Google Calendar. |

---

### <span style="color: #0F766E;">2.6 Billing & Payment Endpoints</span>

| HTTP Method | Route | Description | Safeguards |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/company/billing/overview` | Current subscription tier, limits, renewal date. | Tenant-isolated to `companyId`. |
| `GET` | `/api/v1/company/billing/payments` | Historical payment transactions list. | Pagination support (`getPaginationParams`). |
| `GET` | `/api/v1/company/billing/invoices/:id`| Download tax-compliant receipt. | GST/VAT details formatting. |
| `POST` | `/api/v1/company/billing/upgrade` | Create Razorpay order & initiate payment attempt.| Mandatory `Idempotency-Key` header. |
| `POST` | `/api/v1/company/billing/upgrade-requests`| Submit custom enterprise plan request. | Dispatches outbox notification. |
| `POST` | `/api/v1/payments/webhook` | Inbound Razorpay webhook listener. | Verifies HMAC-SHA256 signature. |

