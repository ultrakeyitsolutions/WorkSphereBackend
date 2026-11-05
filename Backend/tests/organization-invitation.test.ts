import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose, { Types } from 'mongoose';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { User } from '../src/modules/users/user.model';
import { WhiteLabelSettings } from '../src/modules/super-admin/white-label/white-label.model';
import { Invitation } from '../src/modules/companyadmin/invitations/invitation.model';
import { CompanyMember } from '../src/modules/companyadmin/invitations/company-member.model';
import { EmailService } from '../src/modules/companyadmin/invitations/email.service';
import publicInvitationRoutes from '../src/modules/companyadmin/invitations/public-invitation.routes';
import { env } from '../src/config/env';

// ─── Mail mock ────────────────────────────────────────────────────────────────
const { mockSendMail } = vi.hoisted(() => ({
    mockSendMail: vi.fn().mockResolvedValue({
        messageId: '<test-msg@worksphere.com>',
        envelope: { to: ['candidate@example.com'] },
    }),
}));

vi.mock('../src/config/mail', () => ({
    getMailTransporter: vi.fn(() => ({ sendMail: mockSendMail })),
    mailDefaults: { from: '"WorkSphere Platform" <noreply@worksphere.com>' },
}));

vi.mock('../src/modules/companyadmin/settings/company-email.service', () => ({
    CompanyEmailService: {
        resolveSender: vi.fn().mockResolvedValue({
            transporter: { sendMail: mockSendMail },
            from: '"Acme Corp" <invites@acme.com>',
            replyTo: 'support@acme.com',
            senderEmail: 'invites@acme.com',
            senderName: 'Acme Corp',
            mode: 'COMPANY',
        }),
    },
}));

vi.mock('../src/utils/password', () => ({
    hashPassword: vi.fn().mockResolvedValue('hashed-password'),
    comparePassword: vi.fn(async (plain: string) => plain !== 'WrongPassword!'),
}));

// ─── Model mocks ──────────────────────────────────────────────────────────────
vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: vi.fn(),
        findOne: vi.fn(),
    },
    default: { findById: vi.fn(), findOne: vi.fn() },
}));

vi.mock('../src/modules/super-admin/white-label/white-label.model', () => ({
    WhiteLabelSettings: {
        findOne: vi.fn(),
    },
    default: { findOne: vi.fn() },
}));

vi.mock('../src/modules/users/user.model', async () => {
    const { Types: T } = await import('mongoose');
    const UserModel: any = function (this: any, data: any) {
        Object.assign(this, data);
        this._id = new T();
        this.save = vi.fn().mockResolvedValue(this);
    };
    UserModel.findOne = vi.fn();
    UserModel.findById = vi.fn();
    UserModel.create = vi.fn();
    return { User: UserModel, default: UserModel };
});

vi.mock('../src/modules/roles/role.model', () => ({
    Role: {
        findOne: vi.fn(),
        create: vi.fn(),
    },
    default: { findOne: vi.fn(), create: vi.fn() },
}));

