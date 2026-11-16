import dotenv from 'dotenv';
import mongoose, { Types } from 'mongoose';
import dns from 'dns';
import { randomUUID } from 'crypto';
import { connectDatabase } from '../config/database';
import { hashPassword } from '../utils/password';

// Ensure Node uses public DNS resolvers to handle SRV lookups reliably on Windows
try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {
    // Ignore if not supported
}

dotenv.config();

// ─── Import Core Models ───────────────────────────────────────────────────────
import { Company } from '../modules/super-admin/companies/company.model';
import { CompanySettings } from '../modules/companyadmin/settings/company-settings.model';
import { CompanyModuleAccess } from '../modules/companyadmin/module-access/module-access.model';
import { Subscription } from '../modules/super-admin/subscriptions/subscription.model';
import { Plan } from '../modules/super-admin/plans/plans.model';
import { Role } from '../modules/roles/role.model';
import { CompanyRole } from '../modules/companyadmin/invitations/roles/company-role.model';
import { Designation } from '../modules/companyadmin/invitations/designation/designation.model';
import { User } from '../modules/users/user.model';
import { CompanyMember } from '../modules/companyadmin/invitations/company-member.model';
import { Team } from '../modules/teams/team.model';
import { ManagerAssignment } from '../modules/manager/models/manager-assignment.model';
import { ManagerPermission } from '../modules/manager/models/manager-permission.model';
import {
    Project,
    ProjectSettings,
    ProjectInCharge,
    ProjectTeamMember,
    ProjectClient,
} from '../modules/companyadmin/projects/project.model';
import { Release } from '../modules/releases/release.model';
import { Sprint } from '../modules/sprints/sprint.model';
import { Status } from '../modules/tasks/status.model';
import { Stage } from '../modules/tasks/stage.model';
import { Module } from '../modules/tasks/module.model';
import { Task, TaskPriority, TaskType, TaskCriticality } from '../modules/tasks/task.model';
import { TaskActivity, ActivityType } from '../modules/task-activities/task-activity.model';
import { TimeTracking, TrackingState, IntervalType } from '../modules/task-tracking/time-tracking.model';
import { TaskAttachment, AttachmentType } from '../modules/task-attachments/task-attachment.model';
import { Shift } from '../modules/shifts/shift.model';
import { EmployeeShiftAssignment } from '../modules/shifts/employee-shift-assignment.model';
import { Attendance, AttendanceStatus } from '../modules/attendance/attendance.model';
import { AttendanceEvent } from '../modules/attendance/attendance-event.model';
import { AttendanceEventType } from '../modules/attendance/attendance.types';
import { Holiday } from '../modules/attendance/holiday.model';
import { CompanyLeavePolicy } from '../modules/companyadmin/leave/leave-policy.model';
import { EmployeeMonthlyLeaveBalance } from '../modules/companyadmin/leave/leave-balance.model';
import { LeaveRequest } from '../modules/attendance/leave.model';
import { LeaveType, LeaveDurationType, LeaveStatus } from '../modules/attendance/attendance.types';
import { EscalationRule } from '../modules/escalation/models/EscalationRule';
import { EscalationEvent } from '../modules/escalation/models/EscalationEvent';
import { EscalationCase } from '../modules/escalation/models/EscalationCase';
import { EscalationAudit } from '../modules/escalation/models/EscalationAudit';
import {
    EscalationCategory,
    EscalationSeverity,
    EscalationCaseStatus,
    EscalationSourceModule,
    EscalationAuditAction,
    EscalationResetPeriod,
} from '../modules/escalation/constants/escalation.constants';
import { Meeting } from '../modules/meetings/models/meeting.model';
import { MeetingParticipant } from '../modules/meetings/models/meeting-participant.model';
import { CalendarEvent } from '../modules/calendar/calendar-event.model';
import { MeetingType, MeetingStatus, ParticipantRole, ParticipantResponseStatus } from '../modules/meetings/meeting.types';
import { MonitoringActivity } from '../modules/companyadmin/live-monitoring/models/monitoring-activity.model';
import { MonitoringAlert } from '../modules/companyadmin/live-monitoring/models/monitoring-alert.model';
import { MonitoringEventType, AlertType, AlertSeverity, AlertStatus } from '../modules/companyadmin/live-monitoring/live-monitoring.types';
import { Notification } from '../modules/notifications/notification.model';
import { AuditLog } from '../modules/audit-logs/audit-log.model';
import { AuditAction } from '../modules/audit-logs/audit-log.types';
import { Conversation } from '../modules/chat/conversation.model';
import { ConversationParticipant } from '../modules/chat/participant.model';
import { Message } from '../modules/chat/message.model';
import { getRedisClient } from '../config/redis';
import { TeamAccessService } from '../modules/manager/services/team-access.service';

import { ManagerAssignmentType, ManagerAccessLevel, ALL_MANAGER_PERMISSION_KEYS } from '../modules/manager/constants/manager.constants';
import { ProjectType, ProjectPriority, ProjectStatus } from '../modules/companyadmin/projects/project.types';
import { SprintStatus } from '../modules/sprints/sprint.types';
import { ReleaseStatus } from '../modules/releases/release.types';

// ─── Manager Workspace 90-Day Configuration ──────────────────────────────────
export const MGR_CONFIG = {
    COMPANY_NAME: 'UltrakeyIt Solution',
    DEFAULT_ADMIN_EMAIL: 'manoharyalla83@gmail.com',
    DEFAULT_PASSWORD: 'WorkSphere@2026!',
    TOTAL_MANAGERS: 4,
    TOTAL_TEAMS: 8,
    TOTAL_EMPLOYEES: 40,
    TOTAL_CLIENTS: 6,
    TOTAL_PROJECTS: 24,
    TOTAL_TASKS_TARGET: 300,
    TOTAL_SUBTASKS_TARGET: 100,
    TOTAL_LEAVE_TARGET: 60,
    TOTAL_ESCALATION_TARGET: 25,
    TOTAL_MEETINGS_TARGET: 40,
    TOTAL_MONITORING_TARGET: 200,
    ATTENDANCE_DAYS: 90,
};

// ─── Helper Utilities ────────────────────────────────────────────────────────
const formatYMD = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const formatYM = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
};

const padZero = (n: number) => String(n).padStart(2, '0');

export interface SeedManagerOptions {
    forceClean?: boolean;
    targetEmail?: string;
    resetOnly?: boolean;
}

