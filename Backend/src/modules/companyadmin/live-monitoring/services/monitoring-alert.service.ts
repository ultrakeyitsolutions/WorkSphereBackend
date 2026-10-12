import { Types } from 'mongoose';
import {
    AlertType,
    AlertSeverity,
    AlertStatus,
    IMonitoringAlertDto,
    MONITORING_SOCKET_EVENTS,
} from '../live-monitoring.types';
import { MonitoringAlert } from '../models/monitoring-alert.model';
import { Task } from '../../../tasks/task.model';
import { Project } from '../../projects/project.model';
import { ProjectStatus } from '../../projects/project.types';
import { RealtimeEventService } from './realtime-event.service';

export class MonitoringAlertService {
    /**
     * Evaluates live conditions across tasks, projects, and attendance and generates deduplicated alerts
     */
    public static async evaluateAndGenerateAlerts(companyId: string): Promise<IMonitoringAlertDto[]> {
        const generatedAlerts: IMonitoringAlertDto[] = [];
        try {
            if (!companyId || !Types.ObjectId.isValid(companyId)) return [];
            const companyObjId = new Types.ObjectId(companyId);
            const now = new Date();

            // ─── 1. Evaluate Overdue Tasks ─────────────────────────────────────────
            const overdueTasks = await Task.find({
                companyId: companyObjId,
                isArchived: false,
                isActive: true,
                deliveryDate: { $lt: now },
            })
                .populate<{ assignedToId: { _id: Types.ObjectId; name: string } }>('assignedToId', 'name')
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .limit(25)
                .lean();

            for (const task of overdueTasks) {
                const dedupKey = `overdue_task_${(task as any)._id.toString()}`;
                const existing = await MonitoringAlert.findOne({
                    companyId: companyObjId,
                    dedupKey,
                    status: { $in: [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED] },
                }).lean();

                if (!existing) {
                    const alert = new MonitoringAlert({
                        companyId: companyObjId,
                        alertType: AlertType.OVERDUE_TASK,
                        severity: AlertSeverity.CRITICAL,
                        title: `Task Overdue: ${(task as any).taskNumber || task.title}`,
                        summary: `Task "${task.title}" has passed its scheduled delivery deadline of ${task.deliveryDate?.toLocaleDateString()}.`,
                        dedupKey,
                        resourceType: 'TASK',
                        resourceId: (task as any)._id,
                        status: AlertStatus.ACTIVE,
                        metadata: {
                            taskId: (task as any)._id.toString(),
                            taskNumber: (task as any).taskNumber,
                            deliveryDate: task.deliveryDate,
                            assignedToName: (task as any).assignedToId?.name || 'Unassigned',
                            projectName: (task as any).projectId?.name || 'General',
                        },
                    });
                    await alert.save();

                    const dto = this.mapToDto(alert);
                    generatedAlerts.push(dto);

                    RealtimeEventService.broadcastMonitoringEvent(
                        companyId,
                        MONITORING_SOCKET_EVENTS.ALERT_CREATED,
                        dto
                    );
                }
            }

            // ─── 2. Evaluate Unassigned Critical Tasks ─────────────────────────────
            const unassignedCritical = await Task.find({
                companyId: companyObjId,
                isArchived: false,
                isActive: true,
                criticality: 'CRITICAL' as any,
                $or: [{ assignedToId: null }, { assignedToId: { $exists: false } }],
            })
                .limit(10)
                .lean();

            for (const task of unassignedCritical) {
                const dedupKey = `unassigned_critical_${(task as any)._id.toString()}`;
                const existing = await MonitoringAlert.findOne({
                    companyId: companyObjId,
                    dedupKey,
                    status: { $in: [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED] },
                }).lean();

                if (!existing) {
                    const alert = new MonitoringAlert({
                        companyId: companyObjId,
                        alertType: AlertType.UNASSIGNED_CRITICAL_TASK,
                        severity: AlertSeverity.HIGH,
                        title: `Unassigned Critical Task: ${(task as any).taskNumber || task.title}`,
                        summary: `Critical priority task "${task.title}" is currently unassigned.`,
                        dedupKey,
                        resourceType: 'TASK',
                        resourceId: (task as any)._id,
                        status: AlertStatus.ACTIVE,
                        metadata: {
                            taskId: (task as any)._id.toString(),
                            taskNumber: (task as any).taskNumber,
                        },
                    });
                    await alert.save();

                    const dto = this.mapToDto(alert);
                    generatedAlerts.push(dto);

                    RealtimeEventService.broadcastMonitoringEvent(
                        companyId,
                        MONITORING_SOCKET_EVENTS.ALERT_CREATED,
                        dto
                    );
                }
            }

            // ─── 3. Evaluate Projects with Approaching Deadlines (< 3 days) ────────
            const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
            const urgentProjects = await Project.find({
                companyId: companyObjId,
                isArchived: false,
                status: ProjectStatus.ACTIVE,
                endDate: { $gt: now, $lte: threeDaysFromNow },
            })
                .limit(10)
                .lean();

            for (const proj of urgentProjects) {
                const dedupKey = `deadline_project_${(proj as any)._id.toString()}`;
                const existing = await MonitoringAlert.findOne({
                    companyId: companyObjId,
                    dedupKey,
                    status: { $in: [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED] },
                }).lean();

                if (!existing) {
                    const alert = new MonitoringAlert({
                        companyId: companyObjId,
                        alertType: AlertType.UPCOMING_DEADLINE,
                        severity: AlertSeverity.MEDIUM,
                        title: `Project Deadline Approaching: ${proj.name}`,
                        summary: `Project "${proj.name}" is scheduled to complete on ${proj.endDate?.toLocaleDateString()}.`,
                        dedupKey,
                        resourceType: 'PROJECT',
                        resourceId: (proj as any)._id,
                        status: AlertStatus.ACTIVE,
                        metadata: {
                            projectId: (proj as any)._id.toString(),
                            projectName: proj.name,
                            endDate: proj.endDate,
                        },
                    });
                    await alert.save();

                    const dto = this.mapToDto(alert);
                    generatedAlerts.push(dto);

                    RealtimeEventService.broadcastMonitoringEvent(
                        companyId,
                        MONITORING_SOCKET_EVENTS.ALERT_CREATED,
                        dto
                    );
                }
            }
        } catch (err) {
            console.error('[MonitoringAlertService] Error evaluating alerts:', err);
        }
        return generatedAlerts;
    }

