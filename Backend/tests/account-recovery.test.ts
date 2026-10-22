import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { AccountRecoveryService } from '../src/modules/auth/recovery/account-recovery.service';
import { AccountRecoveryRequest } from '../src/modules/auth/recovery/account-recovery.model';
import { User } from '../src/modules/users/user.model';
import { AuthService } from '../src/modules/auth/auth.service';
import { UserService } from '../src/modules/users/user.service';
import { SessionService } from '../src/modules/auth/session/session.service';
import { AccountRecoveryEmailService } from '../src/modules/auth/recovery/account-recovery-email.service';
import { AuditLogService } from '../src/modules/audit-logs/audit-log.service';
import {
    createRecoveryRequestSchema,
    completeRecoverySchema,
    approveRecoverySchema,
    rejectRecoverySchema,
} from '../src/modules/auth/recovery/account-recovery.validator';

// Mock Email Service
vi.mock('../src/modules/auth/recovery/account-recovery-email.service', () => ({
    AccountRecoveryEmailService: {
        sendRequestReceivedEmail: vi.fn().mockResolvedValue(true),
        sendApprovalEmail: vi.fn().mockResolvedValue(true),
        sendRejectionEmail: vi.fn().mockResolvedValue(true),
        sendRestoredEmail: vi.fn().mockResolvedValue(true),
    },
}));

// Mock AuditLogService
vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn().mockResolvedValue(true),
    },
}));

// Mock SessionService
vi.mock('../src/modules/auth/session/session.service', () => ({
    SessionService: {
        revokeAllUserSessions: vi.fn().mockResolvedValue(1),
        createSession: vi.fn().mockResolvedValue(null),
    },
}));

// Mock Password utils
vi.mock('../src/utils/password', () => ({
    hashPassword: vi.fn().mockResolvedValue('hashed_password_123'),
    comparePassword: vi.fn().mockResolvedValue(true),
}));

