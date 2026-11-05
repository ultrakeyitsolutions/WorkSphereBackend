import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Types } from 'mongoose';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
    companyFindById: vi.fn(),
    roleFind: vi.fn(),
    designationFind: vi.fn(),
    userFindOne: vi.fn(),
    companyMemberFindOne: vi.fn(),
    invitationFindOne: vi.fn(),
    invitationCreate: vi.fn(),
    deliveryCreate: vi.fn(),
    deliveryFindByIdAndUpdate: vi.fn(),
    sendInvitationEmail: vi.fn(),
    reserveQuota: vi.fn(),
    releaseQuota: vi.fn(),
}));

vi.mock('../src/modules/companyadmin/invitations/invitation.model', () => ({
    Invitation: {
        findOne: mocks.invitationFindOne,
        create: mocks.invitationCreate,
    },
}));
vi.mock('../src/modules/companyadmin/invitations/invitation-delivery.model', () => ({
    InvitationDelivery: {
        create: mocks.deliveryCreate,
        findByIdAndUpdate: mocks.deliveryFindByIdAndUpdate,
    },
}));
vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: { findById: mocks.companyFindById },
}));
vi.mock('../src/modules/companyadmin/invitations/roles/company-role.model', () => ({
    CompanyRole: { find: mocks.roleFind },
}));
vi.mock('../src/modules/companyadmin/invitations/designation/designation.model', () => ({
    Designation: { find: mocks.designationFind },
}));
vi.mock('../src/modules/companyadmin/invitations/company-member.model', () => ({
    CompanyMember: { findOne: mocks.companyMemberFindOne },
}));
vi.mock('../src/modules/users/user.model', () => ({
    User: { findOne: mocks.userFindOne },
}));
vi.mock('../src/modules/companyadmin/invitations/email.service', () => ({
    EmailService: { sendInvitationEmail: mocks.sendInvitationEmail },
}));
vi.mock('../src/services/subscription-quota.service', () => ({
    SubscriptionQuotaService: {
        reserveQuota: mocks.reserveQuota,
        releaseQuota: mocks.releaseQuota,
    },
}));

// Clear the singleton queue between tests (it holds state in memory).
import { invitationEmailQueue } from '../src/modules/companyadmin/invitations/invitation-queue.service';
import { InvitationService } from '../src/modules/companyadmin/invitations/invitation.service';

const COMPANY_ID = new Types.ObjectId().toHexString();
const USER_ID = new Types.ObjectId().toHexString();
const ROLE_ID = new Types.ObjectId().toHexString();
const DESIGNATION_ID = new Types.ObjectId().toHexString();

function chain(resolved: any) {
    return {
        lean: vi.fn().mockResolvedValue(resolved),
    };
}