    /**
     * Retrieve paginated alerts for a company with filters
     */
    public static async getAlerts(
        companyId: string,
        params: {
            severity?: string;
            alertType?: string;
            status?: string;
            cursor?: string;
            page?: number;
            pageSize?: number;
            limit?: number;
        } = {}
    ): Promise<{ alerts: IMonitoringAlertDto[]; total: number; page: number; limit: number }> {
        const companyObjId = new Types.ObjectId(companyId);
        const limit = Math.min(100, Math.max(1, params.pageSize || params.limit || 20));
        const page = Math.max(1, params.page || 1);
        const skip = (page - 1) * limit;

        const filter: any = { companyId: companyObjId };
        if (params.severity) filter.severity = params.severity;
        if (params.alertType) filter.alertType = params.alertType;
        if (params.status) filter.status = params.status;
        if (params.cursor && Types.ObjectId.isValid(params.cursor)) {
            filter._id = { $lt: new Types.ObjectId(params.cursor) };
        }

        const [alerts, total] = await Promise.all([
            MonitoringAlert.find(filter)
                .sort({ createdAt: -1 })
                .skip(params.cursor ? 0 : skip)
                .limit(limit)
                .populate<{ acknowledgedById: { _id: Types.ObjectId; name: string } }>('acknowledgedById', 'name')
                .populate<{ resolvedById: { _id: Types.ObjectId; name: string } }>('resolvedById', 'name')
                .lean(),
            MonitoringAlert.countDocuments(filter),
        ]);

        return {
            alerts: alerts.map((a) => this.mapToDto(a)),
            total,
            page,
            limit,
        };
    }

