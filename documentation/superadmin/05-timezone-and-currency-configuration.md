# <span style="color: #172554;">05 &mdash; Timezone & Currency Configuration Manual</span>

> **Document ID:** WS-DOC-SA-05 &nbsp;|&nbsp; **Category:** Localization & Standardization &nbsp;|&nbsp; **Target Audience:** Full-Stack Engineers, SuperAdmins, System Architects

---

## <span style="color: #1E40AF;">1. Enterprise Localization Standards</span>

In an international enterprise workforce platform, inaccurate time calculations or hardcoded currency symbols cause severe operational and compliance failures:
- **Attendance & Shift Calculation Errors:** Shift boundaries, late check-in penalties, overtime computations, and holiday calendars become skewed if local Daylight Saving Time (DST) or timezone offsets are mishandled.
- **Financial Inconsistencies:** Invoicing errors, payment gateway settlement mismatches, and inaccurate revenue reporting arise if currency symbols are hardcoded or if past transactions are silently redenominated.

UWorksphere enforces strict international engineering standards:
1. **Timezones:** Powered exclusively by the **IANA Time Zone Database** (`Zoneinfo`) and ECMAScript `Intl.DateTimeFormat`.
2. **Currencies:** Governed exclusively by the **ISO 4217 Currency Standard** and ECMAScript `Intl.NumberFormat`.

---

## <span style="color: #1E40AF;">2. Timezone Configuration & The IANA Standard</span>

### <span style="color: #2563EB;">2.1 Canonical IANA Reference Table</span>

The platform validates timezones using standard IANA identifiers (e.g. `Area/Location`), never ambiguous three-letter abbreviations:

| Country / Region | IANA Identifier | Canonical Display Label | UTC Standard Offset | DST Observed? |
| :--- | :--- | :--- | :---: | :---: |
| **India** | `Asia/Kolkata` | India Standard Time (IST) | `UTC+05:30` | No |
| **USA &ndash; New York** | `America/New_York` | Eastern Time (ET) | `UTC-05:00` / `UTC-04:00` | **Yes** |
| **USA &ndash; Los Angeles**| `America/Los_Angeles`| Pacific Time (PT) | `UTC-08:00` / `UTC-07:00` | **Yes** |
| **United Kingdom** | `Europe/London` | London Time (GMT / BST) | `UTC+00:00` / `UTC+01:00` | **Yes** |
| **United Arab Emirates** | `Asia/Dubai` | Gulf Standard Time (GST) | `UTC+04:00` | No |
| **Singapore** | `Asia/Singapore` | Singapore Standard Time (SGT)| `UTC+08:00` | No |
| **Australia &ndash; Sydney** | `Australia/Sydney` | Sydney Time (AEST / AEDT) | `UTC+10:00` / `UTC+11:00` | **Yes** |
| **Japan** | `Asia/Tokyo` | Japan Standard Time (JST) | `UTC+09:00` | No |
| **Germany / EU** | `Europe/Berlin` | Central European Time (CET) | `UTC+01:00` / `UTC+02:00` | **Yes** |

### <span style="color: #2563EB;">2.2 Golden Rules for Timezone Architecture</span>

> [!CRITICAL]
> **RULE 1: Store IANA Identifiers, NEVER Abbreviations.**
> Never store strings like `"EST"`, `"CST"`, or `"IST"`. Abbreviations are non-standard, ambiguous (e.g. `"CST"` can mean Central Standard Time in the US, China Standard Time, or Cuba Standard Time), and do not encode Daylight Saving Time transition rules.

> [!CRITICAL]
> **RULE 2: All Database Timestamps Must Be Stored in UTC.**
> MongoDB documents must persist native ISO 8601 UTC date objects (`new Date()`). Never apply timezone offsets before persisting to the database.

> [!CRITICAL]
> **RULE 3: Dynamic Presentation-Layer Conversion.**
> When retrieving records for display or reporting, convert UTC timestamps dynamically to the company's configured timezone (or the user's localized timezone preference).

> [!IMPORTANT]
> **RULE 4: Automated Daylight Saving Time Handling.**
> Because IANA identifiers are backed by OS and V8 timezone tables, shifts in regions like New York, London, or Sydney automatically adjust for DST without requiring code changes or server restarts.

> [!NOTE]
> **RULE 5: Company Timezone vs. User Local Timezone.**
> - **Company Timezone:** Determines company-wide operations, attendance shift boundaries, daily attendance reports, leave days, billing cutoff dates, and scheduled batch jobs.
> - **User Local Timezone:** Mobile and web clients can display an employee's local time alongside company shift hours without altering official attendance audit records.

### <span style="color: #2563EB;">2.3 Backend Validation Implementation</span>

In `Backend/src/modules/super-admin/companies/company.schema.ts`, UWorksphere enforces IANA validation at the API boundary:

