import crypto from 'crypto';
import { Types } from 'mongoose';
import { Request } from 'express';
import { AccountRecoveryRequest } from './account-recovery.model';
import { User } from '../../users/user.model';
import { SessionService } from '../session/session.service';
import { AccountRecoveryEmailService } from './account-recovery-email.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';
import { AppError } from '../../../utils/AppError';
import { env } from '../../../config/env';

export class AccountRecoveryService {
    /**
     * Public submission of account recovery request
     */
    static async createRequest(communicationEmail: string, req?: Request) {
        const normalizedEmail = communicationEmail.trim().toLowerCase();

        // Safe generic response helper to avoid account enumeration
        const safeGenericResponse = (requestId?: string) => ({
            status: 'RECEIVED',
            requestId: requestId || undefined,
            message:
                'If an eligible account is associated with this email, your recovery request has been submitted for administrative review.',
        });

        // 1. Locate account by email
        const user = await User.findOne({ email: normalizedEmail });

        // If user doesn't exist, is already active, or was never deleted/deactivated -> safe generic response
        if (!user || (!user.isDeleted && user.status === 'ACTIVE')) {
            return safeGenericResponse();
        }

        // 2. Check recovery eligibility window (e.g. 30 days)
        const now = new Date();
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const eligibleUntil =
            user.recoveryEligibleUntil ||
            (user.deletedAt ? new Date(user.deletedAt.getTime() + thirtyDaysMs) : null);

        if (eligibleUntil && eligibleUntil < now) {
            // Expired recovery window: safe generic response
            return safeGenericResponse();
        }

        // 3. Check for existing pending or approved recovery request
        const existingActiveRequest = await AccountRecoveryRequest.findOne({
            userId: user._id,
            status: { $in: ['PENDING', 'APPROVED'] },
        });

        if (existingActiveRequest) {
            // Prevent conflicting duplicates
            return safeGenericResponse(existingActiveRequest.requestId);
        }

        // 4. Generate unique unguessable request ID
        const requestId = crypto.randomUUID();

        // 5. Create recovery request record
        await AccountRecoveryRequest.create({
            requestId,
            userId: user._id,
            accountEmail: user.email,
            communicationEmail: normalizedEmail,
            status: 'PENDING',
            submittedAt: new Date(),
            ipAddress: req?.ip || null,
            userAgent: (req?.headers?.['user-agent'] as string) || null,
            verificationTokenUsed: false,
        });

        // 6. Update user state (keeps isActive = false; does NOT activate account)
        user.accountStatus = 'RECOVERY_PENDING';
        await user.save();

        // 7. Audit logging
        await AuditLogService.log({
            action: AuditAction.ACCOUNT_RECOVERY_REQUESTED,
            actorEmail: normalizedEmail,
            actorId: String(user._id),
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `Account recovery requested for ${user.email} (Ref: ${requestId})`,
            metadata: {
                requestId,
                communicationEmail: normalizedEmail,
                ipAddress: req?.ip,
            },
            req,
        });

        // 8. Send acknowledgment email
        await AccountRecoveryEmailService.sendRequestReceivedEmail(
            normalizedEmail,
            requestId,
            user.name
        );

        return safeGenericResponse(requestId);
    }

