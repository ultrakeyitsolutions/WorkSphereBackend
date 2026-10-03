import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Custom Performance Metrics ──────────────────────────────────────────────
export const errorRate = new Rate('error_rate');
export const wishlistDuration = new Trend('wishlist_req_duration', true);
export const sprintDuration = new Trend('sprint_req_duration', true);
export const releaseDuration = new Trend('release_req_duration', true);
export const taskAssignDuration = new Trend('task_assign_duration', true);
export const summaryDuration = new Trend('summary_req_duration', true);

// ─── Environment Configuration & Safety Guard ─────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'Bearer test_token';
const PROJECT_ID = __ENV.PROJECT_ID || '507f1f77bcf86cd799439015';

// Safety Guard: Require explicit LOAD_TEST confirmation to prevent accidental production attacks
if (__ENV.LOAD_TEST !== 'true') {
    console.error('Safety Guard: Set LOAD_TEST=true to execute load testing.');
}

// ─── Load Test Staging Profile (100 up to 200,000 Virtual Users) ───────────────
export const options = {
    scenarios: {
        staged_load_test: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                // Stage 1: Baseline 100 VUs
                { duration: '30s', target: 100 },
                { duration: '1m', target: 100 },
                // Stage 2: Scale to 1,000 VUs
                { duration: '30s', target: 1000 },
                { duration: '1m', target: 1000 },
                // Stage 3: Scale to 5,000 VUs
                { duration: '30s', target: 5000 },
                { duration: '1m', target: 5000 },
                // Stage 4: Scale to 10,000 VUs
                { duration: '30s', target: 10000 },
                { duration: '1m', target: 10000 },
                // Stage 5: Scale to 25,000 VUs
                { duration: '30s', target: 25000 },
                { duration: '1m', target: 25000 },
                // Stage 6: Scale to 50,000 VUs
                { duration: '30s', target: 50000 },
                { duration: '1m', target: 50000 },
                // Stage 7: Scale to 100,000 VUs
                { duration: '30s', target: 100000 },
                { duration: '1m', target: 100000 },
                // Stage 8: Scale to 200,000 VUs
                { duration: '30s', target: 200000 },
                { duration: '1m', target: 200000 },
                // Ramp-down
                { duration: '1m', target: 0 },
            ],
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<500', 'p(99)<1000'],
        error_rate: ['rate<0.01'], // error rate < 1%
    },
};

const headers = {
    'Content-Type': 'application/json',
    Authorization: AUTH_TOKEN,
};

export default function () {
    const randomSuffix = Math.floor(Math.random() * 1000000);

    // Scenario 1: Wishlist Queries and Creation
    group('Wishlist Flow', function () {
        // GET Wishlist list
        const getRes = http.get(`${BASE_URL}/projects/${PROJECT_ID}/wishlist?page=1&limit=20`, { headers });
        wishlistDuration.add(getRes.timings.duration);
        const getCheck = check(getRes, {
            'GET wishlist status is 200': (r) => r.status === 200,
        });
        errorRate.add(!getCheck);

        // GET Wishlist Summary
        const summaryRes = http.get(`${BASE_URL}/projects/${PROJECT_ID}/wishlist/summary`, { headers });
        summaryDuration.add(summaryRes.timings.duration);
        check(summaryRes, { 'GET wishlist summary is 200': (r) => r.status === 200 });

        // CREATE Wishlist item
        const payload = JSON.stringify({
            title: `Load Test Idea ${randomSuffix}`,
            description: 'Automated performance benchmark feature idea',
            priority: 'HIGH',
        });
        const postRes = http.post(`${BASE_URL}/projects/${PROJECT_ID}/wishlist`, payload, { headers });
        wishlistDuration.add(postRes.timings.duration);
        const postCheck = check(postRes, {
            'POST wishlist status is 201': (r) => r.status === 201,
        });
        errorRate.add(!postCheck);
    });

    // Scenario 2: Sprints Queries and Management
    group('Sprint Flow', function () {
        // GET Sprints
        const getRes = http.get(`${BASE_URL}/projects/${PROJECT_ID}/sprints?page=1&limit=20`, { headers });
        sprintDuration.add(getRes.timings.duration);
        check(getRes, { 'GET sprints status is 200': (r) => r.status === 200 });

        // CREATE Sprint
        const sprintPayload = JSON.stringify({
            name: `Load Sprint ${randomSuffix}`,
            goal: 'Benchmark sprint creation velocity',
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        });
        const postRes = http.post(`${BASE_URL}/projects/${PROJECT_ID}/sprints`, sprintPayload, { headers });
        sprintDuration.add(postRes.timings.duration);
        check(postRes, { 'POST sprint status is 201': (r) => r.status === 201 });
    });

    // Scenario 3: Releases Queries and Management
    group('Release Flow', function () {
        // GET Releases
        const getRes = http.get(`${BASE_URL}/projects/${PROJECT_ID}/releases?page=1&limit=20`, { headers });
        releaseDuration.add(getRes.timings.duration);
        check(getRes, { 'GET releases status is 200': (r) => r.status === 200 });

        // CREATE Release
        const releasePayload = JSON.stringify({
            name: `Release v${randomSuffix}`,
            version: `v${randomSuffix}.0`,
            targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
        const postRes = http.post(`${BASE_URL}/projects/${PROJECT_ID}/releases`, releasePayload, { headers });
        releaseDuration.add(postRes.timings.duration);
        check(postRes, { 'POST release status is 201': (r) => r.status === 201 });
    });

    // Scenario 4: Concurrent Project Task Querying with Filters
    group('Project Task Queries', function () {
        const taskRes = http.get(`${BASE_URL}/projects/${PROJECT_ID}/tasks?page=1&limit=50&priority=MEDIUM`, { headers });
        check(taskRes, { 'GET project tasks is 200': (r) => r.status === 200 });
    });

    sleep(1);
}
