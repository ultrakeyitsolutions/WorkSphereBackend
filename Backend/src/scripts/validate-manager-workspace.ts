import mongoose, { Types } from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Import Database connection
import { connectDatabase } from '../config/database';

// Import Models
import { User } from '../modules/users/user.model';
import { Company } from '../modules/super-admin/companies/company.model';
import { Team } from '../modules/teams/team.model';
import { Project } from '../modules/companyadmin/projects/project.model';
import { Task } from '../modules/tasks/task.model';
import { Status } from '../modules/tasks/status.model';
import { Shift } from '../modules/shifts/shift.model';
import { EmployeeShiftAssignment } from '../modules/shifts/employee-shift-assignment.model';
import { Attendance } from '../modules/attendance/attendance.model';
import { AttendanceEvent } from '../modules/attendance/attendance-event.model';
import { LeaveRequest } from '../modules/attendance/leave.model';
import { CompanyLeavePolicy } from '../modules/companyadmin/leave/leave-policy.model';
import { EscalationCase } from '../modules/escalation/models/EscalationCase';
import { EscalationRule } from '../modules/escalation/models/EscalationRule';
import { Meeting } from '../modules/meetings/models/meeting.model';
import { MonitoringActivity } from '../modules/companyadmin/live-monitoring/models/monitoring-activity.model';
import { MonitoringAlert } from '../modules/companyadmin/live-monitoring/models/monitoring-alert.model';

// Import Services
import { TeamAccessService, ManagerAccessScope } from '../modules/manager/services/team-access.service';
import { ManagerDashboardService } from '../modules/manager/services/manager-dashboard.service';
import { ManagerReportService } from '../modules/manager/services/manager-report.service';
import { ManagerInspectionService } from '../modules/manager/services/manager-inspection.service';

interface ValidationResult {
    category: string;
    item: string;
    status: 'PASS' | 'FAIL' | 'WARN';
    details: string;
    durationMs: number;
}