    /**
     * SuperAdmin: List recovery requests with filtering and pagination
     */
    static async listRequests(query: {
        page?: number;
        limit?: number;
        status?: string;
        search?: string;
    }) {
        const page = Math.max(1, query.page || 1);
        const limit = Math.min(100, Math.max(1, query.limit || 20));
        const skip = (page - 1) * limit;

        const filter: any = {};

        if (query.status) {
            filter.status = query.status.toUpperCase();
        }

        if (query.search) {
            const regex = new RegExp(query.search.trim(), 'i');
            filter.$or = [
                { accountEmail: regex },
                { communicationEmail: regex },
                { requestId: regex },
            ];
        }

        const [requests, total] = await Promise.all([
            AccountRecoveryRequest.find(filter)
                .sort({ submittedAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('reviewedBy', 'name email')
                .populate('userId', 'name email deletedAt recoveryEligibleUntil status isDeleted')
                .lean(),
            AccountRecoveryRequest.countDocuments(filter),
        ]);

        return {
            requests: requests.map((r: any) => ({
                id: String(r._id),
                requestId: r.requestId,
                status: r.status,
                accountEmail: r.accountEmail,
                communicationEmail: r.communicationEmail,
                submittedAt: r.submittedAt,
                reviewedAt: r.reviewedAt || null,
                reviewedBy: r.reviewedBy
                    ? { id: String(r.reviewedBy._id), name: r.reviewedBy.name, email: r.reviewedBy.email }
                    : null,
                adminReason: r.adminReason || null,
                account: r.userId
                    ? {
                        id: String(r.userId._id),
                        name: r.userId.name,
                        email: r.userId.email,
                        deletedAt: r.userId.deletedAt,
                        recoveryEligibleUntil: r.userId.recoveryEligibleUntil,
                        isDeleted: r.userId.isDeleted,
                    }
                    : null,
                emailDeliveryStatus: r.emailDeliveryStatus,
            })),
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit) || 1,
            },
        };
    }

    /**
     * SuperAdmin: Get single recovery request details
     */
    static async getRequestById(requestId: string) {
        const request: any = await AccountRecoveryRequest.findOne({ requestId })
            .populate('reviewedBy', 'name email')
            .populate('userId', 'name email deletedAt recoveryEligibleUntil status isDeleted companyId createdAt')
            .lean();

        if (!request) {
            throw AppError.notFound(`Account recovery request "${requestId}" not found`);
        }

        return {
            id: String(request._id),
            requestId: request.requestId,
            status: request.status,
            accountEmail: request.accountEmail,
            communicationEmail: request.communicationEmail,
            submittedAt: request.submittedAt,
            reviewedAt: request.reviewedAt || null,
            reviewedBy: request.reviewedBy
                ? { id: String(request.reviewedBy._id), name: request.reviewedBy.name, email: request.reviewedBy.email }
                : null,
            adminReason: request.adminReason || null,
            account: request.userId
                ? {
                    id: String(request.userId._id),
                    name: request.userId.name,
                    email: request.userId.email,
                    deletedAt: request.userId.deletedAt,
                    recoveryEligibleUntil: request.userId.recoveryEligibleUntil,
                    isDeleted: request.userId.isDeleted,
                    companyId: request.userId.companyId,
                    createdAt: request.userId.createdAt,
                }
                : null,
            verificationTokenExpiresAt: request.verificationTokenExpiresAt || null,
            verificationTokenUsed: request.verificationTokenUsed,
            completedAt: request.completedAt || null,
            ipAddress: request.ipAddress,
            userAgent: request.userAgent,
            emailDeliveryStatus: request.emailDeliveryStatus,
        };
    }