    /**
     * Acknowledge an active alert
     */
    public static async acknowledgeAlert(
        companyId: string,
        alertId: string,
        userId: string,
        note?: string
    ): Promise<IMonitoringAlertDto | null> {
        if (!Types.ObjectId.isValid(alertId) || !Types.ObjectId.isValid(userId)) return null;

        const updated = await MonitoringAlert.findOneAndUpdate(
            {
                _id: new Types.ObjectId(alertId),
                companyId: new Types.ObjectId(companyId),
            },
            {
                $set: {
                    status: AlertStatus.ACKNOWLEDGED,
                    acknowledgedById: new Types.ObjectId(userId),
                    acknowledgedAt: new Date(),
                    ...(note ? { 'metadata.acknowledgementNote': note } : {}),
                },
            },
            { new: true }
        )
            .populate<{ acknowledgedById: { _id: Types.ObjectId; name: string } }>('acknowledgedById', 'name')
            .lean();

        if (updated) {
            const dto = this.mapToDto(updated);
            RealtimeEventService.broadcastMonitoringEvent(
                companyId,
                MONITORING_SOCKET_EVENTS.ALERT_UPDATED,
                dto
            );
            return dto;
        }

        return null;
    }

    /**
     * Resolve an alert
     */
    public static async resolveAlert(
        companyId: string,
        alertId: string,
        userId: string,
        note?: string,
        resolutionReason?: string
    ): Promise<IMonitoringAlertDto | null> {
        if (!Types.ObjectId.isValid(alertId) || !Types.ObjectId.isValid(userId)) return null;

        const updated = await MonitoringAlert.findOneAndUpdate(
            {
                _id: new Types.ObjectId(alertId),
                companyId: new Types.ObjectId(companyId),
            },
            {
                $set: {
                    status: AlertStatus.RESOLVED,
                    resolvedById: new Types.ObjectId(userId),
                    resolvedAt: new Date(),
                    ...(resolutionReason ? { resolutionReason } : {}),
                    ...(note ? { 'metadata.resolutionNote': note } : {}),
                },
            },
            { new: true }
        )
            .populate<{ resolvedById: { _id: Types.ObjectId; name: string } }>('resolvedById', 'name')
            .lean();

        if (updated) {
            const dto = this.mapToDto(updated);
            RealtimeEventService.broadcastMonitoringEvent(
                companyId,
                MONITORING_SOCKET_EVENTS.ALERT_UPDATED,
                dto
            );
            return dto;
        }

        return null;
    }

    private static mapToDto(alertDoc: any): IMonitoringAlertDto {
        return {
            id: alertDoc._id.toString(),
            companyId: alertDoc.companyId.toString(),
            alertType: alertDoc.alertType,
            severity: alertDoc.severity,
            title: alertDoc.title,
            summary: alertDoc.summary,
            resourceType: alertDoc.resourceType,
            resourceId: alertDoc.resourceId ? alertDoc.resourceId.toString() : undefined,
            status: alertDoc.status,
            acknowledgedBy: alertDoc.acknowledgedById
                ? {
                      id: alertDoc.acknowledgedById._id?.toString() || alertDoc.acknowledgedById.toString(),
                      name: alertDoc.acknowledgedById.name || 'Admin',
                  }
                : null,
            acknowledgedAt: alertDoc.acknowledgedAt || null,
            resolvedBy: alertDoc.resolvedById
                ? {
                      id: alertDoc.resolvedById._id?.toString() || alertDoc.resolvedById.toString(),
                      name: alertDoc.resolvedById.name || 'Admin',
                  }
                : null,
            resolvedAt: alertDoc.resolvedAt || null,
            createdAt: alertDoc.createdAt,
            metadata: alertDoc.metadata || {},
        };
    }
}
export default MonitoringAlertService;
