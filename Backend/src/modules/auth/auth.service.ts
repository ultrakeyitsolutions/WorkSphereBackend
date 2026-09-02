import { UserService } from '../users/user.service';
import { Role } from '../roles/role.model';
import { Company } from '../super-admin/companies/company.model';
import { hashPassword, comparePassword } from '../../utils/password';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/tokens';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { Request } from 'express';

export class AuthService {
    static async register(data: any) {
        const existingUser = await UserService.findByEmail(data.email);
        if (existingUser) {
            throw new Error('Email is already registered');
        }

        // Role resolution or creation
        const roleName = data.roleName || 'User';
        let role = await Role.findOne({ name: roleName });
        if (!role) {
            role = new Role({ name: roleName });
            await role.save();
        }

        const hashedPassword = await hashPassword(data.password);
        const user = await UserService.createUser({
            name: data.name,
            email: data.email,
            password: hashedPassword,
            role: role._id as any,
            isActive: true,
        });

        return user;
    }

    static async login(data: any, req?: Request) {
        const user = await UserService.findByEmail(data.email);
        if (!user) {
            // Log failed login attempt
            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorEmail: data.email,
                success: false,
                description: `Failed login attempt for email: ${data.email} — user not found`,
                req,
            });
            throw new Error('Invalid email or password');
        }

        if (!user.isActive) {
            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorId: String(user._id),
                actorEmail: user.email,
                actorRole: (user.role as any)?.name ?? null,
                success: false,
                description: `Failed login — account deactivated for: ${user.email}`,
                req,
            });
            throw new Error('Your account is deactivated');
        }

        // ─── Company Status Check ────────────────────────────────────────────────
        if (user.companyId) {
            const company = await Company.findById(user.companyId);
            if (!company) {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGIN_FAILED,
                    actorId: String(user._id),
                    actorEmail: user.email,
                    success: false,
                    description: `Failed login — organization not found for: ${user.email}`,
                    req,
                });
                throw new Error('Your organization account is not found.');
            }
            if (company.status === 'SUSPENDED') {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGIN_FAILED,
                    actorId: String(user._id),
                    actorEmail: user.email,
                    companyId: String(company._id),
                    companyName: company.name,
                    success: false,
                    description: `Failed login — organization suspended for: ${user.email}`,
                    req,
                });
                throw new Error('Your organization account is currently suspended.');
            }
            if (company.status === 'DELETED' || !company.isActive) {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGIN_FAILED,
                    actorId: String(user._id),
                    actorEmail: user.email,
                    companyId: String(company._id),
                    companyName: company.name,
                    success: false,
                    description: `Failed login — organization inactive for: ${user.email}`,
                    req,
                });
                throw new Error('Your organization account is no longer active.');
            }
        }

        const isMatch = await comparePassword(data.password, user.password || '');
        if (!isMatch) {
            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorId: String(user._id),
                actorEmail: user.email,
                actorRole: (user.role as any)?.name ?? null,
                companyId: user.companyId ? String(user.companyId) : null,
                success: false,
                description: `Failed login — wrong password for: ${user.email}`,
                req,
            });
            throw new Error('Invalid email or password');
        }

        const userRole = (user.role as any)?.name || 'User';
        const payload = {
            userId: String(user._id),
            email: user.email,
            role: userRole,
            // Embed companyId so controllers never trust the request body for it
            companyId: user.companyId ? String(user.companyId) : undefined,
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // ── Successful login audit ────────────────────────────────────────────
        await AuditLogService.log({
            action: AuditAction.USER_LOGIN,
            actorId: String(user._id),
            actorEmail: user.email,
            actorRole: userRole,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `User logged in: ${user.email}`,
            req,
        });

        return {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: userRole,
                companyId: user.companyId,
            },
            accessToken,
            refreshToken,
        };
    }

    static async refresh(token: string, req?: Request) {
        const decoded = verifyRefreshToken(token);
        const user = await UserService.findById(decoded.userId);
        if (!user) {
            throw new Error('User not found');
        }
        if (!user.isActive) {
            throw new Error('User account is deactivated');
        }

        // ─── Company Status Check ────────────────────────────────────────────────
        if (user.companyId) {
            const company = await Company.findById(user.companyId);
            if (!company) {
                throw new Error('Your organization account is not found.');
            }
            if (company.status === 'SUSPENDED') {
                throw new Error('Your organization account is currently suspended.');
            }
            if (company.status === 'DELETED' || !company.isActive) {
                throw new Error('Your organization account is no longer active.');
            }
        }

        const userRole = (user.role as any)?.name || 'User';
        const payload = {
            userId: String(user._id),
            email: user.email,
            role: userRole,
            companyId: user.companyId ? String(user.companyId) : undefined,
        };

        const accessToken = generateAccessToken(payload);
        const newRefreshToken = generateRefreshToken(payload);

        // Token refresh is the closest thing to a "logout + re-login" we track
        await AuditLogService.log({
            action: AuditAction.USER_LOGOUT,
            actorId: String(user._id),
            actorEmail: user.email,
            actorRole: userRole,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `Token refreshed (session continued) for: ${user.email}`,
            metadata: { note: 'Token refresh — previous session rotated' },
            req,
        });

        return {
            accessToken,
            refreshToken: newRefreshToken,
        };
    }
}
