import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'Bearer test_token';
const PROJECT_ID = __ENV.PROJECT_ID || '507f1f77bcf86cd799439015';
const TASK_ID = __ENV.TASK_ID || '507f1f77bcf86cd799439099';
const SPRINT_ID = __ENV.SPRINT_ID || '507f1f77bcf86cd799439024';

export const options = {
    vus: 30,
    duration: '30s',
    thresholds: {
        http_req_duration: ['p(95)<400'],
    },
};

export default function () {
    const headers = { 'Content-Type': 'application/json', Authorization: AUTH_TOKEN };
    const payload = JSON.stringify({ sprintId: SPRINT_ID });
    const res = http.patch(`${BASE_URL}/projects/${PROJECT_ID}/tasks/${TASK_ID}/sprint`, payload, { headers });
    check(res, { 'status is 200': (r) => r.status === 200 });
    sleep(0.5);
}
