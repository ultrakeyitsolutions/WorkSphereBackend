import dotenv from 'dotenv';
import http from 'http';
import mongoose from 'mongoose';
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

interface EndpointMetric {
    name: string;
    method: string;
    path: string;
    latencies: number[];
    statusCodes: Record<number, number>;
    errors: number;
}

interface BenchmarkSummary {
    totalRequests: number;
    totalDurationMs: number;
    overallRps: number;
    successRate: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    avgLatency: number;
    minLatency: number;
    maxLatency: number;
    endpoints: Record<string, {
        method: string;
        path: string;
        requests: number;
        p50: number;
        p90: number;
        p95: number;
        p99: number;
        avg: number;
        min: number;
        max: number;
        successRate: number;
        statusCodes: Record<number, number>;
    }>;
}

const calculatePercentile = (sortedArr: number[], p: number): number => {
    if (sortedArr.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedArr.length) - 1;
    return sortedArr[Math.max(0, Math.min(index, sortedArr.length - 1))];
};

export const runBenchmark = async () => {
    console.log('===============================================================');
    console.log(' 🔥 WorkSphere Production Load & Performance Benchmark Suite');
    console.log('===============================================================\n');

    await connectDatabase();

    // 1. Setup in-process HTTP Server
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number; address: string };
    const baseUrl = `http://127.0.0.1:${address.port}`;
    console.log(`📡 In-Process Benchmark Server listening on ${baseUrl}`);

    // 2. Prepare Load Test Dataset
    console.log('📦 Provisioning isolated benchmark dataset...');
    const testTimestamp = Date.now();
    const company = await Company.create({
        name: `Benchmark Corp ${testTimestamp}`,
        slug: `benchmark-corp-${testTimestamp}`,
        isActive: true,
        status: 'ACTIVE',
    });

    const companyAdminRole = await Role.findOne({ name: 'Company Admin', isSystem: true });

    const hashedPassword = await hashPassword('Benchmark123!');
    const user = await User.create({
        companyId: company._id,
        name: 'Benchmark Admin',
        email: `bench_admin_${testTimestamp}@test.com`,
        password: hashedPassword,
        role: companyAdminRole ? companyAdminRole._id : new mongoose.Types.ObjectId(),
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
        name: `Benchmark Core Engine ${testTimestamp}`,
        description: 'High throughput load testing project target',
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

    // Seed 10 Sprints, 10 Releases, 50 Wishlist items, 200 Tasks
    const sprintDocs: any[] = [];
    for (let s = 1; s <= 10; s++) {
        sprintDocs.push({
            companyId: company._id,
            projectId: project._id,
            name: `Sprint ${s}`,
            goal: `Sprint goal ${s}`,
            startDate: new Date(),
            endDate: new Date(Date.now() + 14 * 86400000),
            status: s === 1 ? SprintStatus.ACTIVE : SprintStatus.PLANNED,
            createdBy: user._id,
        });
    }
    const createdSprints: any[] = await Sprint.insertMany(sprintDocs);

    const releaseDocs: any[] = [];
    for (let r = 1; r <= 10; r++) {
        releaseDocs.push({
            companyId: company._id,
            projectId: project._id,
            name: `Release v${r}.0`,
            version: `v${r}.0.${testTimestamp}`,
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
    for (let w = 1; w <= 50; w++) {
        wishlistDocs.push({
            companyId: company._id,
            projectId: project._id,
            title: `Feature Proposal #${w}`,
            description: `High load proposal item description ${w}`,
            status: WishlistStatus.APPROVED,
            priority: WishlistPriority.HIGH,
            tags: ['performance', 'backend'],
            createdBy: user._id,
        });
    }
    const createdWishlists: any[] = await Wishlist.insertMany(wishlistDocs);

    const taskDocs: any[] = [];
    for (let t = 1; t <= 150; t++) {
        taskDocs.push({
            companyId: company._id,
            projectId: project._id,
            sprintId: createdSprints[t % createdSprints.length]._id,
            releaseId: createdReleases[t % createdReleases.length]._id,
            title: `Benchmark Task #${t}`,
            itemNumber: t,
            taskNumber: `TASK-${t}`,
            priority: TaskPriority.MEDIUM,
            taskType: TaskType.TASK,
            criticality: TaskCriticality.NON_CRITICAL,
            progress: t % 2 === 0 ? 100 : 50,
            assignedToId: user._id,
            createdBy: user._id,
            estimatedTime: { hours: 4, minutes: 0 },
            isActive: true,
            isArchived: false,
        });
    }
    const createdTasks = await Task.insertMany(taskDocs);

    console.log(`✅ Seeded ${createdSprints.length} Sprints, ${createdReleases.length} Releases, ${createdWishlists.length} Wishlist Items, ${createdTasks.length} Tasks.\n`);

    // 3. Define Benchmark Scenarios
    const endpointMetrics: Record<string, EndpointMetric> = {
        'GET /wishlist': { name: 'List Wishlist Items (Filtered)', method: 'GET', path: `/api/projects/${projectId}/wishlist?status=APPROVED`, latencies: [], statusCodes: {}, errors: 0 },
        'POST /wishlist': { name: 'Create Wishlist Item', method: 'POST', path: `/api/projects/${projectId}/wishlist`, latencies: [], statusCodes: {}, errors: 0 },
        'POST /wishlist/convert-to-task': { name: 'Wishlist -> Task ACID Conversion', method: 'POST', path: `/api/projects/${projectId}/wishlist/{id}/convert-to-task`, latencies: [], statusCodes: {}, errors: 0 },
        'GET /sprints': { name: 'List Sprints with Task Aggregations', method: 'GET', path: `/api/projects/${projectId}/sprints`, latencies: [], statusCodes: {}, errors: 0 },
        'POST /sprints': { name: 'Create Planned Sprint', method: 'POST', path: `/api/projects/${projectId}/sprints`, latencies: [], statusCodes: {}, errors: 0 },
        'GET /releases': { name: 'List Releases with Progress Aggregations', method: 'GET', path: `/api/projects/${projectId}/releases`, latencies: [], statusCodes: {}, errors: 0 },
        'POST /releases': { name: 'Create Release Milestone', method: 'POST', path: `/api/projects/${projectId}/releases`, latencies: [], statusCodes: {}, errors: 0 },
        'POST /tasks/sprint': { name: 'Assign Task to Sprint', method: 'POST', path: `/api/projects/${projectId}/tasks/{taskId}/sprint`, latencies: [], statusCodes: {}, errors: 0 },
        'POST /tasks/release': { name: 'Assign Task to Release', method: 'POST', path: `/api/projects/${projectId}/tasks/{taskId}/release`, latencies: [], statusCodes: {}, errors: 0 },
        'POST /tasks/sprint-release': { name: 'Assign Task to Sprint & Release', method: 'POST', path: `/api/projects/${projectId}/tasks/{taskId}/sprint-release`, latencies: [], statusCodes: {}, errors: 0 },
    };

    const executeRequest = async (key: string, customPath?: string, body?: any): Promise<number> => {
        const metric = endpointMetrics[key];
        const targetPath = customPath || metric.path;
        const start = performance.now();

        try {
            const res = await fetch(`${baseUrl}${targetPath}`, {
                method: metric.method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: body ? JSON.stringify(body) : undefined,
            });

            const duration = performance.now() - start;
            metric.latencies.push(duration);
            metric.statusCodes[res.status] = (metric.statusCodes[res.status] || 0) + 1;
            if (!res.ok && res.status >= 500) {
                metric.errors++;
            }
            return duration;
        } catch {
            const duration = performance.now() - start;
            metric.latencies.push(duration);
            metric.errors++;
            metric.statusCodes[500] = (metric.statusCodes[500] || 0) + 1;
            return duration;
        }
    };

    // 4. Execution Stages: Warmup, Ramp-Up, High Concurrency Burst, Sustained Peak
    console.log('🚀 Executing Multi-Stage Concurrency & Stress Testing...\n');

    const TOTAL_REQUESTS_TARGET = 2000;
    const CONCURRENCY_WORKERS = 40; // 40 concurrent worker pipelines
    let wishlistSeq = 0;
    let sprintSeq = 0;
    let releaseSeq = 0;

    const runWorker = async (workerId: number, requestsPerWorker: number) => {
        for (let i = 0; i < requestsPerWorker; i++) {
            const opType = (workerId + i) % 10;
            const randomTask = createdTasks[Math.floor(Math.random() * createdTasks.length)];
            const randomSprint = createdSprints[Math.floor(Math.random() * createdSprints.length)];
            const randomRelease = createdReleases[Math.floor(Math.random() * createdReleases.length)];

            switch (opType) {
                case 0:
                case 1:
                    await executeRequest('GET /wishlist');
                    break;
                case 2:
                    wishlistSeq++;
                    await executeRequest('POST /wishlist', undefined, {
                        title: `Load Idea #${workerId}-${wishlistSeq}`,
                        description: 'Load test proposal payload for benchmarking',
                        priority: 'HIGH',
                        status: 'IDEA',
                    });
                    break;
                case 3:
                case 4:
                    await executeRequest('GET /sprints');
                    break;
                case 5:
                    sprintSeq++;
                    await executeRequest('POST /sprints', undefined, {
                        name: `Load Sprint W${workerId}-${sprintSeq}`,
                        goal: 'Verify sprint creation under load',
                        startDate: new Date(),
                        endDate: new Date(Date.now() + 14 * 86400000),
                    });
                    break;
                case 6:
                case 7:
                    await executeRequest('GET /releases');
                    break;
                case 8:
                    releaseSeq++;
                    await executeRequest('POST /releases', undefined, {
                        name: `Release W${workerId}-${releaseSeq}`,
                        version: `v${workerId}.${releaseSeq}.${Date.now().toString().slice(-4)}`,
                        description: 'Load release creation',
                        startDate: new Date(),
                        targetDate: new Date(Date.now() + 30 * 86400000),
                    });
                    break;
                case 9:
                    await executeRequest(
                        'POST /tasks/sprint-release',
                        `/api/projects/${projectId}/tasks/${randomTask._id}/sprint-release`,
                        {
                            sprintId: randomSprint._id.toString(),
                            releaseId: randomRelease._id.toString(),
                        }
                    );
                    break;
            }
        }
    };

    // Test a batch of ACID conversions specifically to measure transaction latency
    console.log('  ⚡ Testing Wishlist -> Task ACID Transaction conversions under concurrency...');
    const acidConversionPromises = createdWishlists.slice(0, 25).map((wItem) =>
        executeRequest(
            'POST /wishlist/convert-to-task',
            `/api/projects/${projectId}/wishlist/${wItem._id}/convert-to-task`,
            {
                priority: 'HIGH',
                taskType: 'TASK',
            }
        )
    );
    await Promise.all(acidConversionPromises);

    console.log(`  ⚡ Launching ${CONCURRENCY_WORKERS} concurrent worker threads (${TOTAL_REQUESTS_TARGET} total requests)...`);
    const startTime = performance.now();

    const requestsPerWorker = Math.floor(TOTAL_REQUESTS_TARGET / CONCURRENCY_WORKERS);
    const workerPromises = [];
    for (let w = 0; w < CONCURRENCY_WORKERS; w++) {
        workerPromises.push(runWorker(w, requestsPerWorker));
    }
    await Promise.all(workerPromises);

    const totalDurationMs = performance.now() - startTime;
    console.log(`\n✅ Benchmark run completed in ${(totalDurationMs / 1000).toFixed(2)}s\n`);

    // 5. Aggregate Results
    const allLatencies: number[] = [];
    let totalRequests = 0;
    let totalErrors = 0;

    const endpointSummaries: BenchmarkSummary['endpoints'] = {};

    for (const [key, metric] of Object.entries(endpointMetrics)) {
        metric.latencies.sort((a, b) => a - b);
        allLatencies.push(...metric.latencies);
        totalRequests += metric.latencies.length;
        totalErrors += metric.errors;

        const sum = metric.latencies.reduce((acc, v) => acc + v, 0);
        const avg = metric.latencies.length > 0 ? sum / metric.latencies.length : 0;
        const successCount = metric.latencies.length - metric.errors;

        endpointSummaries[key] = {
            method: metric.method,
            path: metric.path,
            requests: metric.latencies.length,
            p50: parseFloat(calculatePercentile(metric.latencies, 50).toFixed(2)),
            p90: parseFloat(calculatePercentile(metric.latencies, 90).toFixed(2)),
            p95: parseFloat(calculatePercentile(metric.latencies, 95).toFixed(2)),
            p99: parseFloat(calculatePercentile(metric.latencies, 99).toFixed(2)),
            avg: parseFloat(avg.toFixed(2)),
            min: parseFloat((metric.latencies[0] || 0).toFixed(2)),
            max: parseFloat((metric.latencies[metric.latencies.length - 1] || 0).toFixed(2)),
            successRate: metric.latencies.length > 0 ? parseFloat(((successCount / metric.latencies.length) * 100).toFixed(2)) : 100,
            statusCodes: metric.statusCodes,
        };
    }

    allLatencies.sort((a, b) => a - b);
    const totalLatencySum = allLatencies.reduce((acc, v) => acc + v, 0);
    const overallAvg = allLatencies.length > 0 ? totalLatencySum / allLatencies.length : 0;
    const overallRps = parseFloat(((totalRequests / totalDurationMs) * 1000).toFixed(2));
    const overallSuccessRate = parseFloat((((totalRequests - totalErrors) / totalRequests) * 100).toFixed(2));

    const overallSummary: BenchmarkSummary = {
        totalRequests,
        totalDurationMs: parseFloat(totalDurationMs.toFixed(2)),
        overallRps,
        successRate: overallSuccessRate,
        p50: parseFloat(calculatePercentile(allLatencies, 50).toFixed(2)),
        p90: parseFloat(calculatePercentile(allLatencies, 90).toFixed(2)),
        p95: parseFloat(calculatePercentile(allLatencies, 95).toFixed(2)),
        p99: parseFloat(calculatePercentile(allLatencies, 99).toFixed(2)),
        avgLatency: parseFloat(overallAvg.toFixed(2)),
        minLatency: parseFloat((allLatencies[0] || 0).toFixed(2)),
        maxLatency: parseFloat((allLatencies[allLatencies.length - 1] || 0).toFixed(2)),
        endpoints: endpointSummaries,
    };

    console.log('---------------------------------------------------------------');
    console.log(' 📊 BENCHMARK SUMMARY & METRICS');
    console.log('---------------------------------------------------------------');
    console.log(`Total Requests Processed: ${overallSummary.totalRequests}`);
    console.log(`Throughput (RPS):         ${overallSummary.overallRps} req/sec`);
    console.log(`Success Rate:             ${overallSummary.successRate}%`);
    console.log(`p50 Latency (Median):     ${overallSummary.p50} ms`);
    console.log(`p90 Latency:              ${overallSummary.p90} ms`);
    console.log(`p95 Latency:              ${overallSummary.p95} ms`);
    console.log(`p99 Latency:              ${overallSummary.p99} ms`);
    console.log(`Average Latency:          ${overallSummary.avgLatency} ms`);
    console.log(`Min / Max Latency:        ${overallSummary.minLatency} ms / ${overallSummary.maxLatency} ms\n`);

    console.log('---------------------------------------------------------------');
    console.log(' 📈 PER-ENDPOINT LATENCY BREAKDOWN (ms)');
    console.log('---------------------------------------------------------------');
    console.table(
        Object.entries(endpointSummaries).map(([name, data]) => ({
            Endpoint: name,
            Requests: data.requests,
            'p50 (ms)': data.p50,
            'p90 (ms)': data.p90,
            'p95 (ms)': data.p95,
            'p99 (ms)': data.p99,
            'Avg (ms)': data.avg,
            'Success %': data.successRate,
        }))
    );

    // Clean up server and db
    server.close();
    await mongoose.disconnect();

    console.log('\n🏁 Benchmark run finished cleanly.');
    return overallSummary;
};

if (require.main === module || process.argv[1]?.includes('run-load-benchmark')) {
    runBenchmark()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('Benchmark execution error:', err);
            process.exit(1);
        });
}
