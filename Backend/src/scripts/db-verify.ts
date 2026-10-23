import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { User } from '../modules/users/user.model';
import { Role } from '../modules/roles/role.model';
import { Permission } from '../modules/permissions/permission.model';
import { Feature } from '../modules/super-admin/features/features.model';
import { Plan } from '../modules/super-admin/plans/plans.model';
import { PlanFeature } from '../modules/super-admin/plan-features/plan-features.model';
import { StorageConfiguration } from '../modules/super-admin/storage/storage-config.model';
import { NotificationSound } from '../modules/notification-sounds/notification-sound.model';
import { Company } from '../modules/super-admin/companies/company.model';
import { CompanySettings } from '../modules/companyadmin/settings/company-settings.model';
import { ALL_DEFINED_PERMISSIONS } from '../database/seeds/seed-permissions';
import { SYSTEM_FEATURE_CATALOG } from '../database/seeds/seed-features';
import { SEED_PLANS } from '../database/seeds/seed-plans';

dotenv.config();

interface CheckResult {
    category: string;
    item: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    details: string;
}

async function verifyDatabase(): Promise<boolean> {
    const results: CheckResult[] = [];
    let hasFailures = false;

    console.log('================================================================');
    console.log('       WorkSphere Production Database Verification & Audit');
    console.log(`       Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('================================================================\n');

    await connectDatabase();

    // ── 1. Permissions Audit ──────────────────────────────────────────────────
    const permissionsInDb = await Permission.find({}).lean();
    const permMap = new Map(permissionsInDb.map((p) => [p.name, p]));
    const missingPerms = ALL_DEFINED_PERMISSIONS.filter((p) => !permMap.has(p.name));

    if (missingPerms.length === 0) {
        results.push({
            category: 'Permissions',
            item: 'System & Member Permissions',
            status: 'PASS',
            details: `All ${ALL_DEFINED_PERMISSIONS.length} required permissions present in DB (${permissionsInDb.length} total).`,
        });
    } else {
        hasFailures = true;
        results.push({
            category: 'Permissions',
            item: 'System & Member Permissions',
            status: 'FAIL',
            details: `Missing ${missingPerms.length} required permission(s): ${missingPerms.map((p) => p.name).join(', ')}`,
        });
    }

    // ── 2. Roles Audit ────────────────────────────────────────────────────────
    const requiredRoles = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'User', 'EMPLOYEE'];
    const rolesInDb = await Role.find({ name: { $in: requiredRoles } }).lean();
    const roleMap = new Map(rolesInDb.map((r) => [r.name, r]));

    for (const roleName of requiredRoles) {
        const r = roleMap.get(roleName);
        if (!r) {
            hasFailures = true;
            results.push({
                category: 'Roles',
                item: `Role: ${roleName}`,
                status: 'FAIL',
                details: `Role "${roleName}" is missing from the database.`,
            });
        } else {
            const permCount = (r.permissions || []).length;
            results.push({
                category: 'Roles',
                item: `Role: ${roleName}`,
                status: permCount > 0 ? 'PASS' : 'WARN',
                details: `Present with ${permCount} assigned permission(s).`,
            });
        }
    }

    // ── 3. SuperAdmin Account Audit ───────────────────────────────────────────
    const superAdminRole = roleMap.get('SUPER_ADMIN');
    if (superAdminRole) {
        const superAdminUser = await User.findOne({
            role: superAdminRole._id,
            isDeleted: { $ne: true },
        }).lean();

        if (superAdminUser) {
            const maskedEmail = superAdminUser.email.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => `${a}${'*'.repeat(Math.max(b.length, 3))}${c}`);
            results.push({
                category: 'SuperAdmin',
                item: 'Active SuperAdmin User',
                status: superAdminUser.isActive ? 'PASS' : 'WARN',
                details: `Provisioned (${maskedEmail}), status: ${superAdminUser.status}, active: ${superAdminUser.isActive}`,
            });
        } else {
            hasFailures = true;
            results.push({
                category: 'SuperAdmin',
                item: 'Active SuperAdmin User',
                status: 'FAIL',
                details: 'No active user found with SUPER_ADMIN role. Run npm run db:seed to initialize.',
            });
        }
    }

    // ── 4. Feature Catalog Audit ──────────────────────────────────────────────
    const featuresInDb = await Feature.find({}).lean();
    const featMap = new Map(featuresInDb.map((f) => [f.key, f]));
    const missingFeats = SYSTEM_FEATURE_CATALOG.filter((f) => !featMap.has(f.key));

    if (missingFeats.length === 0) {
        results.push({
            category: 'Feature Catalog',
            item: 'System Features (Limit & Boolean)',
            status: 'PASS',
            details: `All ${SYSTEM_FEATURE_CATALOG.length} catalog features present and active (${featuresInDb.length} total).`,
        });
    } else {
        hasFailures = true;
        results.push({
            category: 'Feature Catalog',
            item: 'System Features (Limit & Boolean)',
            status: 'FAIL',
            details: `Missing ${missingFeats.length} feature(s): ${missingFeats.map((f) => f.key).join(', ')}`,
        });
    }

    // ── 5. Subscription Plans & Entitlements Audit ────────────────────────────
    const plansInDb = await Plan.find({ isArchived: { $ne: true } }).lean();
    const planMap = new Map(plansInDb.map((p) => [p.code, p]));
    const hasDefaultPlan = plansInDb.some((p) => p.isDefault && p.isActive);

    results.push({
        category: 'Plans',
        item: 'Default Plan Availability',
        status: hasDefaultPlan ? 'PASS' : 'FAIL',
        details: hasDefaultPlan
            ? `Active default plan configured: ${plansInDb.find((p) => p.isDefault)?.name}`
            : 'No active default plan flagged in database.',
    });
    if (!hasDefaultPlan) hasFailures = true;

    for (const planDef of SEED_PLANS) {
        const p = planMap.get(planDef.code);
        if (!p) {
            hasFailures = true;
            results.push({
                category: 'Plans',
                item: `Plan: ${planDef.code}`,
                status: 'FAIL',
                details: `Plan "${planDef.name}" (${planDef.code}) not found in database.`,
            });
        } else {
            const entitlementsCount = await PlanFeature.countDocuments({ planId: p._id });
            const allFeaturesCount = featuresInDb.length;
            const isFullyConfigured = entitlementsCount >= SYSTEM_FEATURE_CATALOG.length;

            results.push({
                category: 'Plans',
                item: `Plan: ${planDef.code} Entitlements`,
                status: isFullyConfigured ? 'PASS' : 'WARN',
                details: `${entitlementsCount}/${allFeaturesCount} features configured (Price: ${p.currency} ${p.price}, Cycle: ${p.billingCycle}).`,
            });
        }
    }

    // ── 6. Storage Settings Audit ─────────────────────────────────────────────
    const storageConfig = await StorageConfiguration.findOne({}).lean();
    results.push({
        category: 'Settings',
        item: 'Storage Configuration',
        status: storageConfig ? 'PASS' : 'WARN',
        details: storageConfig
            ? `Configured with provider: ${storageConfig.provider}, enabled: ${storageConfig.enabled}`
            : 'No storage configuration found in DB; utilizing environment fallback.',
    });

    // ── 7. Notification Sound Audit ───────────────────────────────────────────
    const defaultSound = await NotificationSound.findOne({ isDefault: true, deletedAt: null }).lean();
    results.push({
        category: 'Settings',
        item: 'Default Notification Sound',
        status: defaultSound ? 'PASS' : 'WARN',
        details: defaultSound
            ? `Configured default sound: "${defaultSound.name}" (${defaultSound.soundId})`
            : 'No default notification sound registered.',
    });

    // ── 8. Tenant Isolation & Company Settings Audit ──────────────────────────
    const totalCompanies = await Company.countDocuments({});
    const totalCompanySettings = await CompanySettings.countDocuments({});
    const missingSettingsCount = totalCompanies - totalCompanySettings;

    results.push({
        category: 'Tenants',
        item: 'Company Settings Backfill',
        status: missingSettingsCount <= 0 ? 'PASS' : 'WARN',
        details: `${totalCompanies} registered company(s), ${totalCompanySettings} settings documents (${missingSettingsCount > 0 ? `${missingSettingsCount} missing backfill` : '100% synchronized'}).`,
    });

    // ── Output Report ─────────────────────────────────────────────────────────
    console.log('---------------------------------------------------------------------------------------------------------');
    console.log(
        '| ' +
        'CATEGORY'.padEnd(16) +
        '| ' +
        'ITEM'.padEnd(34) +
        '| ' +
        'STATUS'.padEnd(8) +
        '| ' +
        'DETAILS'.padEnd(38) +
        '|'
    );
    console.log('---------------------------------------------------------------------------------------------------------');

    for (const res of results) {
        const statusStr =
            res.status === 'PASS'
                ? '✅ PASS'
                : res.status === 'WARN'
                ? '⚠️  WARN'
                : '❌ FAIL';

        console.log(
            '| ' +
            res.category.padEnd(16) +
            '| ' +
            res.item.padEnd(34) +
            '| ' +
            statusStr.padEnd(8) +
            '| ' +
            res.details.substring(0, 38).padEnd(38) +
            '|'
        );
    }
    console.log('---------------------------------------------------------------------------------------------------------\n');

    if (hasFailures) {
        console.error('❌ Verification failed: One or more critical database requirements are missing.');
        console.error('👉 Run "npm run db:seed" to apply idempotent migrations and seeds.\n');
    } else {
        console.log('✅ Verification passed: Database schema, seed data, and configurations are fully intact.\n');
    }

    await mongoose.disconnect();
    return !hasFailures;
}

verifyDatabase()
    .then((passed) => process.exit(passed ? 0 : 1))
    .catch((err) => {
        console.error('Verification error:', err);
        mongoose.disconnect().then(() => process.exit(1));
    });