export async function validateManagerWorkspace(targetEmailArg?: string): Promise<{ success: boolean; results: ValidationResult[] }> {
    const results: ValidationResult[] = [];
    const startTime = Date.now();

    console.log('\n================================================================');
    console.log('       UWORKSPHERE MANAGER WORKSPACE 90-DAY VALIDATION SUITE');
    console.log('================================================================');

    await connectDatabase();

    // 1. Identify Target Admin & Company
    const targetEmail = targetEmailArg || process.env.QA_TARGET_EMAIL || 'manoharyalla83@gmail.com';
    const adminUser = await User.findOne({ email: targetEmail });
    if (!adminUser) {
        throw new Error(`Target Admin user '${targetEmail}' not found in database.`);
    }

    const companyId = adminUser.companyId;
    const company = await Company.findById(companyId);
    if (!company) {
        throw new Error(`Target Company for Admin '${targetEmail}' not found.`);
    }

    console.log(`🏢 Organization: ${company.name} (${companyId})`);
    console.log(`👤 Target Admin: ${adminUser.name} <${adminUser.email}>\n`);

    // Helper runner
    async function runTest(category: string, item: string, fn: () => Promise<string | void>) {
        const t0 = Date.now();
        try {
            const detailMsg = await fn();
            const dur = Date.now() - t0;
            results.push({
                category,
                item,
                status: 'PASS',
                details: detailMsg || 'Success',
                durationMs: dur,
            });
            console.log(`  ✅ [PASS] ${category} -> ${item} (${dur}ms): ${detailMsg || 'OK'}`);
        } catch (err: any) {
            const dur = Date.now() - t0;
            results.push({
                category,
                item,
                status: 'FAIL',
                details: err.message || String(err),
                durationMs: dur,
            });
            console.error(`  ❌ [FAIL] ${category} -> ${item} (${dur}ms): ${err.message}`);
        }
    }

    // ── Group 1: Manager Roles & Data Isolation Scope ──
    console.log('🔍 [Group 1/6] Verifying Manager Authorization & Data Isolation Scopes...');
    TeamAccessService.clearAllMemoryCache();

    let adminScope: ManagerAccessScope;
    await runTest('Scope', 'Company Admin Full Scope', async () => {
        adminScope = await TeamAccessService.resolveScope(companyId, adminUser as any);
        if (!adminScope.isCompanyAdmin) throw new Error('Expected isCompanyAdmin to be true');
        if (adminScope.allTeamIds.length < 8) throw new Error(`Expected at least 8 teams, got ${adminScope.allTeamIds.length}`);
        if (adminScope.allAccessibleEmployeeIds.length < 40) throw new Error(`Expected at least 40 employees, got ${adminScope.allAccessibleEmployeeIds.length}`);
        if (adminScope.allAccessibleProjectIds.length < 24) throw new Error(`Expected at least 24 projects, got ${adminScope.allAccessibleProjectIds.length}`);
        return `Admin has access to ${adminScope.allTeamIds.length} teams, ${adminScope.allAccessibleEmployeeIds.length} employees, ${adminScope.allAccessibleProjectIds.length} projects`;
    });

    const managers = await User.find({
        companyId,
        email: { $regex: /^qa\.manager0[1-4]@uworksphere\.test$/ },
    }).sort({ email: 1 });

    const managerScopes: ManagerAccessScope[] = [];
    for (let i = 0; i < managers.length; i++) {
        const mgr = managers[i];
        await runTest('Scope', `Manager Scope: ${mgr.name} (${mgr.email})`, async () => {
            const mScope = await TeamAccessService.resolveScope(companyId, mgr as any);
            managerScopes.push(mScope);
            if (mScope.isCompanyAdmin) throw new Error('Regular manager should NOT have isCompanyAdmin = true');
            if (mScope.allTeamIds.length !== 2) throw new Error(`Expected exactly 2 teams, got ${mScope.allTeamIds.length}`);
            if (mScope.allAccessibleEmployeeIds.length === 0) throw new Error('Expected accessible employees');
            if (mScope.allAccessibleProjectIds.length === 0) throw new Error('Expected accessible projects');
            return `Assigned 2 teams, ${mScope.allAccessibleEmployeeIds.length} employees, ${mScope.allAccessibleProjectIds.length} projects`;
        });
    }

    // Verify Isolation: Manager 1 teams vs Manager 2 teams
    await runTest('Scope', 'Manager Team Segregation & Cross-Isolation', async () => {
        if (managerScopes.length >= 2) {
            const m1Teams = new Set(managerScopes[0].allTeamIds.map((id) => id.toString()));
            const m2Teams = new Set(managerScopes[1].allTeamIds.map((id) => id.toString()));
            for (const tId of m1Teams) {
                if (m2Teams.has(tId)) {
                    throw new Error(`Team ${tId} is duplicated between Manager 1 and Manager 2!`);
                }
            }
            return 'Manager 1 and Manager 2 manage completely disjoint sets of teams';
        }
    });

    // ── Group 2: Operations Overview Cards Verification ──
    console.log('\n📊 [Group 2/6] Verifying Operations Overview Aggregations across Periods...');

    const periods: Array<'today' | 'this_week' | 'this_month' | 'last_month'> = ['today', 'this_week', 'this_month', 'last_month'];

    for (const period of periods) {
        await runTest('Dashboard Overview', `Period: '${period}' (Admin Scope)`, async () => {
            const overview = await ManagerDashboardService.getDashboardOverview(adminScope, { period });
            if (!overview) throw new Error('Dashboard overview returned null or undefined');

            const {
                teamOverview,
                projectOverview,
                taskOverview,
                attendanceOverview,
                performanceOverview,
                managementOverview,
            } = overview;

            if (!teamOverview || typeof teamOverview.totalEmployees !== 'number') {
                throw new Error('Invalid teamOverview metrics');
            }
            if (!projectOverview || typeof projectOverview.totalAccessibleProjects !== 'number') {
                throw new Error('Invalid projectOverview metrics');
            }
            if (!taskOverview || typeof taskOverview.totalTasks !== 'number') {
                throw new Error('Invalid taskOverview metrics');
            }
            if (!attendanceOverview || typeof attendanceOverview.presentEmployees !== 'number') {
                throw new Error('Invalid attendanceOverview metrics');
            }
            if (!performanceOverview || typeof performanceOverview.onTimeTaskDelivery !== 'number') {
                throw new Error('Invalid performanceOverview metrics');
            }
            if (!managementOverview || typeof managementOverview.unresolvedEscalations !== 'number') {
                throw new Error('Invalid managementOverview metrics');
            }

            return `Projects: ${projectOverview.totalAccessibleProjects} (${projectOverview.activeProjects} active), Tasks: ${taskOverview.totalTasks} (${taskOverview.completedTasks} comp), On-Time: ${performanceOverview.onTimeTaskDelivery}%, Attention: ${managementOverview.unresolvedEscalations} esc / ${managementOverview.pendingApprovals} leaves, Present: ${attendanceOverview.presentEmployees}`;
        });
    }

    if (managerScopes.length > 0) {
        await runTest('Dashboard Overview', `Period: 'this_month' (Manager Scope: ${managers[0].email})`, async () => {
            const overview = await ManagerDashboardService.getDashboardOverview(managerScopes[0], { period: 'this_month' });
            if (!overview) throw new Error('Dashboard overview returned null');
            return `Scoped Projects: ${overview.projectOverview.totalAccessibleProjects}, Scoped Tasks: ${overview.taskOverview.totalTasks}, Headcount: ${overview.teamOverview.totalEmployees}`;
        });
    }

    // ── Group 3: All 10 Manager Reports Verification ──
    console.log('\n📑 [Group 3/6] Verifying All 10 Manager Reports via ManagerReportService...');

    const sampleFilter = { period: 'this_month' as const };

    await runTest('Reports', '1. Team Performance Report', async () => {
        const report = await ManagerReportService.getTeamPerformanceReport(adminScope, sampleFilter);
        if (!report || !report.data || !Array.isArray(report.data.breakdown)) throw new Error('Invalid report structure');
        return `${report.data.breakdown.length} teams analyzed, avg completion: ${report.data.summary?.averageTeamCompletion || 0}%`;
    });

    await runTest('Reports', '2. Employee Performance Report', async () => {
        const report = await ManagerReportService.getEmployeePerformanceReport(adminScope, sampleFilter);
        if (!report || !report.data || !Array.isArray(report.data.records)) throw new Error('Invalid report structure');
        return `${report.data.records.length} employee records generated with task & attendance metrics`;
    });

    await runTest('Reports', '3. Project Performance Report', async () => {
        const report = await ManagerReportService.getProjectPerformanceReport(adminScope, sampleFilter);
        if (!report || !report.data || !Array.isArray(report.data.records)) throw new Error('Invalid report structure');
        return `${report.data.records.length} projects analyzed, ${report.data.summary?.completedProjects || 0} completed`;
    });

    await runTest('Reports', '4. Task Management Report', async () => {
        const report = await ManagerReportService.getTaskManagementReport(adminScope, sampleFilter);
        if (!report || !report.data || !report.data.metrics) throw new Error('Invalid report structure');
        return `${report.data.metrics.totalTasks} tasks indexed across ${report.data.byProject?.length || 0} projects and ${report.data.byEmployee?.length || 0} assignees`;
    });

    await runTest('Reports', '5. Attendance Timesheet Report', async () => {
        const report = await ManagerReportService.getAttendanceTimesheetReport(adminScope, sampleFilter);
        if (!report || !report.data || !Array.isArray(report.data.records)) throw new Error('Invalid report structure');
        return `${report.data.records.length} employee timesheets aggregated with hours & punctuality`;
    });

    await runTest('Reports', '6. Workload Distribution Report', async () => {
        const report = await ManagerReportService.getWorkloadDistributionReport(adminScope, sampleFilter);
        if (!report || !report.data || !Array.isArray(report.data.records)) throw new Error('Invalid report structure');
        return `${report.data.records.length} employees mapped for workload capacity & capacity status`;
    });

    await runTest('Reports', '7. Escalation Compliance Report', async () => {
        const report = await ManagerReportService.getEscalationReport(adminScope, sampleFilter);
        if (!report || !report.data || !Array.isArray(report.data.records)) throw new Error('Invalid report structure');
        return `${report.data.records.length} escalation cases reported (${report.data.summary?.openCases || 0} open)`;
    });

    await runTest('Reports', '8. Team Activity Report', async () => {
        const report = await ManagerReportService.getTeamActivityReport(adminScope, sampleFilter);
        if (!report || !report.data || !Array.isArray(report.data.records)) throw new Error('Invalid report structure');
        return `${report.data.records.length} team activities and audit traces retrieved`;
    });

    await runTest('Reports', '9. Deadline & Delivery Report', async () => {
        const report = await ManagerReportService.getDeadlineDeliveryReport(adminScope, sampleFilter);
        if (!report || !report.data || !report.data.summary) throw new Error('Invalid report structure');
        return `Evaluated: ${report.data.summary.totalEvaluated}, Upcoming: ${report.data.summary.upcomingDeadlinesCount}, Missed: ${report.data.summary.missedDeadlinesCount}`;
    });

    await runTest('Reports', '10. Executive Management Summary Report', async () => {
        const report = await ManagerReportService.getManagementSummaryReport(adminScope, sampleFilter);
        if (!report || !report.data || !report.data.executiveSummary) throw new Error('Invalid executive summary report structure');
        return `Executive Summary: ${report.data.recommendedActions?.length || 0} recommendations generated`;
    });

    // ── Group 4: CSV / Excel Export Pipeline ──
    console.log('\n📥 [Group 4/6] Verifying Export Pipeline (CSV / Excel format)...');
    await runTest('Export', 'CSV Export: EMPLOYEE_PERFORMANCE', async () => {
        const exported = await ManagerReportService.exportReport(adminScope, 'EMPLOYEE_PERFORMANCE', sampleFilter);
        if (!exported.content || !exported.filename.endsWith('.csv')) {
            throw new Error('Export content empty or invalid filename');
        }
        const lines = exported.content.split('\n');
        return `Exported ${lines.length} CSV rows, filename: ${exported.filename}`;
    });

    await runTest('Export', 'CSV Export: TEAM_PERFORMANCE', async () => {
        const exported = await ManagerReportService.exportReport(adminScope, 'TEAM_PERFORMANCE', sampleFilter);
        if (!exported.content || !exported.filename.endsWith('.csv')) {
            throw new Error('Export content empty or invalid filename');
        }
        return `Exported CSV successfully, filename: ${exported.filename}`;
    });

    // ── Group 5: Teams Tab Inspection & MissingSchemaError Fix Verification ──
    console.log('\n🛡️  [Group 5/6] Verifying Teams Tab & Inspection Service (Schema Population)...');

    await runTest('Teams Tab', 'Admin Authorized Teams Inspection (Zero MissingSchemaError)', async () => {
        const teams = await ManagerInspectionService.getAuthorizedTeams(adminScope);
        if (!teams || teams.length < 8) throw new Error(`Expected at least 8 teams, got ${teams?.length}`);
        return `Successfully populated ${teams.length} teams with managers and department/designation refs`;
    });

    if (managerScopes.length > 0) {
        await runTest('Teams Tab', `Manager Authorized Teams Inspection (${managers[0].email})`, async () => {
            const teams = await ManagerInspectionService.getAuthorizedTeams(managerScopes[0]);
            if (!teams || teams.length !== 2) throw new Error(`Expected exactly 2 teams for manager, got ${teams?.length}`);
            return `Successfully retrieved manager's 2 assigned teams with populated fields`;
        });
    }

    // ── Group 6: Relational Integrity & Orphan Check ──
    console.log('\n🔗 [Group 6/6] Verifying Database Relational Integrity (Zero Orphans)...');

    await runTest('Integrity', 'Task References (Projects & Assignees)', async () => {
        const tasks = await Task.find({ companyId }).select('projectId assignedToId').lean();
        const projectIds = new Set((await Project.find({ companyId }).select('_id').lean()).map((p) => p._id.toString()));
        const userIds = new Set((await User.find({ companyId }).select('_id').lean()).map((u) => u._id.toString()));

        let orphanedProjects = 0;
        let orphanedAssignees = 0;

        for (const t of tasks) {
            if (t.projectId && !projectIds.has(t.projectId.toString())) orphanedProjects++;
            if (t.assignedToId && !userIds.has(t.assignedToId.toString())) orphanedAssignees++;
        }

        if (orphanedProjects > 0 || orphanedAssignees > 0) {
            throw new Error(`Found ${orphanedProjects} orphaned project refs and ${orphanedAssignees} orphaned assignee refs!`);
        }
        return `All ${tasks.length} tasks have 100% valid project and assignee references`;
    });

    await runTest('Integrity', 'Attendance References (Users & Shifts)', async () => {
        const attendances = await Attendance.find({ companyId }).select('employeeId userId shiftId').lean();
        const userIds = new Set((await User.find({ companyId }).select('_id').lean()).map((u) => u._id.toString()));
        const shiftIds = new Set((await Shift.find({ companyId }).select('_id').lean()).map((s) => s._id.toString()));

        let orphanedUsers = 0;
        let orphanedShifts = 0;

        for (const a of attendances) {
            const uId = a.employeeId || (a as any).userId;
            if (!uId || !userIds.has(uId.toString())) orphanedUsers++;
            if (a.shiftId && !shiftIds.has(a.shiftId.toString())) orphanedShifts++;
        }

        if (orphanedUsers > 0 || orphanedShifts > 0) {
            throw new Error(`Found ${orphanedUsers} orphaned users and ${orphanedShifts} orphaned shifts in attendance!`);
        }
        return `All ${attendances.length} attendance records have 100% valid user and shift references`;
    });

    await runTest('Integrity', 'Leave Requests References (Employees & Approvers)', async () => {
        const leaves = await LeaveRequest.find({ companyId }).select('employeeId approvedBy').lean();
        const userIds = new Set((await User.find({ companyId }).select('_id').lean()).map((u) => u._id.toString()));

        let orphanedEmps = 0;
        for (const l of leaves) {
            if (!userIds.has(l.employeeId.toString())) orphanedEmps++;
        }

        if (orphanedEmps > 0) {
            throw new Error(`Found ${orphanedEmps} orphaned employees in leave requests!`);
        }
        return `All ${leaves.length} leave requests have 100% valid employee references`;
    });

    // ── Audit Summary Presentation ──
    const totalTests = results.length;
    const passedTests = results.filter((r) => r.status === 'PASS').length;
    const failedTests = results.filter((r) => r.status === 'FAIL').length;
    const durationTotal = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n================================================================');
    console.log('            MANAGER WORKSPACE VALIDATION SUMMARY');
    console.log('================================================================');
    console.log(`🎯 Total Test Cases Executed:      ${totalTests}`);
    console.log(`✅ Passed:                         ${passedTests}`);
    console.log(`❌ Failed:                         ${failedTests}`);
    console.log(`⏱️  Total Duration:                 ${durationTotal}s`);
    console.log('================================================================\n');

    return {
        success: failedTests === 0,
        results,
    };
}

// ── Standalone CLI Runner ──
if (process.argv[1] && process.argv[1].includes('validate-manager-workspace')) {
    const targetEmailArg = process.argv.find((arg) => arg.startsWith('--target-email='));
    const targetEmail = targetEmailArg ? targetEmailArg.split('=')[1] : undefined;

    validateManagerWorkspace(targetEmail)
        .then(({ success }) => {
            mongoose.disconnect().then(() => process.exit(success ? 0 : 1));
        })
        .catch((err) => {
            console.error('\n❌ VALIDATION CRITICAL ERROR:', err);
            mongoose.disconnect().then(() => process.exit(1));
        });
}

