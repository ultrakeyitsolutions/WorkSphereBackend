import mongoose from 'mongoose';
import { env } from '../config/env';
import { EntitlementReconciliationService } from '../modules/super-admin/entitlements/entitlement-reconciliation.service';

async function main() {
    const isApply = process.argv.includes('--apply');
    const isDryRun = !isApply;

    console.log(`=======================================================`);
    console.log(` WorkSphere Subscription Entitlement Reconciliation`);
    console.log(` Mode: ${isDryRun ? 'DRY-RUN (Audit only)' : 'APPLY (Mutations enabled)'}`);
    console.log(`=======================================================\n`);

    try {
        await mongoose.connect(env.MONGODB_URI);
        console.log('Connected to MongoDB.\n');

        const report = await EntitlementReconciliationService.runReconciliation(isDryRun);

        console.log(`Audit Summary:`);
        console.log(`- Plans Audited: ${report.plansAudited}`);
        console.log(`- Companies Audited: ${report.companiesAudited}`);
        console.log(`- Plans with Missing Catalog Features: ${report.plansWithMissingFeatures.length}`);
        console.log(`- Companies with Discrepancies: ${report.companiesWithDiscrepancies.length}`);

        if (report.plansWithMissingFeatures.length > 0) {
            console.log(`\nUnconfigured / Incomplete Plans:`);
            report.plansWithMissingFeatures.forEach((p) => {
                console.log(`  * Plan: ${p.planName} (${p.billingCycle}) — Missing: ${p.missingCatalogFeatures.join(', ')}`);
            });
        }

        if (report.companiesWithDiscrepancies.length > 0) {
            console.log(`\nCompany Discrepancies:`);
            report.companiesWithDiscrepancies.forEach((c) => {
                console.log(`  * Company: ${c.companyName} [${c.companyId}]`);
                console.log(`    Status: ${c.subscriptionStatus}, Plan: ${c.planName}`);
                if (c.featuresLost.length > 0) console.log(`    Features Revoked (Fail-closed): ${c.featuresLost.join(', ')}`);
                if (c.featuresGained.length > 0) console.log(`    Features Gained: ${c.featuresGained.join(', ')}`);
            });
        }

        if (isApply) {
            console.log(`\nReconciliation applied! Backfilled entries: ${report.reconciledCount}. Distributed caches invalidated.`);
        } else {
            console.log(`\nDry run completed safely without database modifications.`);
            console.log(`To apply safe reconciliation, run with --apply.`);
        }

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('Reconciliation failed:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
}

main();
