import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { CompanyEmailService } from '../src/modules/companyadmin/settings/company-email.service';
import { CompanyEmailEntitlementService } from '../src/modules/companyadmin/settings/company-email-entitlement.service';
import { CompanySettings } from '../src/modules/companyadmin/settings/company-settings.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { User } from '../src/modules/users/user.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { Feature } from '../src/modules/super-admin/features/features.model';
import { PlanFeature } from '../src/modules/super-admin/plan-features/plan-features.model';
import { AuditLogService } from '../src/modules/audit-logs/audit-log.service';
import { EmailService } from '../src/modules/companyadmin/invitations/email.service';
import { InvitationService } from '../src/modules/companyadmin/invitations/invitation.service';
import { Invitation } from '../src/modules/companyadmin/invitations/invitation.model';
import { InvitationDelivery } from '../src/modules/companyadmin/invitations/invitation-delivery.model';
import { CompanyRole } from '../src/modules/companyadmin/invitations/roles/company-role.model';
import { Designation } from '../src/modules/companyadmin/invitations/designation/designation.model';
import { authenticate } from '../src/middleware/auth.middleware';
import companySettingsRouter from '../src/modules/companyadmin/settings/company-settings.routes';
import { mailDefaults } from '../src/config/mail';
import { env } from '../src/config/env';
import { SubscriptionQuotaService } from '../src/services/subscription-quota.service';

// Mock Transporter for mail
const mockSendMail = vi.fn().mockResolvedValue({
    messageId: '<test-msg-123@worksphere.io>',
    envelope: { to: ['test@example.com'] },
});

vi.mock('../src/config/mail', () => ({
    getMailTransporter: vi.fn(() => ({
        sendMail: mockSendMail,
    })),
    mailDefaults: {
        from: '"WorkSphere Platform" <noreply@worksphere.com>',
    },
}));

// Mock Nodemailer createTransport
vi.mock('nodemailer', () => ({
    default: {
        createTransport: vi.fn(() => ({
            sendMail: mockSendMail,
        })),
    },
}));

// Mock DB Models
vi.mock('../src/modules/companyadmin/settings/company-settings.model', async () => {
    const actual = await vi.importActual('../src/modules/companyadmin/settings/company-settings.model') as any;
    return {
        ...actual,
        CompanySettings: {
            findOne: vi.fn(),
            findOneAndUpdate: vi.fn(),
            create: vi.fn(),
        },
        default: {
            findOne: vi.fn(),
            findOneAndUpdate: vi.fn(),
            create: vi.fn(),
        },
    };
});

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: vi.fn(),
        findOne: vi.fn(),
        findByIdAndUpdate: vi.fn(),
    },
    default: {
        findById: vi.fn(),
        findOne: vi.fn(),
        findByIdAndUpdate: vi.fn(),
    },
}));

vi.mock('../src/modules/users/user.model', () => {
    const UserModel: any = function (this: any, data: any) {
        Object.assign(this, data);
        this._id = new Types.ObjectId();
        this.save = vi.fn().mockResolvedValue(this);
    };
    UserModel.findOne = vi.fn().mockResolvedValue(null);
    UserModel.findById = vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue({
            _id: new Types.ObjectId(),
            isActive: true,
            status: 'ACTIVE',
            companyId: new Types.ObjectId(),
            role: { name: 'COMPANY_ADMIN' },
        }),
    });
    return { User: UserModel, default: UserModel };
});

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        findOne: vi.fn(),
    },
    default: {
        findOne: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/features/features.model', () => ({
    Feature: {
        findOne: vi.fn(),
    },
    default: {
        findOne: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/plan-features/plan-features.model', () => ({
    PlanFeature: {
        findOne: vi.fn(),
    },
    default: {
        findOne: vi.fn(),
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn().mockResolvedValue(true),
    },
}));

