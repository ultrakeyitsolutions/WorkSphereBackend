import { Router } from 'express';
import { authenticate } from '../../../middleware/auth.middleware';
import { requireCompanyFeature } from '../../../middleware/feature-toggle.middleware';
import {
    requireManagerWorkspace,
    requireManagerPermission,
} from '../middleware/manager-access.middleware';
import { MANAGER_PERMISSIONS } from '../constants/manager.constants';

import * as ManagerDashboardController from '../controllers/manager-dashboard.controller';
import * as ManagerTeamController from '../controllers/manager-team.controller';
import * as ManagerEmployeeController from '../controllers/manager-employee.controller';
import * as ManagerProjectController from '../controllers/manager-project.controller';
import * as ManagerTaskController from '../controllers/manager-task.controller';
import * as ManagerReportController from '../controllers/manager-report.controller';

const router = Router();

// All manager routes require authentication.
router.use(authenticate);
// Company-level feature toggle: Manager Dashboard must be enabled for the org.
// Runs before role/module checks so disabled features always return the
// canonical FEATURE_DISABLED response (403) instead of a generic module denial.
// Applied at router level so it covers every Manager Dashboard API incl. nested endpoints.
router.use(requireCompanyFeature('enableManagerDashboard'));
router.use(requireManagerWorkspace);

// ── Phase 6: Manager Dashboard ────────────────────────────────────────────────
router.get(
    '/dashboard',
    requireManagerPermission(MANAGER_PERMISSIONS.DASHBOARD_VIEW),
    ManagerDashboardController.getDashboard
);

// ── Phase 7: Team Management ──────────────────────────────────────────────────
router.get(
    '/teams',
    requireManagerPermission(MANAGER_PERMISSIONS.TEAMS_VIEW),
    ManagerTeamController.getTeams
);
router.get(
    '/teams/:teamId',
    requireManagerPermission(MANAGER_PERMISSIONS.TEAMS_VIEW),
    ManagerTeamController.getTeamById
);
router.get(
    '/teams/:teamId/members',
    requireManagerPermission(MANAGER_PERMISSIONS.TEAM_MEMBERS_VIEW),
    ManagerTeamController.getTeamMembers
);
router.get(
    '/teams/:teamId/overview',
    requireManagerPermission(MANAGER_PERMISSIONS.TEAMS_VIEW),
    ManagerTeamController.getTeamOverview
);
router.get(
    '/teams/:teamId/activity',
    requireManagerPermission(MANAGER_PERMISSIONS.TEAMS_VIEW),
    ManagerTeamController.getTeamActivity
);
router.get(
    '/teams/:teamId/performance',
    requireManagerPermission(MANAGER_PERMISSIONS.TEAMS_VIEW),
    ManagerTeamController.getTeamPerformance
);

// ── Phase 8: Individual Employee Inspection ───────────────────────────────────
router.get(
    '/employees',
    requireManagerPermission(MANAGER_PERMISSIONS.EMPLOYEE_PROFILE_VIEW),
    ManagerEmployeeController.getEmployees
);
router.get(
    '/employees/:employeeId',
    requireManagerPermission(MANAGER_PERMISSIONS.EMPLOYEE_PROFILE_VIEW),
    ManagerEmployeeController.getEmployeeById
);
router.get(
    '/employees/:employeeId/projects',
    requireManagerPermission(MANAGER_PERMISSIONS.EMPLOYEE_PROFILE_VIEW),
    ManagerEmployeeController.getEmployeeTasks
);
router.get(
    '/employees/:employeeId/tasks',
    requireManagerPermission(MANAGER_PERMISSIONS.EMPLOYEE_PROFILE_VIEW),
    ManagerEmployeeController.getEmployeeTasks
);
router.get(
    '/employees/:employeeId/attendance',
    requireManagerPermission(MANAGER_PERMISSIONS.REPORTS_ATTENDANCE_VIEW),
    ManagerEmployeeController.getEmployeeAttendance
);
router.get(
    '/employees/:employeeId/timesheets',
    requireManagerPermission(MANAGER_PERMISSIONS.REPORTS_TIMESHEET_VIEW),
    ManagerEmployeeController.getEmployeeTimesheets
);
router.get(
    '/employees/:employeeId/performance',
    requireManagerPermission(MANAGER_PERMISSIONS.REPORTS_EMPLOYEE_VIEW),
    ManagerEmployeeController.getEmployeePerformance
);
router.get(
    '/employees/:employeeId/escalations',
    requireManagerPermission(MANAGER_PERMISSIONS.ESCALATIONS_VIEW),
    ManagerEmployeeController.getEmployeeEscalations
);

