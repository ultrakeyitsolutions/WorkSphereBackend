import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { User } from '../modules/users/user.model';
import { Role } from '../modules/roles/role.model';
import { Permission } from '../modules/permissions/permission.model';
import { hashPassword } from '../utils/password';

// Load environment variables
dotenv.config();

const seedSuperAdmin = async () => {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;

    // 1. Validate required environment variables
    if (!email || !password) {
        console.error(
            'Error: Missing required env variables "SUPER_ADMIN_EMAIL" or "SUPER_ADMIN_PASSWORD".'
        );
        process.exit(1);
    }

    // 2. Normalize inputs
    const normalizedEmail = email.trim().toLowerCase();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
        console.error('Error: SUPER_ADMIN_EMAIL has an invalid email format.');
        process.exit(1);
    }

    if (password.length < 8) {
        console.error('Error: SUPER_ADMIN_PASSWORD must be at least 8 characters long.');
        process.exit(1);
    }

    try {
        // 3. Connect to database
        await connectDatabase();

        // 4. Seed permissions required by SUPER_ADMIN
        const permissionsToSeed = [
            { name: 'COMPANY_CREATE', description: 'Allows creating new companies and their admin users' },
            { name: 'COMPANY_READ', description: 'Allows reading company data' },
            { name: 'COMPANY_UPDATE', description: 'Allows updating company data' },
            { name: 'COMPANY_DELETE', description: 'Allows deleting companies' },
            { name: 'COMPANY_SUSPEND', description: 'Allows suspending a company' },
            { name: 'COMPANY_ACTIVATE', description: 'Allows activating a suspended company' },
            { name: 'COMPANY_ADMIN_PASSWORD_RESET', description: 'Allows resetting a company admin password' },
        ];

        const permissionIds: mongoose.Types.ObjectId[] = [];
        for (const perm of permissionsToSeed) {
            let doc = await Permission.findOne({ name: perm.name });
            if (!doc) {
                doc = await Permission.create(perm);
                console.log(`  ✔ Permission "${perm.name}" created.`);
            } else {
                console.log(`  - Permission "${perm.name}" already exists.`);
            }
            permissionIds.push(doc._id as mongoose.Types.ObjectId);
        }

        // 5. Resolve or create SUPER_ADMIN role — assign all permissions
        const superAdminRoleName = 'SUPER_ADMIN';
        let superAdminRole = await Role.findOne({ name: superAdminRoleName });

        if (!superAdminRole) {
            superAdminRole = new Role({ name: superAdminRoleName, permissions: permissionIds });
            await superAdminRole.save();
            console.log(`  ✔ Role "${superAdminRoleName}" created with all permissions.`);
        } else {
            // Idempotent: merge any missing permissions
            const existing = (superAdminRole.permissions as any[]).map(String);
            const toAdd = permissionIds.filter((id) => !existing.includes(String(id)));
            if (toAdd.length > 0) {
                superAdminRole.permissions.push(...(toAdd as any));
                await superAdminRole.save();
                console.log(`  ✔ Role "${superAdminRoleName}" updated with ${toAdd.length} new permission(s).`);
            } else {
                console.log(`  - Role "${superAdminRoleName}" permissions already up to date.`);
            }
        }

        // 6. Idempotency guard — skip if user already exists by email
        const existingByEmail = await User.findOne({ email: normalizedEmail });
        if (existingByEmail) {
            console.log(`Idempotency: Super Admin "${normalizedEmail}" already exists. Skipped.`);
            await mongoose.disconnect();
            process.exit(0);
        }

        // 7. Idempotency guard — skip if any Super Admin already seeded
        const existingSuperAdmin = await User.findOne({ role: superAdminRole._id as any });
        if (existingSuperAdmin) {
            console.log('Idempotency: A Super Admin already exists in the database. Skipped.');
            await mongoose.disconnect();
            process.exit(0);
        }

        // 8. Hash password securely (Argon2id)
        const hashedPassword = await hashPassword(password);

        // 9. Create the Super Admin user
        const superAdmin = new User({
            name: 'Super Admin',
            email: normalizedEmail,
            password: hashedPassword,
            role: superAdminRole._id as any,
            isActive: true,
            status: 'ACTIVE',
        });

        await superAdmin.save();

        console.log('==================================================');
        console.log('✅ Seeding Complete: Super Admin created.');
        console.log(`   Email:       ${normalizedEmail}`);
        console.log(`   Role:        ${superAdminRoleName}`);
        console.log(`   Permissions: ${permissionsToSeed.map((p) => p.name).join(', ')}`);
        console.log(`   Status:      ACTIVE`);
        console.log('==================================================');

        await mongoose.disconnect();
        process.exit(0);
    } catch (error: any) {
        console.error('CRITICAL ERROR: Seeding failed:', error.message || error);
        await mongoose.disconnect();
        process.exit(1);
    }
};

seedSuperAdmin();
