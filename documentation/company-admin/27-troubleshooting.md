# <span style="color: #065F46;">27 &mdash; Enterprise Operational Troubleshooting Playbook</span>

---

### <span style="color: #047857;">Document Metadata</span>
- **Module:** Production Incident Resolution, Diagnostics & Operational Troubleshooting
- **Target Audience:** Company Administrators, IT Helpdesk Leads, Operations Managers & DevOps
- **Document Version:** 2.4.0
- **Classification:** Enterprise Operational Support Manual

---

## <span style="color: #047857;">1. Troubleshooting Framework Overview</span>

This playbook provides actionable, step-by-step diagnostic and remediation protocols for technical issues encountered across UWorksphere workspaces. Every issue follows a standard enterprise diagnostic template:
- **Symptoms:** User-reported behavior and visual UI anomalies.
- **Possible Causes:** Root cause failure points in the application stack.
- **Diagnostic Verification:** Exact logs, API calls, and database checks.
- **Remediation Procedure:** Step-by-step instructions to restore normal service.
- **Verification:** Criteria confirming successful resolution.
- **Escalation Path:** Next tier of support if unresolved.

---

## <span style="color: #047857;">2. Incident Playbooks</span>

---

### <span style="color: #0F766E;">2.1 Issue: Invitation Email Not Received by Employee</span>
- **Symptoms:** Administrator sends invitation; recipient reports no email in inbox or spam folder after 15 minutes.
- **Possible Causes:**
  1. Corporate email delivery credentials (SMTP/SES) misconfigured or failing authentication.
  2. Recipient email domain rejected by corporate spam filter (SPF/DKIM alignment failure).
  3. Rate limiter triggered due to excessive invitations.
- **Diagnostic Verification:**
  - Check **Teams > Pending Invitations** (`/companyadmin/pages/teams`).
  - If status badge is `FAILED`, review the `InvitationDelivery` log in the database.
  - Check backend logs: `docker logs backend | grep -i "invitation"`.
- **Remediation Procedure:**
  1. If using custom SMTP, navigate to **Settings > Email Delivery** and click **"Send Test Email"**.
  2. Verify SPF DNS record includes your sending IP or mail provider (`include:amazonses.com` or `include:_spf.google.com`).
  3. In **Teams > Pending Invitations**, click **"Resend Invitation"** to cycle the raw token.
  4. Alternatively, copy the generated invite link directly and share it securely through internal corporate chat.
- **Verification:** Employee receives the email or accepts via the direct link.
- **Escalation Path:** Platform SuperAdmin / IT Infrastructure Team.

---

### <span style="color: #0F766E;">2.2 Issue: Employee Cannot Access a Specific Module</span>
- **Symptoms:** Employee attempts to open Chat, Live Monitoring, or Timesheets; received HTTP `403 Forbidden` modal: *"Module Access Restricted"* or *"Plan Upgrade Required"*.
- **Possible Causes:**
  1. The company's subscription plan does not include the module (`PLAN_UPGRADE_REQUIRED`).
  2. Company Admin disabled the module company-wide in **Settings > Feature Controls**.
  3. The employee's specific user account was restricted in **Settings > Module Access**.
- **Diagnostic Verification:**
  - Check error payload code in browser Network console:
    - If `code === 'PLAN_UPGRADE_REQUIRED'` &rarr; Plan entitlement missing.
    - If `code === 'MODULE_ACCESS_RESTRICTED'` &rarr; Admin override or role restriction.
- **Remediation Procedure:**
  1. If `PLAN_UPGRADE_REQUIRED`: Navigate to **Billing** and upgrade the subscription plan.
  2. If `MODULE_ACCESS_RESTRICTED`:
     - Navigate to **Settings > Module Access** (`/companyadmin/pages/settings?tab=module-access`).
     - Search for the employee's name.
     - Toggle the desired module from **Restricted** to **Allowed**.
     - Ask the employee to refresh their browser.
- **Verification:** The module appears in the employee's sidebar and API returns HTTP `200 OK`.
- **Escalation Path:** Company Administrator.

---

### <span style="color: #0F766E;">2.3 Issue: Google Meet Video Link Not Generated</span>
- **Symptoms:** When creating a meeting with provider `GOOGLE_MEET`, an error modal appears: *"Google Calendar & Meet is not connected. Please connect your Google account in Settings."* Or the meeting creates with a fallback URL.
- **Possible Causes:**
  1. The organizer or company has not connected Google Calendar via OAuth 2.0.
  2. Stored Google OAuth refresh token has expired or was revoked by the Google Workspace admin.
  3. Google Cloud OAuth consent screen is configured as "Testing" and the 7-day token expired.
- **Diagnostic Verification:**
  - Check **Settings > Applications > Google Calendar Status**.
  - Review database: `db.calendar_oauths.findOne({ companyId, provider: "google" })`.
- **Remediation Procedure:**
  1. In Google Cloud Console, ensure Publishing Status is set to **In Production** (or Internal for Google Workspace).
  2. In UWorksphere, navigate to **Calendar** or **Settings > Applications**.
  3. Click **"Connect Google Meet"**.
  4. Grant offline calendar access permissions.
  5. Retry meeting creation; verify the generated link begins with `https://meet.google.com/`.
- **Verification:** Authentic Google Meet link populated in meeting details.
- **Escalation Path:** Google Workspace Administrator / Solution Architect.

---

### <span style="color: #0F766E;">2.4 Issue: Attendance Check-In Button Disabled or Failing</span>
- **Symptoms:** Employee clicks **"Check In"**; receives error toast: *"An active check-in session is already open for today"* or *"Invalid shift assignment"*.
- **Possible Causes:**
  1. The employee forgot to check out yesterday, leaving an open overnight session.
  2. The employee was not assigned an active working shift, and no default company shift exists.
- **Diagnostic Verification:**
  - Query `GET /api/v1/company/attendance/status` for the employee.
  - Review `Attendance` record in MongoDB where `actual.lastCheckOut` is `null`.
- **Remediation Procedure:**
  1. If open session exists:
     - The employee must click **Check Out** to close yesterday's cycle, OR
     - An administrator can approve an **Attendance Adjustment** in **Attendance > Adjustments** to record the missing checkout time.
  2. If shift missing: Navigate to **Attendance > Shifts** and assign the employee to the standard shift roster.
- **Verification:** Attendance status resets to green, allowing immediate check-in.
- **Escalation Path:** HR Operations Lead / Company Admin.

---

### <span style="color: #0F766E;">2.5 Issue: Analytics Dashboard Showing Stale or Outdated Data</span>
- **Symptoms:** Tasks were completed or reassigned, but the Company Dashboard KPI cards still display yesterday's numbers.
- **Possible Causes:**
  1. Redis cache key TTL has not expired.
  2. Redis cache invalidation event dropped due to network partition between application and Redis nodes.
- **Diagnostic Verification:**
  - Click the **Refresh** button (circular arrow) on the Dashboard header.
  - Open browser DevTools Network tab; verify query includes `cacheBust` or bypasses client cache.
- **Remediation Procedure:**
  1. Click **Refresh All** on the Dashboard toolbar to force refetch across all queries.
  2. If persistent, have the Company Admin clear Redis cache:
     - Backend command: `redis-cli KEYS "ws:dash:${companyId}:*" | xargs redis-cli DEL`.
- **Verification:** Dashboard KPIs recalculate and reflect the latest database state.
- **Escalation Path:** DevOps Engineer / Platform Admin.

