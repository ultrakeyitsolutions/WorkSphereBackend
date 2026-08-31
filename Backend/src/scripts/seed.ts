import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { User } from '../modules/users/user.model';
import { Role } from '../modules/roles/role.model';
import { hashPassword } from '../utils/password';

// Load environment variables
dotenv.config();

const seedSuperAdmin = async () => {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;

    // 1. Validate required environment variables are present
    if (!email || !password) {
        console.error(
            'Error: Database seeding failed. Missing required environment variables "SUPER_ADMIN_EMAIL" or "SUPER_ADMIN_PASSWORD".'
        );
        process.exit(1);
    }

    // 2. Normalize inputs
    const normalizedEmail = email.trim().toLowerCase();

    // Basic email pattern validate
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
        console.error('Error: Database seeding failed. SUPER_ADMIN_EMAIL has an invalid email format.');
        process.exit(1);
    }

    // 3. User strong password policy check (min 8 chars)
    if (password.length < 8) {
        console.error(
            'Error: Database seeding failed. SUPER_ADMIN_PASSWORD must be at least 8 characters long.'
        );
        process.exit(1);
    }

    try {
        // 4. Connect to database
        await connectDatabase();

        // 5. Query or seed SUPER_ADMIN role
        const superAdminRoleName = 'SUPER_ADMIN';
        let superAdminRole = await Role.findOne({ name: superAdminRoleName });
        if (!superAdminRole) {
            superAdminRole = new Role({ name: superAdminRoleName });
            await superAdminRole.save();
            console.log(`Role "${superAdminRoleName}" initialized successfully.`);
        }

        // 6. Check if email unique document already exists
        const existingUserByEmail = await User.findOne({ email: normalizedEmail });
        if (existingUserByEmail) {
            console.log(
                `Idempotency Check: Super Admin user with email "${normalizedEmail}" already exists. Seeding skipped.`
            );
            await mongoose.disconnect();
            process.exit(0);
        }

        // Check if any Super Admin user is already configured to prevent duplicates
        const existingSuperAdmin = await User.findOne({ role: superAdminRole._id as any });
        if (existingSuperAdmin) {
            console.log(
                'Idempotency Check: A Super Admin user already exists inside the database. Seeding skipped.'
            );
            await mongoose.disconnect();
            process.exit(0);
        }

        // 7. Hash the pass securely using Argon2id
        const hashedPassword = await hashPassword(password);

        // 8. Create the Super Admin record
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
        console.log('Seeding Completed: Super Admin account has been created.');
        console.log(`Email:   ${normalizedEmail}`);
        console.log(`Role:    ${superAdminRoleName}`);
        console.log(`Status:  ACTIVE`);
        console.log('==================================================');

        await mongoose.disconnect();
        process.exit(0);
    } catch (error: any) {
        console.error('CRITICAL ERROR: Super Admin seeding failed:', error.message || error);
        await mongoose.disconnect();
        process.exit(1);
    }
};

seedSuperAdmin();
