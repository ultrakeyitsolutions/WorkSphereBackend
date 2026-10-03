import dotenv from 'dotenv';
import mongoose, { Types } from 'mongoose';
import { connectDatabase } from '../config/database';
import { Company } from '../modules/super-admin/companies/company.model';
import { Project } from '../modules/companyadmin/projects/project.model';
import { ProjectType, ProjectPriority, ProjectStatus } from '../modules/companyadmin/projects/project.types';
import { User } from '../modules/users/user.model';
import { Task, TaskPriority, TaskCriticality, TaskType } from '../modules/tasks/task.model';
import { Wishlist } from '../modules/wishlist/wishlist.model';
import { WishlistStatus, WishlistPriority } from '../modules/wishlist/wishlist.types';
import { Sprint } from '../modules/sprints/sprint.model';
import { SprintStatus } from '../modules/sprints/sprint.types';
import { Release } from '../modules/releases/release.model';
import { ReleaseStatus } from '../modules/releases/release.types';
import { hashPassword } from '../utils/password';

dotenv.config();

export const seedWishlistSprintRelease = async () => {
    console.log('🚀 Starting Scalable Test Data Generator...');

    const SEED_COMPANIES = parseInt(process.env.SEED_COMPANIES || '2', 10);
    const SEED_PROJECTS_PER_COMPANY = parseInt(process.env.SEED_PROJECTS_PER_COMPANY || '3', 10);
    const SEED_USERS_PER_COMPANY = parseInt(process.env.SEED_USERS_PER_COMPANY || '5', 10);
    const SEED_WISHLIST_PER_PROJECT = parseInt(process.env.SEED_WISHLIST_PER_PROJECT || '15', 10);
    const SEED_SPRINTS_PER_PROJECT = parseInt(process.env.SEED_SPRINTS_PER_PROJECT || '4', 10);
    const SEED_RELEASES_PER_PROJECT = parseInt(process.env.SEED_RELEASES_PER_PROJECT || '3', 10);
    const SEED_TASKS_PER_PROJECT = parseInt(process.env.SEED_TASKS_PER_PROJECT || '50', 10);

    await connectDatabase();

    const hashedPassword = await hashPassword('TestPassword123!');

    for (let c = 1; c <= SEED_COMPANIES; c++) {
        const companyName = `Test Enterprise ${c} (${Date.now()})`;
        const company = await Company.create({
            name: companyName,
            slug: `test-corp-${c}-${Date.now()}`,
            isActive: true,
            status: 'ACTIVE',
        });

        console.log(`\n🏢 Created Company: ${company.name} [${company._id}]`);

        // Create Users in bulk
        const userDocs: any[] = [];
        for (let u = 1; u <= SEED_USERS_PER_COMPANY; u++) {
            userDocs.push({
                companyId: company._id,
                name: `User ${u} - Corp ${c}`,
                email: `user${u}_corp${c}_${Date.now()}@worksphere-test.com`,
                password: hashedPassword,
                isActive: true,
                status: 'ACTIVE',
            });
        }
        const createdUsers: any[] = await User.insertMany(userDocs);
        const adminUser = createdUsers[0];

        // Create Projects
        for (let p = 1; p <= SEED_PROJECTS_PER_COMPANY; p++) {
            const project = await Project.create({
                companyId: company._id,
                name: `Project Alpha ${p} - Corp ${c}`,
                description: `Production engineering project ${p}`,
                type: ProjectType.INTERNAL,
                priority: ProjectPriority.HIGH,
                status: ProjectStatus.ACTIVE,
                startDate: new Date('2026-01-01'),
                endDate: new Date('2026-12-31'),
                createdById: adminUser._id,
                isActive: true,
                isArchived: false,
            });

            console.log(`  📁 Project: "${project.name}" [${project._id}]`);

            // Seed Sprints in Bulk
            const sprintDocs: any[] = [];
            for (let s = 1; s <= SEED_SPRINTS_PER_PROJECT; s++) {
                const sStart = new Date(Date.now() + (s - 2) * 14 * 24 * 60 * 60 * 1000);
                const sEnd = new Date(sStart.getTime() + 14 * 24 * 60 * 60 * 1000);
                const status = s === 2 ? SprintStatus.ACTIVE : s < 2 ? SprintStatus.COMPLETED : SprintStatus.PLANNED;

                sprintDocs.push({
                    companyId: company._id,
                    projectId: project._id,
                    name: `Sprint ${s} (${project.name})`,
                    goal: `Deliver milestone ${s} features and stabilization`,
                    startDate: sStart,
                    endDate: sEnd,
                    status,
                    createdBy: adminUser._id,
                });
            }
            const createdSprints: any[] = await Sprint.insertMany(sprintDocs);

            // Seed Releases in Bulk
            const releaseDocs: any[] = [];
            for (let r = 1; r <= SEED_RELEASES_PER_PROJECT; r++) {
                const rStart = new Date(Date.now() + (r - 1) * 30 * 24 * 60 * 60 * 1000);
                const rTarget = new Date(rStart.getTime() + 30 * 24 * 60 * 60 * 1000);
                const version = `v${r}.0.${Date.now().toString().slice(-4)}`;
                const status = r === 1 ? ReleaseStatus.IN_PROGRESS : ReleaseStatus.PLANNED;

                releaseDocs.push({
                    companyId: company._id,
                    projectId: project._id,
                    name: `Release ${version}`,
                    version,
                    description: `Major release delivery for milestone ${r}`,
                    startDate: rStart,
                    targetDate: rTarget,
                    status,
                    sprintIds: [createdSprints[0]._id],
                    createdBy: adminUser._id,
                });
            }
            const createdReleases: any[] = await Release.insertMany(releaseDocs);

            // Seed Wishlist in Bulk
            const wishlistDocs: any[] = [];
            const wishlistTitles = [
                'Dark Mode Support',
                'Excel Export Generator',
                'AI Task Assistant',
                'WhatsApp Notifications',
                'Offline Mobile Sync',
                'Multi-Currency Billing',
                'Custom Webhooks Integration',
                'Automated Meeting Transcripts',
                'Kanban Swimlanes Customizer',
                'Single Sign-On (SAML)',
            ];

            for (let w = 0; w < SEED_WISHLIST_PER_PROJECT; w++) {
                const title = `${wishlistTitles[w % wishlistTitles.length]} (#${w + 1})`;
                const status = w % 5 === 0 ? WishlistStatus.APPROVED
                    : w % 5 === 1 ? WishlistStatus.UNDER_REVIEW
                    : w % 5 === 2 ? WishlistStatus.IDEA
                    : w % 5 === 3 ? WishlistStatus.REJECTED
                    : WishlistStatus.IDEA;

                wishlistDocs.push({
                    companyId: company._id,
                    projectId: project._id,
                    title,
                    description: `Detailed proposal for ${title}`,
                    status,
                    priority: w % 2 === 0 ? WishlistPriority.HIGH : WishlistPriority.MEDIUM,
                    tags: ['feature-request', 'ui-ux', 'performance'],
                    createdBy: adminUser._id,
                });
            }
            await Wishlist.insertMany(wishlistDocs);

            // Seed Tasks in Bulk with Sprint and Release Links
            const taskBulkOps = [];
            for (let t = 1; t <= SEED_TASKS_PER_PROJECT; t++) {
                const assignedSprint = createdSprints[t % createdSprints.length];
                const assignedRelease = createdReleases[t % createdReleases.length];
                const assignee = createdUsers[t % createdUsers.length];
                const isDone = t % 3 === 0;

                taskBulkOps.push({
                    insertOne: {
                        document: {
                            companyId: company._id,
                            projectId: project._id,
                            sprintId: assignedSprint ? assignedSprint._id : null,
                            releaseId: assignedRelease ? assignedRelease._id : null,
                            title: `Task #${t}: Implement module logic for ${project.name}`,
                            itemNumber: t,
                            taskNumber: `TASK-${t}`,
                            priority: t % 4 === 0 ? TaskPriority.URGENT : TaskPriority.MEDIUM,
                            taskType: TaskType.TASK,
                            criticality: TaskCriticality.NON_CRITICAL,
                            progress: isDone ? 100 : (t % 2 === 0 ? 50 : 0),
                            completedDate: isDone ? new Date() : undefined,
                            assignedToId: assignee._id,
                            createdBy: adminUser._id,
                            estimatedTime: { hours: 4, minutes: 0 },
                            actualHours: isDone ? 4 : 2,
                            isActive: true,
                            isArchived: false,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        },
                    },
                });
            }
            await Task.bulkWrite(taskBulkOps);
            console.log(`    ✔ Generated ${SEED_WISHLIST_PER_PROJECT} wishlist items, ${SEED_SPRINTS_PER_PROJECT} sprints, ${SEED_RELEASES_PER_PROJECT} releases, and ${SEED_TASKS_PER_PROJECT} tasks.`);
        }
    }

    console.log('\n✅ Realistic test data seeding complete!');
    await mongoose.disconnect();
};

if (require.main === module || process.argv[1]?.includes('seed-wishlist-sprint-release')) {
    seedWishlistSprintRelease()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('Seeding error:', err);
            process.exit(1);
        });
}
