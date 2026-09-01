import { Request } from 'express';
import { AuditLog } from './audit-log.model';
import { AuditAction } from './audit-log.types';
import { Types } from 'mongoose';

// ─── Helper to extract IP from request ───────────────────────────────────────
function getIp(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
    }
    return req.socket?.remoteAddress ?? null;
}

// ─── Log Entry Payload ────────────────────────────────────────────────────────
export interface LogAuditPayload {
    action: AuditAction;
    actorId?: string | null;
    actorEmail?: string | null;
    actorRole?: string | null;
    targetUserId?: string | null;
    targetEmail?: string | null;
    companyId?: string | null;
    companyName?: string | null;
    metadata?: Record<string, any>;
    success?: boolean;
    description: string;
    req?: Request;
}

// ─── Audit Log Service ────────────────────────────────────────────────────────
export class AuditLogService {
    /**
     * Write a single audit log entry. Fire-and-forget — never throws so that
     * a logging failure never breaks the main request flow.
     */
    static async log(payload: LogAuditPayload): Promise<void> {
        try {
            await AuditLog.create({
                action: payload.action,
                actorId: payload.actorId ? new Types.ObjectId(payload.actorId) : null,
                actorEmail: payload.actorEmail ?? null,
                actorRole: payload.actorRole ?? null,
                targetUserId: payload.targetUserId ? new Types.ObjectId(payload.targetUserId) : null,
                targetEmail: payload.targetEmail ?? null,
                companyId: payload.companyId ? new Types.ObjectId(payload.companyId) : null,
                companyName: payload.companyName ?? null,
                metadata: payload.metadata ?? {},
                success: payload.success ?? true,
                description: payload.description,
                ipAddress: payload.req ? getIp(payload.req) : null,
                userAgent: payload.req ? (payload.req.headers['user-agent'] ?? null) : null,
            });
        } catch (err) {
            // Intentional: log to console but never bubble up
            console.error('[AuditLog] Failed to write audit log entry:', err);
        }
    }

    // ─── Query helpers ────────────────────────────────────────────────────────

    /**
     * Get paginated audit logs with flexible filtering.
     */
    static async getAll(filters: {
        action?: string;
        actorEmail?: string;
        companyId?: string;
        success?: string;         // 'true' | 'false'
        startDate?: string;
        endDate?: string;
        page?: number;
        limit?: number;
    }) {
        const query: Record<string, any> = {};

        if (filters.action) query.action = filters.action;
        if (filters.actorEmail) query.actorEmail = { $regex: filters.actorEmail, $options: 'i' };
        if (filters.companyId) query.companyId = new Types.ObjectId(filters.companyId);
        if (filters.success !== undefined)
            query.success = filters.success === 'true';

        if (filters.startDate || filters.endDate) {
            query.createdAt = {};
            if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
            if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
        }

        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
        const skip = (page - 1) * limit;

        const [logs, total] = await Promise.all([
            AuditLog.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AuditLog.countDocuments(query),
        ]);

        return {
            logs,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get audit logs for a specific company.
     */
    static async getByCompany(companyId: string, filters: {
        action?: string;
        success?: string;
        startDate?: string;
        endDate?: string;
        page?: number;
        limit?: number;
    }) {
        return AuditLogService.getAll({ ...filters, companyId });
    }

    /**
     * Get a single audit log entry by ID.
     */
    static async getById(id: string) {
        return AuditLog.findById(id).lean();
    }

    /**
     * Get aggregated stats — useful for a dashboard overview.
     */
    static async getStats() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [totalLogs, todayLogs, failedLogins, actionBreakdown] = await Promise.all([
            AuditLog.countDocuments({}),
            AuditLog.countDocuments({ createdAt: { $gte: today } }),
            AuditLog.countDocuments({ action: AuditAction.USER_LOGIN_FAILED }),
            AuditLog.aggregate([
                { $group: { _id: '$action', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
        ]);

        return {
            totalLogs,
            todayLogs,
            failedLogins,
            actionBreakdown,
        };
    }
}
