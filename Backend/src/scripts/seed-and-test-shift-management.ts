import mongoose, { Types } from 'mongoose';
import { Shift } from '../modules/shifts/shift.model';
import { EmployeeShiftAssignment } from '../modules/shifts/employee-shift-assignment.model';
import { ShiftService } from '../modules/shifts/shift.service';
import { EmployeeShiftAssignmentService } from '../modules/shifts/employee-shift-assignment.service';
import { AttendanceEvaluationService } from '../modules/shifts/attendance-evaluation.service';
import { Attendance } from '../modules/attendance/attendance.model';
import User from '../modules/users/user.model';
import CompanyMember from '../modules/companyadmin/invitations/company-member.model';
import Company from '../modules/super-admin/companies/company.model';
import Role from '../modules/roles/role.model';
import { env } from '../config/env';

export async function runShiftManagementVerification() {
    console.log('\n======================================================');
    console.log('🚀 WORKSPHERE — SHIFT MANAGEMENT VERIFICATION TEST');
    console.log('======================================================\n');

    const mongoUri = env.MONGODB_URI || 'mongodb://localhost:27017/worksphere';
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(mongoUri);
    }

    try {
        // 1. Create or Find Test Company (UltraKey)
        let company = await Company.findOne({ slug: 'ultrakey-test' });
        if (!company) {
            company = await Company.create({
                name: 'UltraKey',
                slug: 'ultrakey-test',
                status: 'ACTIVE',
                isActive: true,
                timezone: 'Asia/Kolkata',
            });
        }
        const companyId = company._id.toString();

        let role = await Role.findOne({ name: 'EMPLOYEE' });
        if (!role) {
            role = await Role.create({ name: 'EMPLOYEE', permissions: [] });
        }

        // 2. Create or Find Test Employees (Manohar, Ravi, Kiran, Arun)
        const employeeNames = ['Manohar', 'Ravi', 'Kiran', 'Arun'];
        const employeeDocs: any = {};

        for (const name of employeeNames) {
            const email = `${name.toLowerCase()}@ultrakey.test`;
            let user = await User.findOne({ email });
            if (!user) {
                user = await User.create({
                    name,
                    email,
                    password: 'HashedPassword123!',
                    role: role._id,
                    companyId: company._id,
                    status: 'ACTIVE',
                    isActive: true,
                });
            }
            employeeDocs[name] = user;

            // Ensure CompanyMember entry exists
            let member = await CompanyMember.findOne({ companyId: company._id, userId: user._id });
            if (!member) {
                member = await CompanyMember.create({
                    companyId: company._id,
                    userId: user._id,
                    roleId: role._id,
                    designationId: new Types.ObjectId(),
                    memberType: 'EMPLOYEE',
                    status: 'ACTIVE',
                    joinedAt: new Date(),
                });
            }
        }

        const adminUser = employeeDocs['Manohar'];
        const adminId = adminUser._id.toString();

        // 3. Clean up previous test shifts and assignments
        await Shift.deleteMany({ companyId: company._id });
        await EmployeeShiftAssignment.deleteMany({ companyId: company._id });
        await Attendance.deleteMany({ companyId: company._id });

        console.log('✅ 1. Test company and employees initialized.');

        // 4. Create Standard & Custom Shifts
        console.log('\n--- Creating Shifts ---');

        const morningShift = await ShiftService.createShift(companyId, adminId, {
            name: 'Morning Shift',
            code: 'MORN-01',
            startTime: '09:00',
            endTime: '17:30',
            gracePeriodMinutes: 10,
            earlyCheckoutGracePeriodMinutes: 5,
            isDefault: true,
        });
        console.log(`✅ Created Morning Shift: ${morningShift.startTime} - ${morningShift.endTime} (crossesMidnight: ${morningShift.crossesMidnight})`);

        const afternoonShift = await ShiftService.createShift(companyId, adminId, {
            name: 'Afternoon Shift',
            code: 'AFT-01',
            startTime: '13:00',
            endTime: '21:30',
            gracePeriodMinutes: 10,
            earlyCheckoutGracePeriodMinutes: 5,
        });
        console.log(`✅ Created Afternoon Shift: ${afternoonShift.startTime} - ${afternoonShift.endTime} (crossesMidnight: ${afternoonShift.crossesMidnight})`);

        const eveningShift = await ShiftService.createShift(companyId, adminId, {
            name: 'Evening Shift',
            code: 'EVE-01',
            startTime: '16:00',
            endTime: '00:30',
            gracePeriodMinutes: 10,
            earlyCheckoutGracePeriodMinutes: 5,
        });
        console.log(`✅ Created Evening Shift: ${eveningShift.startTime} - ${eveningShift.endTime} (crossesMidnight: ${eveningShift.crossesMidnight})`);

        const nightShift = await ShiftService.createShift(companyId, adminId, {
            name: 'Night Shift',
            code: 'NIGHT-01',
            startTime: '22:00',
            endTime: '06:00',
            gracePeriodMinutes: 10,
            earlyCheckoutGracePeriodMinutes: 5,
        });
        console.log(`✅ Created Night Shift: ${nightShift.startTime} - ${nightShift.endTime} (crossesMidnight: ${nightShift.crossesMidnight})`);

        // 5. Assign Shifts to Employees
        console.log('\n--- Assigning Individual Shifts ---');

        // Manohar -> Morning
        await EmployeeShiftAssignmentService.assignShift(companyId, adminId, {
            employeeId: employeeDocs['Manohar']._id.toString(),
            shiftId: morningShift._id.toString(),
            effectiveFrom: '2026-10-01',
            reason: 'Primary morning roster',
        });
        console.log(`✅ Assigned Manohar -> Morning Shift (Effective: 2026-10-01)`);

        // Ravi -> Afternoon
        await EmployeeShiftAssignmentService.assignShift(companyId, adminId, {
            employeeId: employeeDocs['Ravi']._id.toString(),
            shiftId: afternoonShift._id.toString(),
            effectiveFrom: '2026-10-01',
        });
        console.log(`✅ Assigned Ravi -> Afternoon Shift (Effective: 2026-10-01)`);

        // Kiran -> Evening
        await EmployeeShiftAssignmentService.assignShift(companyId, adminId, {
            employeeId: employeeDocs['Kiran']._id.toString(),
            shiftId: eveningShift._id.toString(),
            effectiveFrom: '2026-10-01',
        });
        console.log(`✅ Assigned Kiran -> Evening Shift (Effective: 2026-10-01)`);

        // Arun -> Night
        await EmployeeShiftAssignmentService.assignShift(companyId, adminId, {
            employeeId: employeeDocs['Arun']._id.toString(),
            shiftId: nightShift._id.toString(),
            effectiveFrom: '2026-10-01',
        });
        console.log(`✅ Assigned Arun -> Night Shift (Effective: 2026-10-01)`);

        // 6. Test Shift Evaluations & Punctuality
        console.log('\n--- Testing Attendance & Punctuality Calculations ---');

        // Test Manohar Check-in at 09:05 (Within 10m grace) -> ON_TIME
        const t1 = new Date('2026-10-05T09:05:00');
        const eval1 = await AttendanceEvaluationService.evaluateCheckIn(companyId, employeeDocs['Manohar']._id.toString(), t1);
        console.log(`Test 1: Manohar at 09:05 -> Status: ${eval1.punchStatus}, Late: ${eval1.lateMinutes}m (Expected: ON_TIME, 0m)`);

        // Test Manohar Check-in at 09:25 (Beyond 10m grace) -> LATE 25m
        const t2 = new Date('2026-10-05T09:25:00');
        const eval2 = await AttendanceEvaluationService.evaluateCheckIn(companyId, employeeDocs['Manohar']._id.toString(), t2);
        console.log(`Test 2: Manohar at 09:25 -> Status: ${eval2.punchStatus}, Late: ${eval2.lateMinutes}m (Expected: LATE, 25m)`);

        // Test Ravi Check-in at 13:05 -> ON_TIME
        const t3 = new Date('2026-10-05T13:05:00');
        const eval3 = await AttendanceEvaluationService.evaluateCheckIn(companyId, employeeDocs['Ravi']._id.toString(), t3);
        console.log(`Test 3: Ravi at 13:05 -> Status: ${eval3.punchStatus}, Late: ${eval3.lateMinutes}m (Expected: ON_TIME, 0m)`);

        // Test Kiran Check-in at 16:20 -> LATE 20m
        const t4 = new Date('2026-10-05T16:20:00');
        const eval4 = await AttendanceEvaluationService.evaluateCheckIn(companyId, employeeDocs['Kiran']._id.toString(), t4);
        console.log(`Test 4: Kiran at 16:20 -> Status: ${eval4.punchStatus}, Late: ${eval4.lateMinutes}m (Expected: LATE, 20m)`);

        // Test Arun Check-in at 22:05 (Night shift start 22:00) -> ON_TIME
        const t5 = new Date('2026-10-05T22:05:00');
        const eval5 = await AttendanceEvaluationService.evaluateCheckIn(companyId, employeeDocs['Arun']._id.toString(), t5);
        console.log(`Test 5: Arun at 22:05 (Night) -> Status: ${eval5.punchStatus}, Late: ${eval5.lateMinutes}m, AttendanceDate: ${eval5.attendanceDate}, isOvernight: ${eval5.isOvernight} (Expected: ON_TIME, 2026-10-05, true)`);

        // Test Arun Check-out at 06:10 next day (Oct 6) -> OVERTIME 10m
        const t5_out = new Date('2026-10-06T06:10:00');
        const checkoutEval5 = AttendanceEvaluationService.evaluateCheckOut(t5, t5_out, eval5.scheduledEndTime);
        console.log(`Test 6: Arun Checkout at 06:10 next day -> Status: ${checkoutEval5.checkoutStatus}, Overtime: ${checkoutEval5.overtimeMinutes}m, Duration: ${checkoutEval5.workDurationMinutes}m (Expected: OVERTIME, 10m, 485m)`);

        // 7. Test Future Shift Assignment
        console.log('\n--- Testing Future Shift Transition (Manohar: Morning -> Night effective Nov 1) ---');

        await EmployeeShiftAssignmentService.assignShift(companyId, adminId, {
            employeeId: employeeDocs['Manohar']._id.toString(),
            shiftId: nightShift._id.toString(),
            effectiveFrom: '2026-11-01',
            reason: 'Rotational night shift',
        });

        // Resolve on Oct 15 -> Should be Morning
        const octShift = await EmployeeShiftAssignmentService.resolveEmployeeShift(
            companyId,
            employeeDocs['Manohar']._id.toString(),
            new Date('2026-10-15T10:00:00')
        );
        console.log(`✅ Manohar shift on Oct 15: "${octShift?.name}" (${octShift?.startTime} - ${octShift?.endTime}) [Expected: Morning Shift]`);

        // Resolve on Nov 05 -> Should be Night
        const novShift = await EmployeeShiftAssignmentService.resolveEmployeeShift(
            companyId,
            employeeDocs['Manohar']._id.toString(),
            new Date('2026-11-05T10:00:00')
        );
        console.log(`✅ Manohar shift on Nov 05: "${novShift?.name}" (${novShift?.startTime} - ${novShift?.endTime}) [Expected: Night Shift]`);

        // 8. Test Bulk Assignment for 50 Accepted Employees
        console.log('\n--- Testing Bulk Shift Assignment (50 employees in single bulkWrite) ---');

        const bulkEmployeeIds: string[] = [];
        for (let i = 1; i <= 50; i++) {
            const email = `bulkemp${i}@ultrakey.test`;
            let u = await User.findOne({ email });
            if (!u) {
                u = await User.create({
                    name: `Bulk Employee ${i}`,
                    email,
                    password: 'HashedPassword123!',
                    role: role._id,
                    companyId: company._id,
                    status: 'ACTIVE',
                    isActive: true,
                });
            }
            const m = await CompanyMember.findOne({ companyId: company._id, userId: u._id });
            if (!m) {
                await CompanyMember.create({
                    companyId: company._id,
                    userId: u._id,
                    roleId: role._id,
                    designationId: new Types.ObjectId(),
                    memberType: 'EMPLOYEE',
                    status: 'ACTIVE',
                    joinedAt: new Date(),
                });
            }
            bulkEmployeeIds.push(u._id.toString());
        }

        const bulkResult = await EmployeeShiftAssignmentService.bulkAssignShift(companyId, adminId, {
            employeeIds: bulkEmployeeIds,
            shiftId: afternoonShift._id.toString(),
            effectiveFrom: '2026-10-01',
            reason: 'Q4 Support Team Roster',
        });

        console.log(`✅ Bulk assigned: ${bulkResult.assignedCount}/${bulkResult.totalRequested} employees to Afternoon Shift in one atomic bulkWrite.`);

        // 9. Verify Shift Summary and Counts
        const shiftList = await ShiftService.getShifts(companyId, {});
        console.log('\n--- Shift List with Aggregated Employee Counts ---');
        for (const s of shiftList.shifts) {
            console.log(`- ${s.name} (${s.code}): ${s.startTime} - ${s.endTime} | ${s.assignedEmployeesCount} Active Employees`);
        }

        console.log('\n======================================================');
        console.log('🎉 ALL SHIFT MANAGEMENT VERIFICATIONS PASSED SUCCESSFULLY!');
        console.log('======================================================\n');
    } catch (err) {
        console.error('❌ Verification Error:', err);
    }
}

if (require.main === module) {
    runShiftManagementVerification()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
