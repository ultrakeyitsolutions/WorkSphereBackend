# <span style="color: #172554;">06 &mdash; Cloudinary Storage Configuration & Security Manual</span>

> **Document ID:** WS-DOC-SA-06 &nbsp;|&nbsp; **Category:** Object Storage & Asset Infrastructure &nbsp;|&nbsp; **Target Audience:** SuperAdmins, Cloud Engineers, Security Officers

---

## <span style="color: #1E40AF;">1. Cloudinary Integration Architecture</span>

UWorksphere implements dynamic, multi-tenant object storage backed by **Cloudinary**. Rather than hardcoding storage credentials into environment files that require server restarts, the platform manages storage credentials dynamically via the `StorageConfiguration` collection, resolved at runtime through `StorageProviderFactory`.

```
[ Client Upload Request ]
           │
           ▼
[ Express API FileService / Multer ]
           │
           ├─► 1. Verify Tenant Quota (SubscriptionQuotaService.reserveQuota())
           ├─► 2. Resolve Active Storage Provider (StorageConfigurationService)
           ├─► 3. Validate MIME Type & Buffer Size (validateUploadedFile())
           ├─► 4. Build Multi-Tenant Key: worksphere/companies/{companyId}/...
           │
           ▼
[ CloudinaryStorageProvider.uploadFile() ]
           │
           ├─► Direct Binary Upload to Cloudinary API via HTTPS
           ├─► Sanitize Delivery URL (Strip credentials; ensure HTTPS CDN)
           │
           ▼
[ MongoDB FileModel ] ◄── Record metadata, storageKey, size, and context
```

---

## <span style="color: #1E40AF;">2. Step-by-Step Cloudinary Account Setup</span>

To establish a production-grade Cloudinary environment:

