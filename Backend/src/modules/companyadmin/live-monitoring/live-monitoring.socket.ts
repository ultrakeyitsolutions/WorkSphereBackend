import { Server, Socket } from 'socket.io';
import { MONITORING_SOCKET_EVENTS, IMonitoringEventEnvelope } from './live-monitoring.types';
import { LiveMonitoringService } from './services/live-monitoring.service';
import { RealtimeEventService } from './services/realtime-event.service';
import { EmployeePresenceService } from './services/employee-presence.service';
import { MonitoringActivityModel } from './models/monitoring-activity.model';
import { FeatureAccessService } from '../settings/feature-access.service';

export function registerLiveMonitoringHandlers(io: Server, socket: Socket): void {
    const user = socket.data.user;
    if (!user || !user.userId) return;

    const userId = user.userId;
    const companyId = user.companyId;
    const role = user.role;

    // Send initial connected confirmation
    socket.emit(MONITORING_SOCKET_EVENTS.CONNECTED, {
        socketId: socket.id,
        userId,
        companyId,
        serverTime: new Date().toISOString(),
    });

    // ─── Event: monitoring:subscribe ──────────────────────────────────────────
    socket.on(MONITORING_SOCKET_EVENTS.SUBSCRIBE, async (payload: { companyId?: string; scope?: string }) => {
        try {
            // Authorization guard: Only COMPANY_ADMIN, MANAGER, or SUPER_ADMIN may subscribe
            const allowedRoles = ['COMPANY_ADMIN', 'SUPER_ADMIN', 'COMPANY_MANAGER', 'HR_ADMIN', 'ADMIN', 'MANAGER'];
            if (!allowedRoles.includes(role)) {
                socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                    code: 'FORBIDDEN',
                    message: 'You do not have permission to subscribe to live monitoring feeds.',
                });
                return;
            }

            // Derive tenant strictly from server-authenticated context unless SUPER_ADMIN specifies companyId
            const targetCompanyId = role === 'SUPER_ADMIN' && payload?.companyId ? payload.companyId : companyId;

            if (!targetCompanyId) {
                socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                    code: 'INVALID_TENANT',
                    message: 'No authorized company scope associated with this session.',
                });
                return;
            }

            // Verify company settings & plan entitlement feature toggle
            const access = await FeatureAccessService.checkAccess(targetCompanyId, 'enableLiveMonitoring');
            if (!access.allowed) {
                socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                    code: access.reason || 'FEATURE_DISABLED',
                    message: access.message || 'Live monitoring is disabled for this organization.',
                });
                return;
            }

            const room = `company:${targetCompanyId}:monitoring`;
            socket.join(room);

            // Fetch initial snapshot and watermark
            const [overview, watermark] = await Promise.all([
                LiveMonitoringService.getDashboardOverview(targetCompanyId, true),
                RealtimeEventService.getCurrentSequence(targetCompanyId),
            ]);

            socket.emit(MONITORING_SOCKET_EVENTS.SNAPSHOT_READY, {
                companyId: targetCompanyId,
                watermarkSequence: watermark,
                overview,
                subscribedAt: new Date().toISOString(),
            });

            console.log(`[LiveMonitoringSocket] User ${userId} (${role}) subscribed to live monitoring room: ${room}`);
        } catch (err: any) {
            console.error(`[LiveMonitoringSocket] Live monitoring subscribe error: ${err.message}`);
            socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                code: 'SUBSCRIBE_FAILED',
                message: err.message || 'Failed to initialize live monitoring subscription.',
            });
        }
    });

    // ─── Event: monitoring:unsubscribe ────────────────────────────────────────
    socket.on(MONITORING_SOCKET_EVENTS.UNSUBSCRIBE, (payload?: { companyId?: string }) => {
        try {
            const targetCompanyId = role === 'SUPER_ADMIN' && payload?.companyId ? payload.companyId : companyId;
            if (targetCompanyId) {
                const room = `company:${targetCompanyId}:monitoring`;
                socket.leave(room);
                console.log(`[LiveMonitoringSocket] User ${userId} unsubscribed from live monitoring room: ${room}`);
            }
        } catch (err: any) {
            console.error(`[LiveMonitoringSocket] Live monitoring unsubscribe error: ${err.message}`);
        }
    });

    // ─── Event: monitoring:employee:subscribe ─────────────────────────────────
    socket.on(
        MONITORING_SOCKET_EVENTS.EMPLOYEE_SUBSCRIBE,
        async (payload: { employeeId: string; companyId?: string }) => {
            try {
                const allowedRoles = ['COMPANY_ADMIN', 'SUPER_ADMIN', 'COMPANY_MANAGER', 'HR_ADMIN', 'ADMIN', 'MANAGER'];
                if (!allowedRoles.includes(role)) {
                    socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                        code: 'FORBIDDEN',
                        message: 'You do not have permission to subscribe to employee detailed monitoring feeds.',
                    });
                    return;
                }

                const targetCompanyId = role === 'SUPER_ADMIN' && payload?.companyId ? payload.companyId : companyId;
                const employeeId = payload?.employeeId;

                if (!targetCompanyId || !employeeId) {
                    socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                        code: 'INVALID_PARAMS',
                        message: 'Both companyId and employeeId are required for employee monitoring subscription.',
                    });
                    return;
                }

                // Verify company settings & plan entitlement feature toggle
                const access = await FeatureAccessService.checkAccess(targetCompanyId, 'enableLiveMonitoring');
                if (!access.allowed) {
                    socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                        code: access.reason || 'FEATURE_DISABLED',
                        message: access.message || 'Live monitoring is disabled for this organization.',
                    });
                    return;
                }

                const employeeRoom = `company:${targetCompanyId}:employee:${employeeId}`;
                socket.join(employeeRoom);

                // Also join company monitoring room to receive tenant-level activity
                const companyRoom = `company:${targetCompanyId}:monitoring`;
                socket.join(companyRoom);

                socket.emit(MONITORING_SOCKET_EVENTS.EMPLOYEE_SNAPSHOT_READY, {
                    companyId: targetCompanyId,
                    employeeId,
                    subscribedAt: new Date().toISOString(),
                });

                console.log(`[LiveMonitoringSocket] User ${userId} subscribed to employee monitoring room: ${employeeRoom}`);
            } catch (err: any) {
                console.error(`[LiveMonitoringSocket] Employee subscribe error: ${err.message}`);
                socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                    code: 'EMPLOYEE_SUBSCRIBE_FAILED',
                    message: err.message || 'Failed to initialize employee monitoring subscription.',
                });
            }
        }
    );

    // ─── Event: monitoring:employee:unsubscribe ───────────────────────────────
    socket.on(
        MONITORING_SOCKET_EVENTS.EMPLOYEE_UNSUBSCRIBE,
        (payload: { employeeId: string; companyId?: string }) => {
            try {
                const targetCompanyId = role === 'SUPER_ADMIN' && payload?.companyId ? payload.companyId : companyId;
                const employeeId = payload?.employeeId;
                if (targetCompanyId && employeeId) {
                    const room = `company:${targetCompanyId}:employee:${employeeId}`;
                    socket.leave(room);
                    console.log(`[LiveMonitoringSocket] User ${userId} unsubscribed from employee monitoring room: ${room}`);
                }
            } catch (err: any) {
                console.error(`[LiveMonitoringSocket] Employee unsubscribe error: ${err.message}`);
            }
        }
    );

    // ─── Event: monitoring:resume ─────────────────────────────────────────────
    socket.on(
        MONITORING_SOCKET_EVENTS.RESUME,
        async (payload: { lastSequence?: number; lastEventId?: string; companyId?: string }) => {
            try {
                const targetCompanyId = role === 'SUPER_ADMIN' && payload?.companyId ? payload.companyId : companyId;
                if (!targetCompanyId) {
                    socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                        code: 'INVALID_TENANT',
                        message: 'Missing company context for resume.',
                    });
                    return;
                }

                // Verify company settings & plan entitlement feature toggle
                const access = await FeatureAccessService.checkAccess(targetCompanyId, 'enableLiveMonitoring');
                if (!access.allowed) {
                    socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                        code: access.reason || 'FEATURE_DISABLED',
                        message: access.message || 'Live monitoring is disabled for this organization.',
                    });
                    return;
                }

                const room = `company:${targetCompanyId}:monitoring`;
                socket.join(room);

                const lastSeq = payload?.lastSequence || 0;
                const currentSeq = await RealtimeEventService.getCurrentSequence(targetCompanyId);

                // If client sequence is too old (> 100 missed events), instruct full refresh
                if (currentSeq - lastSeq > 100 || lastSeq <= 0) {
                    socket.emit(MONITORING_SOCKET_EVENTS.SYNC_REQUIRED, {
                        reason: 'SEQUENCE_GAP_TOO_LARGE',
                        lastAcknowledgedSequence: lastSeq,
                        currentSequence: currentSeq,
                        message: 'Too many missed events. Please refresh your dashboard snapshot.',
                    });
                    return;
                }

                // Query missed events from DB
                const missedEvents = await MonitoringActivityModel.find({
                    companyId: targetCompanyId,
                    sequence: { $gt: lastSeq, $lte: currentSeq },
                })
                    .sort({ sequence: 1 })
                    .limit(100)
                    .lean();

                // Replay missed events
                for (const doc of missedEvents) {
                    const envelope: IMonitoringEventEnvelope = {
                        eventId: doc.eventId,
                        schemaVersion: 1,
                        type: doc.eventType as any,
                        companyId: doc.companyId.toString(),
                        occurredAt: doc.occurredAt.toISOString(),
                        sequence: doc.sequence,
                        data: {
                            actor: {
                                userId: doc.actorId ? doc.actorId.toString() : undefined,
                                displayName: doc.actorName || 'System',
                                avatar: doc.actorAvatar || undefined,
                            },
                            summary: doc.summary,
                            projectId: doc.projectId?.toString(),
                            taskId: doc.taskId?.toString(),
                            employeeId: doc.employeeId?.toString(),
                            metadata: doc.metadata,
                        },
                    };
                    socket.emit(MONITORING_SOCKET_EVENTS.ACTIVITY_CREATED, envelope);
                }

                console.log(`[LiveMonitoringSocket] User ${userId} resumed live monitoring: replayed ${missedEvents.length} events.`);
            } catch (err: any) {
                console.error(`[LiveMonitoringSocket] Live monitoring resume error: ${err.message}`);
                socket.emit(MONITORING_SOCKET_EVENTS.SYNC_REQUIRED, {
                    reason: 'RESUME_PROCESSING_ERROR',
                    message: err.message,
                });
            }
        }
    );

    // ─── Event: monitoring:heartbeat ──────────────────────────────────────────
    socket.on(MONITORING_SOCKET_EVENTS.HEARTBEAT, () => {
        try {
            EmployeePresenceService.recordHeartbeat(userId);
        } catch {
            // Heartbeat failures should not disrupt client
        }
    });
}