describe('InvitationEmailQueue (background delivery)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invitationEmailQueue['queue'] = [];
        invitationEmailQueue['processingIds'].clear();
        mocks.reserveQuota.mockResolvedValue({ commit: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) });
        mocks.releaseQuota.mockResolvedValue(undefined);
        mocks.sendInvitationEmail.mockResolvedValue({ messageId: 'msg_1', senderEmail: 'noreply@worksphere.com', senderMode: 'PLATFORM' });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('enqueues and processes a delivery, marking SENT', async () => {
        const deliveryId = new Types.ObjectId();
        mocks.deliveryCreate.mockResolvedValue({ _id: deliveryId });
        mocks.deliveryFindByIdAndUpdate.mockResolvedValue({ _id: deliveryId });

        invitationEmailQueue.enqueue({
            deliveryId,
            invitationId: new Types.ObjectId(),
            email: 'alice@example.com',
            rawToken: 'tok_abc',
            companyName: 'Acme',
            roleName: 'Employee',
            designationName: 'Engineer',
            companyId: COMPANY_ID,
            attempt: 0,
            nextRetryAt: new Date(),
        });

        expect(invitationEmailQueue.getStats().queued).toBe(1);

        const result = await invitationEmailQueue.process();

        expect(result.processed).toBe(1);
        expect(result.sent).toBe(1);
        expect(result.failed).toBe(0);
        expect(mocks.sendInvitationEmail).toHaveBeenCalledTimes(1);
        expect(mocks.deliveryFindByIdAndUpdate).toHaveBeenCalledWith(
            deliveryId,
            expect.objectContaining({ status: 'SENT' })
        );
        expect(invitationEmailQueue.getStats().queued).toBe(0);
    });

    it('retries on failure and eventually marks FAILED after max attempts', async () => {
        // Reduce max attempts by recreating a small queue instance for deterministic behavior.
        const smallQueue = (invitationEmailQueue as any);
        const origMax = smallQueue.maxAttempts;
        smallQueue.maxAttempts = 2;
        smallQueue.baseBackoffMs = 10;
        smallQueue.sentCount = 0;
        smallQueue.failedCount = 0;

        mocks.sendInvitationEmail.mockRejectedValue(new Error('SMTP timeout'));

        const deliveryId = new Types.ObjectId();
        mocks.deliveryFindByIdAndUpdate.mockResolvedValue({ _id: deliveryId });

        smallQueue.enqueue({
            deliveryId,
            invitationId: new Types.ObjectId(),
            email: 'bob@example.com',
            rawToken: 'tok_def',
            companyName: 'Acme',
            roleName: 'Employee',
            designationName: 'Engineer',
            companyId: COMPANY_ID,
            attempt: 0,
            nextRetryAt: new Date(),
        });

        // First process tick: fails, re-queued with backoff.
        await smallQueue.process();
        expect(smallQueue.getStats().failed).toBe(0); // not yet max attempts
        expect(smallQueue.getStats().queued).toBe(1); // re-queued

        // Advance time past retry and process again -> max attempts reached -> FAILED.
        await new Promise((r) => setTimeout(r, 15));
        await smallQueue.process();

        expect(smallQueue.getStats().failed).toBe(1);
        expect(smallQueue.getStats().queued).toBe(0);
        expect(mocks.sendInvitationEmail).toHaveBeenCalledTimes(2);

        smallQueue.maxAttempts = origMax;
    });

    it('getStats returns queue telemetry', () => {
        const stats = invitationEmailQueue.getStats();
        expect(stats).toHaveProperty('queued');
        expect(stats).toHaveProperty('processing');
        expect(stats).toHaveProperty('sent');
        expect(stats).toHaveProperty('failed');
        expect(stats).toHaveProperty('maxAttempts');
        expect(stats).toHaveProperty('concurrency');
    });
});

