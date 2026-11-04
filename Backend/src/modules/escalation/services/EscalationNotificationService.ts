import mongoose, { Types } from 'mongoose';
import { getSocketServer } from '../../../sockets/socket-server';
import { NotificationEventBus } from '../../notifications/notification.event-bus';
import { Company } from '../../super-admin/companies/company.model';
import { User } from '../../users/user.model';
import { Project, ProjectInCharge, ProjectTeamMember } from '../../companyadmin/projects/project.model';
import CompanyMember from '../../companyadmin/invitations/company-member.model';
import { IEscalationCaseDocument, IEscalationRuleDocument } from '../types/escalation.types';
import { EscalationCategory } from '../constants/escalation.constants';

export interface ResolvedHierarchyRecipients {
    level: number;
    employeeId: Types.ObjectId;
    reportingManagerIds: Types.ObjectId[];
    companyAdminIds: Types.ObjectId[];
    effectiveRecipients: Types.ObjectId[];
}

export class EscalationNotificationService {
    /**
     * Resolve reporting hierarchy dynamically from active database relationships.
     */
    public static async resolveHierarchy(
        companyId: string,
        employeeId: string,
        escalationLevel: number,
        rule?: IEscalationRuleDocument | null
    ): Promise<ResolvedHierarchyRecipients> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);

        // 1. Resolve Company Admins (authoritative Company.adminId + users with COMPANY_ADMIN / Admin roles)
        const companyAdminIdsSet = new Set<string>();
        const company = await Company.findById(companyObjId).select('adminId').lean();
        if (company?.adminId) {
            companyAdminIdsSet.add(company.adminId.toString());
        }

        const adminUsers = await User.find({
            companyId: companyObjId,
            isActive: true,
            isDeleted: false,
        })
            .populate('role', 'name')
            .lean();

        for (const u of adminUsers) {
            const roleName = (u.role as any)?.name;
            if (roleName === 'COMPANY_ADMIN' || roleName === 'Admin') {
                companyAdminIdsSet.add(u._id.toString());
            }
        }

        // 2. Resolve Direct Reporting Managers / Team Leads
        const reportingManagerIdsSet = new Set<string>();

        // Check active projects where the employee is a team member
        const teamMemberships = await ProjectTeamMember.find({
            userId: employeeObjId,
        }).lean();

        if (teamMemberships.length > 0) {
            const projectIds = teamMemberships.map((tm) => tm.projectId);

            // Fetch Project In-Charges
            const inCharges = await ProjectInCharge.find({
                projectId: { $in: projectIds },
            }).lean();
            for (const ic of inCharges) {
                if (ic.userId && ic.userId.toString() !== employeeId) {
                    reportingManagerIdsSet.add(ic.userId.toString());
                }
            }

            // Fetch Project Managers assigned directly on Projects
            const projects = await Project.find({
                _id: { $in: projectIds },
                companyId: companyObjId,
            }).select('createdById').lean();

            for (const p of projects) {
                const pAny = p as any;
                if (pAny.projectManagerId && pAny.projectManagerId.toString() !== employeeId) {
                    reportingManagerIdsSet.add(pAny.projectManagerId.toString());
                }
            }
        }

        // If no project manager found, look for Company Members with memberType === 'MANAGER'
        if (reportingManagerIdsSet.size === 0) {
            const managers = await CompanyMember.find({
                companyId: companyObjId,
                memberType: 'MANAGER',
                status: 'ACTIVE',
                userId: { $ne: employeeObjId },
            }).lean();

            for (const m of managers) {
                reportingManagerIdsSet.add(m.userId.toString());
            }
        }

        // Fallback: If still no reporting manager found, fall back to Company Admin
        if (reportingManagerIdsSet.size === 0) {
            for (const adminId of companyAdminIdsSet) {
                reportingManagerIdsSet.add(adminId);
            }
        }

        // 3. Determine target recipient set based on escalationLevel & rule configuration
        const targetRecipientsSet = new Set<string>();

        // Check custom rule level definition if provided
        const ruleLevelConfig = rule?.escalationLevels?.find((l) => l.level === escalationLevel);

        if (ruleLevelConfig?.notifyUserIds && ruleLevelConfig.notifyUserIds.length > 0) {
            for (const uid of ruleLevelConfig.notifyUserIds) {
                targetRecipientsSet.add(uid.toString());
            }
        }

        switch (escalationLevel) {
            case 1:
                // Level 1: Direct Employee Notification
                targetRecipientsSet.add(employeeId);
                break;

            case 2:
                // Level 2: Reporting Manager
                for (const mid of reportingManagerIdsSet) {
                    targetRecipientsSet.add(mid);
                }
                break;

            case 3:
                // Level 3: Manager + Company Admin
                for (const mid of reportingManagerIdsSet) {
                    targetRecipientsSet.add(mid);
                }
                for (const aid of companyAdminIdsSet) {
                    targetRecipientsSet.add(aid);
                }
                break;

            case 4:
            default:
                // Level 4+: Full Executive Escalation (Managers, Admins, Rule explicit recipients)
                for (const mid of reportingManagerIdsSet) {
                    targetRecipientsSet.add(mid);
                }
                for (const aid of companyAdminIdsSet) {
                    targetRecipientsSet.add(aid);
                }
                if (rule?.notificationRecipients) {
                    for (const r of rule.notificationRecipients) {
                        targetRecipientsSet.add(r.toString());
                    }
                }
                break;
        }

        // Convert string IDs to Types.ObjectId
        const reportingManagerIds = Array.from(reportingManagerIdsSet).map((id) => new Types.ObjectId(id));
        const companyAdminIds = Array.from(companyAdminIdsSet).map((id) => new Types.ObjectId(id));
        const effectiveRecipients = Array.from(targetRecipientsSet).map((id) => new Types.ObjectId(id));

        return {
            level: escalationLevel,
            employeeId: employeeObjId,
            reportingManagerIds,
            companyAdminIds,
            effectiveRecipients,
        };
    }

    /**
     * Notify recipients of an escalation case through NotificationEventBus & Socket.IO.
     */
    public static async notifyEscalation(
        escalationCase: IEscalationCaseDocument,
        event: any,
        hierarchy: ResolvedHierarchyRecipients,
        isNew: boolean = true
    ): Promise<void> {
        try {
            const companyIdStr = escalationCase.companyId.toString();
            const caseIdStr = escalationCase._id.toString();
            const employeeIdStr = escalationCase.employeeId.toString();

            const recipientIdStrs = hierarchy.effectiveRecipients.map((id) => id.toString());

            // 1. Dispatch through WorkSphere centralized NotificationEventBus
            const notifType = isNew
                ? 'ESCALATION_CREATED'
                : escalationCase.status === 'resolved'
                    ? 'ESCALATION_RESOLVED'
                    : 'ESCALATION_LEVEL_UP';

            NotificationEventBus.getInstance().publish({
                type: notifType,
                companyId: companyIdStr,
                actorId: employeeIdStr,
                entityId: caseIdStr,
                entityType: 'ESCALATION',
                recipientIds: hierarchy.effectiveRecipients.map((id) => id.toString()),
                actionUrl: `/companyadmin/escalations?caseId=${caseIdStr}`,
                metadata: {
                    caseId: caseIdStr,
                    category: escalationCase.category,
                    escalationLevel: escalationCase.escalationLevel,
                    status: escalationCase.status,
                    violationDuration: event?.violationDuration || 0,
                    expectedValue: event?.expectedValue || '',
                    actualValue: event?.actualValue || '',
                    dueAt: escalationCase.dueAt,
                },
                priority: escalationCase.escalationLevel >= 3 ? 'CRITICAL' : 'HIGH',
            });

            // 2. Real-time broadcast via Socket.IO
            const io = getSocketServer();
            if (io) {
                const socketPayload = {
                    caseId: caseIdStr,
                    id: caseIdStr,
                    category: escalationCase.category,
                    escalationLevel: escalationCase.escalationLevel,
                    status: escalationCase.status,
                    employeeId: employeeIdStr,
                    dueAt: escalationCase.dueAt,
                    createdAt: escalationCase.createdAt,
                    notifiedCount: recipientIdStrs.length,
                };

                // Emit to Company Admin room
                io.to(`company:${companyIdStr}`).emit('escalation:alert', socketPayload);

                // Emit to each direct recipient room
                for (const rid of recipientIdStrs) {
                    io.to(`user:${rid}`).emit('escalation:new', socketPayload);
                }
            }
        } catch (error) {
            console.error('[EscalationNotificationService] Failed to dispatch notifications:', error);
        }
    }
}
export default EscalationNotificationService;
