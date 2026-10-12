import { NotificationEventBus } from '../../notifications/notification.event-bus';
import { NotificationEventPayload } from '../../notifications/notification.types';
import { RealtimeEventService } from './services/realtime-event.service';
import { MonitoringEventType } from './live-monitoring.types';
import { User } from '../../users/user.model';

export class LiveMonitoringEventHandler {
    private static instance: LiveMonitoringEventHandler;
    private isInitialized = false;

    public static getInstance(): LiveMonitoringEventHandler {
        if (!LiveMonitoringEventHandler.instance) {
            LiveMonitoringEventHandler.instance = new LiveMonitoringEventHandler();
        }
        return LiveMonitoringEventHandler.instance;
    }

    public initialize(): void {
        if (this.isInitialized) return;

        const bus = NotificationEventBus.getInstance();

        bus.on('*', (payload: NotificationEventPayload) => {
            setImmediate(() => {
                this.handleDomainEvent(payload).catch((err) => {
                    console.error(`[LiveMonitoringEventHandler] Error processing domain event ${payload?.type}:`, err);
                });
            });
        });

        this.isInitialized = true;
        console.log('[LiveMonitoringEventHandler] Live monitoring event handler initialized.');
    }

    private async handleDomainEvent(payload: NotificationEventPayload): Promise<void> {
        if (!payload || !payload.companyId) return;

        const companyId = payload.companyId;
        const actorId = payload.actorId || '';
        let actorName = 'System';
        let actorAvatar: string | undefined;

        if (actorId) {
            const user = (await User.findById(actorId).lean()) as any;
            if (user) {
                actorName = user.name || 'Team Member';
                actorAvatar = user.avatar || user.profilePicture;
            }
        }

        let eventType: MonitoringEventType | null = null;
        let summary = '';

        switch (payload.type) {
            case 'TASK_CREATED':
                eventType = MonitoringEventType.TASK_ASSIGNED;
                summary = `${actorName} created task "${payload.metadata?.taskTitle || 'Task'}"`;
                break;
            case 'TASK_STATUS_CHANGED':
                eventType = MonitoringEventType.TASK_STATUS_CHANGED;
                summary = `${actorName} updated status for "${payload.metadata?.taskTitle || 'Task'}" to ${payload.metadata?.newStatus || 'new status'}`;
                break;
            case 'TASK_COMPLETED':
                eventType = MonitoringEventType.TASK_COMPLETED;
                summary = `${actorName} completed task "${payload.metadata?.taskTitle || 'Task'}"`;
                break;
            case 'TASK_REVIEW_REQUESTED':
                eventType = MonitoringEventType.TASK_SUBMITTED_FOR_REVIEW;
                summary = `${actorName} submitted "${payload.metadata?.taskTitle || 'Task'}" for review`;
                break;
            case 'TASK_ASSIGNED':
                eventType = MonitoringEventType.TASK_ASSIGNED;
                summary = `Task "${payload.metadata?.taskTitle || 'Task'}" was assigned`;
                break;
            case 'ATTENDANCE_CHECKIN':
                eventType = MonitoringEventType.ATTENDANCE_CHECKED_IN;
                summary = `${actorName} checked in`;
                break;
            case 'ATTENDANCE_CHECKOUT':
                eventType = MonitoringEventType.ATTENDANCE_CHECKED_OUT;
                summary = `${actorName} checked out`;
                break;
            case 'PROJECT_CREATED':
                eventType = MonitoringEventType.PROJECT_STATUS_CHANGED;
                summary = `${actorName} created project "${payload.metadata?.projectName || 'Project'}"`;
                break;
            case 'PROJECT_STATUS_CHANGED':
                eventType = MonitoringEventType.PROJECT_STATUS_CHANGED;
                summary = `Project "${payload.metadata?.projectName || 'Project'}" status changed to ${payload.metadata?.newStatus || 'updated'}`;
                break;
            case 'MEETING_SCHEDULED':
            case 'MEETING_STARTED':
                eventType = MonitoringEventType.MEETING_STARTED;
                summary = `Meeting "${payload.metadata?.title || 'Team Meeting'}" started`;
                break;
            case 'MEETING_ENDED':
                eventType = MonitoringEventType.MEETING_ENDED;
                summary = `Meeting "${payload.metadata?.title || 'Team Meeting'}" ended`;
                break;
            case 'LEAVE_APPROVED':
                eventType = MonitoringEventType.EMPLOYEE_STATUS_CHANGED;
                summary = `Leave approved for ${actorName}`;
                break;
            default:
                break;
        }

        if (eventType) {
            await RealtimeEventService.publishEvent(companyId, eventType, {
                actor: {
                    userId: actorId,
                    displayName: actorName,
                    avatar: actorAvatar,
                },
                summary,
                projectId: payload.projectId,
                taskId: payload.taskId,
                employeeId: payload.actorId,
                metadata: payload.metadata,
            });
        }
    }
}

// Auto-initialize on import
LiveMonitoringEventHandler.getInstance().initialize();