describe('InvitationService.invite (optimized, background email)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reserveQuota.mockResolvedValue({ commit: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) });
        mocks.releaseQuota.mockResolvedValue(undefined);
        mocks.sendInvitationEmail.mockResolvedValue({ messageId: 'msg_1', senderEmail: 'noreply@worksphere.com', senderMode: 'PLATFORM' });

        const companyDoc = { _id: COMPANY_ID, name: 'Acme Corp', status: 'ACTIVE', isActive: true };
        mocks.companyFindById.mockReturnValue(chain(companyDoc));

        const roleDoc = { _id: ROLE_ID, name: 'Employee', isActive: true };
        const designationDoc = { _id: DESIGNATION_ID, name: 'Engineer', isActive: true };
        mocks.roleFind.mockReturnValue(chain([roleDoc]));
        mocks.designationFind.mockReturnValue(chain([designationDoc]));

        mocks.userFindOne.mockResolvedValue(null);
        mocks.companyMemberFindOne.mockResolvedValue(null);
        mocks.invitationFindOne.mockResolvedValue(null);

        mocks.invitationCreate.mockImplementation((data: any) => ({
            _id: new Types.ObjectId(),
            ...data,
        }));
        mocks.deliveryCreate.mockImplementation((data: any) => ({ _id: new Types.ObjectId(), ...data }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        invitationEmailQueue['queue'] = [];
        invitationEmailQueue['processingIds'].clear();
    });

    it('invites multiple members in parallel, returns immediately with QUEUED deliveries', async () => {
        const members = [
            { emailOrPhone: 'alice@example.com', roleId: ROLE_ID, designationId: DESIGNATION_ID, memberType: 'EMPLOYEE' },
            { emailOrPhone: 'bob@example.com', roleId: ROLE_ID, designationId: DESIGNATION_ID, memberType: 'EMPLOYEE' },
            { emailOrPhone: 'carol@example.com', roleId: ROLE_ID, designationId: DESIGNATION_ID, memberType: 'MANAGER' },
        ];

        const start = Date.now();
        const result = await InvitationService.invite(members, COMPANY_ID, USER_ID);
        const elapsed = Date.now() - start;

        // Roles/designations fetched once per batch, not per member.
        expect(mocks.roleFind).toHaveBeenCalledTimes(1);
        expect(mocks.designationFind).toHaveBeenCalledTimes(1);

        // All invitations created.
        expect(result.total).toBe(3);
        expect(result.created).toBe(3);
        expect(result.failed).toBe(0);
        expect(result.results.every((r: any) => r.status === 'INVITED')).toBe(true);
        // Delivery reported as QUEUED (background), never falsely SENT.
        expect(result.results.every((r: any) => r.deliveryStatus === 'QUEUED')).toBe(true);

        // Emails enqueued to background queue, not sent synchronously during the HTTP call.
        expect(mocks.sendInvitationEmail).not.toHaveBeenCalled();
        expect(invitationEmailQueue.getStats().queued).toBe(3);

        // Response should be fast (no SMTP wait). Under test with mocked DB this is trivially fast,
        // but in production the win is avoiding N sequential SMTP round-trips.
        expect(elapsed).toBeLessThan(5000);
    });

    it('handles already-member and already-invited without creating duplicates', async () => {
        const existingUser = { _id: new Types.ObjectId(), email: 'dave@example.com' };
        mocks.userFindOne.mockImplementation((query: any) =>
            Promise.resolve(query?.email === 'dave@example.com' ? existingUser : null)
        );
        mocks.companyMemberFindOne.mockResolvedValue({ _id: new Types.ObjectId() });

        const pendingInvite = { _id: new Types.ObjectId(), email: 'eve@example.com' };
        mocks.invitationFindOne.mockImplementation((query: any) =>
            Promise.resolve(query?.email === 'eve@example.com' ? pendingInvite : null)
        );

        const members = [
            { emailOrPhone: 'dave@example.com', roleId: ROLE_ID, designationId: DESIGNATION_ID, memberType: 'EMPLOYEE' },
            { emailOrPhone: 'eve@example.com', roleId: ROLE_ID, designationId: DESIGNATION_ID, memberType: 'EMPLOYEE' },
        ];

        const result = await InvitationService.invite(members, COMPANY_ID, USER_ID);

        expect(result.created).toBe(0);
        expect(result.failed).toBe(2);
        const statuses = result.results.map((r: any) => r.status);
        expect(statuses).toContain('ALREADY_MEMBER');
        expect(statuses).toContain('ALREADY_INVITED');
        expect(mocks.invitationCreate).not.toHaveBeenCalled();
        expect(invitationEmailQueue.getStats().queued).toBe(0);
    });

    it('marks a delivery QUEUED when background email throws, without losing the invitation', async () => {
        mocks.sendInvitationEmail.mockRejectedValue(new Error('Hostinger SMTP blocked'));

        const members = [
            { emailOrPhone: 'frank@example.com', roleId: ROLE_ID, designationId: DESIGNATION_ID, memberType: 'EMPLOYEE' },
        ];

        const result = await InvitationService.invite(members, COMPANY_ID, USER_ID);
        expect(result.created).toBe(1);
        expect(result.results[0].deliveryStatus).toBe('QUEUED'); // invitation preserved

        // The email was enqueued for background retry; the invitation itself is durable.
        expect(invitationEmailQueue.getStats().queued).toBe(1);
    });

    it('throws when company is inactive (fail-fast, before quota reservation)', async () => {
        mocks.companyFindById.mockReturnValue(chain({ _id: COMPANY_ID, name: 'Acme', status: 'SUSPENDED', isActive: false }));

        await expect(InvitationService.invite([{ emailOrPhone: 'x@example.com', roleId: ROLE_ID, designationId: DESIGNATION_ID, memberType: 'EMPLOYEE' }], COMPANY_ID, USER_ID))
            .rejects.toThrow('Company is not active');

        // Fail-fast: quota is never reserved, so nothing to release.
        expect(mocks.reserveQuota).not.toHaveBeenCalled();
    });
});
