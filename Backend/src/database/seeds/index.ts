import mongoose from 'mongoose';
import { seedPermissions, SeedResult } from './seed-permissions';
import { seedRoles, RoleSeedResult } from './seed-roles';
import { seedSuperAdmin, SuperAdminSeedResult } from './seed-super-admin';
import { seedFeatures, FeatureSeedResult } from './seed-features';
import { seedPlans, PlanSeedResult } from './seed-plans';
import { seedSettings, SettingsSeedResult } from './seed-settings';

export interface DatabaseSeedReport {
    timestamp: string;
    dryRun: boolean;
    permissions: SeedResult;
    roles: RoleSeedResult;
    superAdmin: SuperAdminSeedResult;
    features: FeatureSeedResult;
    plans: PlanSeedResult;
    settings: SettingsSeedResult;
    indexesSynced: number;
    durationMs: number;
}

/**
 * Ensures critical schema indexes exist in MongoDB safely.
 */
async function syncDatabaseIndexes(): Promise<number> {
    const models = mongoose.modelNames();
    let synced = 0;

    for (const name of models) {
        try {
            const model = mongoose.model(name);
            await model.syncIndexes();
            synced++;
        } catch (err: any) {
            console.warn(`[Index Sync] Warning syncing indexes for model ${name}:`, err.message || err);
        }
    }

    return synced;
}

/**
 * Master database initialization and seeding orchestrator.
 *
 * Runs all seed modules in deterministic dependency order:
 * 1. Permissions (Prerequisite for roles)
 * 2. Roles (Prerequisite for SuperAdmin)
 * 3. Initial SuperAdmin User
 * 4. Feature Catalog (Prerequisite for plans)
 * 5. Subscription Plans & Feature Entitlements
 * 6. Default Settings, Storage Config, & Sounds
 * 7. Safe MongoDB Index Synchronization
 *
 * @param dryRun If true, audits and calculates seed requirements without applying mutations.
 */
export async function runDatabaseSeeds(dryRun = false): Promise<DatabaseSeedReport> {
    const startTime = Date.now();

    // 1. Permissions
    const permissions = await seedPermissions(dryRun);

    // 2. Roles
    const roles = await seedRoles(dryRun);

    // 3. SuperAdmin
    const superAdmin = await seedSuperAdmin(dryRun);

    // 4. Feature Catalog
    const features = await seedFeatures(dryRun);

    // 5. Subscription Plans & Entitlements
    const plans = await seedPlans(dryRun);

    // 6. Settings & Storage Defaults
    const settings = await seedSettings(dryRun);

    // 7. Schema Indexes
    let indexesSynced = 0;
    if (!dryRun) {
        indexesSynced = await syncDatabaseIndexes();
    }

    const durationMs = Date.now() - startTime;

    return {
        timestamp: new Date().toISOString(),
        dryRun,
        permissions,
        roles,
        superAdmin,
        features,
        plans,
        settings,
        indexesSynced,
        durationMs,
    };
}
