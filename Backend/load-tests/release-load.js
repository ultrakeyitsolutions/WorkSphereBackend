import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'Bearer test_token';
const PROJECT_ID = __ENV.PROJECT_ID || '507f1f77bcf86cd799439015';

export const options = {
    vus: 50,
    duration: '30s',
    thresholds: {
        http_req_duration: ['p(95)<300'],
    },
};

export default function () {
    const headers = { 'Content-Type': 'application/json', Authorization: AUTH_TOKEN };
    const res = http.get(`${BASE_URL}/projects/${PROJECT_ID}/releases?page=1&limit=20`, { headers });
    check(res, { 'status is 200': (r) => r.status === 200 });
    sleep(0.5);
}
