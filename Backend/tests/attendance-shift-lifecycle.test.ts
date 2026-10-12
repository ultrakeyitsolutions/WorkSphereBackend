import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { Attendance } from '../src/modules/attendance/attendance.model';
import { AttendanceEvent } from '../src/modules/attendance/attendance-event.model';
import { AttendanceAdjustment } from '../src/modules/attendance/attendance-adjustment.model';
import { Holiday } from '../src/modules/attendance/holiday.model';
import { LeaveRequest } from '../src/modules/attendance/leave.model';
import { Shift } from '../src/modules/shifts/shift.model';
import { EmployeeShiftAssignment } from '../src/modules/shifts/employee-shift-assignment.model';
import { CompanyMember } from '../src/modules/companyadmin/invitations/company-member.model';
import { User } from '../src/modules/users/user.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { generateAccessToken } from '../src/utils/tokens';
import { Types } from 'mongoose';
import { EntitlementService } from '../src/services/entitlement.service';
import { TimezoneUtils } from '../src/modules/attendance/utils/timezone.utils';

vi.mock('../src/modules/audit-logs/audit-log.model', () => ({
    AuditLog: {
        create: vi.fn(),
    },
}));

describe('Attendance Shift Lifecycle & API Endpoints Tests', () => {
    const companyAId = new Types.ObjectId().toString();
    const companyBId = new Types.ObjectId().toString();

    const adminAId = new Types.ObjectId().toString();
    const memberA1Id = new Types.ObjectId().toString();
    const memberA2Id = new Types.ObjectId().toString();
    const memberB1Id = new Types.ObjectId().toString();

    let adminAToken: string;
    let memberA1Token: string;

    beforeEach(() => {
        vi.clearAllMocks();

        adminAToken = generateAccessToken({
            userId: adminAId,
            email: 'admin@companya.com',
            role: 'COMPANY_ADMIN',
            companyId: companyAId,
        });

        memberA1Token = generateAccessToken({
            userId: memberA1Id,
            email: 'member1@companya.com',
            role: 'EMPLOYEE',
            companyId: companyAId,
        });

        // Mock User.findById for auth middleware
        vi.spyOn(User, 'findById').mockImplementation((id: any) => {
            const idStr = id?.toString() || '';
            let roleName = 'EMPLOYEE';
            let cId = companyAId;
            let email = 'member1@companya.com';

            if (idStr === adminAId) {
                roleName = 'COMPANY_ADMIN';
                cId = companyAId;
                email = 'admin@companya.com';
            } else if (idStr === memberA2Id) {
                roleName = 'EMPLOYEE';
                cId = companyAId;
                email = 'member2@companya.com';
            } else if (idStr === memberB1Id) {
                roleName = 'EMPLOYEE';
                cId = companyBId;
                email = 'member1@companyb.com';
            }

            return {
                populate: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(idStr),
                    email,
                    isActive: true,
                    status: 'ACTIVE',
                    companyId: new Types.ObjectId(cId),
                    role: { name: roleName },
                }),
            } as any;
        });

        vi.spyOn(EntitlementService, 'hasFeature').mockResolvedValue(true);
        vi.spyOn(TimezoneUtils, 'getCompanyTimezone').mockResolvedValue('Asia/Kolkata');

        vi.spyOn(Company, 'findById').mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(companyAId),
                    name: 'Company A',
                    isActive: true,
                    status: 'ACTIVE',
                    timezone: 'Asia/Kolkata',
                }),
            }),
            lean: vi.fn().mockResolvedValue({
                _id: new Types.ObjectId(companyAId),
                name: 'Company A',
                isActive: true,
                status: 'ACTIVE',
                timezone: 'Asia/Kolkata',
            }),
            then: (resolve: any) => Promise.resolve({
                _id: new Types.ObjectId(companyAId),
                name: 'Company A',
                isActive: true,
                status: 'ACTIVE',
                timezone: 'Asia/Kolkata',
            }).then(resolve),
        } as any);

        // Mock CompanyMember
        vi.spyOn(CompanyMember, 'find').mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    { userId: new Types.ObjectId(memberA1Id) },
                    { userId: new Types.ObjectId(memberA2Id) },
                ]),
            }),
        } as any);

        // Mock Shift & Assignment
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
                name: 'General Shift',
                code: 'GS-01',
                startTime: '09:00',
                endTime: '17:00',
                gracePeriodMinutes: 15,
                earlyCheckoutGracePeriodMinutes: 10,
                crossesMidnight: false,
                workingDays: [1, 2, 3, 4, 5],
                isActive: true,
            }),
        } as any);

        // Mock Holidays & Leaves
        vi.spyOn(Holiday, 'find').mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
        } as any);
        vi.spyOn(Holiday, 'findOne').mockReturnValue({
            lean: vi.fn().mockResolvedValue(null),
        } as any);
        vi.spyOn(LeaveRequest, 'find').mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
        } as any);
        vi.spyOn(LeaveRequest, 'findOne').mockReturnValue({
            lean: vi.fn().mockResolvedValue(null),
        } as any);

        // Mock Events & Adjustments
        vi.spyOn(AttendanceEvent, 'find').mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([]),
            }),
        } as any);
        vi.spyOn(AttendanceAdjustment, 'find').mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([]),
            }),
        } as any);
    });

    // Helper to create chained mongoose mock query
    const createQueryChain = (result: any) => {
        const chain: any = {
            sort: vi.fn().mockImplementation(() => chain),
            skip: vi.fn().mockImplementation(() => chain),
            limit: vi.fn().mockImplementation(() => chain),
            populate: vi.fn().mockImplementation(() => chain),
            select: vi.fn().mockImplementation(() => chain),
            lean: vi.fn().mockResolvedValue(result),
            exec: vi.fn().mockResolvedValue(result),
            then: (resolve: any) => Promise.resolve(result).then(resolve),
        };
        return chain;
    };

    describe('Company Admin Endpoints (Phase 5)', () => {
        it('1. GET /api/v1/company/attendance/summary - Returns aggregated metrics and accurate percentages', async () => {
            const mockRecords = [
                {
                    _id: new Types.ObjectId(),
                    companyId: new Types.ObjectId(companyAId),
                    employeeId: new Types.ObjectId(memberA1Id),
                    date: new Date('2026-10-12'),
                    status: 'PRESENT',
                    scheduled: { hasAssignedShift: true, shiftName: 'General Shift' },
                    actual: { firstCheckIn: new Date('2026-10-12T09:00:00Z'), lastCheckOut: new Date('2026-10-12T17:00:00Z'), workedMinutes: 480 },
                    metrics: { lateMinutes: 0, earlyDepartureMinutes: 0 },
                },
                {
                    _id: new Types.ObjectId(),
                    companyId: new Types.ObjectId(companyAId),
                    employeeId: new Types.ObjectId(memberA2Id),
                    date: new Date('2026-10-12'),
                    status: 'PRESENT',
                    scheduled: { hasAssignedShift: true, shiftName: 'General Shift' },
                    actual: { firstCheckIn: new Date('2026-10-12T09:30:00Z'), lastCheckOut: null, workedMinutes: 0 },
                    metrics: { lateMinutes: 15, earlyDepartureMinutes: 0 },
                },
            ];

            vi.spyOn(Attendance, 'find').mockReturnValue(createQueryChain(mockRecords) as any);

            const res = await request(app)
                .get('/api/v1/company/attendance/summary?date=2026-10-12')
                .set('Authorization', `Bearer ${adminAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.metrics.scheduledEmployees).toBe(2);
            expect(res.body.data.metrics.checkedInEmployees).toBe(2);
            expect(res.body.data.metrics.onTimeEmployees).toBe(1);
            expect(res.body.data.metrics.lateEmployees).toBe(1);
            expect(res.body.data.metrics.incompleteAttendance).toBe(1); // memberA2 has not checked out
            expect(res.body.data.metrics.totalActualWorkedHours).toBe(8); // 480 / 60
            expect(res.body.data.metrics.onTimeRatePercentage).toBe(50);
            expect(res.body.data.metrics.lateRatePercentage).toBe(50);
        });

        it('2. GET /api/v1/company/attendance/late-arrivals - Ranks top late employees with tie-breaking and limit', async () => {
            const employee1 = new Types.ObjectId();
            const employee2 = new Types.ObjectId();
            const employee3 = new Types.ObjectId();

            const mockRecords = [
                {
                    _id: new Types.ObjectId(),
                    companyId: new Types.ObjectId(companyAId),
                    employeeId: { _id: employee1, name: 'Alice Smith', email: 'alice@companya.com' },
                    date: new Date('2026-10-12'),
                    status: 'PRESENT',
                    scheduled: {
                        hasAssignedShift: true,
                        shiftName: 'Morning Shift',
                        startTime: new Date('2026-10-12T09:00:00Z'),
                        gracePeriodMinutes: 15,
                    },
                    actual: { firstCheckIn: new Date('2026-10-12T09:45:00Z') },
                    metrics: { lateMinutes: 30 },
                    createdAt: new Date('2026-10-12T09:45:00Z'),
                },
                {
                    _id: new Types.ObjectId(),
                    companyId: new Types.ObjectId(companyAId),
                    employeeId: { _id: employee2, name: 'Bob Jones', email: 'bob@companya.com' },
                    date: new Date('2026-10-12'),
                    status: 'PRESENT',
                    scheduled: {
                        hasAssignedShift: true,
                        shiftName: 'Morning Shift',
                        startTime: new Date('2026-10-12T09:00:00Z'),
                        gracePeriodMinutes: 15,
                    },
                    actual: { firstCheckIn: new Date('2026-10-12T09:35:00Z') },
                    metrics: { lateMinutes: 20 },
                    createdAt: new Date('2026-10-12T09:35:00Z'),
                },
                {
                    _id: new Types.ObjectId(),
                    companyId: new Types.ObjectId(companyAId),
                    employeeId: { _id: employee3, name: 'Charlie Brown', email: 'charlie@companya.com' },
                    date: new Date('2026-10-12'),
                    status: 'PRESENT',
                    scheduled: {
                        hasAssignedShift: true,
                        shiftName: 'Morning Shift',
                        startTime: new Date('2026-10-12T09:00:00Z'),
                        gracePeriodMinutes: 15,
                    },
                    actual: { firstCheckIn: new Date('2026-10-12T09:35:00Z') },
                    metrics: { lateMinutes: 20 },
                    createdAt: new Date('2026-10-12T09:35:00Z'),
                },
            ];

            vi.spyOn(Attendance, 'find').mockReturnValue(createQueryChain(mockRecords) as any);
            vi.spyOn(Attendance, 'countDocuments').mockResolvedValue(3 as any);

            const res = await request(app)
                .get('/api/v1/company/attendance/late-arrivals?date=2026-10-12&limit=5')
                .set('Authorization', `Bearer ${adminAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const rankings = res.body.data.ranking;
            expect(rankings).toHaveLength(3);
            // Alice (30m) must be rank 1
            expect(rankings[0].rank).toBe(1);
            expect(rankings[0].employeeName).toBe('Alice Smith');
            expect(rankings[0].lateMinutes).toBe(30);

            // Bob and Charlie both have 20m, tied on late minutes
            expect(rankings[1].lateMinutes).toBe(20);
            expect(rankings[2].lateMinutes).toBe(20);
            expect(rankings[1].employeeName).toBe('Bob Jones');
            expect(rankings[2].employeeName).toBe('Charlie Brown');
        });

        it('3. GET /api/v1/company/attendance/records - Supports lateOnly filter and pagination', async () => {
            vi.spyOn(Attendance, 'countDocuments').mockResolvedValue(1 as any);
            const findSpy = vi.spyOn(Attendance, 'find').mockReturnValue(
                createQueryChain([
                    {
                        _id: new Types.ObjectId(),
                        companyId: new Types.ObjectId(companyAId),
                        employeeId: { _id: new Types.ObjectId(), name: 'Test' },
                        date: new Date('2026-10-12'),
                        status: 'PRESENT',
                        metrics: { lateMinutes: 15 },
                    },
                ]) as any
            );

            const res = await request(app)
                .get('/api/v1/company/attendance/records?date=2026-10-12&lateOnly=true&page=1&limit=10')
                .set('Authorization', `Bearer ${adminAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.records).toHaveLength(1);
            expect(res.body.data.pagination.total).toBe(1);
            expect(findSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    companyId: new Types.ObjectId(companyAId),
                    'metrics.lateMinutes': { $gt: 0 },
                })
            );
        });

        it('4. GET /api/v1/company/attendance/:attendanceId - Rejects cross-company record access with 404', async () => {
            vi.spyOn(Attendance, 'findOne').mockReturnValue(createQueryChain(null) as any);

            const foreignId = new Types.ObjectId().toString();
            const res = await request(app)
                .get(`/api/v1/company/attendance/${foreignId}`)
                .set('Authorization', `Bearer ${adminAToken}`);

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe('Member Attendance Endpoints (Phase 6 & Security)', () => {
        it('5. GET /api/v1/member/attendance/today - Returns authenticated member today record with shift calculation', async () => {
            const mockRecord = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyAId),
                employeeId: new Types.ObjectId(memberA1Id),
                date: new Date('2026-10-12'),
                status: 'PRESENT',
                scheduled: {
                    hasAssignedShift: true,
                    shiftName: 'General Shift',
                    startTime: new Date('2026-10-12T09:00:00Z'),
                    endTime: new Date('2026-10-12T17:00:00Z'),
                },
                actual: {
                    firstCheckIn: new Date('2026-10-12T09:05:00Z'),
                    lastCheckOut: null,
                    workedMinutes: 0,
                },
                metrics: {
                    lateMinutes: 0,
                    earlyDepartureMinutes: 0,
                },
            };

            vi.spyOn(Attendance, 'findOne').mockReturnValue(createQueryChain(mockRecord) as any);

            const res = await request(app)
                .get('/api/v1/member/attendance/today')
                .set('Authorization', `Bearer ${memberA1Token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.isCheckedIn).toBe(true);
            expect(res.body.data.isCheckoutRequired).toBe(true);
        });

        it('6. GET /api/v1/member/attendance/:attendanceId - Blocks member from accessing another member record (403 Forbidden)', async () => {
            const recordBelongingToMember2 = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyAId),
                employeeId: new Types.ObjectId(memberA2Id), // belongs to Member A2
                date: new Date('2026-10-12'),
                status: 'PRESENT',
            };

            vi.spyOn(Attendance, 'findOne').mockReturnValue(createQueryChain(recordBelongingToMember2) as any);

            const recordId = recordBelongingToMember2._id.toString();

            // Member A1 tries to access Member A2's record
            const res = await request(app)
                .get(`/api/v1/member/attendance/${recordId}`)
                .set('Authorization', `Bearer ${memberA1Token}`);

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('not authorized');
        });

        it('7. GET /api/v1/member/attendance/history - Scopes strictly to authenticated memberId and companyId', async () => {
            vi.spyOn(Attendance, 'countDocuments').mockResolvedValue(1 as any);
            const findSpy = vi.spyOn(Attendance, 'find').mockReturnValue(createQueryChain([]) as any);

            const res = await request(app)
                .get('/api/v1/member/attendance/history?startDate=2026-10-01&endDate=2026-10-10')
                .set('Authorization', `Bearer ${memberA1Token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(findSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    companyId: new Types.ObjectId(companyAId),
                    employeeId: new Types.ObjectId(memberA1Id),
                })
            );
        });

        it('8. Regular Employee cannot access Company Admin endpoints (403 Forbidden)', async () => {
            const res = await request(app)
                .get('/api/v1/company/attendance/summary?date=2026-10-12')
                .set('Authorization', `Bearer ${memberA1Token}`);

            expect(res.status).toBe(403);
        });
    });
});