vi.mock('../src/modules/companyadmin/invitations/invitation.model', () => ({
    Invitation: {
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        findByIdAndUpdate: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
    },
    default: {
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        findByIdAndUpdate: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/invitations/company-member.model', () => ({
    CompanyMember: {
        findOne: vi.fn(),
        create: vi.fn(),
        find: vi.fn(),
    },
    default: { findOne: vi.fn(), create: vi.fn(), find: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const queryStub = (doc: any) => {
    const stub: any = {
        then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
        catch: (reject: any) => Promise.resolve(doc).catch(reject),
        populate: vi.fn(() => stub),
        session: vi.fn(() => stub),
        lean: vi.fn().mockResolvedValue(doc),
        sort: vi.fn(() => stub),
    };
    return stub;
};

const companyAId = new Types.ObjectId();
const companyBId = new Types.ObjectId();

const companyDocs: Record<string, any> = {
    [String(companyAId)]: {
        _id: companyAId,
        name: 'Company A',
        slug: 'company-a',
        tenantId: 'ws_comp_a',
        status: 'ACTIVE',
        isActive: true,
        logoUrl: 'https://cdn.example.com/company-a.png',
    },
    [String(companyBId)]: {
        _id: companyBId,
        name: 'Company B',
        slug: 'company-b',
        tenantId: 'ws_comp_b',
        status: 'ACTIVE',
        isActive: true,
        logoUrl: null,
    },
};

const buildInvitation = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    companyId: { ...companyDocs[String(companyAId)] },
    email: 'new.hire@company-a.com',
    phoneNumber: null,
    roleId: { _id: new Types.ObjectId(), name: 'Developer' },
    designationId: { _id: new Types.ObjectId(), name: 'Senior Engineer' },
    memberType: 'EMPLOYEE',
    invitedByUserId: { _id: new Types.ObjectId(), name: 'Ada Admin', email: 'admin@company-a.com' },
    tokenHash: 'hash',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    acceptedUserId: null,
    acceptedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    ...overrides,
});

const app = express();
app.use(express.json());
app.use('/api/v1/invitations', publicInvitationRoutes);

describe('Central-domain invitation URLs & acceptance', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(Company.findById).mockImplementation(((id: any) => {
            const doc = companyDocs[String(id)];
            return queryStub(doc) as any;
        }) as any);
        vi.mocked(Company.findOne).mockImplementation(((q: any) => {
            const doc = Object.values(companyDocs).find((c: any) => c.slug === q?.slug);
            return queryStub(doc) as any;
        }) as any);

        vi.mocked(WhiteLabelSettings.findOne).mockImplementation(((q: any) => {
            const companyId = String(q?.companyId);
            if (companyId === String(companyAId)) {
                return queryStub({
                    displayName: 'Company A',
                    logoUrl: 'https://cdn.example.com/company-a.png',
                    enabled: true,
                    theme: {
                        primaryColor: '#FF5722',
                        secondaryColor: '#212121',
                        accentColor: '#FF9800',
                        backgroundColor: '#FAFAFA',
                        textColor: '#212121',
                    },
                }) as any;
            }
            return queryStub(null) as any;
        }) as any);
    });

    // ── 1. URL generation ─────────────────────────────────────────────────────
    describe('Central invitation URL generation', () => {
        it('1.1 builds a single central-domain invite link for every organization', async () => {
            const result = await EmailService.sendInvitationEmail({
                to: 'hire@company-a.com',
                rawToken: 'tok-aaa',
                companyName: 'Company A',
                roleName: 'Developer',
                designationName: 'Senior Engineer',
                companyId: String(companyAId),
            });
            expect(result.invitationUrl).toBe(
                `https://uworksphere.com/invite/tok-aaa`
            );

            const resultB = await EmailService.sendInvitationEmail({
                to: 'hire@company-b.com',
                rawToken: 'tok-bbb',
                companyName: 'Company B',
                roleName: 'Designer',
                designationName: 'Product Designer',
                companyId: String(companyBId),
            });
            expect(resultB.invitationUrl).toBe(
                `https://uworksphere.com/invite/tok-bbb`
            );
        });

        it('1.2 never emits an organization-specific subdomain', async () => {
            const result = await EmailService.sendInvitationEmail({
                to: 'hire@company-a.com',
                rawToken: 'tok-xyz',
                companyName: 'Company A',
                roleName: 'Developer',
                designationName: 'Senior Engineer',
                companyId: String(companyAId),
            });
            expect(result.invitationUrl).not.toMatch(/invite\?token=/);
            expect(result.invitationUrl).not.toContain('company-a.');
            expect(result.invitationUrl.startsWith('https://uworksphere.com/invite/')).toBe(true);
        });

        it('1.3 falls back to the platform domain and never localhost', async () => {
            vi.mocked(Company.findById).mockResolvedValue(queryStub(null) as any);
            const baseUrl = await import('../src/modules/companyadmin/invitations/email.service')
                .then((m) => m.resolveInvitationBaseUrl(String(companyAId)));
            expect(baseUrl).not.toContain('localhost');
            expect(baseUrl).not.toContain('127.0.0.1');
            expect(baseUrl).toBe('https://uworksphere.com');
        });
    });

    // ── 2. Validation lifecycle ───────────────────────────────────────────────
    describe('Invitation validation', () => {
        it('2.1 returns organization branding resolved from the stored record', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(queryStub(buildInvitation()) as any);
            vi.mocked(User.findOne).mockResolvedValue(null as any);

            const res = await request(app).get('/api/v1/invitations/validate?token=valid-token');

            expect(res.status).toBe(200);
            expect(res.body.data.organization.id).toBe(String(companyAId));
            expect(res.body.data.organization.name).toBe('Company A');
            expect(res.body.data.organization.slug).toBe('company-a');
            expect(res.body.data.organizationName).toBe('Company A');
            expect(res.body.data.assignedRole).toBe('Developer');
            expect(res.body.data.inviterName).toBe('Ada Admin');
            expect(res.body.data.email).toBe('new.hire@company-a.com');
            expect(res.body.data.organization.theme.primaryColor).toBe('#FF5722');
            expect(res.body.data.organization.logoUrl).toBe('https://cdn.example.com/company-a.png');
        });

        it('2.2 rejects an invalid token', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(queryStub(null) as any);
            const res = await request(app).get('/api/v1/invitations/validate?token=bogus');
            expect(res.status).toBe(404);
        });

        it('2.3 rejects an expired invitation', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(
                queryStub(buildInvitation({ expiresAt: new Date(Date.now() - 1000) })) as any
            );
            const res = await request(app).get('/api/v1/invitations/validate?token=expired');
            expect(res.status).toBe(410);
        });

        it('2.4 rejects a revoked (cancelled) invitation', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(
                queryStub(buildInvitation({ status: 'CANCELLED' })) as any
            );
            const res = await request(app).get('/api/v1/invitations/validate?token=revoked');
            expect(res.status).toBe(410);
        });

        it('2.5 rejects an already accepted invitation', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(
                queryStub(buildInvitation({ status: 'ACCEPTED' })) as any
            );
            const res = await request(app).get('/api/v1/invitations/validate?token=accepted');
            expect(res.status).toBe(410);
        });

        it('2.6 resolves the organization from the invitation record, not the caller', async () => {
            // A Company-B invitation token must still resolve to Company B regardless of caller context.
            const inviteB = buildInvitation({
                _id: new Types.ObjectId(),
                companyId: { ...companyDocs[String(companyBId)] },
                email: 'hire@company-b.com',
            });
            vi.mocked(Invitation.findOne).mockReturnValue(queryStub(inviteB) as any);
            vi.mocked(User.findOne).mockResolvedValue(null as any);

            const res = await request(app).get('/api/v1/invitations/validate?token=token-b');
            expect(res.status).toBe(200);
            expect(res.body.data.organizationId).toBe(String(companyBId));
            expect(res.body.data.organization.slug).toBe('company-b');
        });
    });

    // ── 3. Acceptance lifecycle ───────────────────────────────────────────────
    describe('Invitation acceptance', () => {
        const existingUser = {
            _id: new Types.ObjectId(),
            name: 'New Hire',
            email: 'new.hire@company-a.com',
            password: 'hashed-password',
            role: { name: 'User' },
        };

        const fakeSession = {
            startTransaction: vi.fn(),
            commitTransaction: vi.fn().mockResolvedValue(undefined),
            abortTransaction: vi.fn().mockResolvedValue(undefined),
            endSession: vi.fn(),
        };

        beforeEach(() => {
            vi.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession as any);
            vi.mocked(User.findOne).mockReturnValue(queryStub(existingUser) as any);
            vi.mocked(CompanyMember.findOne).mockReturnValue(queryStub(null) as any);
            vi.mocked(CompanyMember.create).mockImplementation(async (docs: any[]) => {
                const doc = {
                    _id: new Types.ObjectId(),
                    ...docs[0],
                    status: docs[0].status || 'ACTIVE',
                };
                return [doc];
            });
            vi.mocked(Invitation.findOneAndUpdate).mockImplementation(async () =>
                queryStub(buildInvitation({ status: 'ACCEPTED' })) as any
            );
        });

        it('3.1 existing user accepts and receives an organization-scoped session', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(queryStub(buildInvitation()) as any);
            vi.mocked(User.findOne).mockReturnValue(queryStub(existingUser) as any);

            const res = await request(app)
                .post('/api/v1/invitations/accept')
                .send({ token: 'valid-token', password: 'CorrectPassword123!' });

            expect(res.status).toBe(200);
            expect(res.body.data.company.slug).toBe('company-a');
            expect(res.body.data.membership.status).toBe('ACTIVE');
            expect(res.body.data.accessToken).toBeTruthy();
            expect(res.body.data.redirectTo).toBe('/dashboard');
            expect(res.body.data.workspace).toBe('company-a');
            expect(CompanyMember.create).toHaveBeenCalledTimes(1);
        });

        it('3.2 an invitation can only be accepted for its own organization', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(queryStub(buildInvitation()) as any);
            vi.mocked(User.findOne).mockReturnValue(queryStub(existingUser) as any);

            const res = await request(app)
                .post('/api/v1/invitations/accept')
                .send({ token: 'valid-token', password: 'CorrectPassword123!' });

            expect(res.status).toBe(200);
            expect(res.body.data.company.slug).toBe('company-a');
            expect(res.body.data.company.id).toBe(String(companyAId));
            expect(CompanyMember.create).toHaveBeenCalledTimes(1);
        });

        it('3.3 duplicate acceptance requests do not create duplicate memberships', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(queryStub(buildInvitation()) as any);
            vi.mocked(User.findOne).mockReturnValue(queryStub(existingUser) as any);

            const first = await request(app)
                .post('/api/v1/invitations/accept')
                .send({ token: 'valid-token', password: 'CorrectPassword123!' });
            expect(first.status).toBe(200);

            vi.mocked(Invitation.findOne).mockReturnValue(
                queryStub(
                    buildInvitation({
                        status: 'ACCEPTED',
                        acceptedUserId: existingUser._id,
                    })
                ) as any
            );
            vi.mocked(CompanyMember.findOne).mockReturnValue(
                queryStub({
                    _id: new Types.ObjectId(),
                    companyId: companyAId,
                    userId: existingUser._id,
                    status: 'ACTIVE',
                    roleId: new Types.ObjectId(),
                    designationId: new Types.ObjectId(),
                }) as any
            );

            const second = await request(app)
                .post('/api/v1/invitations/accept')
                .send({ token: 'valid-token', password: 'CorrectPassword123!' });

            expect(second.status).toBe(200);
            expect(CompanyMember.create).toHaveBeenCalledTimes(1);
        });

        it('3.4 an expired invitation cannot be accepted', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(
                queryStub(buildInvitation({ expiresAt: new Date(Date.now() - 1000) })) as any
            );

            const res = await request(app)
                .post('/api/v1/invitations/accept')
                .send({ token: 'expired-token', password: 'CorrectPassword123!' });

            expect(res.status).toBe(410);
            expect(CompanyMember.create).not.toHaveBeenCalled();
        });

        it('3.5 a revoked invitation cannot be accepted', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(
                queryStub(buildInvitation({ status: 'CANCELLED' })) as any
            );

            const res = await request(app)
                .post('/api/v1/invitations/accept')
                .send({ token: 'revoked-token', password: 'CorrectPassword123!' });

            expect(res.status).toBe(410);
            expect(CompanyMember.create).not.toHaveBeenCalled();
        });

        it('3.6 a wrong password is rejected without creating a membership', async () => {
            vi.mocked(Invitation.findOne).mockReturnValue(queryStub(buildInvitation()) as any);
            vi.mocked(User.findOne).mockReturnValue(queryStub(existingUser) as any);

            const res = await request(app)
                .post('/api/v1/invitations/accept')
                .send({ token: 'valid-token', password: 'WrongPassword!' });

            expect(res.status).toBe(401);
            expect(CompanyMember.create).not.toHaveBeenCalled();
        });
    });

    // ── 4. Email ──────────────────────────────────────────────────────────────
    describe('Invitation email', () => {
        it('4.1 the Accept Invitation button uses the central domain', async () => {
            await EmailService.sendInvitationEmail({
                to: 'new.hire@company-a.com',
                rawToken: 'raw-token-123',
                companyName: 'Company A',
                roleName: 'Developer',
                designationName: 'Senior Engineer',
                companyId: String(companyAId),
                inviterName: 'Ada Admin',
            });

            const mail = mockSendMail.mock.calls[mockSendMail.mock.calls.length - 1][0];
            expect(mail.html).toContain('https://uworksphere.com/invite/raw-token-123');
            expect(mail.html).toContain('https://cdn.example.com/company-a.png');
            expect(mail.text).toContain('https://uworksphere.com/invite/raw-token-123');
        });

        it('4.2 a second organization receives the same central domain, different token', async () => {
            await EmailService.sendInvitationEmail({
                to: 'candidate@company-b.com',
                rawToken: 'raw-token-b',
                companyName: 'Company B',
                roleName: 'Designer',
                designationName: 'Product Designer',
                companyId: String(companyBId),
            });

            const mail = mockSendMail.mock.calls[mockSendMail.mock.calls.length - 1][0];
            expect(mail.html).toContain('https://uworksphere.com/invite/raw-token-b');
            expect(mail.html).not.toContain('company-a.');
        });
    });
});
