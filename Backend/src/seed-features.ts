import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Feature } from './modules/super-admin/features/features.model';

dotenv.config();

const initialFeatures = [
    // ── LIMIT based features ──────────────────────────────────────────────────
    {
        key: 'USERS',
        name: 'Users',
        description: 'Number of employee accounts allowed',
        category: 'Core',
        type: 'LIMIT',
        unit: 'COUNT',
    },
    {
        key: 'PROJECTS',
        name: 'Projects',
        description: 'Maximum number of active projects',
        category: 'Core',
        type: 'LIMIT',
        unit: 'COUNT',
    },
    {
        key: 'TASKS',
        name: 'Tasks',
        description: 'Maximum number of tasks per project',
        category: 'Core',
        type: 'LIMIT',
        unit: 'PER_PROJECT',
    },
    {
        key: 'STORAGE',
        name: 'Storage',
        description: 'File storage limit per company',
        category: 'Storage',
        type: 'LIMIT',
        unit: 'GB',
    },
    {
        key: 'QUICK_MEETINGS',
        name: 'Quick Meetings',
        description: 'Instant 1-click meeting room creation with monthly quota based on plan',
        category: 'Communication',
        type: 'LIMIT',
        unit: 'COUNT',
    },

    // ── BOOLEAN based features ───────────────────────────────────────────────
    {
        key: 'TASK_MANAGEMENT',
        name: 'Task Management',
        description: 'Core task creation and tracking',
        category: 'Productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'TASK_TEMPLATES',
        name: 'Task Templates',
        description: 'Create and use templates for tasks',
        category: 'Productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'RECURRING_TASKS',
        name: 'Recurring Tasks',
        description: 'Automate repetitive tasks on a schedule',
        category: 'Productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'FILE_ATTACHMENTS',
        name: 'File Attachments',
        description: 'Attach files to tasks and projects',
        category: 'Storage',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'TIME_TRACKING',
        name: 'Time Tracking',
        description: 'Track time spent on tasks',
        category: 'Productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'BASIC_ANALYTICS',
        name: 'Basic Analytics',
        description: 'View basic organizational reports',
        category: 'Analytics',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'ADVANCED_TIME_TRACKING',
        name: 'Advanced Time Tracking',
        description: 'Detailed timesheets and approvals',
        category: 'Productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'DASHBOARD_ANALYTICS',
        name: 'Dashboard Analytics',
        description: 'Advanced real-time dashboards',
        category: 'Analytics',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'ROLES_PERMISSIONS',
        name: 'Custom Roles & Permissions',
        description: 'Define custom access roles',
        category: 'Security',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'TASK_WORKFLOWS',
        name: 'Task Workflows',
        description: 'Automated status transitions and hooks',
        category: 'Productivity',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'CHAT',
        name: 'Team Chat',
        description: 'Internal communication tools',
        category: 'Communication',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'GOOGLE_MEET',
        name: 'Google Meet Integration',
        description: 'Enable Google Meet video conference creation and integration',
        category: 'Integrations',
        type: 'BOOLEAN',
        unit: 'NONE',
    },
    {
        key: 'MS_TEAMS',
        name: 'Microsoft Teams Integration',
        description: 'Enable Microsoft Teams video conference creation and integration',
        category: 'Integrations',
        type: 'BOOLEAN',
        unit: 'NONE',
    }
];

const seedFeatures = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI as string);
        console.log('📦 Connected to MongoDB');

        console.log('Syncing features (adding missing ones)...');
        for (const f of initialFeatures) {
            const existing = await Feature.findOne({ key: f.key });
            if (!existing) {
                await Feature.create({ ...f, isActive: true } as any);
                console.log(`+ Added feature: ${f.key}`);
            }
        }

        console.log('✅ Seeding complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
};

seedFeatures();
