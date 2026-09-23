import mongoose from 'mongoose';
import { SystemHealthData, SystemMetricsData, HealthStatus } from './system-health.types';

export class SuperAdminSystemHealthService {
    /**
     * Measure DB ping latency and connection state.
     */
    private static async checkDatabase(): Promise<{ status: HealthStatus; state: string; latencyMs: number }> {
        const readyState = mongoose.connection.readyState;
        const stateMap: Record<number, string> = {
            0: 'disconnected',
            1: 'connected',
            2: 'connecting',
            3: 'disconnecting',
        };
        const stateName = stateMap[readyState] || 'unknown';

        if (readyState !== 1) {
            return {
                status: readyState === 2 ? 'DEGRADED' : 'UNHEALTHY',
                state: stateName,
                latencyMs: -1,
            };
        }

        try {
            const start = Date.now();
            if (mongoose.connection.db) {
                await mongoose.connection.db.admin().ping();
            }
            const latencyMs = Date.now() - start;
            const status: HealthStatus = latencyMs > 500 ? 'DEGRADED' : 'HEALTHY';
            return { status, state: stateName, latencyMs };
        } catch {
            return { status: 'DEGRADED', state: stateName, latencyMs: -1 };
        }
    }

    /**
     * Get overall system health.
     */
    public static async getHealth(): Promise<SystemHealthData> {
        const dbHealth = await this.checkDatabase();
        const apiStatus: HealthStatus = 'HEALTHY';
        const authStatus: HealthStatus = 'HEALTHY';

        let overallStatus: HealthStatus = 'HEALTHY';
        if (dbHealth.status === 'UNHEALTHY') {
            overallStatus = 'UNHEALTHY';
        } else if (dbHealth.status === 'DEGRADED') {
            overallStatus = 'DEGRADED';
        }

        return {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            services: {
                api: {
                    status: apiStatus,
                    uptimeSeconds: Math.floor(process.uptime()),
                },
                database: {
                    status: dbHealth.status,
                    state: dbHealth.state,
                    latencyMs: dbHealth.latencyMs,
                },
                authentication: {
                    status: authStatus,
                },
            },
        };
    }

    /**
     * Get system process & database metrics.
     */
    public static async getMetrics(): Promise<SystemMetricsData> {
        const dbHealth = await this.checkDatabase();
        const mem = process.memoryUsage();

        return {
            timestamp: new Date().toISOString(),
            process: {
                uptimeSeconds: Math.floor(process.uptime()),
                nodeVersion: process.version,
                pid: process.pid,
                memory: {
                    rssBytes: mem.rss,
                    heapTotalBytes: mem.heapTotal,
                    heapUsedBytes: mem.heapUsed,
                    externalBytes: mem.external,
                    heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
                    rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
                },
            },
            database: {
                status: dbHealth.state,
                latencyMs: dbHealth.latencyMs,
            },
        };
    }
}