    /**
     * SuperAdmin: Approve recovery request and dispatch secure single-use token
     */
    static async approveRequest(
        requestId: string,
        adminId: string,
        adminEmail: string,
        adminReason?: string,
        req?: Request
    ) {
        // Concurrency-safe atomic lookup: only transition if currently PENDING
        const request = await AccountRecoveryRequest.findOne({ requestId });
        if (!request) {
            throw AppError.notFound(`Account recovery request "${requestId}" not found`);
        }

        if (request.status !== 'PENDING') {
            throw AppError.conflict(
                `Request cannot be approved because it is already in "${request.status}" status`
            );
        }

        // Verify account exists
        const user = await User.findById(request.userId);
        if (!user) {
            throw AppError.notFound('Associated user account was not found');
        }

        if (!user.isDeleted && user.status === 'ACTIVE') {
            throw AppError.badRequest('User account is already active and does not require recovery');
        }

        // Generate 32-byte cryptographically secure single-use verification token
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity

        // Concurrency-safe atomic update
        const updated = await AccountRecoveryRequest.findOneAndUpdate(
            { requestId, status: 'PENDING' },
            {
                $set: {
                    status: 'APPROVED',
                    reviewedBy: new Types.ObjectId(adminId),
                    reviewedAt: new Date(),
                    adminReason: adminReason?.trim() || null,
                    verificationTokenHash: tokenHash,
                    verificationTokenExpiresAt: tokenExpiresAt,
                    verificationTokenUsed: false,
                    emailDeliveryStatus: 'PENDING',
                },
            },
            { new: true }
        );

        if (!updated) {
            throw AppError.conflict('Request was modified concurrently by another administrator');
        }

        // Update user lifecycle state (Approval alone does NOT activate account)
        user.accountStatus = 'RECOVERY_APPROVED';
        await user.save();

        // Construct secure single-use recovery link
        const baseUrl = env.APP_URL || 'http://localhost:3000';
        const recoveryUrl = `${baseUrl.replace(/\/$/, '')}/account-recovery?requestId=${encodeURIComponent(requestId)}&token=${encodeURIComponent(rawToken)}`;

        // Send approval email
        const emailSent = await AccountRecoveryEmailService.sendApprovalEmail(
            request.communicationEmail,
            requestId,
            recoveryUrl,
            tokenExpiresAt,
            user.name
        );

        updated.emailDeliveryStatus = emailSent ? 'SENT' : 'FAILED';
        await updated.save();

        // Audit log
        await AuditLogService.log({
            action: AuditAction.ACCOUNT_RECOVERY_APPROVED,
            actorId: adminId,
            actorEmail: adminEmail,
            actorRole: 'SUPER_ADMIN',
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `SuperAdmin approved account recovery for ${user.email} (Ref: ${requestId})`,
            metadata: {
                requestId,
                communicationEmail: request.communicationEmail,
                adminReason,
                tokenExpiresAt,
                emailDeliveryStatus: updated.emailDeliveryStatus,
            },
            req,
        });

        return {
            requestId: updated.requestId,
            status: updated.status,
            reviewedAt: updated.reviewedAt,
            tokenExpiresAt: updated.verificationTokenExpiresAt,
            emailDeliveryStatus: updated.emailDeliveryStatus,
            message: 'Account recovery request approved and verification instructions dispatched.',
        };
    }

    /**
     * SuperAdmin: Reject recovery request
     */
    static async rejectRequest(
        requestId: string,
        adminId: string,
        adminEmail: string,
        adminReason: string,
        req?: Request
    ) {
        const request = await AccountRecoveryRequest.findOne({ requestId });
        if (!request) {
            throw AppError.notFound(`Account recovery request "${requestId}" not found`);
        }

        if (request.status !== 'PENDING') {
            throw AppError.conflict(
                `Request cannot be rejected because it is already in "${request.status}" status`
            );
        }

        // Concurrency-safe atomic update
        const updated = await AccountRecoveryRequest.findOneAndUpdate(
            { requestId, status: 'PENDING' },
            {
                $set: {
                    status: 'REJECTED',
                    reviewedBy: new Types.ObjectId(adminId),
                    reviewedAt: new Date(),
                    adminReason: adminReason.trim(),
                },
            },
            { new: true }
        );

        if (!updated) {
            throw AppError.conflict('Request was modified concurrently by another administrator');
        }

        const user = await User.findById(request.userId);
        if (user) {
            user.accountStatus = 'RECOVERY_REJECTED';
            await user.save();
        }

        // Send rejection email
        await AccountRecoveryEmailService.sendRejectionEmail(
            request.communicationEmail,
            requestId,
            adminReason,
            user?.name
        );

        // Audit log
        await AuditLogService.log({
            action: AuditAction.ACCOUNT_RECOVERY_REJECTED,
            actorId: adminId,
            actorEmail: adminEmail,
            actorRole: 'SUPER_ADMIN',
            companyId: user?.companyId ? String(user.companyId) : null,
            success: true,
            description: `SuperAdmin rejected account recovery for ${request.accountEmail} (Ref: ${requestId})`,
            metadata: {
                requestId,
                communicationEmail: request.communicationEmail,
                adminReason,
            },
            req,
        });

        return {
            requestId: updated.requestId,
            status: updated.status,
            reviewedAt: updated.reviewedAt,
            adminReason: updated.adminReason,
            message: 'Account recovery request has been rejected.',
        };
    }

