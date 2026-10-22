import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { CompanyService, ALLOWED_LOGO_MIME_TYPES, ALLOWED_LOGO_EXTENSIONS, MAX_LOGO_SIZE_BYTES } from '../src/modules/super-admin/companies/company.service';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { User } from '../src/modules/users/user.model';
import { Role } from '../src/modules/roles/role.model';
import superAdminRouter from '../src/modules/super-admin/super-admin.routes';

// Mock dependencies
vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        create: vi.fn(),
        findOne: vi.fn(),
        find: vi.fn(),
        findById: vi.fn().mockResolvedValue({
            _id: new Types.ObjectId(),
            status: 'ACTIVE',
            isActive: true,
        }),
    },
}));

vi.mock('../src/modules/users/user.model', () => {
    const UserModel: any = function (this: any, data: any) {
        Object.assign(this, data);
        this._id = new Types.ObjectId();
        this.save = vi.fn().mockResolvedValue(this);
    };
    UserModel.findOne = vi.fn();
    UserModel.findById = vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue({
            _id: new Types.ObjectId(),
            isActive: true,
            status: 'ACTIVE',
            companyId: new Types.ObjectId(),
            role: { name: 'COMPANY_ADMIN' },
        }),
    });
    UserModel.create = vi.fn();
    return { User: UserModel };
});


vi.mock('../src/modules/roles/role.model', () => ({
    Role: {
        findOne: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn().mockResolvedValue(true),
    },
}));

vi.mock('../src/modules/super-admin/storage/storage-config.service', () => ({
    StorageConfigurationService: {
        getActiveConfiguration: vi.fn().mockResolvedValue({
            enabled: false,
            provider: 'BUNNY',
            configuration: { pullZoneUrl: 'https://cdn.worksphere.io' },
        }),
    },
}));

const app = express();
app.use(express.json());
app.use('/api/super-admin', superAdminRouter);

