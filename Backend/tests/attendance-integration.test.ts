import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { Attendance } from '../src/modules/attendance/attendance.model';
import { AttendanceEvent } from '../src/modules/attendance/attendance-event.model';
import { Holiday } from '../src/modules/attendance/holiday.model';
import { LeaveRequest } from '../src/modules/attendance/leave.model';
import { AttendanceAdjustment } from '../src/modules/attendance/attendance-adjustment.model';
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

describe('Attendance Management System - Integration Tests', () => {
    const mockCompanyId = new Types.ObjectId().toString();
    const mockEmployeeId = new Types.ObjectId().toString();
    const mockAdminId = new Types.ObjectId().toString();

    let employeeToken: string;
    let adminToken: string;

    beforeEach(() => {
        vi.clearAllMocks();

        employeeToken = generateAccessToken({
            userId: mockEmployeeId,
            email: 'employee@test.com',
            role: 'EMPLOYEE',
            companyId: mockCompanyId,
        });

        adminToken = generateAccessToken({
            userId: mockAdminId,
            email: 'admin@test.com',
            role: 'COMPANY_ADMIN',
            companyId: mockCompanyId,
        });

        // Mock auth lookups
        vi.spyOn(User, 'findById').mockReturnValue({
            populate: vi.fn().mockResolvedValue({
                _id: new Types.ObjectId(mockEmployeeId),
                email: 'employee@test.com',
                isActive: true,
                status: 'ACTIVE',
                companyId: new Types.ObjectId(mockCompanyId),
                role: { name: 'EMPLOYEE' },
            }),
        } as any);

        vi.spyOn(Company, 'findById').mockResolvedValue({
            _id: new Types.ObjectId(mockCompanyId),
            name: 'WorkSphere Corp',
            isActive: true,
            status: 'ACTIVE',
            timezone: 'Asia/Kolkata',
        } as any);
    });

    describe('POST /api/attendance/check-in', () => {
        it('should successfully check in an employee and calculate punctuality', async () => {
            vi.spyOn(Shift, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    name: 'Morning Shift',
                    code: 'MS-01',
                    startTime: '09:00',
                    endTime: '17:30',
                    crossesMidnight: false,
                    gracePeriodMinutes: 15,
                    workingDays: [1, 2, 3, 4, 5],
                    isActive: true,
                    isDefault: true,
                }),
            } as any);

            vi.spyOn(EmployeeShiftAssignment, 'findOne').mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    sort: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue(null),
                    }),
                }),
            } as any);

            vi.spyOn(Holiday, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);

            vi.spyOn(LeaveRequest, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);

            vi.spyOn(Attendance, 'findOne').mockResolvedValue(null as any);
            vi.spyOn(Attendance, 'create').mockResolvedValue({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(mockCompanyId),
                employeeId: new Types.ObjectId(mockEmployeeId),
                date: '2026-10-03',
                status: 'PRESENT',
                actual: { firstCheckIn: new Date(), lastCheckOut: null, workedMinutes: 0 },
                metrics: { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
                toJSON: vi.fn().mockReturnValue({}),
            } as any);

            vi.spyOn(AttendanceEvent, 'create').mockResolvedValue({
                _id: new Types.ObjectId(),
                type: 'CHECK_IN',
                timestamp: new Date(),
            } as any);

            const res = await request(app)
                .post('/api/attendance/check-in')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    source: 'WEB',
                    deviceId: 'browser-01',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('Checked in successfully');
        });
    });

    describe('POST /api/attendance/check-out', () => {
        it('should reject check-out if no open check-in session exists', async () => {
            vi.spyOn(Shift, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    name: 'Morning Shift',
                    code: 'MS-01',
                    startTime: '09:00',
                    endTime: '17:30',
                    crossesMidnight: false,
                    gracePeriodMinutes: 15,
                    workingDays: [1, 2, 3, 4, 5],
                    isActive: true,
                    isDefault: true,
                }),
            } as any);

            vi.spyOn(EmployeeShiftAssignment, 'findOne').mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    sort: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue(null),
                    }),
                }),
            } as any);

            vi.spyOn(Attendance, 'findOne').mockResolvedValue(null as any);

            const res = await request(app)
                .post('/api/attendance/check-out')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({});

            expect(res.status).toBe(409);
            expect(res.body.message).toContain('No active check-in');
        });
    });

    describe('Leave Application & Approval Workflow', () => {
        it('should allow employee to apply for leave and allow admin to approve', async () => {
            const mockLeaveId = new Types.ObjectId();

            vi.spyOn(LeaveRequest, 'findOne').mockResolvedValue(null as any);
            vi.spyOn(LeaveRequest, 'create').mockResolvedValue({
                _id: mockLeaveId,
                companyId: new Types.ObjectId(mockCompanyId),
                employeeId: new Types.ObjectId(mockEmployeeId),
                leaveType: 'CASUAL',
                durationType: 'FULL_DAY',
                startDate: '2026-10-15',
                endDate: '2026-10-16',
                totalDays: 2,
                status: 'PENDING',
                reason: 'Family event',
            } as any);

            const applyRes = await request(app)
                .post('/api/attendance/leaves')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    leaveType: 'CASUAL',
                    startDate: '2026-10-15',
                    endDate: '2026-10-16',
                    reason: 'Family event',
                });

            expect(applyRes.status).toBe(201);
            expect(applyRes.body.success).toBe(true);
        });
    });

    describe('Holiday Management', () => {
        it('should allow company admin to create a holiday', async () => {
            vi.spyOn(Holiday, 'findOne').mockResolvedValue(null as any);
            vi.spyOn(Holiday, 'create').mockResolvedValue({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(mockCompanyId),
                name: 'Diwali',
                date: '2026-11-08',
                isRecurring: false,
            } as any);

            const res = await request(app)
                .post('/api/attendance/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    name: 'Diwali',
                    date: '2026-11-08',
                    description: 'Festival of Lights',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.holiday.name).toBe('Diwali');
        });
    });
});
