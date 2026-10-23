import { Feature } from '../../modules/super-admin/features/features.model';
import { IFeature } from '../../modules/super-admin/features/features.types';

export interface FeatureSeedResult {
    created: number;
    updated: number;
    total: number;
}

export const SYSTEM_FEATURE_CATALOG: IFeature[] = [
    // ── LIMIT based features ──────────────────────────────────────────────────
    {
        key: 'USERS',
        name: 'Users',
        description: 'Number of active employee accounts allowed per company',
        category: 'core',
        type: 'LIMIT',
        unit: 'COUNT',
        isActive: true,
    },
    {
        key: 'PROJECTS',
        name: 'Projects',
        description: 'Maximum number of active company projects',
        category: 'core',
        type: 'LIMIT',
        unit: 'COUNT',
        isActive: true,
    },
    {
        key: 'TASKS',
        name: 'Tasks',
        description: 'Maximum number of tasks per individual project',
        category: 'core',
        type: 'LIMIT',
        unit: 'PER_PROJECT',
        isActive: true,
    },
    {
        key: 'STORAGE',
        name: 'Storage',
        description: 'File and asset storage capacity quota per company in Gigabytes',
        category: 'storage',
        type: 'LIMIT',
        unit: 'GB',
        isActive: true,
    },
    {
        key: 'QUICK_MEETINGS',
        name: 'Quick Meetings',
        description: 'Monthly quota for instant 1-click video conference rooms',
        category: 'communication',
        type: 'LIMIT',
        unit: 'COUNT',
        isActive: true,
    },

    // ── BOOLEAN based features ───────────────────────────────────────────────
    {
        key: 'TASK_MANAGEMENT',
        name: 'Task Management',
        description: 'Core task creation, Kanban workflow, and task assignment',
        category: 'productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'TASK_TEMPLATES',
        name: 'Task Templates',
        description: 'Reusable task and checklist templates for rapid creation',
        category: 'productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'RECURRING_TASKS',
        name: 'Recurring Tasks',
        description: 'Automated recurring tasks scheduled by cron or recurrence rules',
        category: 'productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'FILE_ATTACHMENTS',
        name: 'File Attachments',
        description: 'Attach files, documents, and media to tasks and comments',
        category: 'storage',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'TIME_TRACKING',
        name: 'Time Tracking',
        description: 'Basic timer and manual duration tracking for individual tasks',
        category: 'productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'BASIC_ANALYTICS',
        name: 'Basic Analytics',
        description: 'Standard attendance logs and general company overview summaries',
        category: 'analytics',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'ADVANCED_TIME_TRACKING',
        name: 'Advanced Time Tracking',
        description: 'Comprehensive timesheets, approvals, corrections, and weekly logs',
        category: 'productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'DASHBOARD_ANALYTICS',
        name: 'Dashboard Analytics',
        description: 'Advanced real-time executive and team productivity dashboards',
        category: 'analytics',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'ROLES_PERMISSIONS',
        name: 'Custom Roles & Permissions',
        description: 'Granular role customization and member access overrides',
        category: 'security',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'TASK_WORKFLOWS',
        name: 'Task Workflows',
        description: 'Custom statuses, stages, and automated lifecycle transitions',
        category: 'productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'CHAT',
        name: 'Team Chat',
        description: 'Real-time internal messaging, direct messaging, and group channels',
        category: 'communication',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'GOOGLE_MEET',
        name: 'Google Meet Integration',
        description: 'Direct synchronization with Google Calendar and automated Google Meet link generation',
        category: 'integrations',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'MS_TEAMS',
        name: 'Microsoft Teams Integration',
        description: 'Direct synchronization with Microsoft 365 and Teams meeting creation',
        category: 'integrations',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'CUSTOM_COMPANY_EMAIL',
        name: 'Custom Company Email',
        description: 'Custom domain SMTP server configuration for employee invitations and company mail',
        category: 'integrations',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'CUSTOM_COMPANY_THEME',
        name: 'Custom Company Theme',
        description: 'White-labeling, brand colors, custom themes, and corporate logo styling',
        category: 'customization',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'LIVE_MONITORING',
        name: 'Live Monitoring',
        description: 'Real-time employee activity, presence, and live dashboard monitoring',
        category: 'management',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
    {
        key: 'DETAILED_MONITORING',
        name: 'Detailed Monitoring',
        description: 'In-depth audit timelines, continuous activity logs, and productivity analytics',
        category: 'management',
        type: 'BOOLEAN',
        unit: 'NONE',
        isActive: true,
    },
];

/**
 * Idempotently seeds the full system feature catalog into the database.
 */
export async function seedFeatures(dryRun = false): Promise<FeatureSeedResult> {
    let created = 0;
    let updated = 0;

    for (const f of SYSTEM_FEATURE_CATALOG) {
        const existing = await Feature.findOne({ key: f.key });

        if (!existing) {
            if (!dryRun) {
                await Feature.create({ ...f, isActive: true });
            }
            created++;
        } else {
            const needsUpdate =
                existing.name !== f.name ||
                existing.description !== f.description ||
                existing.category !== f.category ||
                existing.type !== f.type ||
                existing.unit !== f.unit ||
                existing.isActive !== true;

            if (needsUpdate) {
                if (!dryRun) {
                    await Feature.updateOne(
                        { _id: existing._id },
                        {
                            $set: {
                                name: f.name,
                                description: f.description,
                                category: f.category,
                                type: f.type,
                                unit: f.unit,
                                isActive: true,
                            },
                        }
                    );
                }
                updated++;
            }
        }
    }

    return {
        created,
        updated,
        total: SYSTEM_FEATURE_CATALOG.length,
    };
}
