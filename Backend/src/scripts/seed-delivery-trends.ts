import mongoose, { Types } from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { connectDatabase } from '../config/database';
import { User } from '../modules/users/user.model';
import { Company } from '../modules/super-admin/companies/company.model';
import { Task } from '../modules/tasks/task.model';
import { Status } from '../modules/tasks/status.model';
import { DeliveryTrendsAnalytics } from '../modules/dashboard/analytics/delivery-trends.analytics';
import { DashboardDateRangeService } from '../modules/dashboard/services/dashboard-date-range.service';

export async function seedDeliveryTrends(targetEmailArg?: string) {
    const targetEmail = targetEmailArg || process.env.QA_TARGET_EMAIL || 'manoharyalla83@gmail.com';

    console.log('\n================================================================');
    console.log('    UWORKSPHERE DELIVERY TRENDS DUMMY DATA SEEDING ENGINE');
    console.log('================================================================');

    await connectDatabase();

    // 1. Identify Target Admin & Company
    const adminUser = await User.findOne({ email: targetEmail });
    if (!adminUser) {
        throw new Error(`Target Admin user '${targetEmail}' not found.`);
    }

    const companyId = adminUser.companyId;
    const company = await Company.findById(companyId);
    if (!company) {
        throw new Error(`Company for admin '${targetEmail}' not found.`);
    }

    console.log(`🏢 Organization: ${company.name} (${companyId})`);
    console.log(`👤 Target Admin: ${adminUser.name} <${adminUser.email}>`);

    // 2. Query Existing Tasks
    const allTasks = await Task.find({
        companyId,
        isArchived: { $ne: true },
        isDeleted: { $ne: true }
    })
        .populate('statusId', 'name isCompleted')
        .sort({ createdAt: 1 });

    console.log(`\n📋 Found ${allTasks.length} tasks registered for organization.`);

    const now = new Date();
    const nowMs = now.getTime();

    // Categorize tasks into completed vs open
    const completedTasks = allTasks.filter(
        (t) => t.progress === 100 || (t.statusId as any)?.isCompleted === true || (t.statusId as any)?.name === 'Completed'
    );
    const inProgressTasks = allTasks.filter(
        (t) => (t.statusId as any)?.name === 'In Progress'
    );
    const todoTasks = allTasks.filter(
        (t) => (t.statusId as any)?.name === 'To Do'
    );
    const reviewTasks = allTasks.filter(
        (t) => (t.statusId as any)?.name === 'In Review'
    );
    const blockedTasks = allTasks.filter(
        (t) => (t.statusId as any)?.name === 'Blocked'
    );

    console.log(`   - Completed:   ${completedTasks.length}`);
    console.log(`   - In Progress: ${inProgressTasks.length}`);
    console.log(`   - To Do:       ${todoTasks.length}`);
    console.log(`   - In Review:   ${reviewTasks.length}`);
    console.log(`   - Blocked:     ${blockedTasks.length}`);

    console.log('\n⚙️  Applying 90-Day Rolling Timeline & Delivery Trends Backfill...');

    // 3. Distribute Completed Tasks across the last 88 days up to today
    const totalComp = completedTasks.length;
    const taskUpdates: Promise<any>[] = [];

    for (let i = 0; i < totalComp; i++) {
        const task = completedTasks[i];
        // Stagger completion evenly from day -88 to 0 (today)
        const dayOffset = -88 + (i * (88 / Math.max(1, totalComp - 1)));
        const compDate = new Date(nowMs + dayOffset * 24 * 60 * 60 * 1000);
        compDate.setHours(9 + (i % 9), (i * 7) % 60, 0, 0);

        let dueDate: Date;
        if (i % 7 === 0) {
            // Delayed delivery (14%): completed 1-3 days after due date
            dueDate = new Date(compDate.getTime() - (1 + (i % 3)) * 24 * 60 * 60 * 1000);
        } else {
            // On-time delivery (86%): completed on or before due date
            dueDate = new Date(compDate.getTime() + (i % 3) * 24 * 60 * 60 * 1000);
        }

        const createdAt = new Date(dueDate.getTime() - (4 + (i % 10)) * 24 * 60 * 60 * 1000);

        taskUpdates.push(
            Task.updateOne(
                { _id: task._id },
                {
                    $set: {
                        startDate: createdAt,
                        dueDate,
                        deliveryDate: compDate,
                        completedDate: compDate,
                        progress: 100,
                        updatedAt: compDate,
                    }
                }
            )
        );
    }

    // 4. Update In Progress Tasks (some overdue, some active/upcoming)
    for (let i = 0; i < inProgressTasks.length; i++) {
        const task = inProgressTasks[i];
        const createdAt = new Date(nowMs - (4 + (i % 14)) * 24 * 60 * 60 * 1000);
        let dueDate: Date;
        if (i % 4 === 0) {
            // Overdue by 1-4 days
            dueDate = new Date(nowMs - (1 + (i % 4)) * 24 * 60 * 60 * 1000);
        } else {
            // Upcoming in 2-10 days
            dueDate = new Date(nowMs + (2 + (i % 9)) * 24 * 60 * 60 * 1000);
        }

        taskUpdates.push(
            Task.updateOne(
                { _id: task._id },
                {
                    $set: {
                        startDate: createdAt,
                        dueDate,
                        deliveryDate: null,
                        completedDate: null,
                        progress: 25 + (i % 5) * 12,
                        updatedAt: new Date(nowMs - (i % 3) * 3600 * 1000),
                    }
                }
            )
        );
    }

    // 5. Update To Do Tasks (future due dates)
    for (let i = 0; i < todoTasks.length; i++) {
        const task = todoTasks[i];
        const createdAt = new Date(nowMs - (1 + (i % 6)) * 24 * 60 * 60 * 1000);
        const dueDate = new Date(nowMs + (4 + (i % 12)) * 24 * 60 * 60 * 1000);

        taskUpdates.push(
            Task.updateOne(
                { _id: task._id },
                {
                    $set: {
                        startDate: createdAt,
                        dueDate,
                        deliveryDate: null,
                        completedDate: null,
                        progress: 0,
                    }
                }
            )
        );
    }

    // 6. Update In Review Tasks
    for (let i = 0; i < reviewTasks.length; i++) {
        const task = reviewTasks[i];
        const createdAt = new Date(nowMs - (3 + (i % 6)) * 24 * 60 * 60 * 1000);
        const dueDate = new Date(nowMs + (1 + (i % 3)) * 24 * 60 * 60 * 1000);

        taskUpdates.push(
            Task.updateOne(
                { _id: task._id },
                {
                    $set: {
                        startDate: createdAt,
                        dueDate,
                        deliveryDate: null,
                        completedDate: null,
                        progress: 90,
                    }
                }
            )
        );
    }

    // 7. Update Blocked Tasks (critical overdue)
    for (let i = 0; i < blockedTasks.length; i++) {
        const task = blockedTasks[i];
        const createdAt = new Date(nowMs - (2 + (i % 5)) * 24 * 60 * 60 * 1000);
        const dueDate = new Date(nowMs - (1 + (i % 3)) * 24 * 60 * 60 * 1000);

        taskUpdates.push(
            Task.updateOne(
                { _id: task._id },
                {
                    $set: {
                        startDate: createdAt,
                        dueDate,
                        deliveryDate: null,
                        completedDate: null,
                        progress: 35,
                    }
                }
            )
        );
    }

    await Promise.all(taskUpdates);
    console.log(`✅ Successfully updated ${taskUpdates.length} tasks with delivery and completion dates.\n`);

    // 8. Test and Display Delivery Trends Analytics Across All Standard Periods
    console.log('📊 [Verification] Querying Delivery Trends API (DeliveryTrendsAnalytics)...');

    const testPeriods: Array<{ period: any; interval?: 'day' | 'week' | 'month'; title: string }> = [
        { period: 'today', interval: 'day', title: 'Today (Daily)' },
        { period: 'last_7_days', interval: 'day', title: 'Last 7 Days (Daily)' },
        { period: 'this_week', interval: 'day', title: 'This Week (Daily)' },
        { period: 'this_month', interval: 'day', title: 'This Month (Daily)' },
        { period: 'last_30_days', interval: 'day', title: 'Last 30 Days (Daily)' },
        { period: 'last_month', interval: 'week', title: 'Last Month (Weekly)' },
        { period: 'last_3_months', interval: 'month', title: 'Last 3 Months (Monthly)' },
    ];

    for (const item of testPeriods) {
        const dateRange = DashboardDateRangeService.resolve({ period: item.period }, company.timezone);
        const trends = await DeliveryTrendsAnalytics.getTrends(companyId as any, dateRange, item.interval);

        console.log(`\n🔹 Period: ${item.title}`);
        console.log(`   - Date Range: ${dateRange.startDateStr} to ${dateRange.endDateStr}`);
        console.log(`   - Planned Tasks:   ${trends.summary.totalPlanned}`);
        console.log(`   - Completed Tasks: ${trends.summary.totalCompleted}`);
        console.log(`   - Completion Rate: ${trends.summary.overallCompletionRate ?? 0}%`);
        console.log(`   - Buckets Count:   ${trends.buckets.length}`);

        // Print sample 3 buckets
        const sampleBuckets = trends.buckets.slice(-3);
        console.log('   - Recent Buckets Sample:');
        for (const b of sampleBuckets) {
            console.log(`     * [${b.date || b.label}] Planned: ${b.plannedTasks}, Completed: ${b.completedTasks}, Rate: ${b.completionRate ?? 0}%`);
        }
    }

    console.log('\n================================================================');
    console.log('  DELIVERY TRENDS SEEDING & VALIDATION COMPLETED SUCCESSFULLY!');
    console.log('================================================================\n');

    process.exit(0);
}

if (require.main === module) {
    const targetEmail = process.argv.find((arg) => arg.startsWith('--target-email='))?.split('=')[1];
    seedDeliveryTrends(targetEmail).catch((err) => {
        console.error('❌ Error seeding delivery trends:', err);
        process.exit(1);
    });
}