// ── Phase 9: Project Management ───────────────────────────────────────────────
router.get(
    '/projects',
    requireManagerPermission(MANAGER_PERMISSIONS.PROJECTS_VIEW),
    ManagerProjectController.getProjects
);
router.get(
    '/projects/:projectId',
    requireManagerPermission(MANAGER_PERMISSIONS.PROJECT_DETAILS_VIEW),
    ManagerProjectController.getProjectById
);
router.get(
    '/projects/:projectId/members',
    requireManagerPermission(MANAGER_PERMISSIONS.PROJECT_DETAILS_VIEW),
    ManagerProjectController.getProjectMembers
);
router.get(
    '/projects/:projectId/tasks',
    requireManagerPermission(MANAGER_PERMISSIONS.PROJECT_DETAILS_VIEW),
    ManagerProjectController.getProjectTasks
);
router.get(
    '/projects/:projectId/report',
    requireManagerPermission(MANAGER_PERMISSIONS.PROJECT_DETAILS_VIEW),
    ManagerProjectController.getProjectReport
);
router.get(
    '/projects/:projectId/activity',
    requireManagerPermission(MANAGER_PERMISSIONS.PROJECT_DETAILS_VIEW),
    ManagerProjectController.getProjectActivity
);

// ── Phase 10: Task Management ─────────────────────────────────────────────────
router.get(
    '/tasks',
    requireManagerPermission(MANAGER_PERMISSIONS.TASKS_VIEW),
    ManagerTaskController.getTasks
);
router.get(
    '/tasks/reports',
    requireManagerPermission(MANAGER_PERMISSIONS.TASKS_VIEW),
    ManagerReportController.getTaskManagementReport
);
router.get(
    '/tasks/:taskId',
    requireManagerPermission(MANAGER_PERMISSIONS.TASKS_VIEW),
    ManagerTaskController.getTaskById
);
router.post(
    '/tasks',
    requireManagerPermission(MANAGER_PERMISSIONS.TASKS_CREATE),
    ManagerTaskController.createTask
);
router.put(
    '/tasks/:taskId',
    requireManagerPermission(MANAGER_PERMISSIONS.TASKS_UPDATE),
    ManagerTaskController.updateTask
);
router.patch(
    '/tasks/:taskId/assign',
    requireManagerPermission(MANAGER_PERMISSIONS.TASKS_ASSIGN),
    ManagerTaskController.assignTask
);
router.patch(
    '/tasks/:taskId/status',
    requireManagerPermission(MANAGER_PERMISSIONS.TASKS_UPDATE),
    ManagerTaskController.updateTaskStatus
);
router.patch(
    '/tasks/:taskId/priority',
    requireManagerPermission(MANAGER_PERMISSIONS.TASKS_UPDATE),
    ManagerTaskController.updateTaskPriority
);

// ── Phase 11 & Phase 13: Professional Reporting & Export ──────────────────────
router.get(
    '/reports/team-performance',
    requireManagerPermission(MANAGER_PERMISSIONS.REPORTS_TEAM_VIEW),
    ManagerReportController.getTeamPerformanceReport
);
router.get(
    '/reports/employee-performance',
    requireManagerPermission(MANAGER_PERMISSIONS.REPORTS_EMPLOYEE_VIEW),
    ManagerReportController.getEmployeePerformanceReport
);
router.get(
    '/reports/project-performance',
    requireManagerPermission(MANAGER_PERMISSIONS.PROJECTS_VIEW),
    ManagerReportController.getProjectPerformanceReport
);
router.get(
    '/reports/tasks',
    requireManagerPermission(MANAGER_PERMISSIONS.TASKS_VIEW),
    ManagerReportController.getTaskManagementReport
);
router.get(
    '/reports/attendance-timesheet',
    requireManagerPermission(MANAGER_PERMISSIONS.REPORTS_ATTENDANCE_VIEW),
    ManagerReportController.getAttendanceTimesheetReport
);
router.get(
    '/reports/workload',
    requireManagerPermission(MANAGER_PERMISSIONS.REPORTS_TEAM_VIEW),
    ManagerReportController.getWorkloadDistributionReport
);
router.get(
    '/reports/escalations',
    requireManagerPermission(MANAGER_PERMISSIONS.ESCALATIONS_VIEW),
    ManagerReportController.getEscalationReport
);
router.get(
    '/reports/activity',
    requireManagerPermission(MANAGER_PERMISSIONS.TEAMS_VIEW),
    ManagerReportController.getTeamActivityReport
);
router.get(
    '/reports/deadlines',
    requireManagerPermission(MANAGER_PERMISSIONS.TASKS_VIEW),
    ManagerReportController.getDeadlineDeliveryReport
);
router.get(
    '/reports/summary',
    requireManagerPermission(MANAGER_PERMISSIONS.DASHBOARD_VIEW),
    ManagerReportController.getManagementSummaryReport
);
router.get(
    '/reports/export',
    requireManagerPermission(MANAGER_PERMISSIONS.REPORTS_EXPORT),
    ManagerReportController.exportReport
);

export default router;
