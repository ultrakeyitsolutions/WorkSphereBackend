
import crypto from 'crypto';
import mongoose, { Types } from 'mongoose';
import { env } from '../../../config/env';
import { Company } from '../../super-admin/companies/company.model';
import { CompanyRole } from './roles/company-role.model';
import { Designation } from './designation/designation.model';
import { CompanyMember } from './company-member.model';
import { Invitation } from './invitation.model';
import { InvitationDelivery } from './invitation-delivery.model';
import { invitationEmailQueue } from './invitation-queue.service';
import { User } from '../../users/user.model';
import { Role } from '../../roles/role.model';
import { EmailService } from './email.service';
import { hashPassword, comparePassword } from '../../../utils/password';
import { generateAccessToken, generateRefreshToken } from '../../../utils/tokens';
import { SubscriptionQuotaService } from '../../../services/subscription-quota.service';
import { AppError } from '../../../utils/AppError';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** Generate a cryptographically secure raw token and its SHA-256 hash */
function generateToken(): { rawToken: string; tokenHash: string } {
    const rawToken = crypto.randomBytes(48).toString('hex'); // 96-char hex
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, tokenHash };
}

/** Resolve tokenHash from a raw token string coming from the URL */
function hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InviteMemberInput {
    emailOrPhone: string;
    roleId: string;
    designationId: string;
    memberType: 'EMPLOYEE' | 'CLIENT' | 'MANAGER';
}

export interface AcceptInvitationInput {
    token: string;
    password: string;
}

