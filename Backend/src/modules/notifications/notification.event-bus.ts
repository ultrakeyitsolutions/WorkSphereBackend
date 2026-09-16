import { EventEmitter } from 'events';
import { NotificationEventPayload } from './notification.types';

// ─── Notification Event Bus ───────────────────────────────────────────────────
// Thin wrapper around Node EventEmitter.
// Interface contract is kept abstract so it can be swapped for BullMQ/Redis
// in the future without touching any business module.

export class NotificationEventBus extends EventEmitter {
    private static instance: NotificationEventBus;

    private constructor() {
        super();
        this.setMaxListeners(100);
    }

    public static getInstance(): NotificationEventBus {
        if (!NotificationEventBus.instance) {
            NotificationEventBus.instance = new NotificationEventBus();
        }
        return NotificationEventBus.instance;
    }

    /**
     * Publish a notification event from any business module.
     * This is ALWAYS fire-and-forget — callers must NOT await this.
     */
    public publish(payload: NotificationEventPayload): void {
        setImmediate(() => {
            this.emit(payload.type, payload);
            this.emit('*', payload);
        });
    }

    /**
     * Alias for publish to allow NotificationEventBus.getInstance().emit('TASK_CREATED', payload)
     */
    public dispatch(type: string, payload: NotificationEventPayload): void {
        setImmediate(() => {
            this.emit(type, payload);
            this.emit('*', payload);
        });
    }
}
