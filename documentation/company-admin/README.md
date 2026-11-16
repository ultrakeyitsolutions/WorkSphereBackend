# <span style="color: #065F46;">UWorksphere &mdash; Company Admin, Manager & Employee Operational Manual</span>

---

### <span style="color: #047857;">Executive Document Metadata</span>
- **Product Name:** UWorksphere Multi-Tenant Enterprise Workspace Platform
- **Document Version:** 2.4.0 (Enterprise Production Edition)
- **Publisher:** UltraKey IT Solutions
- **Document Classification:** Enterprise Production Documentation
- **Color Palette Specification:** Deep Emerald (`#065F46`), Forest Green (`#047857`), Teal (`#0F766E`), Soft Mint (`#ECFDF5`), Amber (`#B45309`), Orange (`#C2410C`), Deep Red (`#B91C1C`), Charcoal Text (`#27272A`), Off-White (`#FAFAF9`).

---

## <span style="color: #047857;">1. Master Documentation Index (Chapters 01 to 33)</span>

This enterprise manual covers the complete operational lifecycle of a UWorksphere company workspace, from tenant provisioning through daily management, project delivery, and financial governance.

| Chapter | Document Title | Scope & Key Focus Areas | Direct Link |
| :--- | :--- | :--- | :--- |
| **01** | **Platform & Workspace Overview** | Enterprise overview, 4-tier role hierarchy, core modules catalog, tenant isolation. | [01-uworksphere-overview.md](./01-uworksphere-overview.md) |
| **02** | **Company Onboarding & Registration**| Provisioning workflows, company schema fields, status lifecycle (`PENDING` to `ACTIVE`). | [02-company-onboarding.md](./02-company-onboarding.md) |
| **03** | **Workspace Initial Configuration** | First login, profile setup, timezones, currencies, shift creation, pre-flight checklist. | [03-workspace-initial-configuration.md](./03-workspace-initial-configuration.md) |
| **04** | **Employee Invitations & Onboarding**| Cryptographic token hashing, rate limiting, invite lifecycle, bulk invitations. | [04-employee-invitations.md](./04-employee-invitations.md) |
| **05** | **Member Management & Lifecycle** | Profile structure, action buttons, offboarding modes (`MEMBER_ONLY` vs `ENTIRE_RECORD`). | [05-member-management.md](./05-member-management.md) |
| **06** | **Roles, Permissions & Designations**| Security roles vs job titles, permission keys, custom role creation, access guards. | [06-roles-permissions-designations.md](./06-roles-permissions-designations.md) |
| **07** | **Module Access & Feature Controllers**| 6-tier entitlement evaluation pipeline, `requireModuleAccess`, real-time revocation. | [07-module-access-and-feature-controllers.md](./07-module-access-and-feature-controllers.md) |
| **08** | **Attendance, Check-In & Calculations**| Daytime & overnight shifts, lateness formulas, early leave, overtime, missing checkout. | [08-attendance-checkin-checkout.md](./08-attendance-checkin-checkout.md) |
| **09** | **Team Management & Squad Structure** | Team creation, transfer leadership, inter-team migration, team performance velocity. | [09-team-management.md](./09-team-management.md) |
| **10** | **Project Management & Health Analytics**| Project lifecycle, status transitions, production Project Health evaluation engine. | [10-project-management.md](./10-project-management.md) |
| **11** | **Task Management & Kanban Boards** | Task schemas, Kanban workflows, checklist progress, defect reopen governance. | [11-task-management.md](./11-task-management.md) |
| **12** | **Manager Workspace & Operational Hub**| Scoped access (`TeamAccessService`), 4 tabs, 10 exportable intelligence reports. | [12-manager-dashboard.md](./12-manager-dashboard.md) |
| **13** | **Employee Dashboard & Daily Operations**| Contributor experience, punch widget, "My Work", delivery trends, leave requests. | [13-employee-dashboard-and-operations.md](./13-employee-dashboard-and-operations.md) |
| **14** | **Meeting Management & Calendar** | Instant & scheduled meetings, calendar synchronization, reminder settings. | [14-meeting-management.md](./14-meeting-management.md) |
| **15** | **Google Meet Integration Architecture**| Authentic Google Calendar API integration, AES-256 tokens, Google Cloud setup. | [15-google-meet-integration.md](./15-google-meet-integration.md) |
| **16** | **Chat, Messaging & Presence** | Socket.IO cluster, Redis adapter, direct & group channels, live heartbeats. | [16-chat-and-communication.md](./16-chat-and-communication.md) |
| **17** | **Cloudinary & Multi-Tenant File Storage**| Cloud storage providers (Cloudinary/R2/Bunny), quota reservation protocol, MIME checks. | [17-cloudinary-and-file-storage.md](./17-cloudinary-and-file-storage.md) |
| **18** | **Task Dropbox & Collaboration** | Split-pane task collaboration, notes, voice notes, bugs, doubts, Dropbox distinction. | [18-dropbox-integration.md](./18-dropbox-integration.md) |
| **19** | **Billing, Subscriptions & Razorpay**| Subscription overview, Razorpay order creation, idempotency, webhook processing. | [19-billing-and-subscriptions.md](./19-billing-and-subscriptions.md) |
| **20** | **Custom Subscription Plan Requests** | Enterprise plan request submission, `PlanUpgradeRequest` schema, negotiation flow. | [20-custom-plan-requests.md](./20-custom-plan-requests.md) |
| **21** | **Escalation Management & Compliance**| Automated 4-tier breach engine, SLA windows (24h/48h/72h/96h), immutable audit trails. | [21-escalation-and-support.md](./21-escalation-and-support.md) |
| **22** | **Enterprise Analytics & Formula Reference**| Mathematical formulas for Project Health, Completion Rate, Overdue Rate, Presenteeism. | [22-analytics-and-performance-calculations.md](./22-analytics-and-performance-calculations.md) |
| **23** | **Notifications & Audit Logging** | Event bus, multi-channel delivery (In-App, Push, Email), preferences, `AuditLog`. | [23-notifications-and-activity-history.md](./23-notifications-and-activity-history.md) |
| **24** | **Company Settings & White-Labeling** | Theme palettes, white-label subdomains, custom SMTP/SES delivery, security MFA. | [24-company-settings-and-integrations.md](./24-company-settings-and-integrations.md) |
| **25** | **Web vs Mobile Operations** | Next.js 15 Web Portal vs React Native / Expo Mobile App parity and workflows. | [25-web-and-mobile-operations.md](./25-web-and-mobile-operations.md) |
| **26** | **Security & High-Performance Architecture**| Tenant isolation, AES encryption, compound indexes, Redis caching, clustering. | [26-security-and-performance.md](./26-security-and-performance.md) |
| **27** | **Operational Troubleshooting Playbook** | 16 concrete incident playbooks with root causes, diagnostics, and remediation. | [27-troubleshooting.md](./27-troubleshooting.md) |
| **28** | **Master Button & Action Reference** | End-to-end traceability matrix mapping every UI button to API and database mutations. | [28-complete-button-action-reference.md](./28-complete-button-action-reference.md) |
| **29** | **Complete REST API Reference** | Method, route, request payload, response schema, and error codes for all endpoints. | [29-api-reference.md](./29-api-reference.md) |
| **30** | **Database Schemas & Data Relationships**| Complete Entity-Relationship topologies, compound index catalog, cascade rules. | [30-database-and-data-relationships.md](./30-database-and-data-relationships.md) |
| **31** | **Company Admin Daily Operations SOP**| 4-phase daily executive operational playbook from morning pulse to security audit. | [31-company-admin-daily-operations.md](./31-company-admin-daily-operations.md) |
| **32** | **Manager Daily Operations SOP** | Sprint standups, blocker triage, PR review, adjustments, and timesheet approvals. | [32-manager-daily-operations.md](./32-manager-daily-operations.md) |
| **33** | **Employee Daily Operations SOP** | Clock-in, "My Work" focus, task timer, Task Dropbox collaboration, and clock-out. | [33-employee-daily-operations.md](./33-employee-daily-operations.md) |

---

## <span style="color: #047857;">2. Quick Start & Specialized Reference Guides</span>

In addition to the 33 comprehensive operational chapters, the following specialized companion documents are available:

- **[Company Administrator Quick Start Guide](./COMPANY_ADMIN_QUICK_START.md):** 10-minute onboarding checklist for newly assigned tenant owners.
- **[Manager Quick Start Guide](./MANAGER_QUICK_START.md):** 5-minute setup and team leadership guide.
- **[Employee Quick Start Guide](./EMPLOYEE_QUICK_START.md):** Day-one walkthrough for new hires and team members.
- **[Company Admin Permission Matrix](./COMPANY_ADMIN_PERMISSION_MATRIX.md):** Cross-module role capability matrix.
- **[Module Dependency Map](./MODULE_DEPENDENCY_MAP.md):** Architectural map of dependencies, services, and models.
- **[Analytics Formula Cheat-Sheet](./ANALYTICS_FORMULA_REFERENCE.md):** Standalone mathematical formulation cheat-sheet.
- **[Third-Party Integration Setup Guide](./INTEGRATION_SETUP_GUIDE.md):** Comprehensive setup manual for Google Meet, Microsoft Teams, Cloudinary, AWS SES, and Razorpay.