```typescript
const timezoneValidator = (val: string): boolean => {
    try {
        Intl.DateTimeFormat(undefined, { timeZone: val });
        return true;
    } catch {
        return false;
    }
};

export const editCompanySchema = z.object({
    // ...
    timezone: z.string().trim().refine(timezoneValidator, { 
        message: 'Invalid IANA timezone identifier (e.g. "Asia/Kolkata", "America/New_York")' 
    }).optional(),
});
```

---

## <span style="color: #1E40AF;">3. Currency Configuration & ISO 4217 Standard</span>

### <span style="color: #2563EB;">3.1 Canonical Currency Reference Table</span>

The platform enforces 3-letter uppercase **ISO 4217** currency codes:

| Country / Region | Currency Name | ISO 4217 Code | Official Symbol | Decimal Precision | Formatting Example |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **India** | Indian Rupee | `INR` | ₹ | 2 | `₹25,000.00` |
| **United States** | US Dollar | `USD` | $ | 2 | `$250.00` |
| **United Kingdom** | Pound Sterling | `GBP` | £ | 2 | `£250.00` |
| **United Arab Emirates**| UAE Dirham | `AED` | د.إ | 2 | `د.إ 250.00` |
| **European Union** | Euro | `EUR` | € | 2 | `€250.00` |
| **Singapore** | Singapore Dollar | `SGD` | S$ | 2 | `S$250.00` |
| **Japan** | Japanese Yen | `JPY` | ¥ | **0** | `¥25,000` |
| **Australia** | Australian Dollar | `AUD` | A$ | 2 | `A$250.00` |
| **Canada** | Canadian Dollar | `CAD` | C$ | 2 | `C$250.00` |

### <span style="color: #2563EB;">3.2 Golden Rules for Currency Handling</span>

> [!CRITICAL]
> **RULE 1: Store ISO 4217 Codes, Never Hardcoded Symbols.**
> Database schemas must store `'INR'`, `'USD'`, or `'EUR'`. Never store strings containing symbols like `'₹'`, `'$'`, or `'€'`.

> [!CRITICAL]
> **RULE 2: Dynamic Localization Formatting.**
> Never hardcode the Indian Rupee (`₹`) symbol in frontend templates or backend email notifications. Render prices dynamically using the `Intl.NumberFormat` API:
> ```typescript
> export function formatCurrency(amount: number, currency = 'INR', locale = 'en-IN'): string {
>     return new Intl.NumberFormat(locale, {
>         style: 'currency',
>         currency: currency.toUpperCase(),
>         minimumFractionDigits: currency.toUpperCase() === 'JPY' ? 0 : 2,
>     }).format(amount);
> }
> ```

> [!IMPORTANT]
> **RULE 3: Company Display Currency vs. Payment Settlement Currency.**
> - **Company Display Currency:** Configured on the company record; used across dashboard widgets, budgets, and internal cost allocations.
> - **Settlement Currency:** Configured in payment gateway integrations (e.g. Razorpay merchant account currency).
> The payment engine converts amounts to the settlement currency using explicit exchange rates prior to invoking gateway APIs.

> [!CRITICAL]
> **RULE 4: Past Transactions Are Immutable.**
> When a SuperAdmin updates a company's display currency from `USD` to `EUR`, existing historical invoices, receipts, and `Payment` documents **must not be converted automatically**. Past transactions retain their original currency and numeric amount.

### <span style="color: #2563EB;">3.3 Backend Currency Validator Implementation</span>

In `Backend/src/modules/super-admin/companies/company.schema.ts`:

```typescript
const currencyValidator = (val: string): boolean => {
    try {
        new Intl.NumberFormat('en-US', { style: 'currency', currency: val });
        return true;
    } catch {
        return false;
    }
};

export const editCompanySchema = z.object({
    // ...
    currency: z.string().trim().refine(currencyValidator, { 
        message: 'Invalid ISO 4217 currency code (e.g. "INR", "USD", "EUR")' 
    }).optional(),
});
```

---

## <span style="color: #1E40AF;">4. Code Examples for Frontend and Backend</span>

### <span style="color: #2563EB;">Frontend React Utility (`currencyFormatter.ts`)</span>

```typescript
export const formatMoney = (
    amount: number,
    currencyCode: string = 'INR',
    userLocale: string = 'en-US'
): string => {
    try {
        return new Intl.NumberFormat(userLocale, {
            style: 'currency',
            currency: currencyCode.toUpperCase(),
            currencyDisplay: 'symbol',
        }).format(amount);
    } catch (e) {
        return `${currencyCode.toUpperCase()} ${amount.toFixed(2)}`;
    }
};
```

### <span style="color: #2563EB;">Backend Timezone Formatter Utility (`dateUtils.ts`)</span>

```typescript
export function formatToCompanyTime(
    date: Date,
    timeZone: string = 'UTC',
    formatPattern: string = 'YYYY-MM-DD HH:mm:ss'
): string {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(new Date(date));
}
```

