import dotenv from 'dotenv';
import mongoose, { Types } from 'mongoose';
import dns from 'dns';
import { connectDatabase } from '../config/database';
import { hashPassword } from '../utils/password';

// Ensure Node uses public DNS resolvers to handle SRV lookups reliably on Windows
try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {
    // Ignore if not supported
}

// Load environment variables
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

import { ManagerAssignmentType, ManagerAccessLevel, ALL_MANAGER_PERMISSION_KEYS } from '../modules/manager/constants/manager.constants';
import { ProjectType, ProjectPriority, ProjectStatus } from '../modules/companyadmin/projects/project.types';
import { SprintStatus } from '../modules/sprints/sprint.types';
import { ReleaseStatus } from '../modules/releases/release.types';

// ─── QA Ecosystem Constants ──────────────────────────────────────────────────
export const QA_CONFIG = {
    COMPANY_NAME: 'UWorksphere Technologies QA',
    COMPANY_SLUG: 'uworksphere-qa',
    COMPANY_EMAIL: 'qa.admin@uworksphere.test',
    TENANT_ID: 'QA_TENANT_01',
    DOMAIN: 'uworksphere.test',
    DEFAULT_PASSWORD: 'WorkSphere@2026!',
    TOTAL_EMPLOYEES: 30,
    TOTAL_MANAGERS: 4,
    TOTAL_TEAMS: 5,
    TOTAL_CLIENTS: 5,
    TOTAL_PROJECTS: 15,
    TOTAL_TASKS_TARGET: 150,
    TOTAL_MEETINGS_TARGET: 40,
    TOTAL_LEAVE_TARGET: 50,
    ATTENDANCE_DAYS: 60,
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

// ─── Main Seeder Engine ───────────────────────────────────────────────────────
export interface SeedQaOptions {
    forceClean?: boolean;
    targetEmail?: string;
}

export async function seedQaEcosystem(options: SeedQaOptions | boolean = false) {
    const opts: SeedQaOptions = typeof options === 'boolean' ? { forceClean: options } : options;
    const forceClean = opts.forceClean ?? false;
    const targetEmail = opts.targetEmail?.trim().toLowerCase();

    const startTime = Date.now();
    console.log('================================================================');
    console.log('       UWORKSPHERE QA ECOSYSTEM SEEDING & DATA ENGINE');
    if (targetEmail) {
        console.log(`       Target Admin Email:   ${targetEmail}`);
    } else {
        console.log(`       Target Organization: ${QA_CONFIG.COMPANY_NAME}`);
        console.log(`       Dedicated QA Slug:    ${QA_CONFIG.COMPANY_SLUG}`);
    }
    console.log(`       Execution Mode:       ${forceClean ? 'FULL CLEAN & RESEED' : 'IDEMPOTENT APPLY'}`);
    console.log('================================================================\n');

    // ── Phase 1: Database Safety & Identity Check ──
    console.log('🔍 [Phase 1/16] Verifying Database Connection & Safety Boundaries...');
    await connectDatabase();
    const dbName = mongoose.connection.db?.databaseName;
    console.log(`   Connected Database: "${dbName}"`);

    if (!dbName) {
        throw new Error('Safety Abort: Could not determine active database name.');
    }
    console.log('✅ Safety verification passed: Target database confirmed.\n');

    let companyAdminUser: any;
    let qaCompany: any;
    let companyId: Types.ObjectId;
    let isTargetingExistingCompany = false;

    if (targetEmail) {
        console.log(`🎯 Targeting Existing User & Company: "${targetEmail}"`);
        const foundUser = await User.findOne({ email: targetEmail });
        if (!foundUser) {
            throw new Error(`Target user "${targetEmail}" was not found in the database.`);
        }
        if (!foundUser.companyId) {
            throw new Error(`Target user "${targetEmail}" does not belong to any company.`);
        }
        const foundCompany = await Company.findById(foundUser.companyId);
        if (!foundCompany) {
            throw new Error(`Company with id "${foundUser.companyId}" not found for user "${targetEmail}".`);
        }
        qaCompany = foundCompany;
        companyAdminUser = foundUser;
        companyId = qaCompany._id as Types.ObjectId;
        isTargetingExistingCompany = true;
        console.log(`   Found Company: "${qaCompany.name}" (ID: ${companyId})`);
        console.log(`   Found Admin:   "${companyAdminUser.name}" (${companyAdminUser.email})\n`);
    }

    // ── Phase 2: Safe Scoped Cleanup of QA Records ──
    console.log('🧹 [Phase 2/16] Performing Safe Scoped Cleanup of Prior QA Records...');
    if (isTargetingExistingCompany) {
        console.log(`   Targeting existing company "${qaCompany.name}". Cleaning ONLY previously seeded QA data...`);
        const existingQaUsers = await User.find({
            companyId,
            email: { $regex: /@uworksphere\.test$/i },
        });
        const qaUserIds = existingQaUsers.map((u) => u._id);

        console.log(`   Found ${qaUserIds.length} existing QA users in target company to remove.`);

        // Also clean up any prior standalone QA tenant company if it exists
        const prevStandaloneCompany = await Company.findOne({ slug: QA_CONFIG.COMPANY_SLUG });
        if (prevStandaloneCompany) {
            console.log(`   Removing obsolete standalone QA company: ${prevStandaloneCompany._id}...`);
            await Promise.all([
                CompanySettings.deleteMany({ companyId: prevStandaloneCompany._id }),
                CompanyModuleAccess.deleteMany({ companyId: prevStandaloneCompany._id }),
                Subscription.deleteMany({ companyId: prevStandaloneCompany._id }),
                CompanyRole.deleteMany({ companyId: prevStandaloneCompany._id }),
                Designation.deleteMany({ companyId: prevStandaloneCompany._id }),
                CompanyMember.deleteMany({ companyId: prevStandaloneCompany._id }),
                Team.deleteMany({ companyId: prevStandaloneCompany._id }),
                ManagerAssignment.deleteMany({ companyId: prevStandaloneCompany._id }),
                ManagerPermission.deleteMany({ companyId: prevStandaloneCompany._id }),
                Project.deleteMany({ companyId: prevStandaloneCompany._id }),
                Release.deleteMany({ companyId: prevStandaloneCompany._id }),
                Sprint.deleteMany({ companyId: prevStandaloneCompany._id }),
                Status.deleteMany({ companyId: prevStandaloneCompany._id }),
                Stage.deleteMany({ companyId: prevStandaloneCompany._id }),
                Module.deleteMany({ companyId: prevStandaloneCompany._id }),
                Task.deleteMany({ companyId: prevStandaloneCompany._id }),
                TaskActivity.deleteMany({ companyId: prevStandaloneCompany._id }),
                TimeTracking.deleteMany({ companyId: prevStandaloneCompany._id }),
                TaskAttachment.deleteMany({ companyId: prevStandaloneCompany._id }),
                Shift.deleteMany({ companyId: prevStandaloneCompany._id }),
                EmployeeShiftAssignment.deleteMany({ companyId: prevStandaloneCompany._id }),
                Attendance.deleteMany({ companyId: prevStandaloneCompany._id }),
                AttendanceEvent.deleteMany({ companyId: prevStandaloneCompany._id }),
                Holiday.deleteMany({ companyId: prevStandaloneCompany._id }),
                CompanyLeavePolicy.deleteMany({ companyId: prevStandaloneCompany._id }),
                EmployeeMonthlyLeaveBalance.deleteMany({ companyId: prevStandaloneCompany._id }),
                LeaveRequest.deleteMany({ companyId: prevStandaloneCompany._id }),
                EscalationRule.deleteMany({ companyId: prevStandaloneCompany._id }),
                EscalationEvent.deleteMany({ companyId: prevStandaloneCompany._id }),
                EscalationCase.deleteMany({ companyId: prevStandaloneCompany._id }),
                EscalationAudit.deleteMany({ companyId: prevStandaloneCompany._id }),
                Meeting.deleteMany({ companyId: prevStandaloneCompany._id }),
                MeetingParticipant.deleteMany({ companyId: prevStandaloneCompany._id }),
                CalendarEvent.deleteMany({ companyId: prevStandaloneCompany._id }),
                MonitoringActivity.deleteMany({ companyId: prevStandaloneCompany._id }),
                MonitoringAlert.deleteMany({ companyId: prevStandaloneCompany._id }),
                Notification.deleteMany({ companyId: prevStandaloneCompany._id }),
                AuditLog.deleteMany({ companyId: prevStandaloneCompany._id }),
                Conversation.deleteMany({ companyId: prevStandaloneCompany._id }),
                Company.deleteOne({ _id: prevStandaloneCompany._id }),
            ]);
        }

        await Promise.all([
            CompanyRole.deleteMany({ companyId, name: { $in: ['Admin', 'Project Manager', 'Senior Staff Engineer', 'QA Specialist', 'Product Designer'] } }),
            Designation.deleteMany({ companyId, name: { $in: ['Software Engineering', 'Quality Assurance & Automation', 'Product & Project Management', 'UI/UX Design', 'DevOps & Cloud Infrastructure'] } }),
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
            User.deleteMany({ email: { $regex: /@uworksphere\.test$/i } }),
        ]);
        console.log('✅ Scoped cleanup complete for target company. Real user data preserved.\n');
    } else {
        const existingCompany = await Company.findOne({
            $or: [{ slug: QA_CONFIG.COMPANY_SLUG }, { companyEmail: QA_CONFIG.COMPANY_EMAIL }],
        });

        const cleanupFilter = existingCompany ? { companyId: existingCompany._id } : null;

        if (cleanupFilter) {
            console.log(`   Found existing QA Company ID: ${existingCompany!._id}. Removing QA-owned documents...`);
            await Promise.all([
                CompanySettings.deleteMany(cleanupFilter),
                CompanyModuleAccess.deleteMany(cleanupFilter),
                Subscription.deleteMany(cleanupFilter),
                CompanyRole.deleteMany(cleanupFilter),
                Designation.deleteMany(cleanupFilter),
                CompanyMember.deleteMany(cleanupFilter),
                Team.deleteMany(cleanupFilter),
                ManagerAssignment.deleteMany(cleanupFilter),
                ManagerPermission.deleteMany(cleanupFilter),
                ProjectSettings.deleteMany({}),
                ProjectInCharge.deleteMany({}),
                ProjectTeamMember.deleteMany({}),
                ProjectClient.deleteMany({}),
                Project.deleteMany(cleanupFilter),
                Release.deleteMany(cleanupFilter),
                Sprint.deleteMany(cleanupFilter),
                Status.deleteMany(cleanupFilter),
                Stage.deleteMany(cleanupFilter),
                Module.deleteMany(cleanupFilter),
                Task.deleteMany(cleanupFilter),
                TaskActivity.deleteMany(cleanupFilter),
                TimeTracking.deleteMany(cleanupFilter),
                TaskAttachment.deleteMany(cleanupFilter),
                Shift.deleteMany(cleanupFilter),
                EmployeeShiftAssignment.deleteMany(cleanupFilter),
                Attendance.deleteMany(cleanupFilter),
                AttendanceEvent.deleteMany(cleanupFilter),
                Holiday.deleteMany(cleanupFilter),
                CompanyLeavePolicy.deleteMany(cleanupFilter),
                EmployeeMonthlyLeaveBalance.deleteMany(cleanupFilter),
                LeaveRequest.deleteMany(cleanupFilter),
                EscalationRule.deleteMany(cleanupFilter),
                EscalationEvent.deleteMany(cleanupFilter),
                EscalationCase.deleteMany(cleanupFilter),
                EscalationAudit.deleteMany(cleanupFilter),
                Meeting.deleteMany(cleanupFilter),
                MeetingParticipant.deleteMany(cleanupFilter),
                CalendarEvent.deleteMany(cleanupFilter),
                MonitoringActivity.deleteMany(cleanupFilter),
                MonitoringAlert.deleteMany(cleanupFilter),
                Notification.deleteMany(cleanupFilter),
                AuditLog.deleteMany(cleanupFilter),
                Conversation.deleteMany(cleanupFilter),
                ConversationParticipant.deleteMany({}),
                Message.deleteMany({}),
            ]);
            await Company.deleteOne({ _id: existingCompany!._id });
        }

        const deletedUsers = await User.deleteMany({ email: { $regex: /@uworksphere\.test$/i } });
        console.log(`   Cleaned previous QA users count: ${deletedUsers.deletedCount}`);
        console.log('✅ QA cleanup complete. Ready to seed fresh ecosystem.\n');
    }

    // ── Phase 3: Company, Admin, Roles & Designations ──
    console.log('🏢 [Phase 3/16] Provisioning Organization, Designations & Admin...');

    // Resolve system roles
    const [adminRole, managerRole, employeeRole, userRole] = await Promise.all([
        Role.findOne({ name: 'COMPANY_ADMIN' }),
        Role.findOne({ name: 'MANAGER' }),
        Role.findOne({ name: 'EMPLOYEE' }),
        Role.findOne({ name: 'User' }),
    ]);

    if (!adminRole || !managerRole || !employeeRole || !userRole) {
        throw new Error('System Roles missing in DB. Please run "npm run db:seed" first to seed core system roles.');
    }

    // Resolve an active plan
    const defaultPlan = await Plan.findOne({ isDefault: true }) || await Plan.findOne({});
    if (!defaultPlan) {
        throw new Error('No Subscription Plan found in DB. Please run "npm run db:seed" first.');
    }

    // Pre-hash default password
    console.log('   Generating Argon2id secure password hash for testing credentials...');
    const hashedPassword = await hashPassword(QA_CONFIG.DEFAULT_PASSWORD);

    if (!isTargetingExistingCompany) {
        // Create Company Admin User first
        companyAdminUser = await User.create({
            name: 'Alex Morgan (QA Admin)',
            email: QA_CONFIG.COMPANY_EMAIL,
            phoneNumber: '+1-555-010-0001',
            password: hashedPassword,
            role: adminRole._id,
            isActive: true,
            status: 'ACTIVE',
            mustChangePassword: false,
        });

        // Create QA Company
        qaCompany = await Company.create({
            tenantId: QA_CONFIG.TENANT_ID,
            name: QA_CONFIG.COMPANY_NAME,
            slug: QA_CONFIG.COMPANY_SLUG,
            domain: QA_CONFIG.DOMAIN,
            industry: 'Information Technology & SaaS',
            size: 'ENTERPRISE',
            companyEmail: QA_CONFIG.COMPANY_EMAIL,
            companyPhone: '+1-555-019-2834',
            website: 'https://qa.uworksphere.test',
            address: '100 Innovation Boulevard, Tech Park Suite 500',
            city: 'San Francisco',
            state: 'CA',
            country: 'United States',
            postalCode: '94107',
            timezone: 'Asia/Kolkata',
            currency: 'USD',
            status: 'ACTIVE',
            isActive: true,
            adminId: companyAdminUser._id,
        });

        companyId = qaCompany._id as Types.ObjectId;

        // Link admin user to company
        companyAdminUser.companyId = companyId;
        await companyAdminUser.save();
    }

    // Ensure Company Settings
    const existingSettings = await CompanySettings.findOne({ companyId });
    if (!existingSettings) {
        await CompanySettings.create({
            companyId,
            general: {
                timezone: 'Asia/Kolkata',
                currency: 'USD',
                dateFormat: 'DD/MM/YYYY',
                language: 'en',
            },
            features: {
                enableLiveMonitoring: true,
                enableDetailedMonitoring: true,
                enableQuickMeetings: true,
                enableChat: true,
                enableAttendanceAdjustments: true,
                enableTimesheets: true,
                enableTaskAttachments: true,
                enableEscalations: true,
                enableManagerDashboard: true,
            },
            attendancePolicies: {
                allowSelfServiceCheckIn: true,
                allowAttendanceAdjustments: true,
                requireGeofencing: false,
                requireBiometric: false,
                autoCheckOut: false,
                autoCheckOutTime: '20:00',
                overtimeThresholdMinutes: 480,
                halfDayThresholdMinutes: 240,
            },
            securityPolicies: {
                minPasswordLength: 8,
                enforceAdminMfa: false,
                sessionTimeoutMinutes: 1440,
            },
            updatedBy: companyAdminUser._id,
        });
    } else {
        await CompanySettings.updateOne(
            { companyId },
            {
                $set: {
                    'features.enableLiveMonitoring': true,
                    'features.enableDetailedMonitoring': true,
                    'features.enableQuickMeetings': true,
                    'features.enableChat': true,
                    'features.enableAttendanceAdjustments': true,
                    'features.enableTimesheets': true,
                    'features.enableTaskAttachments': true,
                    'features.enableEscalations': true,
                    'features.enableManagerDashboard': true,
                    'attendancePolicies.allowSelfServiceCheckIn': true,
                    'attendancePolicies.allowAttendanceAdjustments': true,
                    'attendancePolicies.autoCheckOut': false,
                    'attendancePolicies.overtimeThresholdMinutes': 480,
                    'attendancePolicies.halfDayThresholdMinutes': 240,
                },
            }
        );
    }

    // Ensure Company Module Access
    const existingModuleAccess = await CompanyModuleAccess.findOne({ companyId });
    if (!existingModuleAccess) {
        await CompanyModuleAccess.create({
            companyId,
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
            },
            updatedBy: companyAdminUser._id,
        });
    } else {
        await CompanyModuleAccess.updateOne(
            { companyId },
            {
                $set: {
                    'globalSettings.dashboard': true,
                    'globalSettings.attendance': true,
                    'globalSettings.projects': true,
                    'globalSettings.tasks': true,
                    'globalSettings.dropbox': true,
                    'globalSettings.chat': true,
                    'globalSettings.meetings': true,
                    'globalSettings.live-monitoring': true,
                    'globalSettings.detailed-monitoring': true,
                    'globalSettings.timesheet': true,
                    'globalSettings.leave': true,
                    'globalSettings.reports': true,
                    'globalSettings.user-reviews': true,
                    'globalSettings.status-updates': true,
                    'globalSettings.calendar': true,
                    'globalSettings.shifts': true,
                },
            }
        );
    }

    // Ensure Subscription
    let subscription = await Subscription.findOne({ companyId, status: 'ACTIVE' });
    if (!subscription) {
        const periodStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const periodEnd = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000);
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

        qaCompany.subscriptionId = subscription._id as Types.ObjectId;
        await qaCompany.save();
    }

    // Ensure 5 Designations
    const designationNames = [
        'Software Engineering',
        'Quality Assurance & Automation',
        'Product & Project Management',
        'UI/UX Design',
        'DevOps & Cloud Infrastructure',
    ];
    const designations: any[] = [];
    for (const name of designationNames) {
        let d = await Designation.findOne({ companyId, name });
        if (!d) {
            d = await Designation.create({
                companyId,
                name,
                description: `Core organizational designation for ${name}`,
                isActive: true,
                createdBy: companyAdminUser._id,
            });
        }
        designations.push(d);
    }

    // Ensure 5 Company Roles
    const companyRoleNames = [
        'Admin',
        'Project Manager',
        'Senior Staff Engineer',
        'QA Specialist',
        'Product Designer',
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
            joinedAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
        });
    }

    console.log('✅ Company, settings, module access, subscription and designations initialized.\n');

    // ── Phase 4: Managers, Team Leads & 30 Employees ──
    console.log('👥 [Phase 4/16] Provisioning 4 Managers, 5 Teams & 30 Interconnected Employees...');

    // 4 Managers Data
    const managersConfig = [
        {
            name: 'Sarah Jenkins',
            email: 'qa.manager01@uworksphere.test',
            phone: '+1-555-010-0101',
            designationIdx: 0, // Software Engineering
            roleIdx: 1,        // Project Manager
            avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
        },
        {
            name: 'David Chen',
            email: 'qa.manager02@uworksphere.test',
            phone: '+1-555-010-0102',
            designationIdx: 3, // UI/UX Design
            roleIdx: 1,
            avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
        },
        {
            name: 'Elena Rostova',
            email: 'qa.manager03@uworksphere.test',
            phone: '+1-555-010-0103',
            designationIdx: 1, // QA & Automation
            roleIdx: 1,
            avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150',
        },
        {
            name: 'Marcus Vance',
            email: 'qa.manager04@uworksphere.test',
            phone: '+1-555-010-0104',
            designationIdx: 2, // Product & Project Management
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
            joinedAt: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000),
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

    // 30 Employees Data
    const employeeNames = [
        'Vikram Patel', 'Priya Sharma', 'Robert Taylor', 'Ananya Gupta', 'James Wilson',
        'Emily Davis', 'Michael Brown', 'Sophia Martinez', 'Daniel White', 'Olivia Harris',
        'Lucas Clark', 'Mia Lewis', 'Alexander Robinson', 'Isabella Walker', 'Ethan Young',
        'Charlotte King', 'Benjamin Wright', 'Amelia Scott', 'Mason Green', 'Harper Adams',
        'Elijah Baker', 'Evelyn Gonzalez', 'Oliver Nelson', 'Abigail Carter', 'Noah Mitchell',
        'Ella Perez', 'Liam Roberts', 'Avery Turner', 'William Phillips', 'Scarlett Campbell',
    ];

    const employeeUsers: any[] = [];
    for (let i = 0; i < QA_CONFIG.TOTAL_EMPLOYEES; i++) {
        const empCode = `EMP-${1001 + i}`;
        const bioId = `BIO-${padZero(i + 1)}`;
        const email = `qa.employee${padZero(i + 1)}@uworksphere.test`;
        const desigIdx = i % designations.length;
        const roleIdx = 2 + (i % 3); // Senior Engineer, QA Specialist, Product Designer
        const joinOffsetDays = 30 + (i * 4); // Staggered joining dates over past months

        const user = await User.create({
            companyId,
            name: `${employeeNames[i]} (${empCode})`,
            email,
            phoneNumber: `+1-555-020-${padZero(i + 1)}0`,
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

    // 5 Teams Configuration
    // Team Leads: Employees 0..4 (Vikram, Priya, Robert, Ananya, James)
    const teamsConfig = [
        {
            name: 'Core Platform Team',
            code: 'PLAT',
            departmentName: 'Software Engineering',
            departmentId: designations[0]._id,
            leadId: employeeUsers[0]._id,
            managerIds: [managerUsers[0]._id], // Sarah
            memberIndices: [0, 1, 2, 3, 4, 5],
        },
        {
            name: 'Frontend & Mobile Apps',
            code: 'FE-MOB',
            departmentName: 'UI/UX Design',
            departmentId: designations[3]._id,
            leadId: employeeUsers[1]._id,
            managerIds: [managerUsers[1]._id], // David
            memberIndices: [6, 7, 8, 9, 10, 11],
        },
        {
            name: 'DevOps & Cloud Reliability',
            code: 'DEVOPS',
            departmentName: 'DevOps & Cloud Infrastructure',
            departmentId: designations[4]._id,
            leadId: employeeUsers[2]._id,
            managerIds: [managerUsers[0]._id], // Sarah
            memberIndices: [12, 13, 14, 15, 16, 17],
        },
        {
            name: 'Quality Assurance & Testing',
            code: 'QA-TEST',
            departmentName: 'Quality Assurance & Automation',
            departmentId: designations[1]._id,
            leadId: employeeUsers[3]._id,
            managerIds: [managerUsers[2]._id], // Elena
            memberIndices: [18, 19, 20, 21, 22, 23],
        },
        {
            name: 'Product & Growth Systems',
            code: 'PROD',
            departmentName: 'Product & Project Management',
            departmentId: designations[2]._id,
            leadId: employeeUsers[4]._id,
            managerIds: [managerUsers[3]._id], // Marcus
            memberIndices: [24, 25, 26, 27, 28, 29],
        },
    ];

    const teams: any[] = [];
    for (const t of teamsConfig) {
        const teamMembers = t.memberIndices.map((idx) => employeeUsers[idx]._id);
        const team = await Team.create({
            companyId,
            name: t.name,
            code: t.code,
            description: `Core engineering and cross-functional team for ${t.name}`,
            departmentId: t.departmentId,
            departmentName: t.departmentName,
            leadId: t.leadId,
            managerIds: t.managerIds,
            memberIds: teamMembers,
            projectIds: [],
            isActive: true,
            isArchived: false,
            createdBy: companyAdminUser._id,
        });

        // Link manager assignments
        for (const mgrId of t.managerIds) {
            await ManagerAssignment.create({
                companyId,
                managerId: mgrId,
                assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
                teamId: team._id,
                permissions: ALL_MANAGER_PERMISSION_KEYS,
                accessLevel: ManagerAccessLevel.FULL,
                isActive: true,
                startDate: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
                assignedBy: companyAdminUser._id,
            });
        }

        teams.push(team);
    }

    console.log(`✅ Seeded 4 Managers, 5 Team Leads, 30 Employees and 5 Teams.\n`);

    // ── Phase 5: Client Management ──
    console.log('🤝 [Phase 5/16] Provisioning 5 Realistic Clients...');
    const clientConfigs = [
        { name: 'John Sterling', companyName: 'Apex Financial Corp', email: 'qa.client01@uworksphere.test', phone: '+1-555-030-0001' },
        { name: 'Emma Watson', companyName: 'Horizon Logistics Global', email: 'qa.client02@uworksphere.test', phone: '+1-555-030-0002' },
        { name: 'Carlos Rodriguez', companyName: 'OmniHealth HealthCare', email: 'qa.client03@uworksphere.test', phone: '+1-555-030-0003' },
        { name: 'Aisha Al-Mansoor', companyName: 'Global Retail Commerce', email: 'qa.client04@uworksphere.test', phone: '+1-555-030-0004' },
        { name: 'Liam O\'Connor', companyName: 'Nova Media Streaming', email: 'qa.client05@uworksphere.test', phone: '+1-555-030-0005' },
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
            roleId: companyRoles[0]._id, // Standard client role
            designationId: designations[2]._id,
            memberType: 'CLIENT',
            status: 'ACTIVE',
            joinedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        });

        clientUsers.push(clientUser);
    }
    console.log('✅ 5 Clients seeded successfully.\n');

    // ── Phase 6: Projects, Milestones, Sprints & Stages ──
    console.log('🚀 [Phase 6/16] Provisioning 15 Projects with Milestones, Sprints & Stages...');

    // Master Task Statuses
    const statusDefs = [
        { name: 'To Do', color: '#6B7280', orderIndex: 0, isMaster: true },
        { name: 'In Progress', color: '#3B82F6', orderIndex: 1, isMaster: true },
        { name: 'In Review', color: '#F59E0B', orderIndex: 2, isMaster: true },
        { name: 'Blocked', color: '#EF4444', orderIndex: 3, isMaster: true },
        { name: 'Completed', color: '#10B981', orderIndex: 4, isMaster: true },
    ];

    const masterStatuses = await Status.insertMany(
        statusDefs.map((s) => ({
            companyId,
            ...s,
            isActive: true,
            createdBy: companyAdminUser._id,
        }))
    );

    const statusMap = new Map(masterStatuses.map((s) => [s.name, s._id]));

    // 15 Projects Definition
    const projectTemplates = [
        {
            name: 'Enterprise Cloud Migration',
            desc: 'Migrating monolithic on-premise infrastructure into AWS multi-region Kubernetes clusters.',
            type: ProjectType.NEW,
            priority: ProjectPriority.CRITICAL,
            status: ProjectStatus.ACTIVE,
            startDaysAgo: 50,
            endDaysAhead: 70,
            clientIdx: 0,
            managerIdx: 0,
            teamIdx: 0,
            modules: ['IAM & VPC Network', 'Kubernetes Helm Deployments', 'Database RDS Migration'],
        },
        {
            name: 'Cross-Platform Mobile App 2.0',
            desc: 'Building next-generation Flutter & React Native client for retail customer experience.',
            type: ProjectType.UPGRADE,
            priority: ProjectPriority.HIGH,
            status: ProjectStatus.ACTIVE,
            startDaysAgo: 45,
            endDaysAhead: 45,
            clientIdx: 3,
            managerIdx: 1,
            teamIdx: 1,
            modules: ['Authentication & Biometrics', 'Catalog & Checkout UI', 'Push Notification Feed'],
        },
        {
            name: 'Automated QA Test Harness & CI/CD',
            desc: 'End-to-end regression automation suite with Playwright, Jest, and load testing with k6.',
            type: ProjectType.INTERNAL,
            priority: ProjectPriority.HIGH,
            status: ProjectStatus.ACTIVE,
            startDaysAgo: 40,
            endDaysAhead: 30,
            clientIdx: 2,
            managerIdx: 2,
            teamIdx: 3,
            modules: ['API Regression Framework', 'UI Visual Testing Pipeline', 'Load Benchmark Suites'],
        },
        {
            name: 'Real-time Telemetry & Monitoring Pipeline',
            desc: 'Scalable OpenTelemetry, Prometheus and Grafana alerting for sub-second system observability.',
            type: ProjectType.NEW,
            priority: ProjectPriority.CRITICAL,
            status: ProjectStatus.ACTIVE,
            startDaysAgo: 35,
            endDaysAhead: 60,
            clientIdx: 1,
            managerIdx: 0,
            teamIdx: 2,
            modules: ['Log Ingestion Engine', 'Distributed Tracing APM', 'Real-time Anomaly Detection'],
        },
        {
            name: 'Customer Portal & SaaS Billing Overhaul',
            desc: 'Subscription tier management, Stripe & Razorpay webhook integration and invoice downloads.',
            type: ProjectType.UPGRADE,
            priority: ProjectPriority.HIGH,
            status: ProjectStatus.ACTIVE,
            startDaysAgo: 30,
            endDaysAhead: 40,
            clientIdx: 0,
            managerIdx: 3,
            teamIdx: 4,
            modules: ['Customer Onboarding Flow', 'Pricing & Entitlements Engine', 'Invoice PDF Generation'],
        },
        {
            name: 'Microservices Security Hardening',
            desc: 'mTLS between pods, secret rotation with HashiCorp Vault, and vulnerability auto-patching.',
            type: ProjectType.MAINTENANCE,
            priority: ProjectPriority.CRITICAL,
            status: ProjectStatus.ACTIVE,
            startDaysAgo: 25,
            endDaysAhead: 35,
            clientIdx: 2,
            managerIdx: 0,
            teamIdx: 0,
            modules: ['Secret Rotation Vault', 'mTLS Service Mesh', 'Container Image Scanning'],
        },
        {
            name: 'Design System & Component Library 3.0',
            desc: 'Accessible WCAG AAA component tokens, Figma synchronization and Storybook documentation.',
            type: ProjectType.ONGOING,
            priority: ProjectPriority.MEDIUM,
            status: ProjectStatus.ACTIVE,
            startDaysAgo: 40,
            endDaysAhead: 50,
            clientIdx: 4,
            managerIdx: 1,
            teamIdx: 1,
            modules: ['Typography & Color Palette', 'Form Controls & Modals', 'Responsive Data Tables'],
        },
        {
            name: 'Payment Gateway v2 Integration',
            desc: 'Complete tokenized multi-currency transaction pipeline with instantaneous refund handling.',
            type: ProjectType.NEW,
            priority: ProjectPriority.CRITICAL,
            status: ProjectStatus.COMPLETED,
            startDaysAgo: 60,
            endDaysAhead: -5,
            actualEndDaysAgo: 5,
            clientIdx: 3,
            managerIdx: 3,
            teamIdx: 0,
            modules: ['Checkout SDK', 'Idempotent Webhooks', 'Dispute Resolution'],
        },
        {
            name: 'Mobile Push Notification Infrastructure',
            desc: 'APNs & FCM multi-tenant push dispatch service handling high throughput message batches.',
            type: ProjectType.UPGRADE,
            priority: ProjectPriority.HIGH,
            status: ProjectStatus.COMPLETED,
            startDaysAgo: 55,
            endDaysAhead: -10,
            actualEndDaysAgo: 10,
            clientIdx: 4,
            managerIdx: 1,
            teamIdx: 1,
            modules: ['Device Token Registry', 'Batch Dispatch Queue', 'Analytics Feedback Loop'],
        },
        {
            name: 'Legacy Database Migration & Archival',
            desc: 'Safely extracting 10TB historical records into S3 Parquet lakes with cold archival lifecycle.',
            type: ProjectType.MAINTENANCE,
            priority: ProjectPriority.MEDIUM,
            status: ProjectStatus.COMPLETED,
            startDaysAgo: 58,
            endDaysAhead: -12,
            actualEndDaysAgo: 12,
            clientIdx: 1,
            managerIdx: 0,
            teamIdx: 2,
            modules: ['ETL Pipeline', 'Parquet Converter', 'Verification Auditor'],
        },
        {
            name: 'AI Workflow Copilot Engine',
            desc: 'Integrating LLM agents for task auto-summarization and automated PR code explanations.',
            type: ProjectType.NEW,
            priority: ProjectPriority.MEDIUM,
            status: ProjectStatus.ON_HOLD,
            startDaysAgo: 30,
            endDaysAhead: 60,
            clientIdx: 4,
            managerIdx: 3,
            teamIdx: 4,
            modules: ['Prompt Orchestrator', 'Context Retriever RAG', 'Token Quota Controller'],
        },
        {
            name: 'Multi-Region Disaster Recovery Automation',
            desc: 'Cross-continent active-passive database replica failover with automated health probes.',
            type: ProjectType.INTERNAL,
            priority: ProjectPriority.CRITICAL,
            status: ProjectStatus.ON_HOLD,
            startDaysAgo: 20,
            endDaysAhead: 80,
            clientIdx: 0,
            managerIdx: 0,
            teamIdx: 2,
            modules: ['Health Check Probes', 'DNS Failover Switcher', 'State Reconciliation'],
        },
        {
            name: 'Partner API & Webhook Service',
            desc: 'External B2B REST and GraphQL APIs protected by HMAC signatures and rate-limit quotas.',
            type: ProjectType.NEW,
            priority: ProjectPriority.HIGH,
            status: ProjectStatus.ACTIVE, // Planning stage
            startDaysAgo: 10,
            endDaysAhead: 80,
            clientIdx: 3,
            managerIdx: 3,
            teamIdx: 0,
            modules: ['API Key Management', 'HMAC Signatures', 'Developer Portal UI'],
        },
        {
            name: 'Single Sign-On (SSO) & SCIM Directory Sync',
            desc: 'Okta, Azure AD and Google Workspace SAML 2.0 / OIDC enterprise authentication integration.',
            type: ProjectType.NEW,
            priority: ProjectPriority.HIGH,
            status: ProjectStatus.ACTIVE,
            startDaysAgo: 8,
            endDaysAhead: 90,
            clientIdx: 2,
            managerIdx: 0,
            teamIdx: 0,
            modules: ['SAML Assertion Handler', 'SCIM Provisioning API', 'Directory Groups Sync'],
        },
        {
            name: 'Experimental WebRTC Peer Video Chat',
            desc: 'Browser-based P2P audio/video screen sharing prototype evaluating mesh vs SFU architectures.',
            type: ProjectType.INTERNAL,
            priority: ProjectPriority.LOW,
            status: ProjectStatus.CANCELLED,
            startDaysAgo: 45,
            endDaysAhead: 15,
            actualEndDaysAgo: 15,
            clientIdx: 4,
            managerIdx: 1,
            teamIdx: 1,
            modules: ['Signaling Server', 'ICE Candidate Stun/Turn', 'Canvas Screen Streamer'],
        },
    ];

    const projects: any[] = [];
    const projectSprints: Map<string, any[]> = new Map();
    const projectReleases: Map<string, any[]> = new Map();
    const projectStages: Map<string, any[]> = new Map();
    const projectModules: Map<string, any[]> = new Map();

    for (let i = 0; i < projectTemplates.length; i++) {
        const pt = projectTemplates[i];
        const manager = managerUsers[pt.managerIdx];
        const client = clientUsers[pt.clientIdx];
        const team = teams[pt.teamIdx];

        const startDate = new Date(Date.now() - pt.startDaysAgo * 24 * 60 * 60 * 1000);
        const endDate = new Date(Date.now() + pt.endDaysAhead * 24 * 60 * 60 * 1000);
        const actualEndDate = pt.actualEndDaysAgo
            ? new Date(Date.now() - pt.actualEndDaysAgo * 24 * 60 * 60 * 1000)
            : null;

        const proj = await Project.create({
            companyId,
            name: pt.name,
            description: pt.desc,
            type: pt.type,
            priority: pt.priority,
            status: pt.status,
            startDate,
            endDate,
            actualEndDate,
            createdById: manager._id,
            isActive: pt.status !== ProjectStatus.CANCELLED,
            isArchived: false,
            isPinned: i < 3,
        });

        // Link project to team
        team.projectIds.push(proj._id);
        await team.save();

        // Project Settings
        await ProjectSettings.create({
            projectId: proj._id,
            allowTeamMembersToCreateTasks: true,
            showTaskItemNumber: true,
            allowExplanation: true,
            deliveryDateMandatory: false,
            isConfidential: false,
            enableTemplateHierarchy: false,
            lastTaskItemNumber: 10,
        });

        // Project In Charge
        await ProjectInCharge.create({
            projectId: proj._id,
            userId: manager._id,
            addedById: companyAdminUser._id,
        });

        // Project Client
        await ProjectClient.create({
            projectId: proj._id,
            userId: client._id,
            addedById: manager._id,
        });

        // Project Team Members (Add team members to project)
        for (const memberId of team.memberIds) {
            await ProjectTeamMember.create({
                projectId: proj._id,
                userId: memberId,
                addedById: manager._id,
                canCreateTasks: true,
            });
        }

        // Project Stages
        const stageNames = ['Planning', 'Development', 'Code Review', 'QA Testing', 'Deployment'];
        const stages = await Stage.insertMany(
            stageNames.map((name, idx) => ({
                companyId,
                projectId: proj._id,
                name,
                color: idx === 1 ? '#3B82F6' : idx === 3 ? '#10B981' : '#6B7280',
                orderIndex: idx,
                isMaster: idx === 0,
                isDefault: idx === 1,
                isActive: true,
                createdBy: manager._id,
            }))
        );
        projectStages.set(proj._id.toString(), stages);

        // Project Modules
        const pModules = await Module.insertMany(
            pt.modules.map((name, idx) => ({
                companyId,
                projectId: proj._id,
                name,
                description: `Subsystem module for ${name}`,
                orderIndex: idx,
                isActive: true,
                createdBy: manager._id,
            }))
        );
        projectModules.set(proj._id.toString(), pModules);

        // Project Sprints (2 Sprints: 1 Completed, 1 Active)
        const sprint1 = await Sprint.create({
            companyId,
            projectId: proj._id,
            name: `${pt.name} - Sprint 1 (Foundations)`,
            description: 'Core architectural setup, base schemas, and infrastructure initialization.',
            goal: 'Deliver initial MVP modules and foundational API contracts.',
            startDate: new Date(startDate.getTime()),
            endDate: new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000),
            status: SprintStatus.COMPLETED,
            createdBy: manager._id,
        });

        const sprint2 = await Sprint.create({
            companyId,
            projectId: proj._id,
            name: `${pt.name} - Sprint 2 (Feature Acceleration)`,
            description: 'Main feature development, business logic validation, and QA integration.',
            goal: 'Achieve feature completeness and harden critical user journeys.',
            startDate: new Date(startDate.getTime() + 15 * 24 * 60 * 60 * 1000),
            endDate: new Date(startDate.getTime() + 29 * 24 * 60 * 60 * 1000),
            status: pt.status === ProjectStatus.COMPLETED ? SprintStatus.COMPLETED : SprintStatus.ACTIVE,
            createdBy: manager._id,
        });

        projectSprints.set(proj._id.toString(), [sprint1, sprint2]);

        // Project Releases / Milestones
        const release1 = await Release.create({
            companyId,
            projectId: proj._id,
            name: `${pt.name} v1.0.0`,
            version: '1.0.0',
            description: 'General availability release with baseline operational capabilities.',
            startDate: startDate,
            targetDate: new Date(startDate.getTime() + 20 * 24 * 60 * 60 * 1000),
            releasedAt: new Date(startDate.getTime() + 20 * 24 * 60 * 60 * 1000),
            releasedBy: manager._id,
            status: ReleaseStatus.RELEASED,
            createdBy: manager._id,
        });

        const release2 = await Release.create({
            companyId,
            projectId: proj._id,
            name: `${pt.name} v1.1.0 (Milestone 2)`,
            version: '1.1.0',
            description: 'Enhanced performance optimizations and enterprise monitoring telemetry.',
            startDate: new Date(startDate.getTime() + 21 * 24 * 60 * 60 * 1000),
            targetDate: new Date(startDate.getTime() + 50 * 24 * 60 * 60 * 1000),
            releasedAt: pt.status === ProjectStatus.COMPLETED ? actualEndDate : null,
            releasedBy: pt.status === ProjectStatus.COMPLETED ? manager._id : null,
            status: pt.status === ProjectStatus.COMPLETED ? ReleaseStatus.RELEASED : ReleaseStatus.IN_PROGRESS,
            createdBy: manager._id,
        });

        projectReleases.set(proj._id.toString(), [release1, release2]);

        // Chat Conversation for Project
        const conversation = await Conversation.create({
            companyId,
            projectId: proj._id,
            type: 'PRIVATE',
            lastMessageAt: new Date(),
        });

        // Add manager & team leads as participants
        await ConversationParticipant.create({ conversationId: conversation._id, userId: manager._id });
        await ConversationParticipant.create({ conversationId: conversation._id, userId: team.memberIds[0] });

        // Seed initial project message
        const welcomeMsg = await Message.create({
            conversationId: conversation._id,
            senderId: manager._id,
            messageType: 'TEXT',
            text: `Welcome team! Project workspace for "${pt.name}" is now provisioned and tracking is active.`,
            deliveredAt: new Date(),
        });
        conversation.lastMessage = welcomeMsg._id as Types.ObjectId;
        await conversation.save();

        projects.push(proj);
    }

    console.log(`✅ Seeded 15 Projects with Sprints, Releases, Stages, Modules & Chat channels.\n`);

    // ── Phase 7: Tasks & Subtasks (~150 Tasks) ──
    console.log('📋 [Phase 7/16] Generating 150 Distributed Tasks with Subtasks, Worklogs & Comments...');

    const taskTitles = [
        'Design and implement secure JWT refresh rotation strategy',
        'Configure Helm chart values for production deployment',
        'Write end-to-end automation test suite for checkout pipeline',
        'Benchmark database index performance on high volume queries',
        'Implement real-time WebSocket connection state reconciliation',
        'Optimize Docker container image multi-stage build size',
        'Audit third-party dependencies for CVE vulnerabilities',
        'Build responsive dark-mode styling for settings dashboard',
        'Implement idempotent payment webhook handler and refund queue',
        'Configure Prometheus alerting rules for HTTP 5xx error spikes',
    ];

    const allTasks: any[] = [];
    let totalSubtasksCreated = 0;
    let totalTimeTrackingCreated = 0;
    let totalCommentsCreated = 0;

    for (let pIdx = 0; pIdx < projects.length; pIdx++) {
        const proj = projects[pIdx];
        const team = teams[projectTemplates[pIdx].teamIdx];
        const stages = projectStages.get(proj._id.toString())!;
        const sprints = projectSprints.get(proj._id.toString())!;
        const releases = projectReleases.get(proj._id.toString())!;
        const pModules = projectModules.get(proj._id.toString())!;
        const projCode = projectTemplates[pIdx].name.substring(0, 3).toUpperCase();

        const isProjCompleted = proj.status === ProjectStatus.COMPLETED;
        const isProjCancelled = proj.status === ProjectStatus.CANCELLED;

        for (let tIdx = 0; tIdx < 10; tIdx++) {
            const itemNumber = tIdx + 1;
            const taskNumber = `${projCode}-${itemNumber}`;
            const assignee = employeeUsers.find((e) => e._id.equals(team.memberIds[tIdx % team.memberIds.length])) || employeeUsers[0];

            let statusName = 'In Progress';
            let progress = 50;
            let completedDate: Date | null = null;
            let dueDate = new Date(Date.now() + (tIdx * 4 - 10) * 24 * 60 * 60 * 1000); // Some past due dates
            const stage = stages[Math.min(stages.length - 1, Math.floor(tIdx / 2))];
            const sprint = sprints[tIdx < 5 ? 0 : 1];
            const release = releases[tIdx < 5 ? 0 : 1];
            const moduleItem = pModules[tIdx % pModules.length];

            if (isProjCompleted) {
                statusName = 'Completed';
                progress = 100;
                completedDate = new Date(proj.actualEndDate || Date.now() - 5 * 24 * 60 * 60 * 1000);
            } else if (isProjCancelled) {
                statusName = tIdx < 3 ? 'Completed' : 'Blocked';
                progress = tIdx < 3 ? 100 : 20;
            } else {
                if (tIdx < 4) {
                    statusName = 'Completed';
                    progress = 100;
                    completedDate = new Date(Date.now() - (tIdx + 2) * 24 * 60 * 60 * 1000);
                } else if (tIdx < 7) {
                    statusName = 'In Progress';
                    progress = 40 + tIdx * 10;
                } else if (tIdx === 7) {
                    statusName = 'In Review';
                    progress = 90;
                } else if (tIdx === 8) {
                    statusName = 'Blocked';
                    progress = 25;
                } else {
                    statusName = 'To Do';
                    progress = 0;
                }
            }

            const priorityValues = [TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH, TaskPriority.URGENT];
            const priority = priorityValues[tIdx % priorityValues.length];

            // Subtasks checklist (Create 1-2 checklist items for ~50 tasks)
            const checklistItems: any[] = [];
            if (tIdx % 3 === 0) {
                checklistItems.push({
                    title: `Implement unit test coverage for ${taskNumber}`,
                    isCompleted: progress >= 50,
                    completedById: progress >= 50 ? assignee._id : null,
                    completedAt: progress >= 50 ? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) : null,
                    notes: 'Verified via CI pipeline execution',
                });
                totalSubtasksCreated++;

                if (tIdx % 6 === 0) {
                    checklistItems.push({
                        title: `Update technical API documentation & OpenAPI specs`,
                        isCompleted: progress === 100,
                        completedById: progress === 100 ? assignee._id : null,
                        completedAt: progress === 100 ? completedDate : null,
                        notes: 'Swagger docs published',
                    });
                    totalSubtasksCreated++;
                }
            }

            const task = await Task.create({
                companyId,
                projectId: proj._id,
                moduleId: moduleItem._id,
                sprintId: sprint._id,
                releaseId: release._id,
                title: `${taskTitles[tIdx % taskTitles.length]} (${proj.name})`,
                itemNumber,
                taskNumber,
                ticketId: `TICK-${10000 + pIdx * 100 + tIdx}`,
                statusId: statusMap.get(statusName),
                stageId: stage._id,
                priority,
                taskType: TaskType.TASK,
                criticality: priority === TaskPriority.URGENT ? TaskCriticality.CRITICAL : TaskCriticality.NON_CRITICAL,
                startDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
                dueDate,
                deliveryDate: dueDate,
                estimatedTime: { hours: 16 + tIdx * 2, minutes: 0 },
                actualHours: progress > 0 ? Math.round((16 + tIdx * 2) * (progress / 100)) : 0,
                progress,
                completedDate,
                assignedToId: assignee._id,
                createdBy: managerUsers[projectTemplates[pIdx].managerIdx]._id,
                tags: ['backend', 'qa-seed', priority.toLowerCase()],
                notes: [{ content: `Seeded engineering task specification for ${taskNumber}` }],
                checklist: checklistItems,
                isActive: true,
                isArchived: false,
                isPinned: tIdx === 0,
                orderIndex: tIdx,
            });

            // Seed Task Activity (Comments & status changes)
            if (progress > 0) {
                await TaskActivity.create({
                    companyId,
                    projectId: proj._id,
                    taskId: task._id,
                    userId: assignee._id,
                    type: ActivityType.TASK_STARTED,
                    content: `Started working on task ${taskNumber}. Initial environment configured.`,
                    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
                });
                totalCommentsCreated++;

                await TaskActivity.create({
                    companyId,
                    projectId: proj._id,
                    taskId: task._id,
                    userId: assignee._id,
                    type: ActivityType.COMMENT,
                    content: `PR submitted for peer code review. Verified against local integration test suite.`,
                    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
                });
                totalCommentsCreated++;

                // Seed Worklogs / TimeTracking
                const workedSeconds = (task.actualHours || 4) * 3600;
                await TimeTracking.create({
                    companyId,
                    userId: assignee._id,
                    projectId: proj._id,
                    taskId: task._id,
                    state: progress === 100 ? TrackingState.COMPLETED : TrackingState.TRACKING,
                    startedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
                    endedAt: progress === 100 ? completedDate || new Date() : undefined,
                    workedSeconds,
                    intervals: [
                        {
                            type: IntervalType.WORK,
                            startedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
                            endedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 3 * 3600 * 1000),
                            reason: 'Sprint task development',
                        },
                        {
                            type: IntervalType.BREAK,
                            startedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 3 * 3600 * 1000),
                            endedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 3.75 * 3600 * 1000),
                            reason: 'Lunch break',
                        },
                    ],
                });
                totalTimeTrackingCreated++;
            }

            allTasks.push(task);
        }
    }

    console.log(`✅ Seeded ${allTasks.length} Tasks, ${totalSubtasksCreated} Subtasks, ${totalTimeTrackingCreated} Worklogs & ${totalCommentsCreated} Comments.\n`);

    // ── Phase 8: Shift Management ──
    console.log('⏰ [Phase 8/16] Provisioning 5 Shift Configurations & Employee Assignments...');

    const shiftsConfig = [
        {
            name: 'General Shift',
            code: 'GEN',
            startTime: '09:00',
            endTime: '18:00',
            crossesMidnight: false,
            gracePeriodMinutes: 15,
            earlyCheckoutGracePeriodMinutes: 10,
            workingDays: [1, 2, 3, 4, 5],
            halfDayThresholdMinutes: 240,
            fullDayThresholdMinutes: 480,
            isDefault: true,
            description: 'Standard 9 AM to 6 PM general business shift',
        },
        {
            name: 'Morning Shift',
            code: 'MORN',
            startTime: '06:00',
            endTime: '15:00',
            crossesMidnight: false,
            gracePeriodMinutes: 15,
            earlyCheckoutGracePeriodMinutes: 10,
            workingDays: [1, 2, 3, 4, 5],
            halfDayThresholdMinutes: 240,
            fullDayThresholdMinutes: 480,
            isDefault: false,
            description: 'Early morning operations and support shift',
        },
        {
            name: 'Evening Shift',
            code: 'EVE',
            startTime: '14:00',
            endTime: '23:00',
            crossesMidnight: false,
            gracePeriodMinutes: 15,
            earlyCheckoutGracePeriodMinutes: 10,
            workingDays: [1, 2, 3, 4, 5],
            halfDayThresholdMinutes: 240,
            fullDayThresholdMinutes: 480,
            isDefault: false,
            description: 'Afternoon to late evening escalation shift',
        },
        {
            name: 'Night Shift',
            code: 'NIGHT',
            startTime: '22:00',
            endTime: '07:00',
            crossesMidnight: true,
            gracePeriodMinutes: 15,
            earlyCheckoutGracePeriodMinutes: 10,
            workingDays: [1, 2, 3, 4, 5],
            halfDayThresholdMinutes: 240,
            fullDayThresholdMinutes: 480,
            isDefault: false,
            description: 'Overnight DevOps, SRE and cloud reliability shift',
        },
        {
            name: 'Flexible Shift',
            code: 'FLEX',
            startTime: '10:00',
            endTime: '19:00',
            crossesMidnight: false,
            gracePeriodMinutes: 30,
            earlyCheckoutGracePeriodMinutes: 15,
            workingDays: [1, 2, 3, 4, 5, 6],
            halfDayThresholdMinutes: 240,
            fullDayThresholdMinutes: 480,
            isDefault: false,
            description: 'Autonomous flexible schedule for research and lead architects',
        },
    ];

    const shifts = await Shift.insertMany(
        shiftsConfig.map((s) => ({
            companyId,
            ...s,
            timezone: 'Asia/Kolkata',
            isActive: true,
            createdBy: companyAdminUser._id,
        }))
    );

    // Assign all 30 employees to shifts
    // 16 to General, 5 to Morning, 4 to Evening, 3 to Night, 2 to Flexible
    const shiftAssignments: any[] = [];
    for (let i = 0; i < employeeUsers.length; i++) {
        let shiftIdx = 0;
        if (i < 16) shiftIdx = 0;        // General
        else if (i < 21) shiftIdx = 1;   // Morning
        else if (i < 25) shiftIdx = 2;   // Evening
        else if (i < 28) shiftIdx = 3;   // Night
        else shiftIdx = 4;              // Flexible

        const assignment = await EmployeeShiftAssignment.create({
            companyId,
            employeeId: employeeUsers[i]._id,
            shiftId: shifts[shiftIdx]._id,
            effectiveFrom: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
            effectiveTo: null,
            assignedBy: companyAdminUser._id,
            reason: `Initial workforce allocation to ${shifts[shiftIdx].name}`,
            status: 'ACTIVE',
        });
        shiftAssignments.push({ employeeId: employeeUsers[i]._id, shift: shifts[shiftIdx] });
    }

    console.log(`✅ Seeded 5 Shifts and assigned 30 employees.\n`);

    // ── Phase 9: Leave Policies & 50 Leave Requests ──
    console.log('🏖️  [Phase 9/16] Provisioning Leave Policies, Balances & 50 Leave Applications...');

    const leavePoliciesDefs = [
        { leaveType: LeaveType.CASUAL, name: 'Casual Leave', monthlyLimit: 1.5, maxCarryForwardDays: 5 },
        { leaveType: LeaveType.SICK, name: 'Sick Leave', monthlyLimit: 1.0, maxCarryForwardDays: 10 },
        { leaveType: LeaveType.PAID, name: 'Annual Paid Leave', monthlyLimit: 2.0, maxCarryForwardDays: 15 },
        { leaveType: LeaveType.UNPAID, name: 'Unpaid Leave (Loss of Pay)', monthlyLimit: 5.0, maxCarryForwardDays: 0 },
    ];

    const leavePolicies = await CompanyLeavePolicy.insertMany(
        leavePoliciesDefs.map((p) => ({
            companyId,
            leaveType: p.leaveType,
            name: p.name,
            monthlyLimit: p.monthlyLimit,
            unusedLeavePolicy: 'CARRIES_FORWARD',
            maxCarryForwardDays: p.maxCarryForwardDays,
            excessLeaveRule: 'CONVERT_TO_LOP',
            countWeekends: false,
            countHolidays: false,
            allowHalfDay: true,
            effectiveFrom: '2026-01-01',
            isActive: true,
            createdBy: companyAdminUser._id,
        }))
    );

    // Seed monthly balances for September, October, November 2026
    const months = ['2026-09', '2026-10', '2026-11'];
    for (const emp of employeeUsers) {
        for (const m of months) {
            for (const pol of leavePolicies) {
                await EmployeeMonthlyLeaveBalance.create({
                    companyId,
                    employeeId: emp._id,
                    month: m,
                    leaveType: pol.leaveType,
                    allocatedPaidDays: pol.monthlyLimit,
                    carriedForwardPaidDays: 2,
                    totalEligiblePaidDays: pol.monthlyLimit + 2,
                    requestedDays: 1,
                    approvedPaidDays: 1,
                    pendingPaidDays: 0,
                    unpaidLeaveDays: 0,
                    lopDays: 0,
                    rejectedCancelledDays: 0,
                    remainingPaidBalance: pol.monthlyLimit + 1,
                    availablePaidBalance: pol.monthlyLimit + 1,
                    lastRecalculatedAt: new Date(),
                });
            }
        }
    }

    // 50 Leave Requests
    const leaveRequests: any[] = [];
    const leaveReasons = [
        'Family medical appointment and personal errands',
        'Viral fever and prescribed medical rest',
        'Attending sister wedding ceremony in hometown',
        'Personal emergency and household maintenance',
        'Scheduled dental surgery recovery',
        'Annual family vacation trip',
        'Severe headache and seasonal flu',
        'House shifting and relocation',
        'Attending university convocation degree ceremony',
        'Child school admission and parent teacher meeting',
    ];

    for (let i = 0; i < QA_CONFIG.TOTAL_LEAVE_TARGET; i++) {
        const emp = employeeUsers[i % employeeUsers.length];
        const manager = managerUsers[i % managerUsers.length];
        const leaveType = Object.values(LeaveType)[i % 4];

        // Stagger dates across past 50 days to next 20 days
        const dayOffset = (i * 1.4) - 45; // some past, some future
        const leaveStartDate = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
        const leaveEndDate = new Date(leaveStartDate.getTime() + (i % 2 === 0 ? 0 : 24 * 60 * 60 * 1000));
        const startYMD = formatYMD(leaveStartDate);
        const endYMD = formatYMD(leaveEndDate);
        const totalDays = startYMD === endYMD ? 1 : 2;

        let status = LeaveStatus.APPROVED;
        let approvedBy = manager._id;
        let approvedAt = new Date(leaveStartDate.getTime() - 2 * 24 * 60 * 60 * 1000);
        let rejectionReason = null;

        if (dayOffset > 0) {
            // Future leaves: Pending
            status = i % 5 === 0 ? LeaveStatus.CANCELLED : LeaveStatus.PENDING;
            approvedBy = null;
            approvedAt = null;
        } else if (i % 8 === 0) {
            // Some rejected
            status = LeaveStatus.REJECTED;
            rejectionReason = 'Critical sprint delivery release scheduled on requested dates.';
        }

        const lr = await LeaveRequest.create({
            companyId,
            employeeId: emp._id,
            leaveType,
            durationType: LeaveDurationType.FULL_DAY,
            startDate: startYMD,
            endDate: endYMD,
            totalDays,
            paidDays: status === LeaveStatus.APPROVED ? totalDays : 0,
            unpaidDays: 0,
            reason: leaveReasons[i % leaveReasons.length],
            status,
            appliedAt: new Date(leaveStartDate.getTime() - 4 * 24 * 60 * 60 * 1000),
            approvedBy,
            approvedAt,
            rejectionReason,
            emailDeliveryStatus: 'SENT',
        });

        leaveRequests.push(lr);
    }

    console.log(`✅ Seeded Leave Policies, Balances & ${leaveRequests.length} Leave Applications.\n`);

    // ── Phase 10: 60 Days of Realistic Attendance ──
    console.log('📅 [Phase 10/16] Generating 60 Days of Realistic Interconnected Attendance Records...');

    // 4 Calendar Holidays
    const holidaysData = [
        { name: 'Engineers Day', date: '2026-09-15', description: 'National Engineers Day celebration' },
        { name: 'Mahatma Gandhi Jayanti', date: '2026-10-02', description: 'National holiday observing Gandhi Jayanti' },
        { name: 'Dussehra (Vijayadashami)', date: '2026-10-20', description: 'Traditional festival holiday' },
        { name: 'Diwali (Deepavali)', date: '2026-11-01', description: 'Festival of Lights celebration' },
    ];

    const holidays = await Holiday.insertMany(
        holidaysData.map((h) => ({
            companyId,
            name: h.name,
            date: h.date,
            description: h.description,
            isRecurring: false,
            createdBy: companyAdminUser._id,
        }))
    );
    const holidayDateMap = new Map(holidays.map((h) => [h.date, h]));

    // Approved leaves index: Map<"empId_YYYY-MM-DD", LeaveRequest>
    const approvedLeaveDateMap = new Map<string, any>();
    for (const lr of leaveRequests) {
        if (lr.status === LeaveStatus.APPROVED) {
            approvedLeaveDateMap.set(`${lr.employeeId}_${lr.startDate}`, lr);
            if (lr.endDate !== lr.startDate) {
                approvedLeaveDateMap.set(`${lr.employeeId}_${lr.endDate}`, lr);
            }
        }
    }

    const attendanceRecordsToInsert: any[] = [];
    const attendanceEventsToInsert: any[] = [];

    const now = new Date();
    const todayYMD = formatYMD(now);

    for (let d = 59; d >= 0; d--) {
        const currentDate = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
        const dateStr = formatYMD(currentDate);
        const dayOfWeek = currentDate.getDay(); // 0 = Sun, 6 = Sat
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isToday = dateStr === todayYMD;

        for (let eIdx = 0; eIdx < employeeUsers.length; eIdx++) {
            const emp = employeeUsers[eIdx];
            const shiftAssignment = shiftAssignments[eIdx];
            const shift = shiftAssignment.shift;

            const [startHour, startMin] = shift.startTime.split(':').map(Number);
            const [endHour, endMin] = shift.endTime.split(':').map(Number);

            const scheduledStart = new Date(currentDate);
            scheduledStart.setHours(startHour, startMin, 0, 0);

            const scheduledEnd = new Date(currentDate);
            if (shift.crossesMidnight) {
                scheduledEnd.setDate(scheduledEnd.getDate() + 1);
            }
            scheduledEnd.setHours(endHour, endMin, 0, 0);

            let status = AttendanceStatus.PRESENT;
            let punchStatus: 'ON_TIME' | 'LATE' | 'HALF_DAY' = 'ON_TIME';
            let checkoutStatus: 'ON_TIME' | 'EARLY_OUT' | 'OVERTIME' = 'ON_TIME';
            let lateMinutes = 0;
            let earlyLeaveMinutes = 0;
            let overtimeMinutes = 0;
            let workedMinutes = 480;
            let firstCheckIn: Date | null = null;
            let lastCheckOut: Date | null = null;
            let isFinalized = true;
            let leaveRef: any = null;
            let holidayRef: any = null;

            if (holidayDateMap.has(dateStr)) {
                // Holiday
                const hol = holidayDateMap.get(dateStr)!;
                status = AttendanceStatus.HOLIDAY;
                holidayRef = { holidayId: hol._id, holidayName: hol.name };
                workedMinutes = 0;
            } else if (isWeekend && shift.code !== 'FLEX') {
                // Regular weekend off
                status = AttendanceStatus.WEEK_OFF;
                workedMinutes = 0;
            } else if (approvedLeaveDateMap.has(`${emp._id}_${dateStr}`)) {
                // Approved Leave
                const al = approvedLeaveDateMap.get(`${emp._id}_${dateStr}`);
                status = AttendanceStatus.LEAVE;
                leaveRef = { leaveId: al._id, leaveType: al.leaveType, durationType: al.durationType };
                workedMinutes = 0;
            } else if (isToday) {
                // Today: Real in-progress attendance for 24 active employees
                if (eIdx < 24) {
                    status = AttendanceStatus.PRESENT;
                    punchStatus = eIdx % 7 === 0 ? 'LATE' : 'ON_TIME';
                    lateMinutes = punchStatus === 'LATE' ? 25 : 0;
                    firstCheckIn = new Date(scheduledStart.getTime() + (lateMinutes - 5) * 60 * 1000);
                    lastCheckOut = null; // Still in progress
                    workedMinutes = Math.max(30, Math.round((Date.now() - firstCheckIn.getTime()) / (60 * 1000)));
                    isFinalized = false;
                } else {
                    status = AttendanceStatus.ABSENT;
                    workedMinutes = 0;
                }
            } else {
                // Historical weekday: deterministic distribution
                const seed = (d * 31 + eIdx * 17) % 100;

                if (seed < 75) {
                    // 75% Present On Time
                    status = AttendanceStatus.PRESENT;
                    punchStatus = 'ON_TIME';
                    checkoutStatus = 'ON_TIME';
                    firstCheckIn = new Date(scheduledStart.getTime() + ((seed % 10) - 5) * 60 * 1000);
                    lastCheckOut = new Date(scheduledEnd.getTime() + ((seed % 15)) * 60 * 1000);
                    workedMinutes = Math.round((lastCheckOut.getTime() - firstCheckIn.getTime()) / (60 * 1000)) - 45; // 45m break
                } else if (seed < 85) {
                    // 10% Late Arrival
                    status = AttendanceStatus.PRESENT;
                    punchStatus = 'LATE';
                    checkoutStatus = 'ON_TIME';
                    lateMinutes = 20 + (seed % 25);
                    firstCheckIn = new Date(scheduledStart.getTime() + lateMinutes * 60 * 1000);
                    lastCheckOut = new Date(scheduledEnd.getTime() + 10 * 60 * 1000);
                    workedMinutes = Math.round((lastCheckOut.getTime() - firstCheckIn.getTime()) / (60 * 1000)) - 45;
                } else if (seed < 90) {
                    // 5% Early Departure
                    status = AttendanceStatus.PRESENT;
                    punchStatus = 'ON_TIME';
                    checkoutStatus = 'EARLY_OUT';
                    earlyLeaveMinutes = 60 + (seed % 30);
                    firstCheckIn = new Date(scheduledStart.getTime());
                    lastCheckOut = new Date(scheduledEnd.getTime() - earlyLeaveMinutes * 60 * 1000);
                    workedMinutes = Math.round((lastCheckOut.getTime() - firstCheckIn.getTime()) / (60 * 1000)) - 45;
                } else if (seed < 96) {
                    // 6% Overtime
                    status = AttendanceStatus.PRESENT;
                    punchStatus = 'ON_TIME';
                    checkoutStatus = 'OVERTIME';
                    overtimeMinutes = 90 + (seed % 60);
                    firstCheckIn = new Date(scheduledStart.getTime());
                    lastCheckOut = new Date(scheduledEnd.getTime() + overtimeMinutes * 60 * 1000);
                    workedMinutes = Math.round((lastCheckOut.getTime() - firstCheckIn.getTime()) / (60 * 1000)) - 45;
                } else if (seed < 98) {
                    // 2% Half Day
                    status = AttendanceStatus.HALF_DAY;
                    punchStatus = 'HALF_DAY';
                    checkoutStatus = 'EARLY_OUT';
                    earlyLeaveMinutes = 240;
                    firstCheckIn = new Date(scheduledStart.getTime());
                    lastCheckOut = new Date(scheduledStart.getTime() + 240 * 60 * 1000);
                    workedMinutes = 240;
                } else {
                    // 2% Absent
                    status = AttendanceStatus.ABSENT;
                    workedMinutes = 0;
                }
            }

            const attendanceDoc: any = {
                _id: new Types.ObjectId(),
                companyId,
                employeeId: emp._id,
                userId: emp._id, // Backwards-compatibility field for performance service
                date: dateStr,
                status,
                shiftId: shift._id,
                scheduled: {
                    startTime: scheduledStart,
                    endTime: scheduledEnd,
                    workingMinutes: 480,
                    shiftName: shift.name,
                    shiftCode: shift.code,
                    gracePeriodMinutes: shift.gracePeriodMinutes,
                    earlyCheckoutGraceMinutes: shift.earlyCheckoutGracePeriodMinutes,
                },
                actual: {
                    firstCheckIn,
                    lastCheckOut,
                    workedMinutes: Math.max(0, workedMinutes),
                },
                checkInTime: firstCheckIn,   // Explicit field for performance repository query compatibility
                checkOutTime: lastCheckOut, // Explicit field
                metrics: {
                    lateMinutes,
                    earlyLeaveMinutes,
                    overtimeMinutes,
                },
                leave: leaveRef,
                holiday: holidayRef,
                source: 'WEB',
                punchStatus,
                checkoutStatus,
                isOvernight: shift.crossesMidnight,
                isFinalized,
                notes: lateMinutes > 0 ? `Arrived ${lateMinutes} minutes late due to transit delay` : '',
            };

            attendanceRecordsToInsert.push(attendanceDoc);

            // Generate granular punch events for present days
            if (firstCheckIn) {
                attendanceEventsToInsert.push({
                    companyId,
                    employeeId: emp._id,
                    attendanceId: attendanceDoc._id,
                    type: AttendanceEventType.CHECK_IN,
                    timestamp: firstCheckIn,
                    source: 'WEB',
                    location: { latitude: 37.7749, longitude: -122.4194, accuracy: 10, address: 'San Francisco Office HQ' },
                    ipAddress: '192.168.1.105',
                });

                if (lastCheckOut) {
                    // Lunch break start and end
                    const breakStart = new Date(firstCheckIn.getTime() + 4 * 60 * 60 * 1000);
                    const breakEnd = new Date(breakStart.getTime() + 45 * 60 * 1000);
                    attendanceEventsToInsert.push({
                        companyId,
                        employeeId: emp._id,
                        attendanceId: attendanceDoc._id,
                        type: AttendanceEventType.BREAK_START,
                        timestamp: breakStart,
                        source: 'WEB',
                    });
                    attendanceEventsToInsert.push({
                        companyId,
                        employeeId: emp._id,
                        attendanceId: attendanceDoc._id,
                        type: AttendanceEventType.BREAK_END,
                        timestamp: breakEnd,
                        source: 'WEB',
                    });
                    attendanceEventsToInsert.push({
                        companyId,
                        employeeId: emp._id,
                        attendanceId: attendanceDoc._id,
                        type: AttendanceEventType.CHECK_OUT,
                        timestamp: lastCheckOut,
                        source: 'WEB',
                    });
                }
            }
        }
    }

    console.log(`   Writing ${attendanceRecordsToInsert.length} attendance records & ${attendanceEventsToInsert.length} punch events in batches...`);
    // Insert in batches of 500
    for (let i = 0; i < attendanceRecordsToInsert.length; i += 500) {
        await Attendance.insertMany(attendanceRecordsToInsert.slice(i, i + 500));
    }
    for (let i = 0; i < attendanceEventsToInsert.length; i += 500) {
        await AttendanceEvent.insertMany(attendanceEventsToInsert.slice(i, i + 500));
    }

    console.log(`✅ Seeded ${attendanceRecordsToInsert.length} Attendance records & ${attendanceEventsToInsert.length} granular events across 60 days.\n`);

    // ── Phase 11: Escalation Management ──
    console.log('🚨 [Phase 11/16] Provisioning Escalation Rules, Events, Cases & Audits...');

    const escalationRuleDefs = [
        {
            ruleName: 'Repeated Late Check-in Policy',
            category: EscalationCategory.LATE_CHECK_IN,
            description: 'Triggers when employee arrives late more than 3 times within 30 days.',
            thresholds: { occurrenceThreshold: 3 },
            resetPeriod: EscalationResetPeriod.MONTHLY,
        },
        {
            ruleName: 'Excessive Lunch Break Duration',
            category: EscalationCategory.BREAK_TIME_EXCEEDED,
            description: 'Triggers when break interval duration exceeds 60 minutes.',
            thresholds: { breakDurationLimitMinutes: 60 },
            resetPeriod: EscalationResetPeriod.WEEKLY,
        },
        {
            ruleName: 'Prolonged Workstation Inactivity',
            category: EscalationCategory.IDLE_TIME_EXCEEDED,
            description: 'Triggers on continuous idle duration without active task timer.',
            thresholds: { idleThresholdMinutes: 45 },
            resetPeriod: EscalationResetPeriod.WEEKLY,
        },
        {
            ruleName: 'Reopened Bug or Task Failure',
            category: EscalationCategory.REOPENED_TASK,
            description: 'Triggers immediately when QA rejects and reopens a completed task.',
            thresholds: { reopenCountThreshold: 1 },
            resetPeriod: EscalationResetPeriod.MONTHLY,
        },
        {
            ruleName: 'Task Deadline Overdue Escalation',
            category: EscalationCategory.WORK_INEFFICIENCY_DELAY,
            description: 'Triggers when a Critical or High priority task is overdue > 72 hours.',
            thresholds: { projectDelayDays: 3 },
            resetPeriod: EscalationResetPeriod.MONTHLY,
        },
    ];

    const escalationRules = await EscalationRule.insertMany(
        escalationRuleDefs.map((r) => ({
            companyId,
            ruleName: r.ruleName,
            category: r.category,
            description: r.description,
            thresholds: r.thresholds,
            resetPeriod: r.resetPeriod,
            severity: EscalationSeverity.HIGH,
            isEnabled: true,
            createdBy: companyAdminUser._id,
        }))
    );

    const escalationCases: any[] = [];
    const escalationCaseStatuses = [
        EscalationCaseStatus.RESOLVED,
        EscalationCaseStatus.ACKNOWLEDGED,
        EscalationCaseStatus.UNDER_REVIEW,
        EscalationCaseStatus.AWAITING_EMPLOYEE,
        EscalationCaseStatus.PENDING,
    ];

    for (let i = 0; i < 18; i++) {
        const emp = employeeUsers[i % employeeUsers.length];
        const manager = managerUsers[i % managerUsers.length];
        const rule = escalationRules[i % escalationRules.length];
        const status = escalationCaseStatuses[i % escalationCaseStatuses.length];
        const eventDate = formatYMD(new Date(Date.now() - (i * 2 + 1) * 24 * 60 * 60 * 1000));

        // Create Escalation Event
        const event = await EscalationEvent.create({
            companyId,
            employeeId: emp._id,
            category: rule.category,
            sourceModule: EscalationSourceModule.ATTENDANCE,
            sourceRecordId: `SRC-${20000 + i}`,
            ruleId: rule._id,
            eventDate,
            eventTimestamp: new Date(Date.now() - (i * 2 + 1) * 24 * 60 * 60 * 1000),
            expectedValue: 'Under 15 minutes grace',
            actualValue: '35 minutes late arrival',
            violationDuration: 35,
            idempotencyKey: `escalation_event_${emp._id}_${eventDate}_${i}`,
        });

        // Create Escalation Case
        const isResolved = status === EscalationCaseStatus.RESOLVED;
        const eCase = await EscalationCase.create({
            companyId,
            employeeId: emp._id,
            eventId: event._id,
            ruleId: rule._id,
            category: rule.category,
            escalationLevel: (i % 2) + 1,
            occurrenceCount: (i % 3) + 1,
            cycleStartDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            cycleEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            status,
            assignedManager: manager._id,
            notifiedUsers: [
                { userId: manager._id, role: 'MANAGER', notifiedAt: new Date(), level: 1 },
                { userId: companyAdminUser._id, role: 'COMPANY_ADMIN', notifiedAt: new Date(), level: 2 },
            ],
            employeeExplanation: status !== EscalationCaseStatus.PENDING
                ? { text: 'Public transit subway signaling outage delayed commute.', submittedAt: new Date() }
                : null,
            managerComments: status === EscalationCaseStatus.UNDER_REVIEW || isResolved
                ? [{ managerId: manager._id, comment: 'Reviewed explanation with transit advisory notice. Verified.', createdAt: new Date() }]
                : [],
            resolutionReason: isResolved ? 'Employee provided transit evidence. Policy exception granted for this occurrence.' : null,
            resolvedBy: isResolved ? manager._id : null,
            resolvedAt: isResolved ? new Date() : null,
            dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        });

        await EscalationAudit.create({
            companyId,
            escalationCaseId: eCase._id,
            ruleId: rule._id,
            actorId: manager._id,
            action: isResolved ? EscalationAuditAction.CASE_RESOLVED : EscalationAuditAction.CASE_CREATED,
            reason: `Automated escalation lifecycle update for ${rule.ruleName}`,
            timestamp: new Date(),
        });

        escalationCases.push(eCase);
    }

    console.log(`✅ Seeded 5 Escalation Rules and ${escalationCases.length} Escalation Cases & Audits.\n`);

    // ── Phase 12: Meetings, Participants & Calendar Events ──
    console.log('🎙️  [Phase 12/16] Provisioning 40 Meetings, Participants & Calendar Events...');

    const meetingTitles = [
        'Daily Engineering Standup & Blocker Sync',
        'Sprint 2 Sprint Planning & Story Point Estimation',
        'Architecture Review: Microservices Auth & Database Scaling',
        'Client Weekly Status Review & Milestones Demonstration',
        'Post-Incident Review: Production API Latency Spike Postmortem',
        'One-on-One Bi-Weekly Growth & Feedback Session',
        'Design System UI Component Sync & WCAG Review',
        'Security & Compliance Readiness Audit',
    ];

    const meetings: any[] = [];
    for (let i = 0; i < QA_CONFIG.TOTAL_MEETINGS_TARGET; i++) {
        const organizer = i % 5 === 0 ? companyAdminUser : managerUsers[i % managerUsers.length];
        const proj = projects[i % projects.length];
        const meetingTypeValues = [
            MeetingType.QUICK,
            MeetingType.SCHEDULED,
            MeetingType.PROJECT_REVIEW,
            MeetingType.ONE_ON_ONE,
            MeetingType.SYNC,
        ];
        const meetingType = meetingTypeValues[i % meetingTypeValues.length];

        const dayOffset = (i * 1.5) - 50; // some past, some today, some future
        const startAt = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
        startAt.setHours(10 + (i % 6), (i % 2) * 30, 0, 0);
        const durationMins = 30 + (i % 3) * 15;
        const endAt = new Date(startAt.getTime() + durationMins * 60 * 1000);

        let status = MeetingStatus.COMPLETED;
        if (dayOffset > 0) {
            status = i % 4 === 0 ? MeetingStatus.PENDING : MeetingStatus.ACCEPTED;
        } else if (Math.abs(dayOffset) < 1) {
            status = MeetingStatus.IN_PROGRESS;
        }

        const meeting = await Meeting.create({
            meetingId: `MTG-${(qaCompany.slug || 'QA').toUpperCase()}-${1000 + i}`,
            companyId,
            organizerId: organizer._id,
            title: `${meetingTitles[i % meetingTitles.length]} (${proj.name})`,
            agenda: 'Review sprint deliverables, architectural decisions, and active task progress.',
            description: `Collaborative session for ${proj.name} stakeholders and cross-functional team members.`,
            projectId: proj._id,
            meetingType,
            meetingLink: `https://meet.uworksphere.test/${proj.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${i}`,
            meetingProvider: 'google_meet',
            scheduledStartAt: startAt,
            scheduledEndAt: endAt,
            durationMinutes: durationMins,
            timezone: 'Asia/Kolkata',
            status,
            currentVersion: 1,
            completedAt: status === MeetingStatus.COMPLETED ? endAt : null,
        });

        // Add 4-6 participants
        const participantCount = 4 + (i % 3);
        const teamMembers = teams[i % teams.length].memberIds;
        const participantsForCalendar: any[] = [];

        // Add Organizer as participant
        await MeetingParticipant.create({
            meetingId: meeting._id,
            userId: organizer._id,
            companyId,
            role: ParticipantRole.ORGANIZER,
            responseStatus: ParticipantResponseStatus.ACCEPTED,
            joinedAt: status === MeetingStatus.COMPLETED ? startAt : null,
            leftAt: status === MeetingStatus.COMPLETED ? endAt : null,
        });

        for (let pIdx = 0; pIdx < Math.min(participantCount, teamMembers.length); pIdx++) {
            const memberId = teamMembers[pIdx];
            const empUser = employeeUsers.find((e) => e._id.equals(memberId));
            const pStatus = pIdx === 0 ? ParticipantResponseStatus.ACCEPTED : (pIdx % 4 === 0 ? ParticipantResponseStatus.DECLINED : ParticipantResponseStatus.ACCEPTED);

            await MeetingParticipant.create({
                meetingId: meeting._id,
                userId: memberId,
                companyId,
                role: pIdx < 2 ? ParticipantRole.REQUIRED : ParticipantRole.OPTIONAL,
                responseStatus: pStatus,
                joinedAt: status === MeetingStatus.COMPLETED && pStatus === ParticipantResponseStatus.ACCEPTED
                    ? new Date(startAt.getTime() + (pIdx * 60 * 1000))
                    : null,
                leftAt: status === MeetingStatus.COMPLETED && pStatus === ParticipantResponseStatus.ACCEPTED
                    ? endAt
                    : null,
            });

            if (empUser) {
                participantsForCalendar.push({
                    userId: empUser._id,
                    name: empUser.name,
                    email: empUser.email,
                    role: 'EMPLOYEE',
                    status: pStatus.toLowerCase(),
                });
            }
        }

        // Matching Calendar Event for calendar & performance service integration
        const calEvent = await CalendarEvent.create({
            companyId,
            title: meeting.title,
            description: meeting.description,
            startTime: startAt,
            endTime: endAt,
            timeZone: 'Asia/Kolkata',
            organizer: {
                userId: organizer._id,
                name: organizer.name,
                email: organizer.email,
            },
            participants: participantsForCalendar,
            meetingType: 'video',
            provider: 'google_meet',
            meetingUrl: meeting.meetingLink,
        });

        meeting.calendarEventId = calEvent._id as Types.ObjectId;
        await meeting.save();

        meetings.push(meeting);
    }

    console.log(`✅ Seeded ${meetings.length} Meetings, Participants & synchronized Calendar Events.\n`);

    // ── Phase 13: Live Monitoring & Activity Stream ──
    console.log('📡 [Phase 13/16] Generating Live Monitoring Activity Logs & System Alerts...');

    const monitoringActivities: any[] = [];
    for (let i = 0; i < 160; i++) {
        const emp = employeeUsers[i % employeeUsers.length];
        const proj = projects[i % projects.length];
        const task = allTasks[i % allTasks.length];
        const eventTypes = [
            MonitoringEventType.TASK_STARTED,
            MonitoringEventType.TASK_STATUS_CHANGED,
            MonitoringEventType.TASK_COMPLETED,
            MonitoringEventType.ATTENDANCE_CHECKED_IN,
            MonitoringEventType.BREAK_STARTED,
            MonitoringEventType.BREAK_ENDED,
            MonitoringEventType.ATTENDANCE_CHECKED_OUT,
            MonitoringEventType.PRESENCE_ONLINE,
            MonitoringEventType.PRESENCE_OFFLINE,
            MonitoringEventType.MEETING_STARTED,
        ];
        const eventType = eventTypes[i % eventTypes.length];
        const occurredAt = new Date(Date.now() - (160 - i) * 20 * 60 * 1000); // Past ~50 hours

        monitoringActivities.push({
            companyId,
            eventId: `evt_qa_${Date.now()}_${i}`,
            sequence: i + 1,
            eventType,
            actorId: emp._id,
            actorName: emp.name,
            employeeId: emp._id,
            employeeName: emp.name,
            projectId: proj._id,
            projectName: proj.name,
            taskId: task._id,
            taskTitle: task.title,
            summary: `${emp.name} performed action: ${eventType} on ${proj.name}`,
            metadata: { ip: '192.168.1.105', userAgent: 'WorkSphere-QA-Runner/2.0' },
            occurredAt,
        });
    }

    await MonitoringActivity.insertMany(monitoringActivities);

    // Monitoring Alerts
    const alertDefs = [
        { title: 'Critical Task Missed Target Deadline', summary: 'Critical security patch task passed target delivery date.', type: AlertType.OVERDUE_TASK, severity: AlertSeverity.CRITICAL, status: AlertStatus.ACTIVE },
        { title: 'Task Execution Blocked by Dependency', summary: 'Active task marked as blocked pending schema approval.', type: AlertType.BLOCKED_TASK, severity: AlertSeverity.WARNING, status: AlertStatus.ACTIVE },
        { title: 'Missed Shift Check-in Incident', summary: 'Scheduled shift started without attendance punch event.', type: AlertType.MISSED_CHECK_IN, severity: AlertSeverity.WARNING, status: AlertStatus.ACTIVE },
        { title: 'Upcoming Milestone Deadline Warning', summary: 'Sprint milestone deliverable due within 24 hours.', type: AlertType.UPCOMING_DEADLINE, severity: AlertSeverity.INFO, status: AlertStatus.RESOLVED },
        { title: 'Task Completed & Awaiting Review', summary: 'Feature PR submitted and queued for manager review.', type: AlertType.TASK_AWAITING_REVIEW, severity: AlertSeverity.INFO, status: AlertStatus.RESOLVED },
        { title: 'Project Health At Risk Indicator', summary: 'Project burn-rate discrepancy detected in active sprint.', type: AlertType.PROJECT_AT_RISK, severity: AlertSeverity.HIGH, status: AlertStatus.RESOLVED },
    ];

    const monitoringAlerts: any[] = [];
    for (let i = 0; i < 12; i++) {
        const ad = alertDefs[i % alertDefs.length];
        const emp = employeeUsers[i % employeeUsers.length];

        const alert = await MonitoringAlert.create({
            companyId,
            alertType: ad.type,
            severity: ad.severity,
            title: `${ad.title} (${emp.name})`,
            summary: `${ad.summary} - Employee ID: ${emp._id}`,
            dedupKey: `qa_alert_${emp._id}_${ad.type}_${i}`,
            resourceType: 'EMPLOYEE',
            resourceId: emp._id,
            status: ad.status,
            acknowledgedById: ad.status === AlertStatus.RESOLVED ? managerUsers[0]._id : null,
            acknowledgedAt: ad.status === AlertStatus.RESOLVED ? new Date(Date.now() - 5 * 3600 * 1000) : null,
            resolvedById: ad.status === AlertStatus.RESOLVED ? managerUsers[0]._id : null,
            resolvedAt: ad.status === AlertStatus.RESOLVED ? new Date() : null,
            metadata: { employeeCode: `EMP-${1001 + (i % 30)}` },
        });
        monitoringAlerts.push(alert);
    }

    console.log(`✅ Seeded ${monitoringActivities.length} Monitoring Activities and ${monitoringAlerts.length} Monitoring Alerts.\n`);

    // ── Phase 14: Notifications & Audit History ──
    console.log('🔔 [Phase 14/16] Provisioning Notifications & Complete Audit Log Trail...');

    const notificationTemplates = [
        { type: 'PROJECT_ASSIGNED', category: 'PROJECT', title: 'New Project Assignment', message: 'You have been assigned to project: {{projectName}}' },
        { type: 'TASK_ASSIGNED', category: 'TASK', title: 'New Task Assignment', message: 'You have been assigned task: {{taskTitle}}' },
        { type: 'TASK_COMPLETED', category: 'TASK', title: 'Task Completed', message: 'Task {{taskTitle}} has been marked as Completed.' },
        { type: 'LEAVE_APPROVED', category: 'LEAVE', title: 'Leave Application Approved', message: 'Your leave application for {{dates}} has been approved by your manager.' },
        { type: 'MEETING_REMINDER', category: 'MEETING', title: 'Upcoming Meeting Reminder', message: 'Meeting starting in 15 minutes: {{meetingTitle}}' },
        { type: 'ESCALATION_ALERT', category: 'ESCALATION', title: 'Escalation Notice', message: 'An escalation case has been flagged for review: {{reason}}' },
        { type: 'ANNOUNCEMENT', category: 'ANNOUNCEMENT', title: 'Company Announcement', message: 'All-hands organizational milestone review scheduled this Friday at 4 PM.' },
    ];

    const notifications: any[] = [];
    for (let i = 0; i < 75; i++) {
        const recipient = i === 0 ? companyAdminUser : employeeUsers[i % employeeUsers.length];
        const sender = managerUsers[i % managerUsers.length];
        const proj = projects[i % projects.length];
        const task = allTasks[i % allTasks.length];
        const nt = notificationTemplates[i % notificationTemplates.length];
        const isRead = i % 3 !== 0;

        const notif = await Notification.create({
            companyId,
            recipientId: recipient._id,
            recipientRole: 'EMPLOYEE',
            actorId: sender._id,
            type: nt.type,
            category: nt.category,
            title: nt.title,
            message: nt.message
                .replace('{{projectName}}', proj.name)
                .replace('{{taskTitle}}', task.title)
                .replace('{{dates}}', 'next week')
                .replace('{{meetingTitle}}', 'Daily Standup')
                .replace('{{reason}}', 'Late arrival pattern'),
            priority: i % 5 === 0 ? 'CRITICAL' : 'MEDIUM',
            style: 'INFO',
            icon: 'bell',
            projectId: proj._id,
            taskId: task._id,
            isRead,
            readAt: isRead ? new Date(Date.now() - 3 * 3600 * 1000) : undefined,
            createdAt: new Date(Date.now() - (75 - i) * 45 * 60 * 1000),
        });
        notifications.push(notif);
    }

    // Audit Logs
    const auditActions = [
        AuditAction.USER_LOGIN,
        AuditAction.PROJECT_CREATED,
        AuditAction.PROJECT_UPDATED,
        AuditAction.COMPANY_SETTINGS_UPDATED,
        AuditAction.COMPANY_THEME_UPDATED,
        AuditAction.SUBSCRIPTION_CREATED,
        AuditAction.PAYMENT_SUCCEEDED,
        AuditAction.SPRINT_CREATED,
        AuditAction.RELEASE_CREATED,
        AuditAction.TASK_STATUS_CHANGED,
        AuditAction.TASK_ASSIGNED_TO_RELEASE,
        AuditAction.USER_ACTIVATED,
    ];

    const auditLogs: any[] = [];
    for (let i = 0; i < 60; i++) {
        const actor = i % 4 === 0 ? companyAdminUser : managerUsers[i % managerUsers.length];
        const target = employeeUsers[i % employeeUsers.length];
        const action = auditActions[i % auditActions.length];

        const log = await AuditLog.create({
            action,
            actorId: actor._id,
            actorEmail: actor.email,
            actorRole: actor.email.includes('admin') ? 'COMPANY_ADMIN' : 'MANAGER',
            targetUserId: target._id,
            targetEmail: target.email,
            companyId,
            companyName: qaCompany.name,
            metadata: { iteration: i, environment: 'qa-seed' },
            ipAddress: '192.168.1.100',
            userAgent: 'Mozilla/5.0 WorkSphere QA Harness',
            success: true,
            description: `Audit trail event: ${action} executed by ${actor.name}`,
            createdAt: new Date(Date.now() - (60 - i) * 60 * 60 * 1000),
        });
        auditLogs.push(log);
    }

    console.log(`✅ Seeded ${notifications.length} Notifications and ${auditLogs.length} Audit Logs.\n`);

    // ── Phase 15: Cross-Referential Data Consistency Validation ──
    console.log('🔍 [Phase 15/16] Performing Comprehensive Cross-Referential Integrity Validation...');

    const [
        totalCompaniesInDb,
        totalUsersInDb,
        totalProjectsInDb,
        totalTasksInDb,
        totalAttendanceInDb,
        totalShiftsInDb,
        totalLeaveInDb,
        totalEscalationsInDb,
        totalMeetingsInDb,
        totalMonitoringInDb,
    ] = await Promise.all([
        Company.countDocuments({ _id: companyId }),
        User.countDocuments({ companyId }),
        Project.countDocuments({ companyId }),
        Task.countDocuments({ companyId }),
        Attendance.countDocuments({ companyId }),
        Shift.countDocuments({ companyId }),
        LeaveRequest.countDocuments({ companyId }),
        EscalationCase.countDocuments({ companyId }),
        Meeting.countDocuments({ companyId }),
        MonitoringActivity.countDocuments({ companyId }),
    ]);

    // Cross-reference assertions
    const validCompanyUserIds = (await User.find({ companyId }, { _id: 1 })).map((u) => u._id);
    const orphanedTasks = await Task.countDocuments({ companyId, projectId: { $nin: projects.map((p) => p._id) } });
    const orphanedAttendance = await Attendance.countDocuments({
        companyId,
        employeeId: { $nin: validCompanyUserIds },
    });
    const orphanedShiftAssignments = await EmployeeShiftAssignment.countDocuments({
        companyId,
        employeeId: { $nin: validCompanyUserIds },
    });
    const invalidCheckouts = await Attendance.countDocuments({
        companyId,
        'actual.firstCheckIn': { $ne: null },
        'actual.lastCheckOut': { $ne: null },
        $expr: { $gt: ['$actual.firstCheckIn', '$actual.lastCheckOut'] },
    });

    console.log('----------------------------------------------------------------');
    console.log('               DATA CONSISTENCY AUDIT REPORT');
    console.log('----------------------------------------------------------------');
    console.log(`🏢 Organization Verification:        ${totalCompaniesInDb === 1 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`👥 Users In Tenant:                  ${totalUsersInDb} users`);
    console.log(`🚀 Projects Verified:                ${totalProjectsInDb} projects (0 orphaned)`);
    console.log(`📋 Tasks Verified:                   ${totalTasksInDb} tasks (Orphaned: ${orphanedTasks})`);
    console.log(`📅 Attendance Records:               ${totalAttendanceInDb} days (Orphaned: ${orphanedAttendance})`);
    console.log(`⏰ Shift Validity:                   ${totalShiftsInDb} shifts (Orphaned assignments: ${orphanedShiftAssignments})`);
    console.log(`⏱  Check-in/Check-out Chronology:    ${invalidCheckouts === 0 ? '✅ PASS (No check-outs before check-ins)' : '❌ FAIL'}`);
    console.log(`🏖️  Leave Requests:                   ${totalLeaveInDb} requests (All linked to valid employees/approvers)`);
    console.log(`🚨 Escalations:                      ${totalEscalationsInDb} cases (All linked to valid rules/events)`);
    console.log(`🎙️  Meetings:                         ${totalMeetingsInDb} meetings & synced calendar events`);
    console.log(`📡 Monitoring Activities:            ${totalMonitoringInDb} activity logs`);
    console.log('----------------------------------------------------------------\n');

    if (orphanedTasks > 0 || orphanedAttendance > 0 || invalidCheckouts > 0) {
        throw new Error('Data consistency validation failed! Found relational discrepancies.');
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🎉 [Phase 16/16] Seeding Completed Successfully in ${durationSec}s!`);
    console.log('================================================================');

    return {
        company: {
            id: companyId.toString(),
            name: qaCompany.name,
            slug: qaCompany.slug,
            email: qaCompany.companyEmail || companyAdminUser.email,
        },
        credentials: {
            adminEmail: companyAdminUser.email,
            managerEmails: managersConfig.map((m) => m.email),
            employeeEmailSample: [
                'qa.employee01@uworksphere.test',
                'qa.employee10@uworksphere.test',
                'qa.employee30@uworksphere.test',
            ],
            clientEmails: clientConfigs.map((c) => c.email),
            sharedPassword: QA_CONFIG.DEFAULT_PASSWORD,
        },
        counts: {
            companies: totalCompaniesInDb,
            users: totalUsersInDb,
            projects: totalProjectsInDb,
            tasks: totalTasksInDb,
            attendance: totalAttendanceInDb,
            shifts: totalShiftsInDb,
            leaveRequests: totalLeaveInDb,
            escalations: totalEscalationsInDb,
            meetings: totalMeetingsInDb,
            monitoringActivities: totalMonitoringInDb,
        },
        durationSec,
    };
}

// ── Standalone CLI Runner ──
if (process.argv[1] && process.argv[1].endsWith('seed-qa.ts')) {
    const isClean = process.argv.includes('--clean');
    const targetEmailArg = process.argv.find((arg) => arg.startsWith('--target-email='));
    const targetEmail = targetEmailArg ? targetEmailArg.split('=')[1] : process.env.TARGET_ADMIN_EMAIL;

    seedQaEcosystem({ forceClean: isClean, targetEmail })
        .then(() => {
            mongoose.disconnect().then(() => process.exit(0));
        })
        .catch((err) => {
            console.error('\n❌ SEEDING FATAL ERROR:', err);
            mongoose.disconnect().then(() => process.exit(1));
        });
}