    /**
     * Public: Complete recovery verification and restore account to active state
     */
    static async completeRecovery(requestId: string, token: string, req?: Request) {
        const request = await AccountRecoveryRequest.findOne({ requestId });
        if (!request) {
            throw AppError.notFound('Account recovery request not found');
        }

        if (request.status === 'COMPLETED' || request.verificationTokenUsed) {
            throw AppError.badRequest('This recovery request has already been processed or token already used.');
        }

        if (request.status !== 'APPROVED') {
            throw AppError.badRequest(
                `Recovery request cannot be completed because its current status is "${request.status}"`
            );
        }

        if (!request.verificationTokenExpiresAt || request.verificationTokenExpiresAt < new Date()) {
            request.status = 'EXPIRED';
            await request.save();
            throw AppError.badRequest('Recovery verification token has expired. Please submit a new request.');
        }

        // Constant-time token hash validation
        const suppliedHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
        const storedHash = request.verificationTokenHash || '';

        const isMatch =
            storedHash.length === suppliedHash.length &&
            crypto.timingSafeEqual(Buffer.from(suppliedHash, 'utf8'), Buffer.from(storedHash, 'utf8'));

        if (!isMatch) {
            throw AppError.badRequest('Invalid recovery verification token');
        }

        // Concurrency-safe atomic token consumption
        const updatedRequest = await AccountRecoveryRequest.findOneAndUpdate(
            {
                requestId,
                status: 'APPROVED',
                verificationTokenUsed: false,
            },
            {
                $set: {
                    status: 'COMPLETED',
                    verificationTokenUsed: true,
                    completedAt: new Date(),
                },
            },
            { new: true }
        );

        if (!updatedRequest) {
            throw AppError.conflict('Recovery request was already completed or updated concurrently');
        }

        // Restore original account identity
        const user = await User.findById(request.userId);
        if (!user) {
            throw AppError.notFound('Target account record was not found in database');
        }

        // Clean restoration to active state
        user.isDeleted = false;
        user.deletedAt = null;
        user.deletedBy = null;
        user.deletionReason = null;
        user.isActive = true;
        user.status = 'ACTIVE';
        user.accountStatus = 'ACTIVE';
        user.recoveryEligibleUntil = null;
        user.restoredAt = new Date();
        user.restoredBy = request.reviewedBy || null;
        user.restoredViaRequestId = updatedRequest._id;
        await user.save();

        // Invalidate all previous sessions across all devices
        await SessionService.revokeAllUserSessions(String(user._id));

        // Audit log
        await AuditLogService.log({
            action: AuditAction.ACCOUNT_RECOVERY_COMPLETED,
            actorId: String(user._id),
            actorEmail: user.email,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `Account successfully recovered and restored: ${user.email} (Ref: ${requestId})`,
            metadata: {
                requestId,
                restoredAt: user.restoredAt,
            },
            req,
        });

        // Dispatch restoration notification email
        await AccountRecoveryEmailService.sendRestoredEmail(
            request.communicationEmail,
            user.name
        );
        if (request.communicationEmail.toLowerCase() !== user.email.toLowerCase()) {
            await AccountRecoveryEmailService.sendRestoredEmail(user.email, user.name);
        }

        return {
            restored: true,
            email: user.email,
            message: 'Your account has been successfully restored. You can now log in with your credentials.',
        };
    }

    /**
     * Public: Retrieve unauthenticated safe status for a recovery request
     */
    static async getStatus(requestId: string) {
        const request = await AccountRecoveryRequest.findOne({ requestId });

        if (!request) {
            throw AppError.notFound('Recovery request not found');
        }

        const isActionRequired =
            request.status === 'APPROVED' &&
            !request.verificationTokenUsed &&
            Boolean(request.verificationTokenExpiresAt && request.verificationTokenExpiresAt > new Date());

        return {
            requestId: request.requestId,
            status: request.status,
            submittedAt: request.submittedAt,
            isActionRequired,
        };
    }
}
