import dns from 'dns';
import mongoose from 'mongoose';
import { env } from './env';
import { performance } from 'perf_hooks';

// Ensure Node uses public DNS resolvers to handle SRV lookups reliably on Windows
try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {
    // Ignore if not supported
}

export const connectDatabase = async (): Promise<void> => {
    const start = performance.now();
    try {
        mongoose.connection.on('error', (err) => {
            console.error('[DB] Connection error:', err.message);
            import('../modules/super-admin/notifications/super-admin-notification.service.js').then(
                ({ SuperAdminNotificationService }) => {
                    SuperAdminNotificationService.dispatch({
                        type: 'MONGODB_CONNECTION_FAILED',
                        priority: 'CRITICAL',
                        eventId: `mongo_err_${Date.now()}`,
                        metadata: {
                            errorMessage: err.message,
                            state: 'error',
                            timestamp: new Date().toISOString(),
                        },
                    }).catch(() => {});
                }
            ).catch(() => {});
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('[DB] Connection lost.');
            import('../modules/super-admin/notifications/super-admin-notification.service.js').then(
                ({ SuperAdminNotificationService }) => {
                    SuperAdminNotificationService.dispatch({
                        type: 'MONGODB_CONNECTION_FAILED',
                        priority: 'CRITICAL',
                        eventId: `mongo_disc_${Date.now()}`,
                        metadata: {
                            errorMessage: 'MongoDB connection lost or disconnected',
                            state: 'disconnected',
                            timestamp: new Date().toISOString(),
                        },
                    }).catch(() => {});
                }
            ).catch(() => {});
        });

        await mongoose.connect(env.MONGODB_URI, {
            maxPoolSize: 50,
            minPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 30000,
            family: 4,
        });

        console.log(
            `[DB] mongoose.connect: ${(performance.now() - start).toFixed(2)}ms`
        );

        console.log('Successfully connected to MongoDB.');

        const pingStart = performance.now();
        await mongoose.connection.db?.command({ ping: 1 });
        console.log(
            `[DB] ping: ${(performance.now() - pingStart).toFixed(2)}ms`
        );
    } catch (error: any) {
        console.error('Database connection failed:', error);
        import('../modules/super-admin/notifications/super-admin-notification.service.js').then(
            ({ SuperAdminNotificationService }) => {
                SuperAdminNotificationService.dispatch({
                    type: 'MONGODB_CONNECTION_FAILED',
                    priority: 'CRITICAL',
                    eventId: `mongo_init_fail_${Date.now()}`,
                    metadata: {
                        errorMessage: error?.message || 'Database initial connection failed',
                        state: 'failed',
                        timestamp: new Date().toISOString(),
                    },
                }).catch(() => {});
            }
        ).catch(() => {});
        process.exit(1);
    }
};