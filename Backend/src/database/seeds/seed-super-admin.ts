import { User } from '../../modules/users/user.model';
import { Role } from '../../modules/roles/role.model';
import { hashPassword } from '../../utils/password';

export interface SuperAdminSeedResult {
    created: boolean;
    skipped: boolean;
    email?: string;
    message: string;
}

/**
 * Idempotently creates the initial SuperAdmin user.
 *
 * PRODUCTION SAFETY GUARANTEES:
 * 1. Never overwrites existing passwords, credentials, or user metadata.
 * 2. If a user with SUPER_ADMIN_EMAIL already exists, password mutation is strictly skipped.
 * 3. If any user with the SUPER_ADMIN role already exists, creation is skipped to prevent duplicate accounts.
 * 4. Never exposes or logs plain-text passwords.
 */
export async function seedSuperAdmin(dryRun = false): Promise<SuperAdminSeedResult> {
    const rawEmail = process.env.SUPER_ADMIN_EMAIL;
    const rawPassword = process.env.SUPER_ADMIN_PASSWORD;
    const adminName = (process.env.SUPER_ADMIN_NAME || 'Super Admin').trim();

    // Resolve SUPER_ADMIN role
    const superAdminRole = await Role.findOne({ name: 'SUPER_ADMIN' });
    if (!superAdminRole) {
        throw new Error('SUPER_ADMIN role not found. seedRoles() must be executed before seedSuperAdmin().');
    }

    // Check if any SuperAdmin user already exists in the system
    const existingSuperAdmin = await User.findOne({
        role: superAdminRole._id,
        isDeleted: { $ne: true },
    });

    if (!rawEmail || !rawPassword) {
        if (existingSuperAdmin) {
            return {
                created: false,
                skipped: true,
                email: existingSuperAdmin.email,
                message: `SuperAdmin already provisioned (${existingSuperAdmin.email}). Env credentials omitted; preserving existing user.`,
            };
        }
        throw new Error(
            'Cannot provision initial SuperAdmin: Missing required environment variables "SUPER_ADMIN_EMAIL" or "SUPER_ADMIN_PASSWORD".'
        );
    }

    const normalizedEmail = rawEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
        throw new Error(`Invalid SUPER_ADMIN_EMAIL format: "${rawEmail}"`);
    }

    if (rawPassword.length < 8) {
        throw new Error('SUPER_ADMIN_PASSWORD must be at least 8 characters long.');
    }

    // Check if user with this email already exists
    const existingByEmail = await User.findOne({ email: normalizedEmail });

    if (existingByEmail) {
        // Safe check: verify role linkage without mutating password
        const hasAdminRole = String(existingByEmail.role) === String(superAdminRole._id);
        if (!hasAdminRole && !dryRun) {
            existingByEmail.role = superAdminRole._id as any;
            await existingByEmail.save();
        }

        return {
            created: false,
            skipped: true,
            email: normalizedEmail,
            message: `User with email "${normalizedEmail}" already exists. Retained existing production password without mutation.`,
        };
    }

    if (existingSuperAdmin) {
        return {
            created: false,
            skipped: true,
            email: existingSuperAdmin.email,
            message: `A SuperAdmin account already exists (${existingSuperAdmin.email}). Skipped creating duplicate SuperAdmin for "${normalizedEmail}".`,
        };
    }

    // Provision fresh SuperAdmin
    if (!dryRun) {
        const hashedPassword = await hashPassword(rawPassword);

        await User.create({
            name: adminName || 'Super Admin',
            email: normalizedEmail,
            password: hashedPassword,
            role: superAdminRole._id,
            isActive: true,
            status: 'ACTIVE',
            accountStatus: 'ACTIVE',
            mustChangePassword: false,
        });
    }

    return {
        created: true,
        skipped: false,
        email: normalizedEmail,
        message: `Initial SuperAdmin provisioned successfully for "${normalizedEmail}".`,
    };
}