export interface RegisterViaInvitationInput {
    token: string;
    name: string;
    password: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class InvitationService {

    // ── ① Bulk invite ──────────────────────────────────────────────────────────

    /**
     * Bulk create invitations and enqueue their emails for background delivery.
     *
     * Performance optimizations vs the previous synchronous implementation:
     * 1. Company / roles / designations are validated ONCE per batch (not per member).
     * 2. Independent members are validated & inserted in parallel (bounded concurrency).
     * 3. SMTP email delivery is moved to a background queue (InvitationEmailQueue)
     *    so the HTTP response returns immediately after the invitation is durably
     *    stored in MongoDB. Delivery status is reported as QUEUED; the background
     *  worker transitions it to SENT/FAILED and retries with exponential backoff.
     * 4. Structured timing logs are emitted per phase (db, token, total).
     *
     * Reliability: the invitation record + QUEUED delivery record are committed
     * to the database before returning, so no invitation is lost even if the SMTP
     * provider is temporarily unavailable. Failed deliveries are retried up to
     * INVITATION_EMAIL_MAX_ATTEMPTS times and remain resendable via the resend
     * endpoint. An invitation is never reported as "delivered" unless the email
     * was actually accepted by the SMTP provider.
     */
    static async invite(
        members: InviteMemberInput[],
        companyId: string,
        invitedByUserId: string
    ) {
        const totalStart = Date.now();
        const companyObjId = new Types.ObjectId(companyId);
        const invitedByObjId = new Types.ObjectId(invitedByUserId);

        // Validate company (once per batch)
        const dbStart = Date.now();
        const company = await Company.findById(companyObjId).lean();
        if (!company) throw new Error('Company not found');
        if (company.status !== 'ACTIVE' || !company.isActive) {
            throw new Error('Company is not active');
        }
        const companyName = company.name;
        const dbMs = Date.now() - dbStart;

        // ── Enforce Subscription User Limit ──
        const quotaReservation = await SubscriptionQuotaService.reserveQuota(companyId, 'users', members.length);

        // ── Batch-validate roles & designations once (not per member) ──
        const uniqueRoleIds = [...new Set(members.map((m) => m.roleId))];
        const uniqueDesignationIds = [...new Set(members.map((m) => m.designationId))];

        const [roles, designations] = await Promise.all([
            CompanyRole.find({
                _id: { $in: uniqueRoleIds.map((id) => new Types.ObjectId(id)) },
                companyId: companyObjId,
            }).lean(),
            Designation.find({
                _id: { $in: uniqueDesignationIds.map((id) => new Types.ObjectId(id)) },
                companyId: companyObjId,
            }).lean(),
        ]);

        const roleById = new Map<string, any>();
        for (const r of roles) roleById.set(String(r._id), r);
        const designationById = new Map<string, any>();
        for (const d of designations) designationById.set(String(d._id), d);

        const results: Array<{
            emailOrPhone: string;
            status: string;
            reason?: string;
            invitationId?: string;
            deliveryStatus?: 'QUEUED' | 'SENT' | 'FAILED';
            deliveryError?: string;
        }> = [];
        let created = 0;
        let failed = 0;

        // Bounded concurrency for independent member processing.
        const concurrency = Number(env.INVITATION_MEMBER_CONCURRENCY || '10');

        type MemberOutcome = {
            emailOrPhone: string;
            status: string;
            reason?: string;
            invitationId?: string;
            deliveryStatus?: 'QUEUED' | 'SENT' | 'FAILED';
            created: boolean;
        };

        async function processWithLimit<T>(
            items: InviteMemberInput[],
            fn: (item: InviteMemberInput, idx: number) => Promise<T>
        ): Promise<T[]> {
            const out: Array<T | undefined> = new Array(items.length);
            let i = 0;
            async function worker(): Promise<void> {
                while (i < items.length) {
                    const idx = i++;
                    out[idx] = await fn(items[idx], idx);
                }
            }
            await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }).map(() => worker()));
            return out as T[];
        }

        const outcomes = await processWithLimit<MemberOutcome>(members, async (member) => {
            const { emailOrPhone, roleId, designationId, memberType } = member;
            const memberStart = Date.now();

            try {
                // ── Determine channel ──────────────────────────────────────
                const channel = isEmail(emailOrPhone) ? 'EMAIL' : 'SMS';
                const email = channel === 'EMAIL' ? emailOrPhone.toLowerCase().trim() : undefined;
                const phone = channel === 'SMS' ? emailOrPhone.trim() : undefined;

                // ── Validate email / phone format ─────────────────────────
                if (channel === 'EMAIL' && !isEmail(emailOrPhone)) {
                    throw new Error('Invalid email address');
                }

                // ── Validate Role (from batch cache) ───────────────────────
                const role = roleById.get(roleId);
                if (!role) throw new Error(`Role ${roleId} not found or does not belong to this company`);
                if (!role.isActive) throw new Error(`Role "${role.name}" is not active`);

                // ── Validate Designation (from batch cache) ────────────────
                const designation = designationById.get(designationId);
                if (!designation) throw new Error(`Designation ${designationId} not found or does not belong to this company`);
                if (!designation.isActive) throw new Error(`Designation "${designation.name}" is not active`);

                // ── Check existing membership ──────────────────────────────
                if (email) {
                    const existingUser = await User.findOne({ email });
                    if (existingUser) {
                        const existingMember = await CompanyMember.findOne({
                            companyId: companyObjId,
                            userId: existingUser._id,
                        });
                        if (existingMember) {
                            return {
                                emailOrPhone,
                                status: 'ALREADY_MEMBER',
                                created: false,
                            };
                        }
                    }
                }

                // ── Check existing PENDING invitation ──────────────────────
                const pendingQuery: Record<string, unknown> = {
                    companyId: companyObjId,
                    status: 'PENDING',
                    expiresAt: { $gt: new Date() },
                };
                if (email) pendingQuery.email = email;
                else pendingQuery.phoneNumber = phone;

                const existingPending = await Invitation.findOne(pendingQuery);
                if (existingPending) {
                    return {
                        emailOrPhone,
                        status: 'ALREADY_INVITED',
                        created: false,
                    };
                }

                // ── Generate token ─────────────────────────────────────────
                const tokenStart = Date.now();
                const { rawToken, tokenHash } = generateToken();
                const tokenMs = Date.now() - tokenStart;

                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + env.INVITATION_EXPIRES_DAYS);

                // ── Create Invitation ──────────────────────────────────────
                const invitation = await Invitation.create({
                    companyId: companyObjId,
                    email,
                    phoneNumber: phone,
                    roleId: new Types.ObjectId(roleId),
                    designationId: new Types.ObjectId(designationId),
                    memberType,
                    invitedByUserId: invitedByObjId,
                    tokenHash,
                    expiresAt,
                    status: 'PENDING',
                });

                // ── Create Delivery Record (QUEUED for background delivery) ─
                const delivery = await InvitationDelivery.create({
                    invitationId: invitation._id,
                    channel,
                    status: 'QUEUED',
                    attemptCount: 0,
                });

                // ── Enqueue email for background delivery ─────────────────
                if (channel === 'EMAIL' && email) {
                    invitationEmailQueue.enqueue({
                        deliveryId: delivery._id,
                        invitationId: invitation._id,
                        email,
                        rawToken,
                        companyName,
                        roleName: role.name,
                        designationName: designation.name,
                        companyId: String(company._id),
                        attempt: 0,
                        nextRetryAt: new Date(),
                    });
                }

                const memberMs = Date.now() - memberStart;
                console.log(JSON.stringify({
                    level: 'info',
                    component: 'invitation-service',
                    event: 'invitation_created',
                    email: emailOrPhone,
                    invitationId: String(invitation._id),
                    deliveryId: String(delivery._id),
                    channel,
                    dbMs: memberMs,
                    tokenMs,
                    deliveryStatus: 'QUEUED',
                }));

                return {
                    emailOrPhone,
                    status: 'INVITED',
                    invitationId: String(invitation._id),
                    deliveryStatus: 'QUEUED',
                    created: true,
                };

            } catch (err: any) {
                return {
                    emailOrPhone,
                    status: 'FAILED',
                    reason: err?.message ?? 'Unknown error',
                    created: false,
                };
            }
        });

        for (const outcome of outcomes) {
            if (outcome.created) {
                created++;
                results.push({
                    emailOrPhone: outcome.emailOrPhone,
                    status: outcome.status,
                    invitationId: outcome.invitationId,
                    deliveryStatus: (outcome.deliveryStatus as 'QUEUED' | 'SENT' | 'FAILED' | undefined),
                });
            } else {
                failed++;
                results.push({
                    emailOrPhone: outcome.emailOrPhone,
                    status: outcome.status,
                    reason: outcome.reason,
                });
            }
        }

        await quotaReservation.commit();

        const totalMs = Date.now() - totalStart;
        console.log(JSON.stringify({
            level: 'info',
            component: 'invitation-service',
            event: 'invite_batch_complete',
            companyId,
            total: members.length,
            created,
            failed,
            totalMs,
            dbMs,
        }));

        return {
            total: members.length,
            created,
            failed,
            results,
        };
    }

    // ── ② Validate invitation token (public) ──────────────────────────────────

    static async validateToken(rawToken: string) {
        const tokenHash = hashToken(rawToken);
        const invitation = await Invitation.findOne({ $or: [{ tokenHash }, { previousTokenHashes: tokenHash }] })
            .populate<{ roleId: { name: string } }>('roleId', 'name')
            .populate<{ designationId: { name: string } }>('designationId', 'name')
            .populate<{ companyId: { name: string; slug?: string; status: string; isActive: boolean; logoUrl?: string } }>('companyId')
            .populate<{ invitedByUserId: { name?: string; email?: string } }>('invitedByUserId', 'name email');

        if (!invitation) throw AppError.notFound('Invitation not found or invalid token');
        if (invitation.status !== 'PENDING') throw new AppError(`Invitation is ${invitation.status.toLowerCase()}`, 410);
        if (new Date() > invitation.expiresAt) {
            // Auto-expire
            await Invitation.findByIdAndUpdate(invitation._id, { status: 'EXPIRED' });
            throw new AppError('Invitation has expired', 410);
        }

        const company = invitation.companyId as any;
        if (!company || company.status !== 'ACTIVE' || !company.isActive) {
            throw AppError.badRequest('Company is not active');
        }

        const email = invitation.email ?? null;
        const userExists = email ? !!(await User.findOne({ email })) : false;

        let whiteLabel: any = null;
        try {
            const { WhiteLabelSettings } = await import('../../super-admin/white-label/white-label.model.js');
            whiteLabel = await WhiteLabelSettings.findOne({ companyId: company._id || company.id }).lean();
        } catch {
            // fallback if white-label settings are absent
        }

        const orgId = String(company._id || company.id || '');
        const orgName = company.name || '';
        const orgSlug = company.slug || orgName.toLowerCase().replace(/\s+/g, '-');
        const roleName = (invitation.roleId as any)?.name ?? null;
        const desgName = (invitation.designationId as any)?.name ?? null;
        const inviter = invitation.invitedByUserId as any;
        const inviterName = inviter?.name || (inviter?.email ? inviter.email.split('@')[0] : null);

        const logoUrl = whiteLabel?.logoUrl || company.logoUrl || null;
        const theme = whiteLabel?.theme || {
            primaryColor: '#2563EB',
            secondaryColor: '#1E293B',
            accentColor: '#3B82F6',
            backgroundColor: '#FFFFFF',
            textColor: '#0F172A',
        };

        return {
            valid: true,
            data: {
                organizationId: orgId,
                organizationName: orgName,
                assignedRole: roleName,
                inviterName,
                email,
                phoneNumber: invitation.phoneNumber ?? null,
                role: roleName,
                designation: desgName,
                expiresAt: invitation.expiresAt,
                userExists,
                organization: {
                    id: orgId,
                    name: orgName,
                    slug: orgSlug,
                    logoUrl,
                    theme,
                },
                companyName: orgName,
            },
        };
    }

    // ── ③ Accept invitation (existing user) ───────────────────────────────────

    static async acceptInvitation(input: AcceptInvitationInput) {
        const tokenHash = hashToken(input.token);

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const invitation = await Invitation.findOne({ $or: [{ tokenHash }, { previousTokenHashes: tokenHash }] }).session(session)
                .populate<{ roleId: { _id: Types.ObjectId; name: string } }>('roleId', '_id name')
                .populate<{ designationId: { _id: Types.ObjectId; name: string } }>('designationId', '_id name')
                .populate<{ companyId: { _id: Types.ObjectId; name: string; slug?: string; status: string; isActive: boolean } }>('companyId');

            if (!invitation) throw AppError.notFound('Invalid invitation token');

            const company = invitation.companyId as any;
            if (!company || company.status !== 'ACTIVE' || !company.isActive) {
                throw AppError.badRequest('Company is not active');
            }

            // Find user by email
            const email = invitation.email;
            if (!email) throw AppError.badRequest('Invitation has no email — use SMS flow');

            const user = await User.findOne({ email }).session(session);
            if (!user) throw AppError.notFound('No account found for this email. Please register instead.');

            // Verify password first before state assertions
            const passwordMatch = await comparePassword(input.password, user.password || '');
            if (!passwordMatch) throw AppError.unauthorized('Invalid password');

            // Check if invitation is already accepted by this user (idempotent replay)
            if (invitation.status === 'ACCEPTED') {
                const existingMember = await CompanyMember.findOne({
                    companyId: company._id,
                    userId: user._id,
                }).session(session);
                if (existingMember) {
                    await session.commitTransaction();
                    const payload = { userId: String(user._id), email: user.email, role: (user.role as any)?.name || 'User' };
                    const accessToken = generateAccessToken(payload);
                    const refreshToken = generateRefreshToken(payload);
                    return {
                        user: { id: String(user._id), name: user.name, email: user.email },
                        company: { id: String(company._id), name: company.name, slug: company.slug || company.name?.toLowerCase().replace(/\s+/g, '-') },
                        membership: { roleId: String(existingMember.roleId), designationId: String(existingMember.designationId), status: existingMember.status },
                        accessToken,
                        refreshToken,
                        redirectTo: '/dashboard',
                        workspace: company.slug || company.name?.toLowerCase().replace(/\s+/g, '-'),
                    };
                }
                throw new AppError('Invitation is accepted', 410);
            }

            if (invitation.status !== 'PENDING') throw new AppError(`Invitation is ${invitation.status.toLowerCase()}`, 410);
            if (new Date() > invitation.expiresAt) {
                await Invitation.findByIdAndUpdate(invitation._id, { status: 'EXPIRED' }, { session });
                throw new AppError('Invitation has expired', 410);
            }

            // Check already a member
            const existingMembership = await CompanyMember.findOne({
                companyId: company._id,
                userId: user._id,
            }).session(session);
            if (existingMembership) throw AppError.conflict('User is already a member of this company');

            // Create membership
            const roleObj = invitation.roleId as any;
            const desgObj = invitation.designationId as any;

            const [membership] = await CompanyMember.create(
                [{
                    companyId: company._id,
                    userId: user._id,
                    roleId: roleObj._id,
                    designationId: desgObj._id,
                    memberType: invitation.memberType,
                    status: 'ACTIVE',
                    joinedAt: new Date(),
                }],
                { session }
            );

            // Mark invitation as ACCEPTED
            await Invitation.findByIdAndUpdate(
                invitation._id,
                {
                    status: 'ACCEPTED',
                    acceptedUserId: user._id,
                    acceptedAt: new Date(),
                },
                { session }
            );

            await session.commitTransaction();

            // Generate tokens
            const payload = { userId: String(user._id), email: user.email, role: (user.role as any)?.name || 'User' };
            const accessToken = generateAccessToken(payload);
            const refreshToken = generateRefreshToken(payload);

            return {
                user: { id: String(user._id), name: user.name, email: user.email },
                company: { id: String(company._id), name: company.name, slug: company.slug || company.name?.toLowerCase().replace(/\s+/g, '-') },
                membership: { roleId: String(roleObj._id), designationId: String(desgObj._id), status: membership.status },
                accessToken,
                refreshToken,
                redirectTo: '/dashboard',
                workspace: company.slug || company.name?.toLowerCase().replace(/\s+/g, '-'),
            };

        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    // ── ④ Register via invitation (new user) ──────────────────────────────────

    static async registerViaInvitation(input: RegisterViaInvitationInput) {
        const tokenHash = hashToken(input.token);

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const invitation = await Invitation.findOne({ $or: [{ tokenHash }, { previousTokenHashes: tokenHash }] }).session(session)
                .populate<{ roleId: { _id: Types.ObjectId; name: string } }>('roleId', '_id name')
                .populate<{ designationId: { _id: Types.ObjectId; name: string } }>('designationId', '_id name')
                .populate<{ companyId: { _id: Types.ObjectId; name: string; status: string; isActive: boolean } }>('companyId', '_id name status isActive');

            if (!invitation) throw new Error('Invalid invitation token');
            if (invitation.status !== 'PENDING') throw new Error(`Invitation is ${invitation.status.toLowerCase()}`);
            if (new Date() > invitation.expiresAt) {
                await Invitation.findByIdAndUpdate(invitation._id, { status: 'EXPIRED' }, { session });
                throw new Error('Invitation has expired');
            }

            const company = invitation.companyId as any;
            if (!company || company.status !== 'ACTIVE' || !company.isActive) {
                throw new Error('Company is not active');
            }

            const email = invitation.email;
            if (!email) throw new Error('Invitation has no email — use SMS flow');

            // Email must not be taken
            const existingUser = await User.findOne({ email }).session(session);
            if (existingUser) throw new Error('An account with this email already exists. Please use the login flow instead.');

            // Resolve the default "User" system role for auth
            // const { Role } = await import('../../roles/role.model');
            let systemRole = await Role.findOne({ name: 'User' });
            if (!systemRole) {
                const [created] = await Role.create([{ name: 'User' }], { session });
                systemRole = created;
            }

            // Hash password
            const passwordHash = await hashPassword(input.password);

            // Create user
            const [newUser] = await User.create(
                [{
                    name: input.name.trim(),
                    email,
                    password: passwordHash,
                    role: systemRole._id,
                    isActive: true,
                    status: 'ACTIVE',
                    companyId: company._id,
                }],
                { session }
            );

            // Create membership
            const roleObj = invitation.roleId as any;
            const desgObj = invitation.designationId as any;

            const [membership] = await CompanyMember.create(
                [{
                    companyId: company._id,
                    userId: newUser._id,
                    roleId: roleObj._id,
                    designationId: desgObj._id,
                    memberType: invitation.memberType,
                    status: 'ACTIVE',
                    joinedAt: new Date(),
                }],
                { session }
            );

            // Mark invitation ACCEPTED
            await Invitation.findByIdAndUpdate(
                invitation._id,
                {
                    status: 'ACCEPTED',
                    acceptedUserId: newUser._id,
                    acceptedAt: new Date(),
                },
                { session }
            );

            await session.commitTransaction();

            const payload = { userId: String(newUser._id), email: newUser.email, role: 'User' };
            const accessToken = generateAccessToken(payload);
            const refreshToken = generateRefreshToken(payload);

            return {
                user: { id: String(newUser._id), name: newUser.name, email: newUser.email },
                company: { id: String(company._id), name: company.name },
                membership: { roleId: String(roleObj._id), designationId: String(desgObj._id), status: membership.status },
                accessToken,
                refreshToken,
            };

        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    // ── ⑤ List invitations for a company ─────────────────────────────────────

    static async listByCompany(companyId: string) {
        return Invitation.find({ companyId: new Types.ObjectId(companyId) })
            .populate('roleId', 'name')
            .populate('designationId', 'name')
            .populate('invitedByUserId', 'name email')
            .sort({ createdAt: -1 })
            .lean();
    }

    // ── ⑥ Resend / Cancel Invitation ──────────────────────────────────────────

    static async resendInvitation(companyId: string, invitationId: string, invitedByUserId: string) {
        const invitation = await Invitation.findOne({ _id: invitationId, companyId });
        if (!invitation) throw new Error('Invitation not found');
        if (invitation.status !== 'PENDING') throw new Error('Can only resend pending invitations');

        // Refresh token & expiration
        const { rawToken, tokenHash } = generateToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + env.INVITATION_EXPIRES_DAYS);

        const prevHashes = invitation.previousTokenHashes || [];
        if (invitation.tokenHash && !prevHashes.includes(invitation.tokenHash)) {
            prevHashes.push(invitation.tokenHash);
        }
        invitation.previousTokenHashes = prevHashes;
        invitation.tokenHash = tokenHash;
        invitation.expiresAt = expiresAt;
        invitation.invitedByUserId = new Types.ObjectId(invitedByUserId);
        await invitation.save();

        const channel = invitation.email ? 'EMAIL' : 'SMS';

        const delivery = await InvitationDelivery.create({
            invitationId: invitation._id,
            channel,
            status: 'QUEUED',
            attemptCount: 0,
        });

        if (channel === 'EMAIL' && invitation.email) {
            const company = await Company.findById(companyId);
            const role = await CompanyRole.findById(invitation.roleId);
            const designation = await Designation.findById(invitation.designationId);

            if (company && role && designation) {
                try {
                    await InvitationDelivery.findByIdAndUpdate(delivery._id, {
                        status: 'SENDING',
                        $inc: { attemptCount: 1 },
                    });

                    const deliveryResult = await EmailService.sendInvitationEmail({
                        to: invitation.email,
                        rawToken,
                        companyName: company.name,
                        roleName: role.name,
                        designationName: designation.name,
                        companyId: String(company._id),
                    });

                    await InvitationDelivery.findByIdAndUpdate(delivery._id, {
                        status: 'SENT',
                        providerMessageId: deliveryResult.messageId,
                        senderEmail: deliveryResult.senderEmail,
                        senderMode: deliveryResult.senderMode,
                        sentAt: new Date(),
                    });
                } catch (emailErr: any) {
                    console.error(`[InvitationService] Resend failed for ${invitation.email}:`, emailErr);
                    await InvitationDelivery.findByIdAndUpdate(delivery._id, {
                        status: 'FAILED',
                        failureReason: emailErr?.message ?? 'Unknown error',
                        failedAt: new Date(),
                    });
                    throw new AppError(`Failed to deliver invitation email: ${emailErr?.message || 'SMTP delivery failed'}`, 502);
                }
            }
        }

        return { message: 'Invitation resent' };
    }

    static async cancelInvitation(companyId: string, invitationId: string) {
        const invitation = await Invitation.findOne({ _id: invitationId, companyId });
        if (!invitation) throw new Error('Invitation not found');
        if (invitation.status !== 'PENDING') throw new Error('Can only cancel pending invitations');

        invitation.status = 'CANCELLED';
        invitation.cancelledAt = new Date();
        await invitation.save();

        return { message: 'Invitation cancelled' };
    }
}
