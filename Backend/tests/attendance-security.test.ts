import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { Attendance } from '../src/modules/attendance/attendance.model';
import { Holiday } from '../src/modules/attendance/holiday.model';
import { LeaveRequest } from '../src/modules/attendance/leave.model';
import { Shift } from '../src/modules/shifts/shift.model';
import { EmployeeShiftAssignment } from '../src/modules/shifts/employee-shift-assignment.model';
import { User } from '../src/modules/users/user.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { generateAccessToken } from '../src/utils/tokens';
import { Types } from 'mongoose';

vi.mock('../src/modules/audit-logs/audit-log.model', () => ({
    AuditLog: {
        create: vi.fn(),
    },
}));

describe('Attendance System - Security & Access Control Tests', () => {
    const companyAId = new Types.ObjectId().toString();
    const companyBId = new Types.ObjectId().toString();

    const employeeAId = new Types.ObjectId().toString();
    const employeeBId = new Types.ObjectId().toString();

    let employeeAToken: string;
    let employeeBToken: string;

    beforeEach(() => {
        vi.clearAllMocks();

        employeeAToken = generateAccessToken({
            userId: employeeAId,
            email: 'employeeA@companya.com',
            role: 'EMPLOYEE',
            companyId: companyAId,
        });

        employeeBToken = generateAccessToken({
            userId: employeeBId,
            email: 'employeeB@companyb.com',
            role: 'EMPLOYEE',
            companyId: companyBId,
        });

        vi.spyOn(User, 'findById').mockReturnValue({
            populate: vi.fn().mockResolvedValue({
                _id: new Types.ObjectId(employeeAId),
                email: 'employeeA@companya.com',
                isActive: true,
                status: 'ACTIVE',
                companyId: new Types.ObjectId(companyAId),
                role: { name: 'EMPLOYEE' },
            }),
        } as any);

        vi.spyOn(Company, 'findById').mockResolvedValue({
            _id: new Types.ObjectId(companyAId),
            name: 'Company A',
            isActive: true,
            status: 'ACTIVE',
            timezone: 'Asia/Kolkata',
        } as any);
    });

    it('Security 1: Cross-Company Access Denial - Tenant Isolation in Database Queries', async () => {
        const findSpy = vi.spyOn(Attendance, 'find').mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([]),
            }),
        } as any);

        vi.spyOn(Holiday, 'find').mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
        } as any);

        vi.spyOn(LeaveRequest, 'find').mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
        } as any);

        vi.spyOn(EmployeeShiftAssignment, 'findOne').mockReturnValue({
            populate: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(null),
                }),
            }),
        } as any);

        vi.spyOn(Shift, 'findOne').mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: new Types.ObjectId(),
                name: 'Morning Shift',
                code: 'MS-01',
                startTime: '09:00',
                endTime: '17:30',
                crossesMidnight: false,
                workingDays: [1, 2, 3, 4, 5],
                isActive: true,
                isDefault: true,
            }),
        } as any);

        const res = await request(app)
            .get('/api/attendance/calendar?startDate=2026-10-01&endDate=2026-10-05')
            .set('Authorization', `Bearer ${employeeAToken}`);

        expect(res.status).toBe(200);
        expect(findSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: new Types.ObjectId(companyAId),
                employeeId: new Types.ObjectId(employeeAId),
            })
        );
    });

    it('Security 2: Reject Unauthenticated requests', async () => {
        const res = await request(app)
            .post('/api/attendance/check-in')
            .send({});

        expect(res.status).toBe(401);
    });
});