// ─── Main Seeder Engine ───────────────────────────────────────────────────────
export async function seedManagerWorkspace(options: SeedManagerOptions | boolean = false) {
    const opts: SeedManagerOptions = typeof options === 'boolean' ? { forceClean: options } : options;
    const forceClean = opts.forceClean ?? false;
    const resetOnly = opts.resetOnly ?? false;
    const targetEmail = (opts.targetEmail || process.env.TARGET_ADMIN_EMAIL || MGR_CONFIG.DEFAULT_ADMIN_EMAIL).trim().toLowerCase();

    const startTime = Date.now();
    console.log('================================================================');
    console.log('    UWORKSPHERE – MANAGER WORKSPACE 90-DAY COMPLETE SEED ENGINE');
    console.log(`    Target Admin Email:   ${targetEmail}`);
    console.log(`    Historical Window:    90 Days (Dynamic relative to today)`);
    console.log(`    Execution Mode:       ${resetOnly ? 'RESET / CLEAN ONLY' : forceClean ? 'CLEAN & SEED' : 'IDEMPOTENT APPLY'}`);
    console.log('================================================================\n');

    // ── Phase 1: Database Safety & Identity Verification ──
    console.log('🔍 [Phase 1/13] Verifying Database Connection & Safety Boundaries...');
    await connectDatabase();
    const dbName = mongoose.connection.db?.databaseName;
    console.log(`   Connected Database: "${dbName}"`);

    if (!dbName) {
        throw new Error('Safety Abort: Could not determine active database name.');
    }
    console.log('✅ Safety verification passed: Target database confirmed.\n');

    // Resolve target company admin user
    const foundAdmin = await User.findOne({ email: targetEmail }).populate('role');
    if (!foundAdmin) {
        throw new Error(`Target admin user "${targetEmail}" not found in database.`);
    }
    if (!foundAdmin.companyId) {
        throw new Error(`Target user "${targetEmail}" does not belong to any company.`);
    }

    const targetCompany = await Company.findById(foundAdmin.companyId);
    if (!targetCompany) {
        throw new Error(`Company with id "${foundAdmin.companyId}" not found.`);
    }

    const companyId = targetCompany._id as Types.ObjectId;
    const companyAdminUser = foundAdmin;
    console.log(`🎯 Identified Target Organization: "${targetCompany.name}" (ID: ${companyId})`);
    console.log(`   Company Admin: "${companyAdminUser.name}" (${companyAdminUser.email})\n`);

    // ── Phase 2: Safe Scoped Cleanup of Previous QA Records ──
    console.log('🧹 [Phase 2/13] Performing Safe Scoped Cleanup of Previous QA Records...');
    const existingQaUsers = await User.find({
        companyId,
        email: { $regex: /@uworksphere\.test$/i },
    });
    const qaUserIds = existingQaUsers.map((u) => u._id);
    console.log(`   Found ${qaUserIds.length} existing QA dummy users in target organization to clean.`);

    // Clean up prior QA documents belonging to this company
    await Promise.all([
        CompanyMember.deleteMany({ companyId, userId: { $in: qaUserIds } }),
        Team.deleteMany({ companyId }),
        ManagerAssignment.deleteMany({ companyId }),
        ManagerPermission.deleteMany({ companyId }),
        ProjectSettings.deleteMany({}),
        ProjectInCharge.deleteMany({}),
        ProjectTeamMember.deleteMany({}),
        ProjectClient.deleteMany({}),
        Project.deleteMany({ companyId }),
        Release.deleteMany({ companyId }),
        Sprint.deleteMany({ companyId }),
        Status.deleteMany({ companyId }),
        Stage.deleteMany({ companyId }),
        Module.deleteMany({ companyId }),
        Task.deleteMany({ companyId }),
        TaskActivity.deleteMany({ companyId }),
        TimeTracking.deleteMany({ companyId }),
        TaskAttachment.deleteMany({ companyId }),
        Shift.deleteMany({ companyId }),
        EmployeeShiftAssignment.deleteMany({ companyId }),
        Attendance.deleteMany({ companyId, $or: [{ employeeId: { $in: qaUserIds } }, { userId: { $in: qaUserIds } }] }),
        AttendanceEvent.deleteMany({ companyId, userId: { $in: qaUserIds } }),
        Holiday.deleteMany({ companyId }),
        CompanyLeavePolicy.deleteMany({ companyId }),
        EmployeeMonthlyLeaveBalance.deleteMany({ companyId }),
        LeaveRequest.deleteMany({ companyId }),
        EscalationRule.deleteMany({ companyId }),
        EscalationEvent.deleteMany({ companyId }),
        EscalationCase.deleteMany({ companyId }),
        EscalationAudit.deleteMany({ companyId }),
        Meeting.deleteMany({ companyId }),
        MeetingParticipant.deleteMany({ companyId }),
        CalendarEvent.deleteMany({ companyId }),
        MonitoringActivity.deleteMany({ companyId }),
        MonitoringAlert.deleteMany({ companyId }),
        Notification.deleteMany({ companyId }),
        AuditLog.deleteMany({ companyId }),
        Conversation.deleteMany({ companyId }),
        ConversationParticipant.deleteMany({}),
        Message.deleteMany({}),
        User.deleteMany({ _id: { $in: qaUserIds } }),
    ]);

    // Clear caches
    try {
        const redis = getRedisClient();
        if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
            const keys = await redis.keys('worksphere:cache:*').catch(() => []);
            if (keys.length > 0) {
                await redis.del(...keys).catch(() => {});
            }
        }
    } catch {}
    TeamAccessService.clearAllMemoryCache();

    console.log('✅ Scoped cleanup complete. Real members & credentials preserved.\n');

    if (resetOnly) {
        console.log('🛑 Reset completed. Exiting as requested by reset mode.');
        return { message: 'Reset completed successfully' };
    }

    // ── Phase 3: System Roles, Settings, Module Access & Designations ──
    console.log('🏢 [Phase 3/13] Ensuring Company Settings, Module Access & Designations...');

    const [adminRole, managerRole, employeeRole, userRole] = await Promise.all([
        Role.findOne({ name: 'COMPANY_ADMIN' }),
        Role.findOne({ name: 'MANAGER' }),
        Role.findOne({ name: 'EMPLOYEE' }),
        Role.findOne({ name: 'User' }),
    ]);

    if (!adminRole || !managerRole || !employeeRole || !userRole) {
        throw new Error('System Roles missing in DB. Please run "npm run db:seed" first.');
    }

    const defaultPlan = (await Plan.findOne({ isDefault: true })) || (await Plan.findOne({}));
    if (!defaultPlan) {
        throw new Error('No Subscription Plan found in DB. Please run "npm run db:seed" first.');
    }

    // Hash shared password
    const hashedPassword = await hashPassword(MGR_CONFIG.DEFAULT_PASSWORD);

    // Update CompanySettings to guarantee Manager Dashboard & all operational features are ENABLED
    await CompanySettings.findOneAndUpdate(
        { companyId },
        {
            $set: {
                'features.enableManagerDashboard': true,
                'features.enableLiveMonitoring': true,
                'features.enableDetailedMonitoring': true,
                'features.enableQuickMeetings': true,
                'features.enableChat': true,
                'features.enableAttendanceAdjustments': true,
                'features.enableTimesheets': true,
                'features.enableTaskAttachments': true,
                'features.enableEscalations': true,
                'attendancePolicies.allowSelfServiceCheckIn': true,
                'attendancePolicies.allowAttendanceAdjustments': true,
                'attendancePolicies.autoCheckOut': false,
                'attendancePolicies.overtimeThresholdMinutes': 480,
                'attendancePolicies.halfDayThresholdMinutes': 240,
                updatedBy: companyAdminUser._id,
            },
        },
        { upsert: true, new: true }
    );

    // Update CompanyModuleAccess to guarantee manager module is globally enabled
    await CompanyModuleAccess.findOneAndUpdate(
        { companyId },
        {
            $set: {
                globalSettings: {
                    dashboard: true,
                    attendance: true,
                    projects: true,
                    tasks: true,
                    dropbox: true,
                    chat: true,
                    meetings: true,
                    'live-monitoring': true,
                    'detailed-monitoring': true,
                    timesheet: true,
                    leave: true,
                    reports: true,
                    'user-reviews': true,
                    'status-updates': true,
                    calendar: true,
                    shifts: true,
                    manager: true,
                },
                updatedBy: companyAdminUser._id,
            },
        },
        { upsert: true, new: true }
    );

    // Ensure active subscription
    let subscription = await Subscription.findOne({ companyId, status: 'ACTIVE' });
    if (!subscription) {
        const periodStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        subscription = await Subscription.create({
            companyId,
            planId: defaultPlan._id,
            status: 'ACTIVE',
            startedAt: periodStart,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            isComplimentary: true,
        });
        targetCompany.subscriptionId = subscription._id as Types.ObjectId;
        await targetCompany.save();
    }

    // 12 Designations covering full cross-functional team structure
    const designationNames = [
        'Software Engineering',
        'Quality Assurance & Automation',
        'Product & Project Management',
        'UI/UX Design',
        'DevOps & Cloud Infrastructure',
        'Site Reliability Engineering',
        'Mobile Development (iOS/Android)',
        'Data & Analytics Engineering',
        'Cybersecurity & Compliance',
        'Enterprise Integration Architecture',
        'Technical Product Owner',
        'Frontend Architecture',
    ];

    const designations: any[] = [];
    for (const name of designationNames) {
        let d = await Designation.findOne({ companyId, name });
        if (!d) {
            d = await Designation.create({
                companyId,
                name,
                description: `Organizational designation for ${name}`,
                isActive: true,
                createdBy: companyAdminUser._id,
            });
        }
        designations.push(d);
    }

    // 6 Company Roles
    const companyRoleNames = [
        'Admin',
        'Project Manager',
        'Senior Staff Engineer',
        'Lead QA Engineer',
        'Senior Product Designer',
        'DevOps Specialist',
    ];
    const companyRoles: any[] = [];
    for (const name of companyRoleNames) {
        let r = await CompanyRole.findOne({ companyId, name });
        if (!r) {
            r = await CompanyRole.create({
                companyId,
                name,
                description: `Internal tenant role for ${name}`,
                isActive: true,
                createdBy: companyAdminUser._id,
            });
        }
        companyRoles.push(r);
    }

    // Ensure Admin has a CompanyMember entry
    const existingAdminMember = await CompanyMember.findOne({ companyId, userId: companyAdminUser._id });
    if (!existingAdminMember) {
        await CompanyMember.create({
            companyId,
            userId: companyAdminUser._id,
            roleId: companyRoles[0]._id,
            designationId: designations[2]._id,
            memberType: 'EMPLOYEE',
            status: 'ACTIVE',
            joinedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        });
    }

    console.log('✅ Settings, module access, subscription, 12 designations & roles active.\n');

    // ── Phase 4: 4 Managers, 8 Teams & 40 Employees ──
    console.log('👥 [Phase 4/13] Provisioning 4 Managers, 8 Teams, 8 Leads & 40 Employees...');

    // 4 Managers (Each will manage exactly 2 teams)
    const managersConfig = [
        {
            name: 'Sarah Jenkins',
            email: 'qa.manager01@uworksphere.test',
            phone: '+1-555-011-0001',
            designationIdx: 0, // Software Engineering
            roleIdx: 1,        // Project Manager
            avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
        },
        {
            name: 'David Chen',
            email: 'qa.manager02@uworksphere.test',
            phone: '+1-555-011-0002',
            designationIdx: 3, // UI/UX Design
            roleIdx: 1,
            avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
        },
        {
            name: 'Elena Rostova',
            email: 'qa.manager03@uworksphere.test',
            phone: '+1-555-011-0003',
            designationIdx: 1, // QA & Automation
            roleIdx: 1,
            avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150',
        },
        {
            name: 'Marcus Vance',
            email: 'qa.manager04@uworksphere.test',
            phone: '+1-555-011-0004',
            designationIdx: 2, // Product & PM
            roleIdx: 1,
            avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
        },
    ];

    const managerUsers: any[] = [];
    for (const m of managersConfig) {
        const user = await User.create({
            companyId,
            name: `${m.name} (Manager)`,
            email: m.email,
            phoneNumber: m.phone,
            password: hashedPassword,
            role: managerRole._id,
            avatar: m.avatar,
            isActive: true,
            status: 'ACTIVE',
            mustChangePassword: false,
        });

        await CompanyMember.create({
            companyId,
            userId: user._id,
            roleId: companyRoles[m.roleIdx]._id,
            designationId: designations[m.designationIdx]._id,
            memberType: 'MANAGER',
            status: 'ACTIVE',
            joinedAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
        });

        await ManagerPermission.create({
            companyId,
            managerId: user._id,
            permissions: ALL_MANAGER_PERMISSION_KEYS,
            restrictions: [],
            isSuspended: false,
            grantedBy: companyAdminUser._id,
            updatedBy: companyAdminUser._id,
        });

        managerUsers.push(user);
    }

    // 40 Employees
    const employeeNames = [
        'Vikram Patel', 'Priya Sharma', 'Robert Taylor', 'Ananya Gupta', 'James Wilson',
        'Emily Davis', 'Michael Brown', 'Sophia Martinez', 'Daniel White', 'Olivia Harris',
        'Lucas Clark', 'Mia Lewis', 'Alexander Robinson', 'Isabella Walker', 'Ethan Young',
        'Charlotte King', 'Benjamin Wright', 'Amelia Scott', 'Mason Green', 'Harper Adams',
        'Elijah Baker', 'Evelyn Gonzalez', 'Oliver Nelson', 'Abigail Carter', 'Noah Mitchell',
        'Ella Perez', 'Liam Roberts', 'Avery Turner', 'William Phillips', 'Scarlett Campbell',
        'Henry Evans', 'Grace Murphy', 'Sebastian Rivera', 'Chloe Cooper', 'Jack Richardson',
        'Zoey Howard', 'Owen Ward', 'Hannah Torres', 'Wyatt Peterson', 'Nora Gray',
    ];

    const employeeUsers: any[] = [];
    for (let i = 0; i < MGR_CONFIG.TOTAL_EMPLOYEES; i++) {
        const empCode = `EMP-${1001 + i}`;
        const bioId = `BIO-${padZero(i + 1)}`;
        const email = `qa.employee${padZero(i + 1)}@uworksphere.test`;
        const desigIdx = i % designations.length;
        const roleIdx = 2 + (i % 4);
        const joinOffsetDays = 100 + (i * 2);

        const user = await User.create({
            companyId,
            name: `${employeeNames[i]} (${empCode})`,
            email,
            phoneNumber: `+1-555-021-${padZero(i + 1)}0`,
            password: hashedPassword,
            role: employeeRole._id,
            isActive: true,
            status: 'ACTIVE',
            mustChangePassword: false,
        });

        await CompanyMember.create({
            companyId,
            userId: user._id,
            roleId: companyRoles[roleIdx]._id,
            designationId: designations[desigIdx]._id,
            memberType: 'EMPLOYEE',
            biometricId: bioId,
            status: 'ACTIVE',
            joinedAt: new Date(Date.now() - joinOffsetDays * 24 * 60 * 60 * 1000),
        });

        employeeUsers.push(user);
    }

    // 8 Teams Configuration (Each manager manages exactly 2 teams)
    // Team Leads: Employees 0..7
    const teamsConfig = [
        // Manager 1 (Sarah Jenkins)
        {
            name: 'Core Platform Engine',
            code: 'PLAT',
            departmentId: designations[0]._id, // Software Engineering
            departmentName: 'Software Engineering',
            manager: managerUsers[0],
            assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
            lead: employeeUsers[0],
            members: [employeeUsers[0], employeeUsers[1], employeeUsers[2], employeeUsers[3], employeeUsers[4]],
        },
        {
            name: 'Cloud Infrastructure & SRE',
            code: 'SRE',
            departmentId: designations[4]._id, // DevOps
            departmentName: 'DevOps & Cloud Infrastructure',
            manager: managerUsers[0],
            assignmentType: ManagerAssignmentType.ADDITIONAL_TEAM,
            lead: employeeUsers[1],
            members: [employeeUsers[5], employeeUsers[6], employeeUsers[7], employeeUsers[8], employeeUsers[9]],
        },
        // Manager 2 (David Chen)
        {
            name: 'Frontend & Design Systems',
            code: 'FED',
            departmentId: designations[3]._id, // UI/UX
            departmentName: 'UI/UX Design',
            manager: managerUsers[1],
            assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
            lead: employeeUsers[2],
            members: [employeeUsers[10], employeeUsers[11], employeeUsers[12], employeeUsers[13], employeeUsers[14]],
        },
        {
            name: 'Mobile Applications',
            code: 'MOB',
            departmentId: designations[6]._id, // Mobile
            departmentName: 'Mobile Development (iOS/Android)',
            manager: managerUsers[1],
            assignmentType: ManagerAssignmentType.ADDITIONAL_TEAM,
            lead: employeeUsers[3],
            members: [employeeUsers[15], employeeUsers[16], employeeUsers[17], employeeUsers[18], employeeUsers[19]],
        },
        // Manager 3 (Elena Rostova)
        {
            name: 'Quality Assurance & Automation',
            code: 'QA',
            departmentId: designations[1]._id, // QA
            departmentName: 'Quality Assurance & Automation',
            manager: managerUsers[2],
            assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
            lead: employeeUsers[4],
            members: [employeeUsers[20], employeeUsers[21], employeeUsers[22], employeeUsers[23], employeeUsers[24]],
        },
        {
            name: 'Security & Compliance',
            code: 'SEC',
            departmentId: designations[8]._id, // Security
            departmentName: 'Cybersecurity & Compliance',
            manager: managerUsers[2],
            assignmentType: ManagerAssignmentType.ADDITIONAL_TEAM,
            lead: employeeUsers[5],
            members: [employeeUsers[25], employeeUsers[26], employeeUsers[27], employeeUsers[28], employeeUsers[29]],
        },
        // Manager 4 (Marcus Vance)
        {
            name: 'Product Growth & Analytics',
            code: 'PGA',
            departmentId: designations[2]._id, // Product & PM
            departmentName: 'Product & Project Management',
            manager: managerUsers[3],
            assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
            lead: employeeUsers[6],
            members: [employeeUsers[30], employeeUsers[31], employeeUsers[32], employeeUsers[33], employeeUsers[34]],
        },
        {
            name: 'Enterprise Integrations',
            code: 'INT',
            departmentId: designations[9]._id, // Integration
            departmentName: 'Enterprise Integration Architecture',
            manager: managerUsers[3],
            assignmentType: ManagerAssignmentType.ADDITIONAL_TEAM,
            lead: employeeUsers[7],
            members: [employeeUsers[35], employeeUsers[36], employeeUsers[37], employeeUsers[38], employeeUsers[39]],
        },
    ];

    const teams: any[] = [];
    for (const t of teamsConfig) {
        const teamMemberIds = t.members.map((m: any) => m._id);
        const team = await Team.create({
            companyId,
            name: t.name,
            code: t.code,
            description: `Core delivery and operational engineering unit for ${t.name}`,
            departmentId: t.departmentId,
            departmentName: t.departmentName,
            leadId: t.lead._id,
            managerIds: [t.manager._id],
            memberIds: teamMemberIds,
            projectIds: [],
            isActive: true,
            isArchived: false,
            createdBy: companyAdminUser._id,
        });

        // Manager Assignment
        await ManagerAssignment.create({
            companyId,
            managerId: t.manager._id,
            assignmentType: t.assignmentType,
            teamId: team._id,
            departmentId: t.departmentId,
            permissions: ALL_MANAGER_PERMISSION_KEYS,
            accessLevel: ManagerAccessLevel.FULL,
            isActive: true,
            startDate: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
            assignedBy: companyAdminUser._id,
        });

        teams.push(team);
    }

    console.log(`✅ Seeded 4 Managers, 8 Teams, 8 Team Leads & 40 Employees.\n`);

    // ── Phase 5: 6 Clients ──
    console.log('🤝 [Phase 5/13] Provisioning 6 Clients...');
    const clientConfigs = [
        { name: 'John Sterling', companyName: 'Apex Financial Corp', email: 'qa.client01@uworksphere.test', phone: '+1-555-031-0001' },
        { name: 'Emma Watson', companyName: 'Horizon Logistics Global', email: 'qa.client02@uworksphere.test', phone: '+1-555-031-0002' },
        { name: 'Carlos Rodriguez', companyName: 'OmniHealth HealthCare', email: 'qa.client03@uworksphere.test', phone: '+1-555-031-0003' },
        { name: 'Aisha Al-Mansoor', companyName: 'Global Retail Commerce', email: 'qa.client04@uworksphere.test', phone: '+1-555-031-0004' },
        { name: 'Liam O\'Connor', companyName: 'Nova Media Streaming', email: 'qa.client05@uworksphere.test', phone: '+1-555-031-0005' },
        { name: 'Astrid Lindqvist', companyName: 'Quantum Robotics Nordic', email: 'qa.client06@uworksphere.test', phone: '+1-555-031-0006' },
    ];

    const clientUsers: any[] = [];
    for (const c of clientConfigs) {
        const clientUser = await User.create({
            companyId,
            name: `${c.name} (${c.companyName})`,
            email: c.email,
            phoneNumber: c.phone,
            password: hashedPassword,
            role: userRole._id,
            isActive: true,
            status: 'ACTIVE',
            mustChangePassword: false,
        });

        await CompanyMember.create({
            companyId,
            userId: clientUser._id,
            roleId: companyRoles[0]._id,
            designationId: designations[2]._id,
            memberType: 'CLIENT',
            status: 'ACTIVE',
            joinedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        });

        clientUsers.push(clientUser);
    }
    console.log('✅ 6 Clients seeded successfully.\n');

    // ── Phase 6: Master Task Statuses & 24 Projects ──
    console.log('🚀 [Phase 6/13] Provisioning 24 Projects Across 8 Teams with Sprints, Releases & Modules...');

    const statusDefs = [
        { name: 'To Do', color: '#6B7280', orderIndex: 0, isMaster: true, isCompleted: false },
        { name: 'In Progress', color: '#3B82F6', orderIndex: 1, isMaster: true, isCompleted: false },
        { name: 'In Review', color: '#F59E0B', orderIndex: 2, isMaster: true, isCompleted: false },
        { name: 'Blocked', color: '#EF4444', orderIndex: 3, isMaster: true, isCompleted: false },
        { name: 'Completed', color: '#10B981', orderIndex: 4, isMaster: true, isCompleted: true },
    ];

    const masterStatuses = await Status.insertMany(
        statusDefs.map((s) => ({
            companyId,
            ...s,
            isActive: true,
            createdBy: companyAdminUser._id,
        }))
    );

    const statusMap = new Map(masterStatuses.map((s) => [s.name, s]));

    // 24 Projects Definition (3 per team)
    const projectTemplates = [
        // Team 0: Core Platform Engine (Sarah)
        { teamIdx: 0, clientIdx: 0, name: 'Microservices Mesh Migration', desc: 'Deploy Istio service mesh across production Kubernetes clusters.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.CRITICAL, startOffset: -80, endOffset: 45, progress: 65 },
        { teamIdx: 0, clientIdx: 1, name: 'High-Throughput Event Streaming', desc: 'Kafka cluster event ingestion pipeline handling 100k events/sec.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -60, endOffset: 30, progress: 50 },
        { teamIdx: 0, clientIdx: 2, name: 'Legacy Monolith Decommissioning', desc: 'Phase out legacy monolithic backend modules cleanly.', status: ProjectStatus.COMPLETED, priority: ProjectPriority.MEDIUM, startOffset: -90, endOffset: -10, progress: 100 },

        // Team 1: Cloud Infrastructure & SRE (Sarah)
        { teamIdx: 1, clientIdx: 3, name: 'Kubernetes Auto-Scaling Framework', desc: 'Implement KEDA and predictive auto-scaling for cluster cost-performance.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.CRITICAL, startOffset: -75, endOffset: 40, progress: 70 },
        { teamIdx: 1, clientIdx: 4, name: 'Multi-Region Disaster Recovery', desc: 'Cross-region automated failover architecture on AWS.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -50, endOffset: 60, progress: 40 },
        { teamIdx: 1, clientIdx: 5, name: 'Cloud Cost Optimization Reroute', desc: 'FinOps cluster auditing and spot instance migration saving 35%.', status: ProjectStatus.COMPLETED, priority: ProjectPriority.MEDIUM, startOffset: -90, endOffset: -15, progress: 100 },

        // Team 2: Frontend & Design Systems (David)
        { teamIdx: 2, clientIdx: 0, name: 'Design System 3.0 Web Components', desc: 'Unified Tailwind CSS and React design tokens and component library.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -70, endOffset: 35, progress: 75 },
        { teamIdx: 2, clientIdx: 1, name: 'Accessibility & WCAG 2.1 AA Audit', desc: 'Full semantic HTML and screen-reader accessibility overhaul.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.MEDIUM, startOffset: -45, endOffset: 25, progress: 55 },
        { teamIdx: 2, clientIdx: 2, name: 'Admin Dashboard Component Redesign', desc: 'Modern responsive metrics view and data-table virtual scrolling.', status: ProjectStatus.COMPLETED, priority: ProjectPriority.MEDIUM, startOffset: -85, endOffset: -5, progress: 100 },

        // Team 3: Mobile Applications (David)
        { teamIdx: 3, clientIdx: 3, name: 'iOS Native Performance Rewrite', desc: 'SwiftUI redesign for sub-second app launch and smooth 120fps.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.CRITICAL, startOffset: -80, endOffset: 20, progress: 60 },
        { teamIdx: 3, clientIdx: 4, name: 'Android Offline Sync Engine', desc: 'Room DB SQLite background synchronization for spotty connections.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -55, endOffset: 45, progress: 45 },
        { teamIdx: 3, clientIdx: 5, name: 'Biometric Authentication Integration', desc: 'FaceID and Fingerprint biometric authentication gating.', status: ProjectStatus.ON_HOLD, priority: ProjectPriority.LOW, startOffset: -40, endOffset: 50, progress: 20 },

        // Team 4: QA & Automation (Elena)
        { teamIdx: 4, clientIdx: 0, name: 'End-to-End Playwright Regression', desc: 'Automated CI/CD end-to-end regression suites covering 100% core user flows.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -65, endOffset: 30, progress: 80 },
        { teamIdx: 4, clientIdx: 1, name: 'Load & Stress Testing Automation', desc: 'k6 performance benchmarking against 50,000 concurrent virtual users.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -50, endOffset: 40, progress: 60 },
        { teamIdx: 4, clientIdx: 2, name: 'Cross-Browser Visual Regression CI', desc: 'Percy/Applitools snapshot diffing integrated into GitHub Actions.', status: ProjectStatus.COMPLETED, priority: ProjectPriority.MEDIUM, startOffset: -90, endOffset: -20, progress: 100 },

        // Team 5: Security & Compliance (Elena)
        { teamIdx: 5, clientIdx: 3, name: 'Zero-Trust IAM & Vault Rotation', desc: 'Dynamic secret rotation and HashiCorp Vault pod identity integration.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.CRITICAL, startOffset: -80, endOffset: 15, progress: 70 },
        { teamIdx: 5, clientIdx: 4, name: 'SOC2 Type II Audit Readiness', desc: 'Evidence automation and continuous compliance monitoring.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -60, endOffset: 30, progress: 50 },
        { teamIdx: 5, clientIdx: 5, name: 'Container Vulnerability Auto-Remediation', desc: 'Trivy scanner integration with automated Dockerfile bump PRs.', status: ProjectStatus.PLANNING, priority: ProjectPriority.MEDIUM, startOffset: -10, endOffset: 80, progress: 10 },

        // Team 6: Product Growth & Analytics (Marcus)
        { teamIdx: 6, clientIdx: 0, name: 'Real-time User Analytics Pipeline', desc: 'Clickhouse & Clickstream ingestion pipeline for behavioral cohort analysis.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -75, endOffset: 30, progress: 65 },
        { teamIdx: 6, clientIdx: 1, name: 'Onboarding Conversion Optimization', desc: 'Multi-variant A/B experiment engine reducing user time-to-first-value.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.MEDIUM, startOffset: -45, endOffset: 45, progress: 40 },
        { teamIdx: 6, clientIdx: 2, name: 'Subscription Self-Serve Upgrades', desc: 'Stripe customer portal and self-service tier upgrades with automated invoices.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -60, endOffset: 20, progress: 85 },

        // Team 7: Enterprise Integrations (Marcus)
        { teamIdx: 7, clientIdx: 3, name: 'Salesforce & HubSpot Two-Way Sync', desc: 'High-reliability bidirectional sync for accounts, leads, and contacts.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -70, endOffset: 35, progress: 60 },
        { teamIdx: 7, clientIdx: 4, name: 'Global Webhook & Event Dispatcher', desc: 'Idempotent webhook delivery with exponential backoff and dead-letter queues.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.HIGH, startOffset: -55, endOffset: 40, progress: 55 },
        { teamIdx: 7, clientIdx: 5, name: 'Enterprise Partner REST & GraphQL API', desc: 'Public developer portal, rate-limiting, and OAuth2 client credentials flow.', status: ProjectStatus.ACTIVE, priority: ProjectPriority.CRITICAL, startOffset: -80, endOffset: 25, progress: 75 },
    ];

    const projects: any[] = [];
    const nowMs = Date.now();

    for (let pIdx = 0; pIdx < projectTemplates.length; pIdx++) {
        const pDef = projectTemplates[pIdx];
        const team = teams[pDef.teamIdx];
        const client = clientUsers[pDef.clientIdx];
        const manager = teamsConfig[pDef.teamIdx].manager;

        const startDate = new Date(nowMs + pDef.startOffset * 24 * 60 * 60 * 1000);
        const endDate = new Date(nowMs + pDef.endOffset * 24 * 60 * 60 * 1000);
        const actualEndDate = pDef.status === ProjectStatus.COMPLETED ? new Date(endDate.getTime() - 5 * 24 * 60 * 60 * 1000) : null;

        const proj = await Project.create({
            companyId,
            name: pDef.name,
            code: `PRJ-${padZero(pIdx + 1)}`,
            description: pDef.desc,
            type: ProjectType.NEW,
            priority: pDef.priority,
            status: pDef.status,
            progress: pDef.progress,
            startDate,
            endDate,
            actualEndDate,
            budget: 50000 + pIdx * 10000,
            currency: 'USD',
            isActive: true,
            isArchived: false,
            createdById: companyAdminUser._id,
        });

        // Link project to team
        team.projectIds.push(proj._id);
        await team.save();

        // Project settings
        await ProjectSettings.create({
            projectId: proj._id,
            allowTeamMembersToCreateTasks: true,
            showTaskItemNumber: true,
            allowExplanation: true,
            deliveryDateMandatory: false,
            isConfidential: false,
            enableTemplateHierarchy: false,
            lastTaskItemNumber: 0,
        });

        // Project in charge (Manager)
        await ProjectInCharge.create({
            projectId: proj._id,
            userId: manager._id,
            addedById: companyAdminUser._id,
            addedAt: startDate,
        });

        // Project client
        await ProjectClient.create({
            projectId: proj._id,
            userId: client._id,
            addedById: companyAdminUser._id,
            addedAt: startDate,
        });

        // Project team members
        const teamMembers = teamsConfig[pDef.teamIdx].members;
        for (const member of teamMembers) {
            await ProjectTeamMember.create({
                projectId: proj._id,
                userId: member._id,
                addedById: companyAdminUser._id,
                canCreateTasks: true,
                addedAt: startDate,
            });
        }

        // 2 Sprints per project
        await Sprint.create([
            {
                companyId,
                projectId: proj._id,
                name: `Sprint 1 - Foundations (${proj.name})`,
                goal: 'Core architecture, design specifications, and initial deliverables.',
                status: SprintStatus.COMPLETED,
                startDate: new Date(startDate.getTime()),
                endDate: new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000),
                createdBy: manager._id,
            },
            {
                companyId,
                projectId: proj._id,
                name: `Sprint 2 - Core Implementation (${proj.name})`,
                goal: 'Sprint execution, integration tests, and delivery milestones.',
                status: pDef.status === ProjectStatus.COMPLETED ? SprintStatus.COMPLETED : SprintStatus.ACTIVE,
                startDate: new Date(startDate.getTime() + 15 * 24 * 60 * 60 * 1000),
                endDate: new Date(startDate.getTime() + 29 * 24 * 60 * 60 * 1000),
                createdBy: manager._id,
            },
        ]);

        // 1 Release per project
        await Release.create({
            companyId,
            projectId: proj._id,
            version: `v1.${pIdx + 1}.0`,
            name: `${proj.name} Milestone Release`,
            description: `Official milestone release for ${proj.name}.`,
            status: pDef.status === ProjectStatus.COMPLETED ? ReleaseStatus.RELEASED : ReleaseStatus.PLANNED,
            targetDate: endDate,
            createdBy: manager._id,
        });

        // 3 Stages per project
        await Stage.create([
            { companyId, projectId: proj._id, name: 'Planning & Specs', orderIndex: 0, isDefault: true, createdBy: manager._id },
            { companyId, projectId: proj._id, name: 'Active Development', orderIndex: 1, isDefault: false, createdBy: manager._id },
            { companyId, projectId: proj._id, name: 'Review & Staging', orderIndex: 2, isDefault: false, createdBy: manager._id },
        ]);

        // 2 Feature modules
        await Module.create([
            { companyId, projectId: proj._id, name: 'Core Engine & APIs', description: 'Underlying services and schemas', createdBy: manager._id },
            { companyId, projectId: proj._id, name: 'Integration & Telemetry', description: 'Event pipeline and UI bindings', createdBy: manager._id },
        ]);

        projects.push(proj);
    }

    console.log(`✅ Seeded 24 Projects, 48 Sprints, 24 Releases, 72 Stages, and 48 Modules.\n`);

    // ── Phase 7: 300 Tasks & 100 Subtasks Across 90 Days ──
    console.log('📋 [Phase 7/13] Generating 300 Distributed Tasks with Subtasks, Worklogs & Comments...');

    const todoStatus = statusMap.get('To Do')!;
    const inProgressStatus = statusMap.get('In Progress')!;
    const reviewStatus = statusMap.get('In Review')!;
    const blockedStatus = statusMap.get('Blocked')!;
    const completedStatus = statusMap.get('Completed')!;

    const taskPriorities = [
        TaskPriority.LOW,
        TaskPriority.MEDIUM,
        TaskPriority.HIGH,
        TaskPriority.URGENT,
    ];

    const tasks: any[] = [];
    const taskActivities: any[] = [];
    const timeTrackings: any[] = [];

    // Distribute ~12-13 tasks per project to reach 300 total tasks
    let taskCounter = 0;
    const TOTAL_TASKS = MGR_CONFIG.TOTAL_TASKS_TARGET; // 300

    for (let tIdx = 0; tIdx < TOTAL_TASKS; tIdx++) {
        const projIdx = tIdx % projects.length;
        const proj = projects[projIdx];
        const teamIdx = projectTemplates[projIdx].teamIdx;
        const teamMembers = teamsConfig[teamIdx].members;
        const assignee = teamMembers[tIdx % teamMembers.length];
        const manager = teamsConfig[teamIdx].manager;

        // Lifecycle distribution:
        // Tasks 0..199 (67%): COMPLETED (delivered across past 90 days right up to today)
        // Tasks 200..239 (13%): IN_PROGRESS (some overdue, some upcoming)
        // Tasks 240..269 (10%): TO_DO / PENDING
        // Tasks 270..284 (5%): IN_REVIEW
        // Tasks 285..299 (5%): BLOCKED / CRITICAL
        let statusObj = completedStatus;
        let progress = 100;
        let priority = taskPriorities[tIdx % taskPriorities.length];

        let createdAt: Date;
        let dueDate: Date;
        let deliveryDate: Date | null = null;
        let completedDate: Date | null = null;

        if (tIdx < 200) {
            // Completed tasks distributed across past 90 days (from day -88 to day 0 / today)
            statusObj = completedStatus;
            progress = 100;

            // Stagger completion evenly across previous 88 days up to today:
            const completionDayOffset = -88 + (tIdx * (88 / 200)); // spans -88 to 0
            const completionHour = 10 + (tIdx % 8); // 10:00 to 18:00
            completedDate = new Date(nowMs + completionDayOffset * 24 * 60 * 60 * 1000);
            completedDate.setHours(completionHour, (tIdx * 7) % 60, 0, 0);
            deliveryDate = completedDate;

            // 85% On-time delivery, 15% delayed delivery:
            if (tIdx % 7 === 0) {
                // Delayed: due date was 1-3 days before completion
                dueDate = new Date(completedDate.getTime() - (1 + (tIdx % 3)) * 24 * 60 * 60 * 1000);
            } else {
                // On-time: due date was either same day or 1-2 days after completion
                dueDate = new Date(completedDate.getTime() + (tIdx % 3) * 24 * 60 * 60 * 1000);
            }

            // Created 5-14 days before due date
            createdAt = new Date(dueDate.getTime() - (5 + (tIdx % 10)) * 24 * 60 * 60 * 1000);
        } else if (tIdx < 240) {
            // In Progress
            statusObj = inProgressStatus;
            progress = 25 + (tIdx % 5) * 12; // 25%..73%
            createdAt = new Date(nowMs - (4 + (tIdx % 16)) * 24 * 60 * 60 * 1000);
            if (tIdx % 4 === 0) {
                dueDate = new Date(nowMs - (1 + (tIdx % 4)) * 24 * 60 * 60 * 1000); // Overdue!
            } else {
                dueDate = new Date(nowMs + (2 + (tIdx % 8)) * 24 * 60 * 60 * 1000); // Upcoming!
            }
        } else if (tIdx < 270) {
            // To Do
            statusObj = todoStatus;
            progress = 0;
            createdAt = new Date(nowMs - (1 + (tIdx % 7)) * 24 * 60 * 60 * 1000);
            dueDate = new Date(nowMs + (4 + (tIdx % 12)) * 24 * 60 * 60 * 1000);
        } else if (tIdx < 285) {
            // In Review
            statusObj = reviewStatus;
            progress = 90;
            createdAt = new Date(nowMs - (3 + (tIdx % 6)) * 24 * 60 * 60 * 1000);
            dueDate = new Date(nowMs + (1 + (tIdx % 3)) * 24 * 60 * 60 * 1000);
        } else {
            // Blocked / Critical
            statusObj = blockedStatus;
            progress = 35;
            priority = TaskPriority.URGENT;
            createdAt = new Date(nowMs - (2 + (tIdx % 5)) * 24 * 60 * 60 * 1000);
            dueDate = new Date(nowMs - (1 + (tIdx % 3)) * 24 * 60 * 60 * 1000); // Overdue blocker!
        }

        const task = await Task.create({
            companyId,
            projectId: proj._id,
            title: `[${proj.code}] Feature Deliverable #${tIdx + 1} - ${proj.name}`,
            taskType: TaskType.TASK,
            priority,
            criticality: priority === TaskPriority.URGENT ? TaskCriticality.CRITICAL : TaskCriticality.NON_CRITICAL,
            statusId: statusObj._id,
            assignedToId: assignee._id,
            createdBy: manager._id,
            startDate: createdAt,
            dueDate,
            deliveryDate,
            completedDate,
            progress,
            estimatedTime: { hours: 16 + (tIdx % 24), minutes: 0 },
            actualHours: statusObj === completedStatus ? 14 + (tIdx % 22) : Math.round((progress / 100) * 16),
            createdAt,
            updatedAt: completedDate || new Date(nowMs - (tIdx % 3) * 60 * 60 * 1000),
            checklist: tIdx < 100 ? [
                {
                    title: `Subtask Unit 1: Component Specs & Implementation`,
                    isCompleted: progress >= 50,
                    completedById: assignee._id,
                    completedAt: progress >= 50 ? (completedDate || createdAt) : undefined,
                },
            ] : [],
        });

        tasks.push(task);

        // Task Activity (Status change & Comment)
        taskActivities.push({
            companyId,
            projectId: proj._id,
            taskId: task._id,
            userId: assignee._id,
            type: ActivityType.TASK_STARTED,
            content: `Task initialized with status ${statusObj.name} and progress ${progress}%.`,
            createdAt: task.createdAt,
        });

        if (statusObj === completedStatus && completedDate) {
            taskActivities.push({
                companyId,
                projectId: proj._id,
                taskId: task._id,
                userId: assignee._id,
                type: ActivityType.TASK_COMPLETED,
                content: `Task completed successfully on ${completedDate.toISOString().split('T')[0]}.`,
                createdAt: completedDate,
            });
        }

        if (statusObj === blockedStatus) {
            taskActivities.push({
                companyId,
                projectId: proj._id,
                taskId: task._id,
                userId: assignee._id,
                type: ActivityType.COMMENT,
                content: 'Dependency Blocker Encountered: Waiting on upstream API endpoint deployment and staging credentials.',
                createdAt: new Date(nowMs - 2 * 24 * 60 * 60 * 1000),
            });
        }

        // Time Tracking (Worklog)
        if (progress > 0) {
            const workedHours = statusObj === completedStatus ? 12 + (tIdx % 16) : 6 + (tIdx % 6);
            const workStartedAt = completedDate
                ? new Date(completedDate.getTime() - workedHours * 60 * 60 * 1000)
                : createdAt;
            timeTrackings.push({
                companyId,
                taskId: task._id,
                projectId: proj._id,
                userId: assignee._id,
                state: statusObj === completedStatus ? TrackingState.COMPLETED : TrackingState.TRACKING,
                startedAt: workStartedAt,
                endedAt: statusObj === completedStatus ? completedDate : undefined,
                workedSeconds: workedHours * 3600,
                intervals: [
                    {
                        type: IntervalType.WORK,
                        startedAt: workStartedAt,
                        endedAt: statusObj === completedStatus ? completedDate : new Date(createdAt.getTime() + workedHours * 60 * 60 * 1000),
                    },
                ],
                createdAt: completedDate || task.updatedAt,
            });
        }
    }

    // 5 Employees currently on break today for Workforce Capacity (PAUSED tracking state)
    for (let bIdx = 0; bIdx < 5; bIdx++) {
        const emp = employeeUsers[bIdx + 19];
        const proj = projects[bIdx % projects.length];
        const task = tasks[bIdx % tasks.length];
        timeTrackings.push({
            companyId,
            taskId: task._id,
            projectId: proj._id,
            userId: emp._id,
            state: TrackingState.PAUSED,
            startedAt: new Date(nowMs - 60 * 60 * 1000),
            workedSeconds: 120 * 60,
            intervals: [
                {
                    type: IntervalType.BREAK,
                    startedAt: new Date(nowMs - 20 * 60 * 1000),
                    reason: 'Midday Rest Break',
                },
            ],
            createdAt: new Date(),
        });
    }

    // 100 Subtasks distributed under first 100 tasks
    for (let sIdx = 0; sIdx < MGR_CONFIG.TOTAL_SUBTASKS_TARGET; sIdx++) {
        const parent = tasks[sIdx];
        const isCompleted = parent.progress === 100;
        await Task.create({
            companyId,
            projectId: parent.projectId,
            title: `Subtask ${sIdx + 1}: Implementation Unit & Unit Tests (${parent.title})`,
            taskType: TaskType.TASK,
            priority: TaskPriority.MEDIUM,
            criticality: TaskCriticality.NON_CRITICAL,
            statusId: parent.statusId,
            assignedToId: parent.assignedToId,
            createdBy: parent.createdBy,
            startDate: parent.startDate,
            dueDate: parent.dueDate,
            deliveryDate: isCompleted ? parent.deliveryDate : undefined,
            completedDate: isCompleted ? parent.completedDate : undefined,
            progress: parent.progress,
            createdAt: parent.createdAt,
            updatedAt: isCompleted ? (parent.completedDate || parent.createdAt) : parent.updatedAt,
        });
    }

    // Insert activities and time trackings
    await TaskActivity.insertMany(taskActivities);
    await TimeTracking.insertMany(timeTrackings);

    console.log(`✅ Seeded 300 Tasks, 100 Subtasks, ${taskActivities.length} Activities & ${timeTrackings.length} Worklogs.\n`);

    // ── Phase 8: 5 Shift Configurations & 90-Day Employee Shift Assignments ──
    console.log('⏰ [Phase 8/13] Provisioning 5 Shift Configurations & 90-Day Employee Assignments...');

    const shiftDefinitions = [
        {
            name: 'General Shift',
            code: 'GEN-01',
            type: 'REGULAR',
            color: '#3B82F6',
            workingDays: [1, 2, 3, 4, 5],
            startTime: '09:00',
            endTime: '18:00',
            durationMinutes: 540,
            gracePeriodMinutes: 15,
            isDefault: true,
            breaks: [{ name: 'Lunch Break', startTime: '13:00', endTime: '14:00', durationMinutes: 60, isPaid: false }],
        },
        {
            name: 'Morning Shift',
            code: 'MORN-01',
            type: 'EARLY',
            color: '#10B981',
            workingDays: [1, 2, 3, 4, 5],
            startTime: '06:00',
            endTime: '15:00',
            durationMinutes: 540,
            gracePeriodMinutes: 15,
            isDefault: false,
            breaks: [{ name: 'Breakfast Break', startTime: '09:30', endTime: '10:30', durationMinutes: 60, isPaid: false }],
        },
        {
            name: 'Evening Shift',
            code: 'EVE-01',
            type: 'LATE',
            color: '#F59E0B',
            workingDays: [1, 2, 3, 4, 5],
            startTime: '14:00',
            endTime: '23:00',
            durationMinutes: 540,
            gracePeriodMinutes: 15,
            isDefault: false,
            breaks: [{ name: 'Dinner Break', startTime: '18:00', endTime: '19:00', durationMinutes: 60, isPaid: false }],
        },
        {
            name: 'Night Shift',
            code: 'NIGHT-01',
            type: 'NIGHT',
            color: '#6366F1',
            workingDays: [1, 2, 3, 4, 5],
            startTime: '22:00',
            endTime: '07:00',
            durationMinutes: 540,
            gracePeriodMinutes: 15,
            isDefault: false,
            breaks: [{ name: 'Midnight Break', startTime: '02:00', endTime: '03:00', durationMinutes: 60, isPaid: false }],
        },
        {
            name: 'Flexible Shift',
            code: 'FLEX-01',
            type: 'FLEXIBLE',
            color: '#EC4899',
            workingDays: [1, 2, 3, 4, 5],
            startTime: '08:00',
            endTime: '20:00',
            durationMinutes: 480,
            gracePeriodMinutes: 30,
            isDefault: false,
            breaks: [{ name: 'Flex Break', startTime: '13:00', endTime: '14:00', durationMinutes: 60, isPaid: true }],
        },
    ];

    const shifts = await Shift.insertMany(
        shiftDefinitions.map((s) => ({
            companyId,
            ...s,
            isActive: true,
            createdBy: companyAdminUser._id,
        }))
    );

    // Assign all 40 employees to shifts across the 90-day window
    const shiftAssignments: any[] = [];
    const assignmentStart = new Date(nowMs - 95 * 24 * 60 * 60 * 1000);
    const assignmentEnd = new Date(nowMs + 95 * 24 * 60 * 60 * 1000);

    for (let eIdx = 0; eIdx < employeeUsers.length; eIdx++) {
        const assignedShift = shifts[eIdx % shifts.length];
        shiftAssignments.push({
            companyId,
            employeeId: employeeUsers[eIdx]._id,
            shiftId: assignedShift._id,
            effectiveFrom: assignmentStart,
            effectiveTo: assignmentEnd,
            assignedBy: companyAdminUser._id,
            status: 'ACTIVE',
        });
    }
    await EmployeeShiftAssignment.insertMany(shiftAssignments);

    console.log(`✅ Seeded 5 Shifts and assigned all 40 employees across 90 days.\n`);

    // ── Phase 9: Leave Policies, Monthly Balances & 60 Leave Requests ──
    console.log('🏖️  [Phase 9/13] Provisioning Leave Policies, Balances & 60 Leave Requests...');

    const leavePolicies = await CompanyLeavePolicy.insertMany([
        { companyId, leaveType: LeaveType.CASUAL, name: 'Casual Leave Policy', monthlyLimit: 1.5, effectiveFrom: '2026-01-01', isActive: true },
        { companyId, leaveType: LeaveType.SICK, name: 'Sick Leave Policy', monthlyLimit: 1.0, effectiveFrom: '2026-01-01', isActive: true },
        { companyId, leaveType: LeaveType.PAID, name: 'Earned / Annual Leave Policy', monthlyLimit: 1.75, effectiveFrom: '2026-01-01', isActive: true },
        { companyId, leaveType: LeaveType.MATERNITY, name: 'Maternity Leave Policy', monthlyLimit: 15.0, effectiveFrom: '2026-01-01', isActive: true },
    ]);

    // Generate monthly balances for all 40 employees across past 4 months per LeaveType
    const leaveTypesList = [LeaveType.CASUAL, LeaveType.SICK, LeaveType.PAID];
    const monthlyBalances: any[] = [];
    for (let mOffset = 0; mOffset < 4; mOffset++) {
        const balDate = new Date(nowMs - mOffset * 30 * 24 * 60 * 60 * 1000);
        const yMonth = formatYM(balDate);

        for (const emp of employeeUsers) {
            for (const lt of leaveTypesList) {
                monthlyBalances.push({
                    companyId,
                    employeeId: emp._id,
                    month: yMonth,
                    leaveType: lt,
                    allocatedPaidDays: 1.5,
                    carriedForwardPaidDays: 0,
                    totalEligiblePaidDays: 1.5,
                    requestedDays: mOffset === 0 ? 1 : 0,
                    approvedPaidDays: mOffset === 0 ? 1 : 0,
                    remainingPaidDays: mOffset === 0 ? 0.5 : 1.5,
                });
            }
        }
    }
    await EmployeeMonthlyLeaveBalance.insertMany(monthlyBalances);

    // 60 Leave Applications (42 Approved, 10 Pending, 5 Rejected, 3 Cancelled)
    // Employees 0..2 will have approved leaves active TODAY so Workforce Capacity reflects leavesToday!
    const todayYmd = formatYMD(new Date());
    const leaveRequests: any[] = [];

    // 3 Leaves Active Today
    for (let lToday = 0; lToday < 3; lToday++) {
        const emp = employeeUsers[lToday];
        const mgr = managerUsers[lToday % managerUsers.length];
        leaveRequests.push({
            companyId,
            employeeId: emp._id,
            leaveType: LeaveType.CASUAL,
            durationType: LeaveDurationType.FULL_DAY,
            startDate: todayYmd,
            endDate: todayYmd,
            totalDays: 1,
            paidDays: 1,
            reason: 'Personal urgent family appointment.',
            status: LeaveStatus.APPROVED,
            approvedBy: mgr._id,
            approvedAt: new Date(nowMs - 24 * 60 * 60 * 1000),
            appliedAt: new Date(nowMs - 48 * 60 * 60 * 1000),
            createdAt: new Date(nowMs - 48 * 60 * 60 * 1000),
        });
    }

    // Remaining 57 leaves across previous 90 days and upcoming days
    const leaveTypes = [LeaveType.CASUAL, LeaveType.SICK, LeaveType.PAID];
    for (let i = 3; i < MGR_CONFIG.TOTAL_LEAVE_TARGET; i++) {
        const emp = employeeUsers[i % employeeUsers.length];
        const mgr = managerUsers[i % managerUsers.length];
        const dayOffset = -80 + (i * 1.5);
        const lDate = new Date(nowMs + dayOffset * 24 * 60 * 60 * 1000);
        const startYmd = formatYMD(lDate);
        const endYmd = formatYMD(new Date(lDate.getTime() + (i % 2) * 24 * 60 * 60 * 1000));

        let status = LeaveStatus.APPROVED;
        let approver: any = mgr._id;
        let approvedAt: any = new Date(lDate.getTime() - 24 * 60 * 60 * 1000);

        if (i >= 50) {
            // 10 Pending approvals -> populated for Management Attention!
            status = LeaveStatus.PENDING;
            approver = null;
            approvedAt = null;
        } else if (i >= 45) {
            status = LeaveStatus.REJECTED;
        } else if (i >= 42) {
            status = LeaveStatus.CANCELLED;
            approver = null;
            approvedAt = null;
        }

        leaveRequests.push({
            companyId,
            employeeId: emp._id,
            leaveType: leaveTypes[i % leaveTypes.length],
            durationType: LeaveDurationType.FULL_DAY,
            startDate: startYmd,
            endDate: endYmd,
            totalDays: startYmd === endYmd ? 1 : 2,
            paidDays: status === LeaveStatus.APPROVED ? (startYmd === endYmd ? 1 : 2) : 0,
            reason: `Planned leave application #${i + 1} for personal commitments.`,
            status,
            approvedBy: approver,
            approvedAt,
            appliedAt: new Date(lDate.getTime() - 48 * 60 * 60 * 1000),
            createdAt: new Date(lDate.getTime() - 48 * 60 * 60 * 1000),
        });
    }
    await LeaveRequest.insertMany(leaveRequests);

    console.log(`✅ Seeded Leave Policies, ${monthlyBalances.length} Monthly Balances & 60 Leave Requests (10 Pending, 3 Active Today).\n`);

    // ── Phase 10: 90 Days of Realistic Attendance (3,600 Days + Current Operational State) ──
    console.log('📅 [Phase 10/13] Generating 90 Days of Interconnected Attendance for All 40 Employees...');

    // 4 Organization Holidays
    const holidays = await Holiday.insertMany([
        { companyId, name: 'New Year Day', date: formatYMD(new Date(nowMs - 80 * 24 * 60 * 60 * 1000)), isRecurring: false, createdBy: companyAdminUser._id },
        { companyId, name: 'Republic / Independence Celebration', date: formatYMD(new Date(nowMs - 55 * 24 * 60 * 60 * 1000)), isRecurring: false, createdBy: companyAdminUser._id },
        { companyId, name: 'Regional Tech Fest', date: formatYMD(new Date(nowMs - 30 * 24 * 60 * 60 * 1000)), isRecurring: false, createdBy: companyAdminUser._id },
        { companyId, name: 'Company Anniversary Holiday', date: formatYMD(new Date(nowMs - 12 * 24 * 60 * 60 * 1000)), isRecurring: false, createdBy: companyAdminUser._id },
    ]);
    const holidayDateSet = new Set(holidays.map((h) => h.date));

    // Attendance batch generator
    const attendanceBatch: any[] = [];
    const punchEventsBatch: any[] = [];

    // Current Day Operational Session state:
    // 24 Online/Checked In today (Employees 0..23)
    // 5 of these 24 are currently on Break (Employees 19..23) -> TimeTracking state: PAUSED
    // 3 are on Approved Leave today (Employees 0..2)
    // 8 are Offline / Not Checked In (Employees 32..39)

    for (let dayOffset = 89; dayOffset >= 0; dayOffset--) {
        const currentDate = new Date(nowMs - dayOffset * 24 * 60 * 60 * 1000);
        const ymd = formatYMD(currentDate);
        const dayOfWeek = currentDate.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
        const isHoliday = holidayDateSet.has(ymd);
        const isToday = dayOffset === 0;

        for (let eIdx = 0; eIdx < employeeUsers.length; eIdx++) {
            const emp = employeeUsers[eIdx];
            const shift = shifts[eIdx % shifts.length];
            const attId = new Types.ObjectId();

            if (isToday) {
                // Today: Operational Real-time State
                if (eIdx < 3) {
                    // On Leave Today
                    attendanceBatch.push({
                        _id: attId,
                        companyId,
                        userId: emp._id,
                        employeeId: emp._id,
                        date: ymd,
                        shiftId: shift._id,
                        status: AttendanceStatus.LEAVE,
                        punchStatus: 'ON_TIME',
                        source: 'SYSTEM',
                        metrics: { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
                    });
                } else if (eIdx >= 32) {
                    // Offline / Not checked in today
                    // (Omit check-in for today so they show as offline)
                    continue;
                } else {
                    // Present Today (eIdx 3..31) -> 29 employees clocked in!
                    const checkInHour = 9;
                    const checkInMin = (eIdx * 2) % 30; // 09:00 - 09:28
                    const checkInTime = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), checkInHour, checkInMin, 0);
                    const isLate = checkInMin > shift.gracePeriodMinutes;

                    attendanceBatch.push({
                        _id: attId,
                        companyId,
                        userId: emp._id,
                        employeeId: emp._id,
                        date: ymd,
                        shiftId: shift._id,
                        status: AttendanceStatus.PRESENT,
                        punchStatus: isLate ? 'LATE' : 'ON_TIME',
                        checkInTime,
                        actual: {
                            firstCheckIn: checkInTime,
                            lastCheckOut: null, // Still active!
                            workedMinutes: Math.min(Math.round((nowMs - checkInTime.getTime()) / 60000), 480),
                        },
                        metrics: {
                            lateMinutes: isLate ? checkInMin - shift.gracePeriodMinutes : 0,
                            earlyLeaveMinutes: 0,
                            overtimeMinutes: 0,
                        },
                        source: 'WEB',
                    });

                    punchEventsBatch.push({
                        companyId,
                        employeeId: emp._id,
                        attendanceId: attId,
                        type: AttendanceEventType.CHECK_IN,
                        timestamp: checkInTime,
                        source: 'WEB',
                    });
                }
                continue;
            }

            // Past 89 Days
            if (isWeekend) {
                attendanceBatch.push({
                    _id: attId,
                    companyId,
                    userId: emp._id,
                    employeeId: emp._id,
                    date: ymd,
                    shiftId: shift._id,
                    status: AttendanceStatus.WEEK_OFF,
                    punchStatus: 'ON_TIME',
                    source: 'SYSTEM',
                    metrics: { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
                });
                continue;
            }

            if (isHoliday) {
                attendanceBatch.push({
                    _id: attId,
                    companyId,
                    userId: emp._id,
                    employeeId: emp._id,
                    date: ymd,
                    shiftId: shift._id,
                    status: AttendanceStatus.HOLIDAY,
                    punchStatus: 'ON_TIME',
                    source: 'SYSTEM',
                    metrics: { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
                });
                continue;
            }

            // Regular Workday distribution:
            // ~88% Present, ~5% Half-Day, ~4% Leave, ~3% Absent
            const hash = (eIdx * 37 + dayOffset * 13) % 100;
            if (hash < 3) {
                // Absent
                attendanceBatch.push({
                    _id: attId,
                    companyId,
                    userId: emp._id,
                    employeeId: emp._id,
                    date: ymd,
                    shiftId: shift._id,
                    status: AttendanceStatus.ABSENT,
                    punchStatus: 'ON_TIME',
                    source: 'SYSTEM',
                    metrics: { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
                });
            } else if (hash < 7) {
                // Approved Leave
                attendanceBatch.push({
                    _id: attId,
                    companyId,
                    userId: emp._id,
                    employeeId: emp._id,
                    date: ymd,
                    shiftId: shift._id,
                    status: AttendanceStatus.LEAVE,
                    punchStatus: 'ON_TIME',
                    source: 'SYSTEM',
                    metrics: { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
                });
            } else if (hash < 12) {
                // Half-Day
                const checkIn = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 9, 0, 0);
                const checkOut = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 13, 15, 0);
                attendanceBatch.push({
                    _id: attId,
                    companyId,
                    userId: emp._id,
                    employeeId: emp._id,
                    date: ymd,
                    shiftId: shift._id,
                    status: AttendanceStatus.HALF_DAY,
                    punchStatus: 'ON_TIME',
                    checkInTime: checkIn,
                    checkOutTime: checkOut,
                    actual: { firstCheckIn: checkIn, lastCheckOut: checkOut, workedMinutes: 255 },
                    metrics: { lateMinutes: 0, earlyLeaveMinutes: 240, overtimeMinutes: 0 },
                    source: 'WEB',
                });
            } else {
                // Present
                const isLate = hash % 11 === 0;
                const isOvertime = hash % 9 === 0;
                const checkInMin = isLate ? 25 + (hash % 20) : (hash % 12);
                const checkIn = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 9, checkInMin, 0);

                const checkOutHour = isOvertime ? 19 + (hash % 2) : 18;
                const checkOutMin = hash % 20;
                const checkOut = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), checkOutHour, checkOutMin, 0);

                const totalWorkedMins = Math.round((checkOut.getTime() - checkIn.getTime()) / 60000) - 60; // deduct 1hr lunch
                const overtimeMinutes = totalWorkedMins > 480 ? totalWorkedMins - 480 : 0;
                const lateMinutes = isLate ? checkInMin - shift.gracePeriodMinutes : 0;

                attendanceBatch.push({
                    _id: attId,
                    companyId,
                    userId: emp._id,
                    employeeId: emp._id,
                    date: ymd,
                    shiftId: shift._id,
                    status: AttendanceStatus.PRESENT,
                    punchStatus: isLate ? 'LATE' : 'ON_TIME',
                    checkInTime: checkIn,
                    checkOutTime: checkOut,
                    actual: { firstCheckIn: checkIn, lastCheckOut: checkOut, workedMinutes: totalWorkedMins },
                    metrics: { lateMinutes, earlyLeaveMinutes: 0, overtimeMinutes },
                    source: 'WEB',
                });

                // Punch events (check-in, break-start, break-end, check-out)
                punchEventsBatch.push(
                    { companyId, employeeId: emp._id, attendanceId: attId, type: AttendanceEventType.CHECK_IN, timestamp: checkIn, source: 'WEB' },
                    { companyId, employeeId: emp._id, attendanceId: attId, type: AttendanceEventType.BREAK_START, timestamp: new Date(checkIn.getTime() + 4 * 60 * 60 * 1000), source: 'WEB' },
                    { companyId, employeeId: emp._id, attendanceId: attId, type: AttendanceEventType.BREAK_END, timestamp: new Date(checkIn.getTime() + 5 * 60 * 60 * 1000), source: 'WEB' },
                    { companyId, employeeId: emp._id, attendanceId: attId, type: AttendanceEventType.CHECK_OUT, timestamp: checkOut, source: 'WEB' }
                );
            }
        }
    }

    // Bulk insert attendance documents in chunks of 1000
    console.log(`   Writing ${attendanceBatch.length} attendance records & ${punchEventsBatch.length} events...`);
    const chunkSize = 1000;
    for (let i = 0; i < attendanceBatch.length; i += chunkSize) {
        await Attendance.insertMany(attendanceBatch.slice(i, i + chunkSize));
    }
    for (let i = 0; i < punchEventsBatch.length; i += chunkSize) {
        await AttendanceEvent.insertMany(punchEventsBatch.slice(i, i + chunkSize));
    }

    console.log(`✅ Seeded ${attendanceBatch.length} Attendance records & ${punchEventsBatch.length} Punch Events over 90 days.\n`);

    // ── Phase 11: 25 Escalations & Management Attention ──
    console.log('🚨 [Phase 11/13] Provisioning Escalation Rules & 25 Escalation Cases...');

    const escalationRules = await EscalationRule.insertMany([
        {
            companyId,
            ruleName: 'Critical Task SLA Overdue',
            category: EscalationCategory.WORK_INEFFICIENCY_DELAY,
            severity: EscalationSeverity.CRITICAL,
            thresholds: { occurrenceThreshold: 1, idleThresholdMinutes: 60 },
            resetPeriod: EscalationResetPeriod.NEVER,
            isEnabled: true,
            createdBy: companyAdminUser._id,
        },
        {
            companyId,
            ruleName: 'Reopened Defect Escalation',
            category: EscalationCategory.REOPENED_TASK,
            severity: EscalationSeverity.HIGH,
            thresholds: { occurrenceThreshold: 2, reopenCountThreshold: 2 },
            resetPeriod: EscalationResetPeriod.MONTHLY,
            isEnabled: true,
            createdBy: companyAdminUser._id,
        },
        {
            companyId,
            ruleName: 'Excessive Break Time Escalation',
            category: EscalationCategory.BREAK_TIME_EXCEEDED,
            severity: EscalationSeverity.MEDIUM,
            thresholds: { occurrenceThreshold: 1, breakDurationLimitMinutes: 45 },
            resetPeriod: EscalationResetPeriod.WEEKLY,
            isEnabled: true,
            createdBy: companyAdminUser._id,
        },
        {
            companyId,
            ruleName: 'Unexcused Absence / Late Check-In',
            category: EscalationCategory.LATE_CHECK_IN,
            severity: EscalationSeverity.MEDIUM,
            thresholds: { occurrenceThreshold: 2, maxViolationDuration: 30 },
            resetPeriod: EscalationResetPeriod.MONTHLY,
            isEnabled: true,
            createdBy: companyAdminUser._id,
        },
        {
            companyId,
            ruleName: 'Production Hours Discrepancy Policy',
            category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
            severity: EscalationSeverity.LOW,
            thresholds: { occurrenceThreshold: 1, customMetricThreshold: 120 },
            resetPeriod: EscalationResetPeriod.MONTHLY,
            isEnabled: true,
            createdBy: companyAdminUser._id,
        },
    ]);

    // 25 Escalation Cases (13 Resolved, 4 Pending, 3 Under Review, 3 Acknowledged, 2 Awaiting Employee)
    const caseStatuses = [
        EscalationCaseStatus.PENDING,
        EscalationCaseStatus.ACKNOWLEDGED,
        EscalationCaseStatus.UNDER_REVIEW,
        EscalationCaseStatus.AWAITING_EMPLOYEE,
        EscalationCaseStatus.RESOLVED,
    ];

    const escalationCases: any[] = [];
    const escalationAudits: any[] = [];

    for (let cIdx = 0; cIdx < MGR_CONFIG.TOTAL_ESCALATION_TARGET; cIdx++) {
        const rule = escalationRules[cIdx % escalationRules.length];
        const task = tasks[cIdx % tasks.length];
        const proj = projects[cIdx % projects.length];
        const emp = employeeUsers[cIdx % employeeUsers.length];
        const mgr = managerUsers[cIdx % managerUsers.length];

        const dayOffset = -70 + (cIdx * 2.8);
        const createdAt = new Date(nowMs + dayOffset * 24 * 60 * 60 * 1000);

        // First 13 are resolved, next 12 are open/active
        const status = cIdx < 13 ? EscalationCaseStatus.RESOLVED : caseStatuses[cIdx % (caseStatuses.length - 1)];
        const resolvedAt = status === EscalationCaseStatus.RESOLVED ? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000) : null;

        const ev = await EscalationEvent.create({
            companyId,
            employeeId: emp._id,
            category: rule.category,
            sourceModule: EscalationSourceModule.TASKS,
            sourceRecordId: task._id.toString(),
            ruleId: rule._id,
            eventDate: formatYMD(createdAt),
            eventTimestamp: createdAt,
        });

        const eCase = await EscalationCase.create({
            companyId,
            employeeId: emp._id,
            eventId: ev._id,
            ruleId: rule._id,
            category: rule.category,
            escalationLevel: 1,
            occurrenceCount: 1,
            cycleStartDate: createdAt,
            status,
            assignedManager: mgr._id,
            dueAt: new Date(createdAt.getTime() + 48 * 60 * 60 * 1000),
            resolvedAt,
            resolvedBy: status === EscalationCaseStatus.RESOLVED ? mgr._id : null,
            resolutionReason: status === EscalationCaseStatus.RESOLVED ? 'Resolution verified with manager' : null,
            createdAt,
        });

        escalationCases.push(eCase);

        escalationAudits.push({
            companyId,
            escalationCaseId: eCase._id,
            ruleId: rule._id,
            actorId: mgr._id,
            action: status === EscalationCaseStatus.RESOLVED ? EscalationAuditAction.CASE_RESOLVED : EscalationAuditAction.CASE_ASSIGNED,
            timestamp: resolvedAt || createdAt,
        });
    }

    await EscalationAudit.insertMany(escalationAudits);
    console.log(`✅ Seeded 5 Escalation Rules and 25 Escalation Cases & Audits (12 Open Cases for Management Attention).\n`);

    // ── Phase 12: 40 Meetings, Participants & Calendar Events ──
    console.log('🎙️  [Phase 12/13] Provisioning 40 Meetings, Participants & Calendar Events...');

    const meetingTitles = [
        'Weekly Sprint Planning & Backlog Refinement',
        'Cross-Functional Architecture Review',
        'Daily Standup & Blocker Sync',
        'Engineering Quality & Release Readiness',
        'Client Milestone Demo & Review',
        'SRE & Reliability Performance Sync',
        'Security Compliance & Pen-test Review',
        'Product Roadmap & Capacity Planning',
    ];

    const meetings: any[] = [];
    const participants: any[] = [];
    const calendarEvents: any[] = [];

    for (let mIdx = 0; mIdx < MGR_CONFIG.TOTAL_MEETINGS_TARGET; mIdx++) {
        const proj = projects[mIdx % projects.length];
        const teamIdx = projectTemplates[mIdx % projects.length].teamIdx;
        const team = teams[teamIdx];
        const teamMembers = teamsConfig[teamIdx].members;
        const manager = teamsConfig[teamIdx].manager;

        const dayOffset = -80 + (mIdx * 2.1);
        const startAt = new Date(nowMs + dayOffset * 24 * 60 * 60 * 1000);
        startAt.setHours(10 + (mIdx % 5), (mIdx % 2) * 30, 0, 0);
        const durationMins = 45;
        const endAt = new Date(startAt.getTime() + durationMins * 60 * 1000);

        let status = MeetingStatus.COMPLETED;
        if (dayOffset > 0) {
            status = mIdx % 3 === 0 ? MeetingStatus.PENDING : MeetingStatus.ACCEPTED;
        } else if (Math.abs(dayOffset) < 1) {
            status = MeetingStatus.IN_PROGRESS;
        }

        const meeting = await Meeting.create({
            meetingId: `MTG-${(targetCompany.slug || 'ULTRAKEY').toUpperCase()}-${1000 + mIdx}`,
            companyId,
            organizerId: manager._id,
            title: `${meetingTitles[mIdx % meetingTitles.length]} (${proj.name})`,
            agenda: `Strategic alignment on sprint deliverables, capacity allocation, and active blockers for ${proj.name}.`,
            description: `Collaborative engineering and delivery review for ${proj.name}.`,
            projectId: proj._id,
            meetingType: MeetingType.SCHEDULED,
            meetingLink: `https://meet.uworksphere.test/${proj.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${mIdx}`,
            meetingProvider: 'google_meet',
            scheduledStartAt: startAt,
            scheduledEndAt: endAt,
            durationMinutes: durationMins,
            timezone: 'Asia/Kolkata',
            status,
            currentVersion: 1,
            completedAt: status === MeetingStatus.COMPLETED ? endAt : null,
        });

        meetings.push(meeting);

        // Add Organizer
        participants.push({
            meetingId: meeting._id,
            userId: manager._id,
            companyId,
            role: ParticipantRole.ORGANIZER,
            responseStatus: ParticipantResponseStatus.ACCEPTED,
            joinedAt: status === MeetingStatus.COMPLETED ? startAt : null,
            leftAt: status === MeetingStatus.COMPLETED ? endAt : null,
        });

        // Add Team members as attendees
        for (const member of teamMembers) {
            participants.push({
                meetingId: meeting._id,
                userId: member._id,
                companyId,
                role: ParticipantRole.REQUIRED,
                responseStatus: ParticipantResponseStatus.ACCEPTED,
                joinedAt: status === MeetingStatus.COMPLETED ? startAt : null,
                leftAt: status === MeetingStatus.COMPLETED ? endAt : null,
            });
        }

        // Calendar event for manager
        calendarEvents.push({
            companyId,
            title: meeting.title,
            description: meeting.description || '',
            startTime: startAt,
            endTime: endAt,
            meetingType: 'video',
            provider: 'none',
            organizer: {
                userId: manager._id,
                name: manager.name,
                email: manager.email,
            },
            participants: teamMembers.map((m: any) => ({
                userId: m._id,
                name: m.name,
                email: m.email,
                status: 'accepted',
            })),
        });
    }

    await MeetingParticipant.insertMany(participants);
    await CalendarEvent.insertMany(calendarEvents);
    console.log(`✅ Seeded 40 Meetings, ${participants.length} Participants & 40 Calendar Events.\n`);

    // ── Phase 13: Live Monitoring, Alerts, Notifications & Validation Audit ──
    console.log('📡 [Phase 13/13] Provisioning Live Monitoring, Alerts, Audit Logs & Validation...');

    // 200 Monitoring Activity logs
    const monitoringActivities: any[] = [];
    const eventTypes = [
        MonitoringEventType.TASK_STARTED,
        MonitoringEventType.TASK_COMPLETED,
        MonitoringEventType.TASK_STATUS_CHANGED,
        MonitoringEventType.ATTENDANCE_CHECKED_IN,
        MonitoringEventType.ATTENDANCE_CHECKED_OUT,
        MonitoringEventType.BREAK_STARTED,
        MonitoringEventType.MEETING_STARTED,
        MonitoringEventType.PRESENCE_ONLINE,
        MonitoringEventType.ALERT_CREATED,
    ];

    for (let aIdx = 0; aIdx < MGR_CONFIG.TOTAL_MONITORING_TARGET; aIdx++) {
        const emp = employeeUsers[aIdx % employeeUsers.length];
        const proj = projects[aIdx % projects.length];
        const task = tasks[aIdx % tasks.length];
        const dayOffset = -85 + (aIdx * 0.42);

        monitoringActivities.push({
            companyId,
            eventId: randomUUID(),
            sequence: aIdx + 1,
            eventType: eventTypes[aIdx % eventTypes.length],
            actorId: emp._id,
            actorName: emp.name,
            employeeId: emp._id,
            employeeName: emp.name,
            projectId: proj._id,
            projectName: proj.name,
            taskId: task._id,
            taskTitle: task.title,
            summary: `Telemetry activity recorded for ${emp.name} on ${proj.name}.`,
            metadata: { branch: 'main', commit: `c0ffee${aIdx}`, activeDurationSeconds: 180 + (aIdx % 300) },
            occurredAt: new Date(nowMs + dayOffset * 24 * 60 * 60 * 1000),
        });
    }
    await MonitoringActivity.insertMany(monitoringActivities);

    // 15 Monitoring Alerts
    const alertTypes = [
        AlertType.OVERDUE_TASK,
        AlertType.BLOCKED_TASK,
        AlertType.MISSED_CHECK_IN,
        AlertType.UPCOMING_DEADLINE,
        AlertType.PROJECT_AT_RISK,
    ];

    const alerts: any[] = [];
    for (let alIdx = 0; alIdx < 15; alIdx++) {
        const emp = employeeUsers[alIdx % employeeUsers.length];
        const proj = projects[alIdx % projects.length];
        const task = tasks[alIdx % tasks.length];

        alerts.push({
            companyId,
            alertType: alertTypes[alIdx % alertTypes.length],
            severity: alIdx % 3 === 0 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
            status: alIdx < 5 ? AlertStatus.ACTIVE : AlertStatus.RESOLVED,
            title: `Monitoring Alert #${alIdx + 1}: ${alertTypes[alIdx % alertTypes.length]}`,
            summary: `Automated telemetry signal detected for ${emp.name} on ${proj.name}.`,
            dedupKey: `alert-${alIdx}-${randomUUID()}`,
            resourceType: 'TASK',
            resourceId: task._id,
            metadata: { iteration: alIdx },
            createdAt: new Date(nowMs - (15 - alIdx) * 24 * 60 * 60 * 1000),
        });
    }
    await MonitoringAlert.insertMany(alerts);

    // 80 Notifications
    const notifications: any[] = [];
    for (let nIdx = 0; nIdx < 80; nIdx++) {
        const recipient = nIdx % 2 === 0 ? managerUsers[nIdx % managerUsers.length] : employeeUsers[nIdx % employeeUsers.length];
        notifications.push({
            recipientId: recipient._id,
            companyId,
            title: `Team Notification #${nIdx + 1}`,
            message: `Delivery milestone update and progress summary recorded.`,
            type: 'TASK',
            category: 'TASK_ASSIGNED',
            priority: 'MEDIUM',
            style: 'INFO',
            icon: 'bell',
            isRead: nIdx < 50,
            createdAt: new Date(nowMs - (80 - nIdx) * 60 * 60 * 1000),
        });
    }
    await Notification.insertMany(notifications);

    // 80 Audit Logs
    const auditLogs: any[] = [];
    const auditActions = [
        AuditAction.USER_LOGIN,
        AuditAction.PROJECT_CREATED,
        AuditAction.PROJECT_UPDATED,
        AuditAction.COMPANY_SETTINGS_UPDATED,
        AuditAction.USER_ACTIVATED,
    ];
    for (let auIdx = 0; auIdx < 80; auIdx++) {
        const actor = auIdx % 3 === 0 ? companyAdminUser : managerUsers[auIdx % managerUsers.length];
        const target = employeeUsers[auIdx % employeeUsers.length];
        auditLogs.push({
            action: auditActions[auIdx % auditActions.length],
            actorId: actor._id,
            actorEmail: actor.email,
            actorRole: actor.email.includes('admin') ? 'COMPANY_ADMIN' : 'MANAGER',
            targetUserId: target._id,
            targetEmail: target.email,
            companyId,
            companyName: targetCompany.name,
            metadata: { iteration: auIdx, environment: 'manager-workspace-seed' },
            ipAddress: '192.168.1.100',
            userAgent: 'Mozilla/5.0 WorkSphere QA Harness',
            success: true,
            description: `Audit trail event: ${auditActions[auIdx % auditActions.length]} executed by ${actor.name}`,
            createdAt: new Date(nowMs - (80 - auIdx) * 24 * 60 * 60 * 1000),
        });
    }
    await AuditLog.insertMany(auditLogs);

    // ── Final Verification Count Checks ──
    const [
        totalTeamsInDb,
        totalProjectsInDb,
        totalTasksInDb,
        totalAttendanceInDb,
        totalLeaveInDb,
        totalEscalationsInDb,
        totalMeetingsInDb,
        totalMonitoringInDb,
    ] = await Promise.all([
        Team.countDocuments({ companyId }),
        Project.countDocuments({ companyId }),
        Task.countDocuments({ companyId }),
        Attendance.countDocuments({ companyId }),
        LeaveRequest.countDocuments({ companyId }),
        EscalationCase.countDocuments({ companyId }),
        Meeting.countDocuments({ companyId }),
        MonitoringActivity.countDocuments({ companyId }),
    ]);

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('----------------------------------------------------------------');
    console.log('         MANAGER WORKSPACE 90-DAY AUDIT SUMMARY REPORT');
    console.log('----------------------------------------------------------------');
    console.log(`🏢 Organization:                    ${targetCompany.name} (${companyId})`);
    console.log(`👥 Managers Assigned:               ${MGR_CONFIG.TOTAL_MANAGERS} Managers (2 Teams Each)`);
    console.log(`👥 Headcount:                       ${MGR_CONFIG.TOTAL_EMPLOYEES} Employees across 8 Teams`);
    console.log(`👥 Team Leads:                      8 Leads`);
    console.log(`🛡️  Teams:                           ${totalTeamsInDb} Teams (Verified: No Missing References)`);
    console.log(`🚀 Projects:                        ${totalProjectsInDb} Projects across 8 Teams`);
    console.log(`📋 Tasks & Delivery:                ${totalTasksInDb} Tasks + 100 Subtasks`);
    console.log(`📅 Attendance Records:              ${totalAttendanceInDb} Days across 90 Calendar Days`);
    console.log(`⏰ Shift Validity:                  5 Shifts & 40 Assignments (Active)`);
    console.log(`🏖️  Leave Applications:              ${totalLeaveInDb} Applications (10 Pending Approvals)`);
    console.log(`🚨 Escalation Cases:                ${totalEscalationsInDb} Cases (12 Open Cases)`);
    console.log(`🎙️  Meetings:                        ${totalMeetingsInDb} Meetings & Calendar Events`);
    console.log(`📡 Monitoring Activities:           ${totalMonitoringInDb} Telemetry Logs`);
    console.log('----------------------------------------------------------------');
    console.log(`🎉 90-Day Seeding Completed Successfully in ${durationSec}s!`);
    console.log('================================================================\n');

    return {
        companyId: companyId.toString(),
        companyName: targetCompany.name,
        adminEmail: companyAdminUser.email,
        managers: managersConfig.map((m) => m.email),
        teamsCount: totalTeamsInDb,
        projectsCount: totalProjectsInDb,
        tasksCount: totalTasksInDb,
        attendanceCount: totalAttendanceInDb,
        durationSec,
    };
}

// ── Standalone CLI Runner ──
if (process.argv[1] && (process.argv[1].includes('seed-manager-workspace'))) {
    const isClean = process.argv.includes('--clean');
    const isReset = process.argv.includes('--reset');
    const targetEmailArg = process.argv.find((arg) => arg.startsWith('--target-email='));
    const targetEmail = targetEmailArg ? targetEmailArg.split('=')[1] : undefined;

    seedManagerWorkspace({ forceClean: isClean, resetOnly: isReset, targetEmail })
        .then(() => {
            mongoose.disconnect().then(() => process.exit(0));
        })
        .catch((err) => {
            console.error('\n❌ SEEDING FATAL ERROR:', err);
            mongoose.disconnect().then(() => process.exit(1));
        });
}
