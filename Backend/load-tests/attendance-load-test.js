import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * ============================================================================
 * WORKSPHERE ATTENDANCE MANAGEMENT SYSTEM - PRODUCTION LOAD TEST SCRIPT (k6)
 * ============================================================================
 *
 * Scenarios Tested:
 * - 100 Concurrent Virtual Users (Baseline Office Load)
 * - 500 Concurrent Virtual Users (Mid-Market Enterprise Peak Punch In)
 * - 1,000 Concurrent Virtual Users (Large Enterprise Shift Transition)
 * - 5,000 Concurrent Virtual Users (Multi-Region Shift Change Surge)
 * - 10,000 Concurrent Virtual Users (Massive High-Concurrency Shift Clock-in)
 *
 * Metrics Measured:
 * - http_req_duration (p50, p90, p95, p99)
 * - http_reqs (RPS - Requests Per Second)
 * - http_req_failed (Error Rate %)
 * - Check-in Latency & Throughput
 * - Check-out Latency & Throughput
 * - Calendar Fetch Latency
 *
 * Run with:
 * k6 run load-tests/attendance-load-test.js
 * ============================================================================
 */

export const checkInDuration = new Trend('check_in_duration_ms');
export const checkOutDuration = new Trend('check_out_duration_ms');
export const calendarDuration = new Trend('calendar_fetch_duration_ms');
export const successfulPunches = new Counter('successful_punches_total');
export const failedPunches = new Counter('failed_punches_total');
export const punchErrorRate = new Rate('punch_error_rate');

export const options = {
    scenarios: {
        // Ramp up from 100 to 1,000 to 5,000 to 10,000 VUs
        shift_clockin_surge: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 100 },   // Warmup to 100 VUs
                { duration: '1m', target: 500 },    // Surge to 500 VUs
                { duration: '1m', target: 1000 },   // Surge to 1,000 VUs
                { duration: '2m', target: 5000 },   // Scale to 5,000 VUs
                { duration: '1m', target: 10000 },  // Peak 10,000 VUs
                { duration: '1m', target: 0 },      // Cooldown
            ],
            gracefulRampDown: '30s',
        },
    },
    thresholds: {
        http_req_duration: ['p(50)<50', 'p(95)<150', 'p(99)<300'], // Strict enterprise SLA (<300ms p99)
        punch_error_rate: ['rate<0.01'],                           // <1% error rate under peak load
        http_req_failed: ['rate<0.01'],
    },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:5000/api';
const AUTH_TOKEN = __ENV.TEST_JWT_TOKEN || 'SAMPLE_TEST_BEARER_TOKEN';

export default function () {
    const params = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AUTH_TOKEN}`,
        },
    };

    // 1. Employee Check-In Request
    const checkInPayload = JSON.stringify({
        source: 'MOBILE',
        deviceId: `device-vu-${__VU}`,
        location: {
            latitude: 12.9716,
            longitude: 77.5946,
            accuracy: 10,
            address: 'WorkSphere Bangalore HQ',
        },
    });

    const checkInStart = Date.now();
    const checkInRes = http.post(`${BASE_URL}/attendance/check-in`, checkInPayload, params);
    checkInDuration.add(Date.now() - checkInStart);

    const isCheckInOk = check(checkInRes, {
        'check-in status is 200 or 409 (already active)': (r) => r.status === 200 || r.status === 409,
    });

    if (isCheckInOk) {
        successfulPunches.add(1);
        punchErrorRate.add(0);
    } else {
        failedPunches.add(1);
        punchErrorRate.add(1);
    }

    sleep(1); // Employee working simulation interval

    // 2. Employee Attendance Calendar Fetch
    const calendarStart = Date.now();
    const calendarRes = http.get(`${BASE_URL}/attendance/calendar?month=10&year=2026`, params);
    calendarDuration.add(Date.now() - calendarStart);

    check(calendarRes, {
        'calendar status is 200': (r) => r.status === 200,
        'calendar has daily records': (r) => r.json('data.days') !== undefined,
    });

    sleep(0.5);

    // 3. Employee Check-Out Request
    const checkOutPayload = JSON.stringify({
        source: 'MOBILE',
        deviceId: `device-vu-${__VU}`,
        notes: 'Shift completed on time',
    });

    const checkOutStart = Date.now();
    const checkOutRes = http.post(`${BASE_URL}/attendance/check-out`, checkOutPayload, params);
    checkOutDuration.add(Date.now() - checkOutStart);

    const isCheckOutOk = check(checkOutRes, {
        'check-out status is 200 or 409 (already checked out)': (r) => r.status === 200 || r.status === 409,
    });

    if (isCheckOutOk) {
        successfulPunches.add(1);
        punchErrorRate.add(0);
    } else {
        failedPunches.add(1);
        punchErrorRate.add(1);
    }

    sleep(1);
}
