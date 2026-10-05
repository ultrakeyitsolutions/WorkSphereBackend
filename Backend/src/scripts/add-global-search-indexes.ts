/**
 * One-time migration: add MongoDB compound indexes for global search.
 *
 * Run once against your Atlas cluster:
 *   npx tsx src/scripts/add-global-search-indexes.ts
 *
 * Safe to run multiple times — createIndex is idempotent.
 * Does NOT touch Atlas Search indexes (create those in the Atlas UI or CLI).
 */

import mongoose from 'mongoose';
import { env } from '../config/env';

async function addGlobalSearchIndexes() {
    console.log('[Migration] Connecting to MongoDB...');
    await mongoose.connect(env.MONGODB_URI);
    const db = mongoose.connection.db!;

    // ── users collection ──────────────────────────────────────────────────────
    console.log('[Migration] Creating users compound index...');
    await db.collection('users').createIndex(
        { companyId: 1, status: 1, name: 1 },
        { background: true, name: 'global_search_users' }
    );

    // ── companies collection ──────────────────────────────────────────────────
    console.log('[Migration] Creating companies compound index...');
    await db.collection('companies').createIndex(
        { name: 1, status: 1 },
        { background: true, name: 'global_search_companies' }
    );

    // ── projects collection ───────────────────────────────────────────────────
    // { companyId: 1, status: 1 } already exists in the project model.
    // Adding a name index for the fallback regex path.
    console.log('[Migration] Creating projects name index...');
    await db.collection('projects').createIndex(
        { name: 1, deletedAt: 1 },
        { background: true, name: 'global_search_projects' }
    );

    console.log('[Migration] ✅ All global search indexes created successfully.');
    await mongoose.disconnect();
}

addGlobalSearchIndexes().catch((err) => {
    console.error('[Migration] Failed:', err);
    process.exit(1);
});
