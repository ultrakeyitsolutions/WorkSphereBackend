import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

export const errorRate = new Rate('error_rate');
export const wishlistDuration = new Trend('wishlist_req_duration', true);
export const sprintDuration = new Trend('sprint_req_duration', true);
export const releaseDuration = new Trend('release_req_duration', true);
export const taskDuration = new Trend('task_req_duration', true);

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:5050/api';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'Bearer test_token';
const PROJECT_ID = __ENV.PROJECT_ID || '507f1f77bcf86cd799439015';

export const options = {
    scenarios: {
        wishlist_sprint_release_benchmark: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '5s', target: 20 },   // Warmup
                { duration: '15s', target: 50 },  // Moderate load
                { duration: '15s', target: 100 }, // Peak load
                { duration: '5s', target: 0 },    // Ramp-down
            ],
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<300', 'p(99)<800'],
        error_rate: ['rate<0.02'],
    },
};

const headers = {
    'Content-Type': 'application/json',
    Authorization: AUTH_TOKEN,
};

export default function () {
    const rand = Math.floor(Math.random() * 100000);

    // 1. Wishlist Flow
    group('Wishlist Flow', function () {
        const getWishlist = http.get(`${BASE_URL}/projects/${PROJECT_ID}/wishlist?page=1&limit=20`, { headers });
        wishlistDuration.add(getWishlist.timings.duration);
        check(getWishlist, {
            'GET /wishlist status is 200': (r) => r.status === 200,
        });

        const postWishlist = http.post(`${BASE_URL}/projects/${PROJECT_ID}/wishlist`, JSON.stringify({
            title: `Feature Idea #${rand}`,
            description: 'Automated k6 load benchmark feature idea',
            priority: 'HIGH',
        }), { headers });
        wishlistDuration.add(postWishlist.timings.duration);
        check(postWishlist, {
            'POST /wishlist status is 201': (r) => r.status === 201,
        });
    });

    // 2. Sprint Flow
    group('Sprint Flow', function () {
        const getSprints = http.get(`${BASE_URL}/projects/${PROJECT_ID}/sprints?page=1&limit=20`, { headers });
        sprintDuration.add(getSprints.timings.duration);
        check(getSprints, {
            'GET /sprints status is 200': (r) => r.status === 200,
        });

        const postSprint = http.post(`${BASE_URL}/projects/${PROJECT_ID}/sprints`, JSON.stringify({
            name: `Sprint Load ${rand}`,
            goal: 'Benchmark sprint creation velocity',
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        }), { headers });
        sprintDuration.add(postSprint.timings.duration);
        check(postSprint, {
            'POST /sprints status is 201': (r) => r.status === 201,
        });
    });

    // 3. Release Flow
    group('Release Flow', function () {
        const getReleases = http.get(`${BASE_URL}/projects/${PROJECT_ID}/releases?page=1&limit=20`, { headers });
        releaseDuration.add(getReleases.timings.duration);
        check(getReleases, {
            'GET /releases status is 200': (r) => r.status === 200,
        });

        const postRelease = http.post(`${BASE_URL}/projects/${PROJECT_ID}/releases`, JSON.stringify({
            name: `Release v${rand}`,
            version: `v${rand}.${Math.floor(Math.random() * 100)}`,
            targetDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        }), { headers });
        releaseDuration.add(postRelease.timings.duration);
        check(postRelease, {
            'POST /releases status is 201': (r) => r.status === 201,
        });
    });

    // 4. Project Tasks Flow
    group('Task Flow', function () {
        const getTasks = http.get(`${BASE_URL}/projects/${PROJECT_ID}/tasks?page=1&limit=20`, { headers });
        taskDuration.add(getTasks.timings.duration);
        check(getTasks, {
            'GET /tasks status is 200': (r) => r.status === 200,
        });
    });

    sleep(0.2);
}
