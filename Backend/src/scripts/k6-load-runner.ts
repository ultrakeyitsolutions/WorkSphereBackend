import dotenv from 'dotenv';
import http from 'http';
import mongoose from 'mongoose';
import { spawn } from 'child_process';
import { connectDatabase } from '../config/database';
import { app } from '../app';
import { Company } from '../modules/super-admin/companies/company.model';
import { Project } from '../modules/companyadmin/projects/project.model';
import { ProjectType, ProjectPriority, ProjectStatus } from '../modules/companyadmin/projects/project.types';
import { User } from '../modules/users/user.model';
import { Role } from '../modules/roles/role.model';
import { Task, TaskPriority, TaskCriticality, TaskType } from '../modules/tasks/task.model';
import { Wishlist } from '../modules/wishlist/wishlist.model';
import { WishlistStatus, WishlistPriority } from '../modules/wishlist/wishlist.types';
import { Sprint } from '../modules/sprints/sprint.model';
import { SprintStatus } from '../modules/sprints/sprint.types';
import { Release } from '../modules/releases/release.model';
import { ReleaseStatus } from '../modules/releases/release.types';
import { generateAccessToken } from '../utils/tokens';
import { hashPassword } from '../utils/password';

dotenv.config();

export const runK6LoadTest = async () => {
    console.log('===============================================================');
    console.log(' 🔥 WorkSphere k6 Production Load Test Runner');
    console.log('===============================================================\n');

    await connectDatabase();

    // 1. Start Server on port 5050
    const PORT = 5050;
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', () => resolve()));
    console.log(`📡 Backend Server listening on http://127.0.0.1:${PORT}`);

    // 2. Setup Test Account & Data
    console.log('📦 Setting up benchmark test project & credentials...');
    const timestamp = Date.now();
    const company = await Company.create({
        name: `K6 Load Corp ${timestamp}`,
        slug: `k6-corp-${timestamp}`,
        isActive: true,
        status: 'ACTIVE',
    });

    let companyAdminRole = await Role.findOne({ name: 'Company Admin' });
    if (!companyAdminRole) {
        companyAdminRole = await Role.findOne({});
    }
    const roleId = companyAdminRole ? companyAdminRole._id : new mongoose.Types.ObjectId();

    const hashedPassword = await hashPassword('K6Password123!');
    const user = await User.create({
        companyId: company._id,
        name: 'K6 Admin',
        email: `k6_admin_${timestamp}@test.com`,
        password: hashedPassword,
        role: roleId,
        isActive: true,
        status: 'ACTIVE',
    });

    const accessToken = generateAccessToken({
        userId: user._id.toString(),
        companyId: company._id.toString(),
        email: user.email,
        role: 'COMPANY_ADMIN',
    });

    const project = await Project.create({
        companyId: company._id,
        name: `K6 Benchmark Target ${timestamp}`,
        description: 'Target project for k6 load testing',
        type: ProjectType.INTERNAL,
        priority: ProjectPriority.HIGH,
        status: ProjectStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        createdById: user._id,
        isActive: true,
        isArchived: false,
    });

    const projectId = project._id.toString();

    // Seed 5 Sprints, 5 Releases, 20 Wishlist items, 50 Tasks
    const sprintDocs: any[] = [];
    for (let s = 1; s <= 5; s++) {
        sprintDocs.push({
            companyId: company._id,
            projectId: project._id,
            name: `Sprint ${s}`,
            goal: `Goal ${s}`,
            startDate: new Date(),
            endDate: new Date(Date.now() + 14 * 86400000),
            status: s === 1 ? SprintStatus.ACTIVE : SprintStatus.PLANNED,
            createdBy: user._id,
        });
    }
    const createdSprints: any[] = await Sprint.insertMany(sprintDocs);

    const releaseDocs: any[] = [];
    for (let r = 1; r <= 5; r++) {
        releaseDocs.push({
            companyId: company._id,
            projectId: project._id,
            name: `Release v${r}.0`,
            version: `v${r}.0.${timestamp}`,
            description: `Release ${r}`,
            startDate: new Date(),
            targetDate: new Date(Date.now() + 30 * 86400000),
            status: r === 1 ? ReleaseStatus.IN_PROGRESS : ReleaseStatus.PLANNED,
            sprintIds: [createdSprints[0]._id],
            createdBy: user._id,
        });
    }
    const createdReleases: any[] = await Release.insertMany(releaseDocs);

    const wishlistDocs: any[] = [];
    for (let w = 1; w <= 20; w++) {
        wishlistDocs.push({
            companyId: company._id,
            projectId: project._id,
            title: `Wishlist Idea ${w}`,
            description: `Description ${w}`,
            status: WishlistStatus.APPROVED,
            priority: WishlistPriority.HIGH,
            createdBy: user._id,
        });
    }
    await Wishlist.insertMany(wishlistDocs);

    const taskDocs: any[] = [];
    for (let t = 1; t <= 50; t++) {
        taskDocs.push({
            companyId: company._id,
            projectId: project._id,
            sprintId: createdSprints[t % createdSprints.length]._id,
            releaseId: createdReleases[t % createdReleases.length]._id,
            title: `Task ${t}`,
            itemNumber: t,
            taskNumber: `TASK-${t}`,
            priority: TaskPriority.MEDIUM,
            taskType: TaskType.TASK,
            criticality: TaskCriticality.NON_CRITICAL,
            progress: 50,
            assignedToId: user._id,
            createdBy: user._id,
            estimatedTime: { hours: 4, minutes: 0 },
            isActive: true,
            isArchived: false,
        });
    }
    await Task.insertMany(taskDocs);

    console.log(`✅ Data setup ready: Project ID = ${projectId}\n`);

    // 3. Prepare k6 runner options
    const targetScript = process.argv[2] || 'load-tests/quick-load.js';
    console.log(`🚀 Executing k6 against ${targetScript}...\n`);

    const k6Process = spawn('k6', ['run', targetScript], {
        stdio: 'inherit',
        shell: true,
        env: {
            ...process.env,
            LOAD_TEST: 'true',
            BASE_URL: `http://127.0.0.1:${PORT}/api`,
            AUTH_TOKEN: `Bearer ${accessToken}`,
            PROJECT_ID: projectId,
        },
    });

    k6Process.on('close', async (code) => {
        console.log(`\n🏁 k6 process completed (exit code: ${code})`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        server.close();
        try {
            await mongoose.disconnect();
        } catch (_) {}
        process.exit(code || 0);
    });
};

if (require.main === module || process.argv[1]?.includes('k6-load-runner')) {
    runK6LoadTest().catch((err) => {
        console.error('k6 runner error:', err);
        process.exit(1);
    });
}
