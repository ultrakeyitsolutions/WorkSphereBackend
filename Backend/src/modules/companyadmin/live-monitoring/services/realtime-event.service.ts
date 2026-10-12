import { Types } from 'mongoose';
import { getSocketServer } from '../../../../sockets/socket-server';
import {
    MonitoringEventType,
    IMonitoringEventEnvelope,
    MONITORING_SOCKET_EVENTS,
} from '../live-monitoring.types';
import { MonitoringActivity } from '../models/monitoring-activity.model';
import { FeatureAccessService } from '../../settings/feature-access.service';

export interface PublishActivityParams {
    companyId: string;
    eventType: MonitoringEventType;
    actorId?: string | null;
    actorName?: string | null;
    actorAvatar?: string | null;
    employeeId?: string | null;
    employeeName?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    taskId?: string | null;
    taskTitle?: string | null;
    meetingId?: string | null;
    summary: string;
    metadata?: Record<string, any>;
    occurredAt?: Date;
}

export class RealtimeEventService {
    // In-memory monotonic sequence counter per company to guarantee ordered updates & resumption
    private static sequenceCounters = new Map<string, number>();

    /**
     * Get next sequence number for a company room
     */
    public static async getNextSequence(companyId: string): Promise<number> {
        let current = this.sequenceCounters.get(companyId);
        if (current === undefined) {
            // Initialize from database if available
            try {
                const latest = await MonitoringActivity.findOne({
                    companyId: Types.ObjectId.isValid(companyId) ? new Types.ObjectId(companyId) : companyId,
                })
                    .sort({ sequence: -1 })
                    .select('sequence')
                    .lean();
                current = latest?.sequence || 0;
            } catch {
                current = 0;
            }
        }
        const next = current + 1;
        this.sequenceCounters.set(companyId, next);
        return next;
    }

    /**
     * Reset sequence counter (useful for testing or cache invalidation)
     */
    public static resetSequenceCounter(companyId?: string): void {
        if (companyId) {
            this.sequenceCounters.delete(companyId);
        } else {
            this.sequenceCounters.clear();
        }
    }

    /**
     * Get current sequence number for a company
     */
    public static async getCurrentSequence(companyId: string): Promise<number> {

        let current = this.sequenceCounters.get(companyId);
        if (current === undefined) {
            try {
                const latest = await MonitoringActivity.findOne({
                    companyId: Types.ObjectId.isValid(companyId) ? new Types.ObjectId(companyId) : companyId,
                })
                    .sort({ sequence: -1 })
                    .select('sequence')
                    .lean();
                current = latest?.sequence || 0;
            } catch {
                current = 0;
            }
            this.sequenceCounters.set(companyId, current);
        }
        return current;
    }

    /**
     * Centralized method to publish a domain monitoring event
     */
    public static async publishEvent(
        companyId: string,
        eventType: MonitoringEventType,
        payload: {
            actor?: { userId?: string; displayName?: string; avatar?: string };
            summary: string;
            projectId?: string;
            taskId?: string;
            employeeId?: string;
            metadata?: Record<string, any>;
        }
    ): Promise<IMonitoringEventEnvelope> {
        const occurredAt = new Date();
        const sequence = await this.getNextSequence(companyId);
        const eventId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // 1. Persist to MongoDB
        try {
            const activityDoc = new MonitoringActivity({
                companyId: new Types.ObjectId(companyId),
                eventId,
                sequence,
                eventType,
                actorId: payload.actor?.userId && Types.ObjectId.isValid(payload.actor.userId) ? new Types.ObjectId(payload.actor.userId) : null,
                actorName: payload.actor?.displayName || null,
                actorAvatar: payload.actor?.avatar || null,
                employeeId: payload.employeeId && Types.ObjectId.isValid(payload.employeeId) ? new Types.ObjectId(payload.employeeId) : null,
                projectId: payload.projectId && Types.ObjectId.isValid(payload.projectId) ? new Types.ObjectId(payload.projectId) : null,
                taskId: payload.taskId && Types.ObjectId.isValid(payload.taskId) ? new Types.ObjectId(payload.taskId) : null,
                summary: payload.summary,
                metadata: payload.metadata || {},
                occurredAt,
            });
            await activityDoc.save();
        } catch (dbErr) {
            console.warn('[RealtimeEventService] Failed to persist activity record:', dbErr);
        }

        // 2. Format Envelope
        const envelope: IMonitoringEventEnvelope = {
            eventId,
            schemaVersion: 1,
            type: eventType as any,
            companyId,
            occurredAt: occurredAt.toISOString(),
            sequence,
            data: {
                actor: payload.actor || { displayName: 'System' },
                summary: payload.summary,
                projectId: payload.projectId,
                taskId: payload.taskId,
                employeeId: payload.employeeId,
                metadata: payload.metadata || {},
            },
        };

        // 3. Broadcast to Socket.IO live monitoring room and employee room if applicable
        const isLiveMonitoringEnabled = await FeatureAccessService.canAccess(companyId, 'enableLiveMonitoring');
        const io = getSocketServer();
        if (io && isLiveMonitoringEnabled) {
            io.to(`company:${companyId}:monitoring`).emit(
                MONITORING_SOCKET_EVENTS.ACTIVITY_CREATED,
                envelope
            );
            if (payload.employeeId) {
                io.to(`company:${companyId}:employee:${payload.employeeId}`).emit(
                    MONITORING_SOCKET_EVENTS.ACTIVITY_CREATED,
                    envelope
                );
            }
        }

        return envelope;
    }

    /**
     * Publishes a business activity event with detailed entity names
     */
    public static async publishActivity(params: PublishActivityParams): Promise<void> {
        await this.publishEvent(params.companyId, params.eventType, {
            actor: {
                userId: params.actorId || undefined,
                displayName: params.actorName || undefined,
                avatar: params.actorAvatar || undefined,
            },
            summary: params.summary,
            projectId: params.projectId || undefined,
            taskId: params.taskId || undefined,
            employeeId: params.employeeId || undefined,
            metadata: params.metadata,
        });
    }

    /**
     * Broadcasts a custom live monitoring event (presence, employee updated, project updated, alert)
     */
    public static async broadcastMonitoringEvent<T = any>(
        companyId: string,
        eventType: string,
        data: T
    ): Promise<IMonitoringEventEnvelope<T>> {
        const sequence = await this.getNextSequence(companyId);
        const eventId = `ev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const envelope: IMonitoringEventEnvelope<T> = {
            eventId,
            schemaVersion: 1,
            type: eventType,
            companyId,
            occurredAt: new Date().toISOString(),
            sequence,
            data,
        };

        try {
            const isLiveMonitoringEnabled = await FeatureAccessService.canAccess(companyId, 'enableLiveMonitoring');
            const io = getSocketServer();
            if (io && companyId && isLiveMonitoringEnabled) {
                io.to(`company:${companyId}:monitoring`).emit(eventType, envelope);
                const empId = (data as any)?.employeeId || (data as any)?.userId;
                if (empId) {
                    io.to(`company:${companyId}:employee:${empId}`).emit(eventType, envelope);
                }
            }
        } catch (err) {
            console.error(`[RealtimeEventService] Error broadcasting event ${eventType}:`, err);
        }

        return envelope;
    }
}
export default RealtimeEventService;
