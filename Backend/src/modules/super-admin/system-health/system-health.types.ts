export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface SystemHealthData {
    status: HealthStatus;
    timestamp: string;
    services: {
        api: {
            status: HealthStatus;
            uptimeSeconds: number;
            version?: string;
        };
        database: {
            status: HealthStatus;
            state: string; // 'connected' | 'connecting' | 'disconnected'
            latencyMs: number;
        };
        authentication: {
            status: HealthStatus;
        };
    };
}

export interface SystemMetricsData {
    timestamp: string;
    process: {
        uptimeSeconds: number;
        nodeVersion: string;
        pid: number;
        memory: {
            rssBytes: number;
            heapTotalBytes: number;
            heapUsedBytes: number;
            externalBytes: number;
            heapUsedMb: number;
            rssMb: number;
        };
    };
    database: {
        status: string;
        latencyMs: number;
    };
}