1. **Account Registration:** Navigate to [https://cloudinary.com/](https://cloudinary.com/) and register for an Enterprise or Developer account.
2. **Email Verification:** Complete email verification to enable API credential provisioning.
3. **Open Management Console:** Access the [Cloudinary Console](https://console.cloudinary.com/).
4. **Identify Product Environment:** In the top navigation, ensure you have selected the appropriate Product Environment (e.g. `production` or `staging`).
5. **Obtain API Credentials:**
   - On the Dashboard overview, locate the **Product Environment Credentials** card.
   - Copy the **Cloud Name** (e.g. `worksphere-prod`).
   - Copy the **API Key** (a 15-digit numeric string).
   - Click **Show** to reveal the **API Secret** (a 27-character alphanumeric string).
6. **Backend Initial Configuration (Optional Fallback):**
   Optionally define fallback environment variables in `Backend/.env`:
   ```bash
   CLOUDINARY_CLOUD_NAME=worksphere-prod
   CLOUDINARY_API_KEY=123456789012345
   CLOUDINARY_API_SECRET=aBcDeFgHiJkLmNoPqRsTuVwXyZ1
   ```
7. **Runtime Dynamic Activation:** Log into the UWorksphere SuperAdmin Console at `/superadmin/storage`, input the credentials, run the connection test, and save the active configuration.

> [!CRITICAL]
> **Never expose the `API Secret` or private connection strings to frontend applications or public repositories.**

---

## <span style="color: #1E40AF;">3. SuperAdmin Storage Configuration Interface</span>

The SuperAdmin Storage Configuration module (`/superadmin/storage` &mdash; `StorageConfigForm.tsx`) enables complete dynamic control over storage policies:

| Setting Parameter | Form Field / API Key | Allowed Values / Constraints | Operational Impact |
| :--- | :--- | :--- | :--- |
| **Provider Selection** | `provider` | `CLOUDINARY`, `BUNNY`, `CLOUDFLARE_R2` | Selects active storage engine. |
| **Storage Status** | `enabled` | `true`, `false` | Master toggle. When `false`, all upload endpoints return `503 Service Unavailable`. |
| **Cloud Name** | `configuration.cloudName` | Alphanumeric string | Cloudinary namespace bucket identifier. |
| **API Key** | `configuration.apiKey` | 15-digit string | Cloudinary public identifier. |
| **API Secret** | `configuration.apiSecret` | Secret string (Masked: `****1234`) | Cryptographic secret for signing API actions. |
| **Delivery URL** | `configuration.deliveryUrl` | Valid HTTPS URL | Optional custom CDN delivery domain (e.g. `https://media.worksphere.com`). |
| **Base Directory** | `configuration.basePath` | Slug (Default: `worksphere`) | Root namespace folder on Cloudinary. |
| **Image Max Size** | `limits.imageMaxSizeMB` | Number (Default: `10` MB) | Maximum permitted size for JPEG, PNG, WebP, SVG. |
| **Document Max Size** | `limits.documentMaxSizeMB`| Number (Default: `50` MB) | Maximum permitted size for PDF, DOCX, XLSX, ZIP. |
| **Audio Max Size** | `limits.audioMaxSizeMB` | Number (Default: `25` MB) | Maximum permitted size for MP3, WAV, OGG. |
| **Video Max Size** | `limits.videoMaxSizeMB` | Number (Default: `100` MB) | Maximum permitted size for MP4, MOV, WEBM. |

---

## <span style="color: #1E40AF;">4. Standard Multi-Tenant Cloudinary Folder Structure</span>

To guarantee strict isolation across organizations, prevent path collisions, and simplify tenant offboarding, UWorksphere enforces a hierarchical folder structure:

```
worksphere/
├── companies/
│   └── {companyId}/
│       ├── profiles/
│       │   └── employees/           <-- User avatars & identification docs
│       ├── projects/
│       │   └── {projectId}/         <-- Project briefs, attachments & assets
│       ├── tasks/
│       │   └── {taskId}/            <-- Task attachments & bug screenshots
│       ├── documents/               <-- Corporate wiki & shared files
│       ├── announcements/           <-- Broadcast banners & media
│       └── branding/
│           ├── logos/               <-- White-label corporate logos
│           └── banners/             <-- Custom login page banners
└── superadmin/
    ├── logos/                       <-- Platform primary logos
    ├── banners/                     <-- Global login backgrounds
    └── system-assets/               <-- Default notification sounds & media
```

### <span style="color: #2563EB;">Tenant Isolation Enforcement</span>

> [!CRITICAL]
> **Never trust client-supplied folder paths or tenant IDs.**

1. In `FileService.upload()`, the `companyId` is extracted strictly from the verified JWT access token (`req.user.companyId`).
2. The storage key is assembled exclusively on the backend:
   ```typescript
   const companyFolder = companyId ? `companies/${companyId}` : 'platform';
   const uniquePrefix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
   const sanitizedOriginal = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
   const storageKey = `${basePath}/${companyFolder}/${targetFolder}/${uniquePrefix}-${sanitizedOriginal}`;
   ```
3. A company administrator or employee has zero ability to specify storage keys or access assets belonging to another tenant organization.

---

## <span style="color: #1E40AF;">5. Storage Security, Testing, Rotation & Rollback</span>

### <span style="color: #2563EB;">5.1 Secret Masking & Safe Responses</span>
When SuperAdmins view storage configurations via `GET /api/super-admin/storage/configuration`, secrets are automatically masked via `StorageConfigurationService.toSafeResponse()`:
- `apiSecret` is returned as `****************ABCD` (preserving only the last 4 characters).
- Frontend form components detect masked values; if the user does not edit the secret field, the backend preserves the existing encrypted credential without overwriting it.

### <span style="color: #2563EB;">5.2 Automated Pre-Activation Testing (`POST /storage/test`)</span>
The system will **refuse to activate** a Cloudinary configuration that fails verification. When a SuperAdmin submits credentials:
1. The backend initializes a temporary `CloudinaryStorageProvider` instance.
2. It executes a live ping to the Cloudinary API (`client.api.ping()`).
3. Only if Cloudinary returns `status: "ok"` does the backend allow saving and enabling the provider.

### <span style="color: #2563EB;">5.3 Secure Asset Deletion</span>
When a file is deleted in UWorksphere:
1. `FileService.deleteFile(fileId)` issues an immediate Cloudinary destruction command (`cloudinary.v2.uploader.destroy(storageKey, { invalidate: true })`).
2. This purges the file from Cloudinary CDN edge caches within minutes.
3. The database marks the record with `deletedAt: new Date()` (or removes it), instantly releasing the tenant's storage quota.

### <span style="color: #2563EB;">5.4 Credential Rotation & Automated Rollback</span>
- Every configuration update creates an immutable snapshot in `StorageConfigurationHistory`.
- If newly entered Cloudinary credentials cause upload failures or latency spikes, the SuperAdmin can instantly revert to a previous working configuration with one click:
  `POST /api/super-admin/storage/rollback/:historyId`
- The system restores the historic snapshot, re-verifies connectivity, updates the active configuration, and records the rollback in the audit trail.