vi.mock('../src/modules/companyadmin/invitations/invitation.model', () => ({
    Invitation: {
        create: vi.fn(),
        findOne: vi.fn().mockResolvedValue(null),
        findById: vi.fn(),
        findByIdAndUpdate: vi.fn(),
        find: vi.fn(),
    },
    default: {
        create: vi.fn(),
        findOne: vi.fn().mockResolvedValue(null),
        findById: vi.fn(),
        findByIdAndUpdate: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/invitations/invitation-delivery.model', () => ({
    InvitationDelivery: {
        create: vi.fn(),
        findByIdAndUpdate: vi.fn(),
    },
    default: {
        create: vi.fn(),
        findByIdAndUpdate: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/invitations/roles/company-role.model', () => ({
    CompanyRole: {
        findOne: vi.fn(),
        findById: vi.fn(),
    },
    default: {
        findOne: vi.fn(),
        findById: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/invitations/designation/designation.model', () => ({
    Designation: {
        findOne: vi.fn(),
        findById: vi.fn(),
    },
    default: {
        findOne: vi.fn(),
        findById: vi.fn(),
    },
}));

// Build Test Express App
const app = express();
app.use(express.json());
app.use('/api/v1/company/settings', authenticate, companySettingsRouter);

describe('Company Admin Custom Invitation Email Suite', () => {
    const companyAId = new Types.ObjectId().toString();
    const companyBId = new Types.ObjectId().toString();
    const userAId = new Types.ObjectId().toString();
    const userBId = new Types.ObjectId().toString();
    const empUserId = new Types.ObjectId().toString();

    const planProId = new Types.ObjectId().toString();
    const planFreeId = new Types.ObjectId().toString();
    const featureCustomEmailId = new Types.ObjectId().toString();

    const companyAAdminToken = generateAccessToken({
        userId: userAId,
        email: 'admin@companya.com',
        role: 'COMPANY_ADMIN',
        companyId: companyAId,
    });

    const companyBAdminToken = generateAccessToken({
        userId: userBId,
        email: 'admin@companyb.com',
        role: 'COMPANY_ADMIN',
        companyId: companyBId,
    });

    const employeeToken = generateAccessToken({
        userId: empUserId,
        email: 'emp@companya.com',
        role: 'EMPLOYEE',
        companyId: companyAId,
    });

    const subscriptionMap = new Map<string, any>();
    const settingsMap = new Map<string, any>();

    function createQuery(doc: any) {
        return {
            lean: vi.fn().mockResolvedValue(doc),
            populate: vi.fn().mockImplementation(() => createQuery(doc)),
            sort: vi.fn().mockImplementation(() => createQuery(doc)),
            then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
            catch: (reject: any) => Promise.resolve(doc).catch(reject),
        };
    }

    function setCompanySubscription(companyId: string, entitled: boolean, status = 'ACTIVE') {
        const planId = entitled ? planProId : planFreeId;
        subscriptionMap.set(String(companyId), {
            _id: new Types.ObjectId(),
            companyId: new Types.ObjectId(companyId),
            planId: {
                _id: new Types.ObjectId(planId),
                name: entitled ? 'Enterprise Plan' : 'Free Tier',
                billingCycle: entitled ? 'YEARLY' : 'MONTHLY',
            },
            status,
        });
    }

    function setCompanySettings(companyId: string, emailSettings: any = {}) {
        const doc: any = {
            _id: new Types.ObjectId(),
            companyId: new Types.ObjectId(companyId),
            email: {
                mode: 'PLATFORM',
                senderEmail: null,
                senderName: null,
                replyTo: null,
                isVerified: false,
                verifiedAt: null,
                verificationCodeHash: null,
                verificationCodeExpiresAt: null,
                verificationAttempts: 0,
                smtp: null,
                ...emailSettings,
            },
        };
        doc.save = vi.fn().mockImplementation(function (this: any) {
            settingsMap.set(String(companyId), this);
            return Promise.resolve(this);
        });
        settingsMap.set(String(companyId), doc);
        return doc;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        subscriptionMap.clear();
        settingsMap.clear();
        CompanyEmailEntitlementService.clearAllCache();

        // Default: User.findById in authenticate middleware
        vi.mocked(User.findById).mockImplementation(((id: any) => {
            const strId = String(id);
            const isEmp = strId === empUserId;
            const cid = isEmp ? companyAId : strId === userBId ? companyBId : companyAId;
            return {
                populate: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(strId),
                    isActive: true,
                    status: 'ACTIVE',
                    companyId: new Types.ObjectId(cid),
                    role: { name: isEmp ? 'EMPLOYEE' : 'COMPANY_ADMIN' },
                }),
            } as any;
        }) as any);

        // Default: Company.findById
        vi.mocked(Company.findById).mockImplementation(((id: any) => {
            const strId = String(id);
            const doc = {
                _id: new Types.ObjectId(strId),
                name: strId === companyAId ? 'Acme Corp' : 'Beta LLC',
                status: 'ACTIVE',
                isActive: true,
            };
            return createQuery(doc) as any;
        }) as any);

        // Subscriptions
        vi.mocked(Subscription.findOne).mockImplementation(((query: any) => {
            const cid = String(query?.companyId);
            const subDoc = subscriptionMap.get(cid) || null;
            return createQuery(subDoc) as any;
        }) as any);

        // PlanFeature
        vi.mocked(PlanFeature.findOne).mockImplementation(((query: any) => {
            const pid = String(query?.planId);
            const isEntitled = pid === planProId;
            const pfDoc = isEntitled ? { _id: new Types.ObjectId(), enabled: true } : null;
            return createQuery(pfDoc) as any;
        }) as any);

        // Feature
        vi.mocked(Feature.findOne).mockReturnValue(createQuery({
            _id: new Types.ObjectId(featureCustomEmailId),
            key: 'CUSTOM_COMPANY_EMAIL',
            isActive: true,
        }) as any);

        // CompanySettings
        vi.mocked(CompanySettings.findOne).mockImplementation(((query: any) => {
            const cid = String(query?.companyId);
            let doc = settingsMap.get(cid);
            if (!doc) {
                doc = setCompanySettings(cid);
            }
            return {
                ...doc,
                save: doc.save,
                lean: vi.fn().mockResolvedValue(doc),
                then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
                catch: (reject: any) => Promise.resolve(doc).catch(reject),
            };
        }) as any);

        vi.mocked(CompanySettings.create).mockImplementation(((data: any) => {
            const cid = String(data?.companyId);
            const doc = setCompanySettings(cid, data?.email || {});
            return Promise.resolve(doc);
        }) as any);
    });

    // ── Test 1: Standard subscription uses the global platform sender ─────────
    it('1. Standard subscription uses the global platform sender', async () => {
        setCompanySubscription(companyAId, false);
        setCompanySettings(companyAId, { mode: 'PLATFORM', isVerified: false });

        const resolved = await CompanyEmailService.resolveSender(companyAId);

        expect(resolved.mode).toBe('PLATFORM');
        expect(resolved.from).toBe(mailDefaults.from);
        expect(resolved.senderEmail).toBe(env.MAIL_FROM_ADDRESS);
    });

    // ── Test 2: Eligible subscription with verified email uses custom sender ──
    it('2. Eligible subscription with verified company email uses custom authorized sender', async () => {
        setCompanySubscription(companyAId, true);
        setCompanySettings(companyAId, {
            mode: 'COMPANY',
            senderEmail: 'invites@acme.com',
            senderName: 'Acme Invitations',
            replyTo: 'support@acme.com',
            isVerified: true,
            verifiedAt: new Date(),
        });

        const resolved = await CompanyEmailService.resolveSender(companyAId);

        expect(resolved.mode).toBe('COMPANY');
        expect(resolved.from).toContain('invites@acme.com');
        expect(resolved.from).toContain('Acme Invitations');
        expect(resolved.replyTo).toBe('support@acme.com');
        expect(resolved.senderEmail).toBe('invites@acme.com');
    });

    // ── Test 3: Ineligible subscription cannot configure custom sender ────────
    it('3. Ineligible subscription cannot configure or update custom sender (403 Forbidden)', async () => {
        setCompanySubscription(companyAId, false); // Ineligible
        setCompanySettings(companyAId);

        const res = await request(app)
            .put('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${companyAAdminToken}`)
            .send({
                mode: 'COMPANY',
                senderEmail: 'invites@acme.com',
                senderName: 'Acme Corp',
            });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('Custom company email is not included in your organization\'s subscription plan');
    });

    // ── Test 4: Expired subscription falls back to platform sender ────────────
    it('4. Expired subscription falls back to platform sender and blocks updates', async () => {
        setCompanySubscription(companyAId, true, 'EXPIRED');
        setCompanySettings(companyAId, {
            mode: 'COMPANY',
            senderEmail: 'invites@acme.com',
            senderName: 'Acme Invitations',
            isVerified: true,
        });

        // Sender resolution falls back to platform
        const resolved = await CompanyEmailService.resolveSender(companyAId);
        expect(resolved.mode).toBe('PLATFORM');
        expect(resolved.from).toBe(mailDefaults.from);

        // Updates are blocked with 403
        const updateRes = await request(app)
            .put('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${companyAAdminToken}`)
            .send({
                senderEmail: 'new@acme.com',
            });

        expect(updateRes.status).toBe(403);
        expect(updateRes.body.message).toContain('expired');
    });

    // ── Test 5: Unverified email falls back to platform sender ────────────────
    it('5. Unverified email falls back to platform sender', async () => {
        setCompanySubscription(companyAId, true);
        setCompanySettings(companyAId, {
            mode: 'COMPANY',
            senderEmail: 'unverified@acme.com',
            isVerified: false,
        });

        const resolved = await CompanyEmailService.resolveSender(companyAId);

        expect(resolved.mode).toBe('PLATFORM');
        expect(resolved.from).toBe(mailDefaults.from);
    });

    // ── Test 6: One company settings never affect another company ─────────────
    it('6. One company\'s sender settings never affect another company', async () => {
        // Company A: Entitled and verified custom sender
        setCompanySubscription(companyAId, true);
        setCompanySettings(companyAId, {
            mode: 'COMPANY',
            senderEmail: 'invitations@companya.com',
            senderName: 'Company A',
            isVerified: true,
        });

        // Company B: Standard plan, unentitled
        setCompanySubscription(companyBId, false);
        setCompanySettings(companyBId, {
            mode: 'PLATFORM',
            isVerified: false,
        });

        const resolvedA = await CompanyEmailService.resolveSender(companyAId);
        const resolvedB = await CompanyEmailService.resolveSender(companyBId);

        expect(resolvedA.mode).toBe('COMPANY');
        expect(resolvedA.from).toContain('invitations@companya.com');

        expect(resolvedB.mode).toBe('PLATFORM');
        expect(resolvedB.from).toBe(mailDefaults.from);
    });

    // ── Test 7: Company Admins cannot modify another company's settings ───────
    it('7. Company Admins cannot modify another company\'s settings (Isolation Enforced)', async () => {
        setCompanySubscription(companyAId, true);
        setCompanySubscription(companyBId, true);

        setCompanySettings(companyAId, { mode: 'PLATFORM', isVerified: false });
        setCompanySettings(companyBId, { mode: 'PLATFORM', isVerified: false });

        // Company A Admin tries to pass ?companyId=companyBId
        const res = await request(app)
            .put(`/api/v1/company/settings/email?companyId=${companyBId}`)
            .set('Authorization', `Bearer ${companyAAdminToken}`)
            .send({
                mode: 'COMPANY',
                senderEmail: 'tamper@companya.com',
                senderName: 'Tamper Name',
            });

        expect(res.status).toBe(200);

        // Verify that Company A settings were updated, NOT Company B!
        const docA = settingsMap.get(companyAId);
        const docB = settingsMap.get(companyBId);

        expect(docA.email.senderEmail).toBe('tamper@companya.com');
        expect(docB.email.senderEmail).toBeNull();
    });

    // ── Test 8: Non-admin users are forbidden ─────────────────────────────────
    it('8. Non-admin users cannot access or modify email settings (403 Forbidden)', async () => {
        setCompanySubscription(companyAId, true);
        setCompanySettings(companyAId);

        const res = await request(app)
            .get('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(403);
    });

    // ── Test 9: SMTP credentials never appear in API responses or logs ─────────
    it('9. SMTP credentials never appear in API responses or audit logs', async () => {
        setCompanySubscription(companyAId, true);
        setCompanySettings(companyAId);

        const updateRes = await request(app)
            .put('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${companyAAdminToken}`)
            .send({
                mode: 'COMPANY',
                senderEmail: 'mail@acme.com',
                senderName: 'Acme Notifications',
                smtp: {
                    host: 'smtp.sendgrid.net',
                    port: 587,
                    secure: false,
                    username: 'apikey',
                    password: 'SG.SuperSecretPassword123',
                },
            });

        expect(updateRes.status).toBe(200);
        const data = updateRes.body.data;

        // Password MUST NOT be in API response!
        expect(JSON.stringify(data)).not.toContain('SG.SuperSecretPassword123');
        expect(data.smtp).toHaveProperty('hasPassword', true);
        expect(data.smtp).not.toHaveProperty('password');
        expect(data.smtp).not.toHaveProperty('passwordEncrypted');

        // Audit log MUST NOT log the plaintext password
        const logCalls = vi.mocked(AuditLogService.log).mock.calls;
        expect(logCalls.length).toBeGreaterThan(0);
        const loggedMetadata = JSON.stringify(logCalls[logCalls.length - 1][0]?.metadata);
        expect(loggedMetadata).not.toContain('SG.SuperSecretPassword123');
    });

    // ── Test 10: SSRF prevention blocks dangerous SMTP hosts ───────────────────
    it('10. SSRF prevention rejects private, loopback, and metadata destinations', async () => {
        setCompanySubscription(companyAId, true);
        setCompanySettings(companyAId);

        const dangerousHosts = [
            'localhost',
            '127.0.0.1',
            '169.254.169.254',
            '10.0.0.1',
            '192.168.1.1',
            '172.16.0.5',
            'metadata.google.internal',
            'server.local',
        ];

        for (const host of dangerousHosts) {
            const res = await request(app)
                .put('/api/v1/company/settings/email')
                .set('Authorization', `Bearer ${companyAAdminToken}`)
                .send({
                    smtp: {
                        host,
                        port: 587,
                        username: 'user',
                        password: 'pwd',
                    },
                });

            expect(res.status).toBe(422);
            expect(res.body.success).toBe(false);
            expect(JSON.stringify(res.body.errors)).toContain('not permitted');
        }
    });

    // ── Test 11: Verification flow (Send code, rate limit, confirm code) ───────
    it('11. Email verification flow dispatches code and verifies ownership correctly', async () => {
        setCompanySubscription(companyAId, true);
        setCompanySettings(companyAId, {
            mode: 'PLATFORM',
            senderEmail: 'verify-me@acme.com',
            isVerified: false,
        });

        // 1. Dispatch code
        const sendRes = await request(app)
            .post('/api/v1/company/settings/email/verify/send')
            .set('Authorization', `Bearer ${companyAAdminToken}`);

        expect(sendRes.status).toBe(200);
        expect(sendRes.body.success).toBe(true);
        expect(mockSendMail).toHaveBeenCalled();

        // 2. Reject wrong code
        const failRes = await request(app)
            .post('/api/v1/company/settings/email/verify/confirm')
            .set('Authorization', `Bearer ${companyAAdminToken}`)
            .send({ code: '000000' });

        expect(failRes.status).toBe(400);
        expect(failRes.body.message).toContain('Invalid verification code');

        // Extract sent verification code from email body
        const sentMailOpts = mockSendMail.mock.calls[mockSendMail.mock.calls.length - 1][0];
        const match = sentMailOpts.text.match(/code is: (\d{6})/);
        expect(match).toBeTruthy();
        const validCode = match[1];

        // 3. Confirm with valid code
        const confirmRes = await request(app)
            .post('/api/v1/company/settings/email/verify/confirm')
            .set('Authorization', `Bearer ${companyAAdminToken}`)
            .send({ code: validCode });

        expect(confirmRes.status).toBe(200);
        expect(confirmRes.body.success).toBe(true);

        const currentSettings = settingsMap.get(companyAId);
        expect(currentSettings.email.isVerified).toBe(true);
        expect(currentSettings.email.mode).toBe('COMPANY');
    });

    // ── Test 12: Invitation sending with custom sender end-to-end ──────────────
    it('12. EmailService.sendInvitationEmail uses verified company sender', async () => {
        setCompanySubscription(companyAId, true);
        setCompanySettings(companyAId, {
            mode: 'COMPANY',
            senderEmail: 'invitations@acme.com',
            senderName: 'Acme Official',
            replyTo: 'reply@acme.com',
            isVerified: true,
        });

        const result = await EmailService.sendInvitationEmail({
            to: 'candidate@example.com',
            rawToken: 'mock_raw_token_xyz',
            companyName: 'Acme Corp',
            roleName: 'Developer',
            designationName: 'Senior Engineer',
            companyId: companyAId,
        });

        expect(result.senderEmail).toBe('invitations@acme.com');
        expect(result.senderMode).toBe('COMPANY');

        const lastMailCall = mockSendMail.mock.calls[mockSendMail.mock.calls.length - 1][0];
        expect(lastMailCall.from).toContain('invitations@acme.com');
        expect(lastMailCall.to).toBe('candidate@example.com');
        expect(lastMailCall.replyTo).toBe('reply@acme.com');
    });

    // ── Test 13: InvitationService.invite tracks sender in InvitationDelivery ──
    it('13. InvitationService.invite creates delivery record with sender metadata', async () => {
        setCompanySubscription(companyAId, true);
        setCompanySettings(companyAId, {
            mode: 'COMPANY',
            senderEmail: 'invites@acme.com',
            senderName: 'Acme Corp',
            isVerified: true,
        });

        const mockRole = { _id: new Types.ObjectId(), name: 'Developer', isActive: true };
        const mockDesignation = { _id: new Types.ObjectId(), name: 'Senior Dev', isActive: true };
        vi.mocked(CompanyRole.findOne).mockResolvedValue(mockRole as any);
        vi.mocked(Designation.findOne).mockResolvedValue(mockDesignation as any);

        const mockInvitation = {
            _id: new Types.ObjectId(),
            status: 'PENDING',
        };
        vi.mocked(Invitation.create).mockResolvedValue(mockInvitation as any);

        const mockDelivery = {
            _id: new Types.ObjectId(),
            status: 'QUEUED',
        };
        vi.mocked(InvitationDelivery.create).mockResolvedValue(mockDelivery as any);
        vi.spyOn(SubscriptionQuotaService, 'reserveQuota').mockResolvedValue({ reservationId: 'test', commit: vi.fn(), release: vi.fn() } as any);

        const batchResult = await InvitationService.invite(
            [
                {
                    emailOrPhone: 'newhire@test.com',
                    roleId: mockRole._id.toString(),
                    designationId: mockDesignation._id.toString(),
                    memberType: 'EMPLOYEE',
                },
            ],
            companyAId,
            userAId
        );

        expect(batchResult.created).toBe(1);
        expect(batchResult.results[0].status).toBe('INVITED');

        // Check InvitationDelivery update
        expect(InvitationDelivery.findByIdAndUpdate).toHaveBeenCalledWith(
            mockDelivery._id,
            expect.objectContaining({
                status: 'SENT',
                senderEmail: 'invites@acme.com',
                senderMode: 'COMPANY',
            })
        );
    });

    // ── Test 14: Reset email settings to platform defaults ─────────────────────
    it('14. Reset email settings resets to platform defaults', async () => {
        setCompanySubscription(companyAId, true);
        setCompanySettings(companyAId, {
            mode: 'COMPANY',
            senderEmail: 'old@acme.com',
            isVerified: true,
        });

        const res = await request(app)
            .delete('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${companyAAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const currentSettings = settingsMap.get(companyAId);
        expect(currentSettings.email.mode).toBe('PLATFORM');
        expect(currentSettings.email.isVerified).toBe(false);
    });
});
