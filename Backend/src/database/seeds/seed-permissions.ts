import { Permission } from '../../modules/permissions/permission.model';
import { IPermission } from '../../modules/permissions/permission.types';

export interface SeedResult {
    created: number;
    updated: number;
    total: number;
}

export const SYSTEM_PERMISSIONS: IPermission[] = [
    // ── SuperAdmin Company Management ─────────────────────────────────────────
    {
        name: 'COMPANY_CREATE',
        description: 'Allows creating new companies and their initial admin accounts',
        category: 'COMPANY_MANAGEMENT',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'COMPANY_READ',
        description: 'Allows viewing registered companies and company metadata',
        category: 'COMPANY_MANAGEMENT',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'COMPANY_UPDATE',
        description: 'Allows modifying company profiles, settings, and quotas',
        category: 'COMPANY_MANAGEMENT',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'COMPANY_DELETE',
        description: 'Allows deleting or soft-deleting registered companies',
        category: 'COMPANY_MANAGEMENT',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'COMPANY_SUSPEND',
        description: 'Allows suspending company access and active tenant operations',
        category: 'COMPANY_MANAGEMENT',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'COMPANY_ACTIVATE',
        description: 'Allows activating and un-suspending company accounts',
        category: 'COMPANY_MANAGEMENT',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'COMPANY_ADMIN_PASSWORD_RESET',
        description: 'Allows super admins to initiate password resets for company administrators',
        category: 'COMPANY_MANAGEMENT',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },

    // ── SuperAdmin Subscriptions Management ──────────────────────────────────
    {
        name: 'SUBSCRIPTION_READ',
        description: 'Allows viewing subscription records, billing cycles, and payment statuses',
        category: 'SUBSCRIPTIONS',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'SUBSCRIPTION_CREATE',
        description: 'Allows assigning initial subscriptions and assigning plans to companies',
        category: 'SUBSCRIPTIONS',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'SUBSCRIPTION_UPDATE',
        description: 'Allows changing subscription statuses, billing cycles, and manual plan upgrades',
        category: 'SUBSCRIPTIONS',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'SUBSCRIPTION_DELETE',
        description: 'Allows terminating, cancelling, or deleting subscriptions',
        category: 'SUBSCRIPTIONS',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },

    // ── SuperAdmin Plans Management ──────────────────────────────────────────
    {
        name: 'PLAN_CREATE',
        description: 'Allows creating new subscription tiers and pricing plans',
        category: 'PLANS',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'PLAN_READ',
        description: 'Allows viewing all defined subscription plans and entitlements',
        category: 'PLANS',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'PLAN_UPDATE',
        description: 'Allows updating plan metadata, pricing, and feature entitlements',
        category: 'PLANS',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'PLAN_DELETE',
        description: 'Allows archiving or deactivating subscription plans',
        category: 'PLANS',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },

    // ── SuperAdmin Feature Catalog ───────────────────────────────────────────
    {
        name: 'FEATURE_CREATE',
        description: 'Allows defining new feature flags and limit definitions in the catalog',
        category: 'FEATURES',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'FEATURE_READ',
        description: 'Allows browsing available feature flags, types, and units',
        category: 'FEATURES',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'FEATURE_UPDATE',
        description: 'Allows editing feature catalog keys, descriptions, and active statuses',
        category: 'FEATURES',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
    {
        name: 'FEATURE_DELETE',
        description: 'Allows deactivating or deleting features from the catalog',
        category: 'FEATURES',
        scope: 'SYSTEM',
        assignableBy: ['SUPER_ADMIN'],
    },
];

export const MEMBER_PERMISSIONS: IPermission[] = [
    // ── Dashboard ─────────────────────────────────────────────────────────────
    {
        name: 'DASHBOARD_READ',
        description: 'View dashboard analytics, daily metrics, and team activity feeds',
        category: 'GENERAL',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },

    // ── Projects ──────────────────────────────────────────────────────────────
    {
        name: 'PROJECT_READ',
        description: 'View company projects, milestones, and project summaries',
        category: 'PROJECTS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'PROJECT_CREATE',
        description: 'Create new company projects and define timelines',
        category: 'PROJECTS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'PROJECT_UPDATE',
        description: 'Update project details, assignees, statuses, and milestones',
        category: 'PROJECTS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'PROJECT_DELETE',
        description: 'Delete or archive company projects',
        category: 'PROJECTS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },

    // ── Tasks ─────────────────────────────────────────────────────────────────
    {
        name: 'TASK_READ',
        description: 'View tasks, task stages, sprint boards, and task attachments',
        category: 'TASKS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'TASK_CREATE',
        description: 'Create tasks, subtasks, and wishlist backlog items',
        category: 'TASKS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'TASK_UPDATE',
        description: 'Update task descriptions, stages, estimates, and priorities',
        category: 'TASKS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'TASK_DELETE',
        description: 'Delete tasks and subtasks',
        category: 'TASKS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'TASK_ASSIGN',
        description: 'Assign or reassign tasks and reviewers to team members',
        category: 'TASKS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },

    // ── Meetings & Video Conferencing ─────────────────────────────────────────
    {
        name: 'MEETING_READ',
        description: 'View scheduled and past company meetings and calendars',
        category: 'MEETINGS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'MEETING_CREATE',
        description: 'Schedule company calendar meetings with Google/Teams integrations',
        category: 'MEETINGS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'MEETING_UPDATE',
        description: 'Update meeting agendas, participant lists, and timeframes',
        category: 'MEETINGS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'MEETING_DELETE',
        description: 'Cancel or delete scheduled company meetings',
        category: 'MEETINGS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'QUICK_MEETING_CREATE',
        description: 'Create instant 1-click quick meeting rooms subject to plan quota',
        category: 'MEETINGS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'MEETING_INVITE_ANYONE',
        description: 'Invite external guests or any company member to video conferences',
        category: 'MEETINGS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },

    // ── Reports & Analytics ───────────────────────────────────────────────────
    {
        name: 'REPORT_READ',
        description: 'View organization reports, timesheet summaries, and attendance logs',
        category: 'REPORTS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'REPORT_EXPORT',
        description: 'Export timesheet, attendance, and project logs to CSV/Excel formats',
        category: 'REPORTS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },

    // ── Live Monitoring ───────────────────────────────────────────────────────
    {
        name: 'LIVE_MONITORING_READ',
        description: 'View live presence, current activities, and real-time dashboard status',
        category: 'MONITORING',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },

    // ── Users & Member Access Management ─────────────────────────────────────
    {
        name: 'USER_REVIEW_READ',
        description: 'View member performance review links and appraisal history',
        category: 'USERS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'USER_PERMISSIONS_MANAGE',
        description: 'Manage granular permission grants and revocations for company members',
        category: 'USERS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },

    // ── Notification Sounds ──────────────────────────────────────────────────
    {
        name: 'NOTIFICATION_SOUND_READ',
        description: 'Browse available notification sounds in the sound library',
        category: 'NOTIFICATIONS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'NOTIFICATION_SOUND_CREATE',
        description: 'Upload custom audio notification sounds',
        category: 'NOTIFICATIONS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'NOTIFICATION_SOUND_UPDATE',
        description: 'Update audio sound properties and friendly names',
        category: 'NOTIFICATIONS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'NOTIFICATION_SOUND_DELETE',
        description: 'Delete custom notification sounds from library',
        category: 'NOTIFICATIONS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
    {
        name: 'NOTIFICATION_SOUND_CONFIGURE',
        description: 'Configure event-to-sound mappings for workspace notifications',
        category: 'NOTIFICATIONS',
        scope: 'COMPANY_MEMBER',
        assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'],
    },
];

export const ALL_DEFINED_PERMISSIONS = [...SYSTEM_PERMISSIONS, ...MEMBER_PERMISSIONS];

/**
 * Idempotently seeds all system and member permissions.
 * Does not duplicate records and updates metadata if altered.
 */
export async function seedPermissions(dryRun = false): Promise<SeedResult> {
    let created = 0;
    let updated = 0;

    for (const perm of ALL_DEFINED_PERMISSIONS) {
        const existing = await Permission.findOne({ name: perm.name });

        if (!existing) {
            if (!dryRun) {
                await Permission.create(perm);
            }
            created++;
        } else {
            // Check if any field differs
            const needsUpdate =
                existing.description !== perm.description ||
                existing.category !== perm.category ||
                existing.scope !== perm.scope ||
                JSON.stringify(existing.assignableBy?.sort()) !== JSON.stringify(perm.assignableBy?.sort());

            if (needsUpdate) {
                if (!dryRun) {
                    await Permission.updateOne(
                        { _id: existing._id },
                        {
                            $set: {
                                description: perm.description,
                                category: perm.category,
                                scope: perm.scope,
                                assignableBy: perm.assignableBy,
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
        total: ALL_DEFINED_PERMISSIONS.length,
    };
}
