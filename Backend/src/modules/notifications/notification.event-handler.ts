import { NotificationEventBus } from './notification.event-bus';
import { NotificationService } from './notification.service';
import { NOTIFICATION_TYPES, NotificationEventPayload } from './notification.types';

// ─── Notification Event Handler ───────────────────────────────────────────
// Listens to domain events on the NotificationEventBus and forwards them to NotificationService.

export class NotificationEventHandler {
    private static instance: NotificationEventHandler;
    private service = new NotificationService();
    private isInitialized = false;

    public static getInstance(): NotificationEventHandler {
        if (!NotificationEventHandler.instance) {
            NotificationEventHandler.instance = new NotificationEventHandler();
        }
        return NotificationEventHandler.instance;
    }

    /**
     * Registers listeners for all notification types in the registry.
     * Safe to call multiple times (idempotent initialization).
     */
    public initialize(): void {
        if (this.isInitialized) return;

        const bus = NotificationEventBus.getInstance();

        // Register listener for wildcard / all notification events
        for (const type of Object.keys(NOTIFICATION_TYPES)) {
            bus.on(type, (payload: NotificationEventPayload) => {
                // Fire and forget via setImmediate to decouple caller completely
                setImmediate(() => {
                    this.service.publish(payload).catch((err) => {
                        console.error(`[NotificationEventHandler] Failed handling event ${type}:`, err);
                    });
                });
            });
        }

        this.isInitialized = true;
        console.log('[NotificationEventHandler] Event handler initialized for all notification types.');
    }
}

// Auto-initialize on import
NotificationEventHandler.getInstance().initialize();
