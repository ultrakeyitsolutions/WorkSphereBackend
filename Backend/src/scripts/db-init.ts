import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { runDatabaseSeeds } from '../database/seeds';

// Load environment variables
dotenv.config();

async function main() {
    const isDryRun = process.argv.includes('--dry-run');

    console.log('================================================================');
    console.log('  WorkSphere Production Database Initialization & Seeding');
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  Execution Mode: ${isDryRun ? 'DRY-RUN (No database mutations)' : 'APPLY (Safe idempotent mutations)'}`);
    console.log('================================================================\n');

    try {
        console.log('⏳ Connecting to MongoDB...');
        await connectDatabase();
        console.log('✅ Connected successfully.\n');

        console.log('🚀 Running database seeds in deterministic order...\n');
        const report = await runDatabaseSeeds(isDryRun);

        console.log('================================================================');
        console.log('                  SEED EXECUTION SUMMARY');
        console.log('================================================================');
        console.log(`⏱  Duration:              ${report.durationMs}ms`);
        console.log(`🛡  Execution Mode:        ${report.dryRun ? 'DRY-RUN' : 'APPLIED'}`);
        console.log(`🔑 Permissions:           ${report.permissions.created} created, ${report.permissions.updated} synchronized, ${report.permissions.total} total`);
        console.log(`👥 Roles:                 ${report.roles.created} created, ${report.roles.updated} synchronized, ${report.roles.total} total`);
        console.log(`👑 SuperAdmin:            ${report.superAdmin.created ? 'CREATED' : report.superAdmin.skipped ? 'PRESERVED (No mutation)' : 'UNCHANGED'} - ${report.superAdmin.message}`);
        console.log(`✨ Feature Catalog:       ${report.features.created} created, ${report.features.updated} updated, ${report.features.total} total`);
        console.log(`📦 Subscription Plans:    ${report.plans.plansCreated} created, ${report.plans.plansUpdated} updated, ${report.plans.entitlementsConfigured} entitlements configured`);
        console.log(`⚙️  System Settings:       Storage: ${report.settings.storageInitialized ? 'Initialized' : 'Existing'}, Sound: ${report.settings.defaultSoundInitialized ? 'Initialized' : 'Existing'}, Company Backfill: ${report.settings.companySettingsBackfilled}`);
        if (!isDryRun) {
            console.log(`📑 Schema Indexes:        ${report.indexesSynced} collections synced`);
        }
        console.log('================================================================\n');

        console.log('✅ Database initialization completed successfully.\n');
        await mongoose.disconnect();
        process.exit(0);
    } catch (error: any) {
        console.error('\n❌ CRITICAL: Database initialization failed!');
        console.error('Error Details:', error.message || error);
        if (error.stack) {
            console.error(error.stack);
        }
        await mongoose.disconnect();
        process.exit(1);
    }
}

main();
