import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Permission } from '../src/modules/permissions/permission.model';
import { IPermission } from '../src/modules/permissions/permission.types';
import { Role } from '../src/modules/roles/role.model';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/worksphere_test';

const seedPermissions = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        // 1. Mark existing system permissions correctly
        const systemPrefixes = ['COMPANY_', 'SUBSCRIPTION_', 'PLAN_', 'FEATURE_'];
        const systemRegex = new RegExp(`^(${systemPrefixes.join('|')})`, 'i');

        const systemUpdateResult = await Permission.updateMany(
            { name: { $regex: systemRegex } },
            { 
                $set: { 
                    scope: 'SYSTEM', 
                    assignableBy: ['SUPER_ADMIN'],
                    category: 'COMPANY_MANAGEMENT' 
                } 
            }
        );
        console.log(`Updated ${systemUpdateResult.modifiedCount} system permissions.`);

        // 2. Define the new granular member permissions
        const memberPermissions: IPermission[] = [
            // DASHBOARD
            { name: 'DASHBOARD_READ', description: 'View the dashboard', category: 'GENERAL', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },

            // PROJECTS
            { name: 'PROJECT_READ', description: 'View projects', category: 'PROJECTS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'PROJECT_CREATE', description: 'Create projects', category: 'PROJECTS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'PROJECT_UPDATE', description: 'Update projects', category: 'PROJECTS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'PROJECT_DELETE', description: 'Delete projects', category: 'PROJECTS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },

            // TASKS
            { name: 'TASK_READ', description: 'View tasks', category: 'TASKS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'TASK_CREATE', description: 'Create tasks', category: 'TASKS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'TASK_UPDATE', description: 'Update tasks', category: 'TASKS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'TASK_DELETE', description: 'Delete tasks', category: 'TASKS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'TASK_ASSIGN', description: 'Assign tasks to users', category: 'TASKS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },

            // MEETINGS
            { name: 'MEETING_READ', description: 'View meetings', category: 'MEETINGS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'MEETING_CREATE', description: 'Create meetings', category: 'MEETINGS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'MEETING_UPDATE', description: 'Update meetings', category: 'MEETINGS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'MEETING_DELETE', description: 'Delete meetings', category: 'MEETINGS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'QUICK_MEETING_CREATE', description: 'Create quick meetings and invite anyone', category: 'MEETINGS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'MEETING_INVITE_ANYONE', description: 'Invite anyone in the company to a meeting', category: 'MEETINGS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },

            // REPORTS
            { name: 'REPORT_READ', description: 'View reports', category: 'REPORTS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            { name: 'REPORT_EXPORT', description: 'Export reports', category: 'REPORTS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },

            // MONITORING
            { name: 'LIVE_MONITORING_READ', description: 'View live monitoring', category: 'MONITORING', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },

            // USERS
            { name: 'USER_REVIEW_READ', description: 'View user reviews', category: 'USERS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
            
            // PERMISSIONS MANAGEMENT
            { name: 'USER_PERMISSIONS_MANAGE', description: 'Manage access and permissions for company members', category: 'USERS', scope: 'COMPANY_MEMBER', assignableBy: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
        ];

        let insertedCount = 0;
        let updatedCount = 0;
        const memberPermissionDocs = [];

        for (const p of memberPermissions) {
            const existing = await Permission.findOne({ name: p.name });
            if (!existing) {
                const newPerm = await Permission.create(p);
                memberPermissionDocs.push(newPerm);
                insertedCount++;
            } else {
                await Permission.updateOne({ _id: existing._id }, { $set: p });
                memberPermissionDocs.push(existing);
                updatedCount++;
            }
        }

        console.log(`Successfully seeded granular member permissions. Inserted: ${insertedCount}, Updated: ${updatedCount}`);

        // 3. Assign all member permissions to the default COMPANY_ADMIN role to prevent lockout
        const companyAdminRole = await Role.findOne({ name: 'COMPANY_ADMIN' });
        if (companyAdminRole) {
            const permIds = memberPermissionDocs.map(doc => doc._id);
            await Role.updateOne(
                { _id: companyAdminRole._id },
                { $set: { permissions: permIds } }
            );
            console.log('Successfully assigned all member permissions to COMPANY_ADMIN role.');
        } else {
            console.log('COMPANY_ADMIN role not found. Skipping permission assignment.');
        }

        process.exit(0);
    } catch (error) {
        console.error('Error seeding permissions:', error);
        process.exit(1);
    }
};

seedPermissions();