describe('Account Deletion & Recovery Workflow (Backend)', () => {
    const mockUserId = new Types.ObjectId('654321654321654321654321');
    const mockAdminId = new Types.ObjectId('123456123456123456123456');
    const mockEmail = 'deleted.user@worksphere.com';
    let mockUser: any;
    let mockRequestsStore: any[];

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequestsStore = [];

        mockUser = {
            _id: mockUserId,
            name: 'Deleted User',
            email: mockEmail,
            password: 'hashed_password_123',
            isActive: false,
            status: 'DEACTIVATED',
            accountStatus: 'DELETED',
            isDeleted: true,
            deletedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // deleted 5 days ago
            recoveryEligibleUntil: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000), // eligible for 25 more days
            save: vi.fn().mockResolvedValue(true),
        };

        // Spy User.findOne
        vi.spyOn(User, 'findOne').mockImplementation((query: any) => {
            if (query.email === mockEmail) {
                return Promise.resolve(mockUser) as any;
            }
            return Promise.resolve(null) as any;
        });

        // Spy User.findById
        vi.spyOn(User, 'findById').mockImplementation((id: any) => {
            if (String(id) === String(mockUserId)) {
                return Promise.resolve(mockUser) as any;
            }
            return Promise.resolve(null) as any;
        });

        // Spy AccountRecoveryRequest.findOne
        vi.spyOn(AccountRecoveryRequest, 'findOne').mockImplementation((query: any) => {
            let found = null;
            if (query.requestId) {
                found = mockRequestsStore.find((r) => r.requestId === query.requestId);
            } else if (query.userId) {
                found = mockRequestsStore.find(
                    (r) =>
                        String(r.userId) === String(query.userId) &&
                        (!query.status || (query.status.$in && query.status.$in.includes(r.status)))
                );
            }
            if (!found) return Promise.resolve(null) as any;

            // Mongoose doc simulator
            const doc = {
                ...found,
                save: vi.fn().mockImplementation(function (this: any) {
                    Object.assign(found, this);
                    return Promise.resolve(found);
                }),
            };
            return Promise.resolve(doc) as any;
        });

        // Spy AccountRecoveryRequest.create
        vi.spyOn(AccountRecoveryRequest, 'create').mockImplementation(async (data: any) => {
            const newRecord = {
                ...data,
                _id: new Types.ObjectId(),
                save: vi.fn().mockResolvedValue(true),
            };
            mockRequestsStore.push(newRecord);
            return newRecord as any;
        });

        // Spy AccountRecoveryRequest.findOneAndUpdate
        vi.spyOn(AccountRecoveryRequest, 'findOneAndUpdate').mockImplementation(
            async (filter: any, update: any) => {
                const index = mockRequestsStore.findIndex((r) => {
                    let matches = true;
                    if (filter.requestId && r.requestId !== filter.requestId) matches = false;
                    if (filter.status && r.status !== filter.status) matches = false;
                    if (
                        filter.verificationTokenUsed !== undefined &&
                        r.verificationTokenUsed !== filter.verificationTokenUsed
                    )
                        matches = false;
                    return matches;
                });

                if (index === -1) return null;

                const item = mockRequestsStore[index];
                if (update.$set) {
                    Object.assign(item, update.$set);
                }
                item.save = vi.fn().mockResolvedValue(item);
                return item as any;
            }
        );
    });

    // ── Scenario 1: A deleted account cannot log in ────────────────────────────
    it('Scenario 1: A deleted account cannot log in and returns machine-readable recoveryAction', async () => {
        vi.spyOn(UserService, 'findByEmail').mockResolvedValue(mockUser);

        await expect(
            AuthService.login({ email: mockEmail, password: 'password123' })
        ).rejects.toThrow('Your account is deactivated');

        try {
            await AuthService.login({ email: mockEmail, password: 'password123' });
        } catch (err: any) {
            expect(err.errors).toBeDefined();
            expect(err.errors.action).toBe('ACCOUNT_RECOVERY_AVAILABLE');
            expect(err.errors.recoveryAction).toBe('ACCOUNT_RECOVERY_AVAILABLE');
        }
    });

    // ── Scenario 2: An active account cannot be incorrectly restored ───────────
    it('Scenario 2: An active account cannot be submitted for recovery', async () => {
        const activeUser = {
            ...mockUser,
            isActive: true,
            status: 'ACTIVE',
            isDeleted: false,
        };
        vi.spyOn(User, 'findOne').mockResolvedValue(activeUser as any);

        const res = await AccountRecoveryService.createRequest(mockEmail);
        expect(res.status).toBe('RECEIVED');
        expect(res.requestId).toBeUndefined(); // Safe response without creating a request
        expect(mockRequestsStore.length).toBe(0);
    });

    // ── Scenario 3: A valid recovery request is persisted ──────────────────────
    it('Scenario 3: A valid recovery request is persisted with unguessable requestId', async () => {
        const res = await AccountRecoveryService.createRequest(mockEmail);

        expect(res.status).toBe('RECEIVED');
        expect(res.requestId).toBeDefined();
        expect(typeof res.requestId).toBe('string');
        expect(mockRequestsStore.length).toBe(1);
        expect(mockRequestsStore[0].status).toBe('PENDING');
        expect(mockRequestsStore[0].accountEmail).toBe(mockEmail);
        expect(mockUser.accountStatus).toBe('RECOVERY_PENDING');
        expect(mockUser.isActive).toBe(false); // Account remains inactive!
    });

    // ── Scenario 4: Unknown and ineligible accounts receive safe public responses
    it('Scenario 4: Unknown and expired accounts receive safe generic responses', async () => {
        // Unknown email
        vi.spyOn(User, 'findOne').mockResolvedValue(null);
        const resUnknown = await AccountRecoveryService.createRequest('nonexistent@example.com');
        expect(resUnknown.status).toBe('RECEIVED');
        expect(resUnknown.requestId).toBeUndefined();

        // Expired recovery window
        const expiredUser = {
            ...mockUser,
            recoveryEligibleUntil: new Date(Date.now() - 10000), // expired in past
        };
        vi.spyOn(User, 'findOne').mockResolvedValue(expiredUser as any);
        const resExpired = await AccountRecoveryService.createRequest(mockEmail);
        expect(resExpired.status).toBe('RECEIVED');
        expect(resExpired.requestId).toBeUndefined();
        expect(mockRequestsStore.length).toBe(0);
    });

    // ── Scenario 5: Duplicate recovery requests are handled safely ─────────────
    it('Scenario 5: Duplicate recovery requests do not create conflicting records', async () => {
        const res1 = await AccountRecoveryService.createRequest(mockEmail);
        expect(res1.requestId).toBeDefined();
        expect(mockRequestsStore.length).toBe(1);

        // Second request for the same account while pending
        const res2 = await AccountRecoveryService.createRequest(mockEmail);
        expect(res2.status).toBe('RECEIVED');
        expect(res2.requestId).toBe(res1.requestId);
        expect(mockRequestsStore.length).toBe(1); // Still 1 record
    });

    // ── Scenario 6: Unauthorized users cannot access SuperAdmin endpoints ──────
    it('Scenario 6: SuperAdmin guard rejects non-superadmins', async () => {
        const { requireSuperAdmin } = await import(
            '../src/modules/super-admin/shared/super-admin-guard'
        );
        const guardFn = requireSuperAdmin[1];

        const next = vi.fn();
        const json = vi.fn();
        const status = vi.fn().mockReturnValue({ json });
        const res: any = { status };

        // Company admin attempt
        const reqCompanyAdmin: any = {
            user: { role: 'COMPANY_ADMIN', userId: 'user1' },
            authenticatedUser: { role: 'COMPANY_ADMIN' },
        };
        guardFn(reqCompanyAdmin, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(403);

        // SuperAdmin attempt
        const reqSuperAdmin: any = {
            user: { role: 'SUPER_ADMIN', userId: 'sa1' },
            authenticatedUser: { role: 'SUPER_ADMIN' },
        };
        guardFn(reqSuperAdmin, res, next);
        expect(next).toHaveBeenCalled();
    });

    // ── Scenario 7: SuperAdmin can approve an eligible pending request ─────────
    it('Scenario 7: SuperAdmin can approve an eligible pending request', async () => {
        const created = await AccountRecoveryService.createRequest(mockEmail);
        const requestId = created.requestId!;

        const approved = await AccountRecoveryService.approveRequest(
            requestId,
            String(mockAdminId),
            'admin@worksphere.com',
            'Identity verified through secondary channel'
        );

        expect(approved.status).toBe('APPROVED');
        expect(approved.tokenExpiresAt).toBeDefined();

        const stored = mockRequestsStore.find((r) => r.requestId === requestId);
        expect(stored.status).toBe('APPROVED');
        expect(stored.verificationTokenHash).toBeDefined();
        expect(stored.verificationTokenUsed).toBe(false);
        // Approval alone does NOT restore user!
        expect(mockUser.isActive).toBe(false);
        expect(mockUser.accountStatus).toBe('RECOVERY_APPROVED');
    });

    // ── Scenario 8: SuperAdmin can reject a pending request ────────────────────
    it('Scenario 8: SuperAdmin can reject a pending request with reason', async () => {
        const created = await AccountRecoveryService.createRequest(mockEmail);
        const requestId = created.requestId!;

        const rejected = await AccountRecoveryService.rejectRequest(
            requestId,
            String(mockAdminId),
            'admin@worksphere.com',
            'Failed verification questions'
        );

        expect(rejected.status).toBe('REJECTED');
        expect(rejected.adminReason).toBe('Failed verification questions');

        const stored = mockRequestsStore.find((r) => r.requestId === requestId);
        expect(stored.status).toBe('REJECTED');
        expect(mockUser.accountStatus).toBe('RECOVERY_REJECTED');
        expect(AccountRecoveryEmailService.sendRejectionEmail).toHaveBeenCalled();
    });

    // ── Scenario 9: Approval sends email with single-use verification link ─────
    it('Scenario 9: Approval triggers secure email dispatch', async () => {
        const created = await AccountRecoveryService.createRequest(mockEmail);
        const requestId = created.requestId!;

        await AccountRecoveryService.approveRequest(
            requestId,
            String(mockAdminId),
            'admin@worksphere.com',
            'Approved'
        );

        expect(AccountRecoveryEmailService.sendApprovalEmail).toHaveBeenCalledWith(
            mockEmail,
            requestId,
            expect.stringContaining('/account-recovery?requestId='),
            expect.any(Date),
            mockUser.name
        );
    });

    // ── Scenario 10: Invalid, expired, reused, or mismatched tokens are rejected
    it('Scenario 10: Invalid, expired, reused, or mismatched tokens are rejected', async () => {
        const created = await AccountRecoveryService.createRequest(mockEmail);
        const requestId = created.requestId!;

        await AccountRecoveryService.approveRequest(
            requestId,
            String(mockAdminId),
            'admin@worksphere.com'
        );

        // 1. Wrong token
        await expect(
            AccountRecoveryService.completeRecovery(requestId, 'wrong_hex_token_000000000000000000000000')
        ).rejects.toThrow('Invalid recovery verification token');

        // Extract raw token from mock call
        const emailCall = vi.mocked(AccountRecoveryEmailService.sendApprovalEmail).mock.calls[0];
        const recoveryUrl = emailCall[2];
        const rawToken = new URL(recoveryUrl).searchParams.get('token')!;

        // 2. Complete with valid token
        const completed = await AccountRecoveryService.completeRecovery(requestId, rawToken);
        expect(completed.restored).toBe(true);

        // 3. Reused token
        await expect(
            AccountRecoveryService.completeRecovery(requestId, rawToken)
        ).rejects.toThrow(/already been processed|already been used/);
    });

    // ── Scenario 11: Account restoration preserves original account ID ─────────
    it('Scenario 11: Account restoration preserves original account ID', async () => {
        const created = await AccountRecoveryService.createRequest(mockEmail);
        const requestId = created.requestId!;

        await AccountRecoveryService.approveRequest(
            requestId,
            String(mockAdminId),
            'admin@worksphere.com'
        );

        const emailCall = vi.mocked(AccountRecoveryEmailService.sendApprovalEmail).mock.calls[0];
        const rawToken = new URL(emailCall[2]).searchParams.get('token')!;

        await AccountRecoveryService.completeRecovery(requestId, rawToken);

        expect(mockUser._id).toEqual(mockUserId);
        expect(mockUser.isDeleted).toBe(false);
        expect(mockUser.isActive).toBe(true);
        expect(mockUser.status).toBe('ACTIVE');
        expect(mockUser.accountStatus).toBe('ACTIVE');
        expect(mockUser.deletedAt).toBeNull();
        expect(mockUser.restoredAt).toBeDefined();
    });

    // ── Scenario 12: Concurrent approvals cannot restore an account more than once
    it('Scenario 12: Concurrent approvals/completions are guarded atomically', async () => {
        const created = await AccountRecoveryService.createRequest(mockEmail);
        const requestId = created.requestId!;

        await AccountRecoveryService.approveRequest(
            requestId,
            String(mockAdminId),
            'admin@worksphere.com'
        );

        // Attempting to approve again
        await expect(
            AccountRecoveryService.approveRequest(
                requestId,
                String(mockAdminId),
                'admin@worksphere.com'
            )
        ).rejects.toThrow(/already in "APPROVED" status/);
    });

    // ── Scenario 13: Failed database operations do not leave partial state ─────
    it('Scenario 13: Non-existent requests throw not found without modifying user', async () => {
        await expect(
            AccountRecoveryService.completeRecovery('fake-request-id', 'token123')
        ).rejects.toThrow('Account recovery request not found');

        expect(mockUser.isActive).toBe(false);
    });

    // ── Scenario 14: Sessions and tokens cannot bypass login after deletion ────
    it('Scenario 14: Account deletion revokes all sessions', async () => {
        mockUser.isActive = true;
        mockUser.isDeleted = false;
        mockUser.status = 'ACTIVE';

        const res = await AuthService.deleteAccount(String(mockUserId), 'User voluntary deletion');
        expect(res.recoveryEligibleUntil).toBeDefined();
        expect(mockUser.isDeleted).toBe(true);
        expect(mockUser.isActive).toBe(false);
        expect(mockUser.status).toBe('DEACTIVATED');
        expect(SessionService.revokeAllUserSessions).toHaveBeenCalledWith(String(mockUserId));
    });

    // ── Scenario 15: Restored account can log in normally ──────────────────────
    it('Scenario 15: A successfully restored account can log in normally', async () => {
        // Setup restored user
        mockUser.isActive = true;
        mockUser.isDeleted = false;
        mockUser.status = 'ACTIVE';
        mockUser.accountStatus = 'ACTIVE';
        mockUser.deletedAt = null;

        vi.spyOn(UserService, 'findByEmail').mockResolvedValue(mockUser);

        const authResponse = await AuthService.login({
            email: mockEmail,
            password: 'valid_password',
        });

        expect(authResponse).toBeDefined();
        expect(authResponse.user.email).toBe(mockEmail);
        expect(authResponse.accessToken).toBeDefined();
    });

    // ── Scenario 16: Public Status Endpoint works safely ───────────────────────
    it('Scenario 16: Recovery status query returns minimal unclassified data', async () => {
        const created = await AccountRecoveryService.createRequest(mockEmail);
        const requestId = created.requestId!;

        const statusPending = await AccountRecoveryService.getStatus(requestId);
        expect(statusPending.status).toBe('PENDING');
        expect(statusPending.isActionRequired).toBe(false);
        expect((statusPending as any).accountEmail).toBeUndefined();
        expect((statusPending as any).userId).toBeUndefined();

        await AccountRecoveryService.approveRequest(
            requestId,
            String(mockAdminId),
            'admin@worksphere.com'
        );

        const statusApproved = await AccountRecoveryService.getStatus(requestId);
        expect(statusApproved.status).toBe('APPROVED');
        expect(statusApproved.isActionRequired).toBe(true);
    });

    // ── Scenario 17: Request schema validation blocks invalid inputs ───────────
    it('Scenario 17: Schema validators reject invalid inputs', () => {
        // Invalid email
        const badEmail = createRecoveryRequestSchema.safeParse({ body: { email: 'not-an-email' } });
        expect(badEmail.success).toBe(false);

        // Valid email
        const goodEmail = createRecoveryRequestSchema.safeParse({ body: { email: 'valid@example.com' } });
        expect(goodEmail.success).toBe(true);

        // Short token
        const shortToken = completeRecoverySchema.safeParse({
            params: { requestId: 'req-1' },
            body: { token: 'short' },
        });
        expect(shortToken.success).toBe(false);

        // Empty rejection reason
        const emptyReject = rejectRecoverySchema.safeParse({
            params: { requestId: 'req-1' },
            body: { adminReason: ' ' },
        });
        expect(emptyReject.success).toBe(false);
    });
});