describe('Company Logo Management Feature', () => {
    const companyAdminToken = generateAccessToken({
        userId: 'company_admin_456',
        email: 'admin@acme.com',
        role: 'COMPANY_ADMIN',
        companyId: new Types.ObjectId().toString(),
    });

    const employeeToken = generateAccessToken({
        userId: 'emp_789',
        email: 'employee@acme.com',
        role: 'EMPLOYEE',
        companyId: new Types.ObjectId().toString(),
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('File Validation Constraints', () => {
        it('allows valid logo extensions (png, jpg, jpeg, webp)', () => {
            expect(ALLOWED_LOGO_EXTENSIONS.has('png')).toBe(true);
            expect(ALLOWED_LOGO_EXTENSIONS.has('jpg')).toBe(true);
            expect(ALLOWED_LOGO_EXTENSIONS.has('jpeg')).toBe(true);
            expect(ALLOWED_LOGO_EXTENSIONS.has('webp')).toBe(true);
            expect(ALLOWED_LOGO_EXTENSIONS.has('svg')).toBe(false);
            expect(ALLOWED_LOGO_EXTENSIONS.has('exe')).toBe(false);
            expect(ALLOWED_LOGO_EXTENSIONS.has('pdf')).toBe(false);
        });

        it('allows valid logo MIME types and rejects unsanitized SVG or executables', () => {
            expect(ALLOWED_LOGO_MIME_TYPES.has('image/png')).toBe(true);
            expect(ALLOWED_LOGO_MIME_TYPES.has('image/jpeg')).toBe(true);
            expect(ALLOWED_LOGO_MIME_TYPES.has('image/webp')).toBe(true);
            expect(ALLOWED_LOGO_MIME_TYPES.has('image/svg+xml')).toBe(false);
            expect(ALLOWED_LOGO_MIME_TYPES.has('application/pdf')).toBe(false);
        });

        it('enforces maximum logo size of 5MB', () => {
            expect(MAX_LOGO_SIZE_BYTES).toBe(5 * 1024 * 1024);
        });

        it('rejects logo upload when file is missing', async () => {
            await expect(CompanyService.uploadLogo(undefined)).rejects.toThrow(
                'No image file provided for logo upload.'
            );
        });

        it('rejects logo upload with unsupported extension', async () => {
            const fakeFile: any = {
                originalname: 'malicious.svg',
                mimetype: 'image/svg+xml',
                buffer: Buffer.from('<svg></svg>'),
                size: 100,
            };
            await expect(CompanyService.uploadLogo(fakeFile)).rejects.toThrow(
                'Unsupported image format .svg'
            );
        });

        it('rejects logo upload with unsupported MIME type', async () => {
            const fakeFile: any = {
                originalname: 'fake.png',
                mimetype: 'application/octet-stream',
                buffer: Buffer.from('not an image'),
                size: 100,
            };
            await expect(CompanyService.uploadLogo(fakeFile)).rejects.toThrow(
                'Unsupported MIME type application/octet-stream'
            );
        });

        it('rejects logo upload exceeding 5MB limit', async () => {
            const fakeFile: any = {
                originalname: 'huge_logo.png',
                mimetype: 'image/png',
                buffer: Buffer.alloc(6 * 1024 * 1024),
                size: 6 * 1024 * 1024,
            };
            await expect(CompanyService.uploadLogo(fakeFile)).rejects.toThrow(
                'exceeds the maximum allowed logo size of 5MB'
            );
        });

        it('accepts and generates stable storage URL for valid PNG/WebP logo', async () => {
            const fakeFile: any = {
                originalname: 'company_logo.png',
                mimetype: 'image/png',
                buffer: Buffer.from('fake image content'),
                size: 1024,
            };
            const result = await CompanyService.uploadLogo(fakeFile);
            expect(result.logoUrl).toBeDefined();
            expect(result.logoUrl).toContain('company_logo.png');
            expect(result.storageKey).toBeDefined();
        });
    });

    describe('Company Registration with Logo', () => {
        it('allows creating a company with logoUrl', async () => {
            const companyId = new Types.ObjectId();

            vi.mocked(User.findOne).mockResolvedValue(null);
            vi.mocked(Company.findOne).mockResolvedValue(null);
            vi.mocked(Role.findOne).mockReturnValue({
                session: vi.fn().mockResolvedValue({ _id: new Types.ObjectId(), name: 'COMPANY_ADMIN' }),
            } as any);

            const mockSave = vi.fn().mockResolvedValue(true);
            const mockCompanyDoc: any = {
                _id: companyId,
                name: 'Globex Corp',
                slug: 'globex-corp',
                domain: 'https://globex.com',
                industry: 'Manufacturing',
                size: 'ENTERPRISE',
                logoUrl: 'https://cdn.worksphere.io/worksphere/companies/logos/globex.png',
                status: 'ACTIVE',
                createdAt: new Date(),
                save: mockSave,
            };

            vi.mocked(Company.create).mockResolvedValue([mockCompanyDoc] as any);

            // Mock session on mongoose
            const mongoose = await import('mongoose');
            vi.spyOn(mongoose.default, 'startSession').mockResolvedValue({
                startTransaction: vi.fn(),
                commitTransaction: vi.fn(),
                abortTransaction: vi.fn(),
                endSession: vi.fn(),
            } as any);

            const result = await CompanyService.createWithAdmin({
                companyName: 'Globex Corp',
                companyDomain: 'https://globex.com',
                companyIndustry: 'Manufacturing',
                companySize: 'ENTERPRISE',
                logoUrl: 'https://cdn.worksphere.io/worksphere/companies/logos/globex.png',
                adminName: 'Homer Simpson',
                adminEmail: 'homer@globex.com',
                adminPassword: 'Password123!',
            });

            expect(result.company).toBeDefined();
            expect(result.company.logoUrl).toBe('https://cdn.worksphere.io/worksphere/companies/logos/globex.png');
            expect(result.company.name).toBe('Globex Corp');
        });

        it('allows creating a company without a logo (clean optional fallback)', async () => {
            const companyId = new Types.ObjectId();

            vi.mocked(User.findOne).mockResolvedValue(null);
            vi.mocked(Company.findOne).mockResolvedValue(null);
            vi.mocked(Role.findOne).mockReturnValue({
                session: vi.fn().mockResolvedValue({ _id: new Types.ObjectId(), name: 'COMPANY_ADMIN' }),
            } as any);

            const mockCompanyDoc: any = {
                _id: companyId,
                name: 'Initech LLC',
                slug: 'initech-llc',
                status: 'ACTIVE',
                createdAt: new Date(),
                save: vi.fn().mockResolvedValue(true),
            };

            vi.mocked(Company.create).mockResolvedValue([mockCompanyDoc] as any);

            const mongoose = await import('mongoose');
            vi.spyOn(mongoose.default, 'startSession').mockResolvedValue({
                startTransaction: vi.fn(),
                commitTransaction: vi.fn(),
                abortTransaction: vi.fn(),
                endSession: vi.fn(),
            } as any);

            const result = await CompanyService.createWithAdmin({
                companyName: 'Initech LLC',
                adminName: 'Peter Gibbons',
                adminEmail: 'peter@initech.com',
                adminPassword: 'Password123!',
            });

            expect(result.company).toBeDefined();
            expect(result.company.logoUrl).toBeNull();
        });
    });

    describe('Company Logo Update and Removal', () => {
        it('updates company logoUrl via editCompany', async () => {
            const mockCompany: any = {
                _id: new Types.ObjectId(),
                name: 'Acme Corp',
                logoUrl: 'https://old-logo.png',
                save: vi.fn().mockResolvedValue(true),
            };

            vi.mocked(Company.findOne).mockResolvedValue(mockCompany);

            const updated = await CompanyService.editCompany(mockCompany._id.toString(), {
                logoUrl: 'https://cdn.worksphere.io/new-logo.png',
            });

            expect(updated.logoUrl).toBe('https://cdn.worksphere.io/new-logo.png');
            expect(mockCompany.save).toHaveBeenCalled();
        });

        it('removes company logo via deleteLogo', async () => {
            const mockCompany: any = {
                _id: new Types.ObjectId(),
                name: 'Acme Corp',
                logoUrl: 'https://cdn.worksphere.io/logo.png',
                save: vi.fn().mockResolvedValue(true),
            };

            vi.mocked(Company.findOne).mockResolvedValue(mockCompany);

            const updated = await CompanyService.deleteLogo(mockCompany._id.toString());
            expect(updated.logoUrl).toBeUndefined();
            expect(mockCompany.save).toHaveBeenCalled();
        });
    });

    describe('Authorization and Tenant Protection', () => {
        it('rejects company logo management from unauthenticated requests', async () => {
            const res = await request(app).post('/api/super-admin/companies/upload-logo');
            expect(res.status).toBe(401);
        });

        it('rejects company logo management from Company Admin users on super-admin routes', async () => {
            const res = await request(app)
                .post('/api/super-admin/companies/upload-logo')
                .set('Authorization', `Bearer ${companyAdminToken}`);
            expect(res.status).toBe(403);
        });

        it('rejects company logo management from Employee users on super-admin routes', async () => {
            const res = await request(app)
                .post('/api/super-admin/companies/upload-logo')
                .set('Authorization', `Bearer ${employeeToken}`);
            expect(res.status).toBe(403);
        });
    });
});
