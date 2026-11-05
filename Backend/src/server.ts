import http from 'http';
import { app } from './app';
import { connectDatabase } from './config/database';
import { env } from './config/env';
import { initSocketServer } from './sockets/socket-server';
import { NotificationEventHandler } from './modules/notifications/notification.event-handler';
import { LiveMonitoringEventHandler } from './modules/companyadmin/live-monitoring/live-monitoring.event-handler';
import { MeetingSchedulerJob } from './modules/meetings/meeting-scheduler.job';
import { StickyNoteReminderJob } from './modules/sticky-notes/sticky-note-reminder.service';
import { EscalationSchedulerJob } from './modules/escalation/jobs/escalationScheduler';
import { verifyMailConnection } from './config/mail';
import { EntitlementService } from './services/entitlement.service';
import { StorageConfigurationService } from './modules/super-admin/storage/storage-config.service';
import { ModuleAccessService } from './modules/companyadmin/module-access/module-access.service';
import { InvitationEmailWorker } from './modules/companyadmin/invitations/invitation-worker';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        
        // Establish database connection in background
        await connectDatabase();

        // Initialize notification and live monitoring event handlers
        NotificationEventHandler.getInstance().initialize();
        LiveMonitoringEventHandler.getInstance().initialize();

        // Initialize cross-worker entitlement invalidation subscriber
        EntitlementService.initRedisSubscriber();

        // Initialize cross-worker storage configuration invalidation subscriber
        StorageConfigurationService.initRedisSubscriber();

        // Initialize cross-worker module access permission subscriber
        ModuleAccessService.initRedisSubscriber();

        // Initialize background invitation email delivery worker (fast API responses).
        InvitationEmailWorker.start();

        // Initialize meeting reminder scheduler
        MeetingSchedulerJob.start();

        // Initialize sticky note reminder scheduler
        StickyNoteReminderJob.start();

        // Initialize workforce compliance escalation scheduler
        EscalationSchedulerJob.start();

        // Create HTTP server wrapping Express
        const httpServer = http.createServer(app);

        // Attach Socket.IO real-time server
        initSocketServer(httpServer);

        // Start listening
        httpServer.listen(PORT, () => {
            console.log(`Server is running on port ${PORT} in ${env.NODE_ENV} environment with Socket.IO.`);
            // Run background SMTP connection check for operational diagnostics
            verifyMailConnection().catch((err) => {
                console.error('[Server] Mail verification error:', err);
            });
        });
    } catch (error) {
        console.error('Failed to start the server:', error);
        process.exit(1);
    }
};

startServer();
