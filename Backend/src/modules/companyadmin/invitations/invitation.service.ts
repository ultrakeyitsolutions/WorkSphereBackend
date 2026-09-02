import crypto from 'crypto';
import mongoose, { Types } from 'mongoose';
import { env } from '../../../config/env';
import { Company } from '../../super-admin/companies/company.model';
import { CompanyRole } from './roles/company-role.model';
import { Designation } from './designation/designation.model';
import { CompanyMember } from './company-member.model';
import { Invitation, IInvitationDocument } from './invitation.model';
import { InvitationDelivery } from './invitation-delivery.model';
import { User } from '../../users/user.model';
import { Role } from '../../roles/role.model';
import { EmailService } from './email.service';
import { hashPassword, comparePassword } from '../../../utils/password';
import { generateAccessToken, generateRefreshToken } from '../../../utils/tokens';

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

    static async invite(
        members: InviteMemberInput[],
        companyId: string,
        invitedByUserId: string
    ) {
        // Validate company
        const company = await Company.findById(companyId);
        if (!company) throw new Error('Company not found');
        if (company.status !== 'ACTIVE' || !company.isActive) {
            throw new Error('Company is not active');
        }

        const results: Array<{ emailOrPhone: string; status: string; reason?: string; invitationId?: string }> = [];
        let created = 0;
        let failed = 0;

        for (const member of members) {
            const { emailOrPhone, roleId, designationId, memberType } = member;

            try {
                // ── Determine channel ──────────────────────────────────────
                const channel = isEmail(emailOrPhone) ? 'EMAIL' : 'SMS';
                const email = channel === 'EMAIL' ? emailOrPhone.toLowerCase().trim() : undefined;
                const phone = channel === 'SMS' ? emailOrPhone.trim() : undefined;

                // ── Validate email / phone format ─────────────────────────
                if (channel === 'EMAIL' && !isEmail(emailOrPhone)) {
                    throw new Error('Invalid email address');
                }

                // ── Validate Role ──────────────────────────────────────────
                const role = await CompanyRole.findOne({
                    _id: new Types.ObjectId(roleId),
                    companyId: new Types.ObjectId(companyId),
                });
                if (!role) throw new Error(`Role ${roleId} not found or does not belong to this company`);
                if (!role.isActive) throw new Error(`Role "${role.name}" is not active`);

                // ── Validate Designation ───────────────────────────────────
                const designation = await Designation.findOne({
                    _id: new Types.ObjectId(designationId),
                    companyId: new Types.ObjectId(companyId),
                });
                if (!designation) throw new Error(`Designation ${designationId} not found or does not belong to this company`);
                if (!designation.isActive) throw new Error(`Designation "${designation.name}" is not active`);

                // ── Check existing membership ──────────────────────────────
                if (email) {
                    const existingUser = await User.findOne({ email });
                    if (existingUser) {
                        const existingMember = await CompanyMember.findOne({
                            companyId: new Types.ObjectId(companyId),
                            userId: existingUser._id,
                        });
                        if (existingMember) {
                            results.push({ emailOrPhone, status: 'ALREADY_MEMBER' });
                            failed++;
                            continue;
                        }
                    }
                }

                // ── Check existing PENDING invitation ──────────────────────
                const pendingQuery: Record<string, unknown> = {
                    companyId: new Types.ObjectId(companyId),
                    status: 'PENDING',
                    expiresAt: { $gt: new Date() },
                };
                if (email) pendingQuery.email = email;
                else pendingQuery.phoneNumber = phone;

                const existingPending = await Invitation.findOne(pendingQuery);
                if (existingPending) {
                    results.push({ emailOrPhone, status: 'ALREADY_INVITED' });
                    failed++;
                    continue;
                }

                // ── Generate token ─────────────────────────────────────────
                const { rawToken, tokenHash } = generateToken();
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + env.INVITATION_EXPIRES_DAYS);

                // ── Create Invitation ──────────────────────────────────────
                const invitation = await Invitation.create({
                    companyId: new Types.ObjectId(companyId),
                    email,
                    phoneNumber: phone,
                    roleId: new Types.ObjectId(roleId),
                    designationId: new Types.ObjectId(designationId),
                    memberType,
                    invitedByUserId: new Types.ObjectId(invitedByUserId),
                    tokenHash,
                    expiresAt,
                    status: 'PENDING',
                });

                // ── Create Delivery Record ─────────────────────────────────
                const delivery = await InvitationDelivery.create({
                    invitationId: invitation._id,
                    channel,
                    status: 'QUEUED',
                    attemptCount: 0,
                });

                // ── Send Email ─────────────────────────────────────────────
                if (channel === 'EMAIL' && email) {
                    try {
                        await InvitationDelivery.findByIdAndUpdate(delivery._id, {
                            status: 'SENDING',
                            $inc: { attemptCount: 1 },
                        });

                        const messageId = await EmailService.sendInvitationEmail({
                            to: email,
                            rawToken,
                            companyName: company.name,
                            roleName: role.name,
                            designationName: designation.name,
                        });

                        await InvitationDelivery.findByIdAndUpdate(delivery._id, {
                            status: 'SENT',
                            providerMessageId: messageId,
                            sentAt: new Date(),
                        });
                    } catch (emailErr: any) {
                        await InvitationDelivery.findByIdAndUpdate(delivery._id, {
                            status: 'FAILED',
                            failureReason: emailErr?.message ?? 'Unknown error',
                            failedAt: new Date(),
                        });
                        // Invitation still created — let admin retry manually
                    }
                }

                results.push({
                    emailOrPhone,
                    status: 'INVITED',
                    invitationId: String(invitation._id),
                });
                created++;

            } catch (err: any) {
                results.push({
                    emailOrPhone,
                    status: 'FAILED',
                    reason: err?.message ?? 'Unknown error',
                });
                failed++;
            }
        }

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
        const invitation = await Invitation.findOne({ tokenHash })
            .populate<{ roleId: { name: string } }>('roleId', 'name')
            .populate<{ designationId: { name: string } }>('designationId', 'name')
            .populate<{ companyId: { name: string; status: string; isActive: boolean } }>('companyId', 'name status isActive');

        if (!invitation) throw new Error('Invitation not found or invalid token');
        if (invitation.status !== 'PENDING') throw new Error(`Invitation is ${invitation.status.toLowerCase()}`);
        if (new Date() > invitation.expiresAt) {
            // Auto-expire
            await Invitation.findByIdAndUpdate(invitation._id, { status: 'EXPIRED' });
            throw new Error('Invitation has expired');
        }

        const company = invitation.companyId as any;
        if (!company || company.status !== 'ACTIVE' || !company.isActive) {
            throw new Error('Company is not active');
        }

        const email = invitation.email ?? null;
        const userExists = email ? !!(await User.findOne({ email })) : false;

        return {
            valid: true,
            data: {
                companyName: company.name,
                email,
                phoneNumber: invitation.phoneNumber ?? null,
                role: (invitation.roleId as any)?.name ?? null,
                designation: (invitation.designationId as any)?.name ?? null,
                expiresAt: invitation.expiresAt,
                userExists,
            },
        };
    }

    // ── ③ Accept invitation (existing user) ───────────────────────────────────

    static async acceptInvitation(input: AcceptInvitationInput) {
        const tokenHash = hashToken(input.token);

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const invitation = await Invitation.findOne({ tokenHash }).session(session)
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

            // Find user by email
            const email = invitation.email;
            if (!email) throw new Error('Invitation has no email — use SMS flow');

            const user = await User.findOne({ email }).session(session);
            if (!user) throw new Error('No account found for this email. Please register instead.');

            // Verify password
            const passwordMatch = await comparePassword(input.password, user.password || '');
            if (!passwordMatch) throw new Error('Invalid password');

            // Check already a member
            const existingMembership = await CompanyMember.findOne({
                companyId: company._id,
                userId: user._id,
            }).session(session);
            if (existingMembership) throw new Error('User is already a member of this company');

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

    // ── ④ Register via invitation (new user) ──────────────────────────────────

    static async registerViaInvitation(input: RegisterViaInvitationInput) {
        const tokenHash = hashToken(input.token);

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const invitation = await Invitation.findOne({ tokenHash }).session(session)
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

                    const messageId = await EmailService.sendInvitationEmail({
                        to: invitation.email,
                        rawToken,
                        companyName: company.name,
                        roleName: role.name,
                        designationName: designation.name,
                    });

                    await InvitationDelivery.findByIdAndUpdate(delivery._id, {
                        status: 'SENT',
                        providerMessageId: messageId,
                        sentAt: new Date(),
                    });
                } catch (emailErr: any) {
                    await InvitationDelivery.findByIdAndUpdate(delivery._id, {
                        status: 'FAILED',
                        failureReason: emailErr?.message ?? 'Unknown error',
                        failedAt: new Date(),
                    });
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
