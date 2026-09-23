import { Types } from 'mongoose';
import { AuditLog } from '../../audit-logs/audit-log.model';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../shared/pagination.util';
import { AuditLogFilters } from './audit.types';
import { AppError } from '../../../utils/AppError';

export class SuperAdminAuditService {
    /**
     * List audit logs with comprehensive filters and search.
     */
    public static async listLogs(
        pagination: PaginationParams,
        filters: AuditLogFilters
    ): Promise<PaginatedResult<any>> {
        const query: any = {};

        if (filters.action) {
            query.action = filters.action.toUpperCase();
        }

        if (filters.actorUserId && Types.ObjectId.isValid(filters.actorUserId)) {
            query.actorId = new Types.ObjectId(filters.actorUserId);
        }

        if (filters.targetUserId && Types.ObjectId.isValid(filters.targetUserId)) {
            query.targetUserId = new Types.ObjectId(filters.targetUserId);
        }

        if (filters.companyId && Types.ObjectId.isValid(filters.companyId)) {
            query.companyId = new Types.ObjectId(filters.companyId);
        }

        if (filters.startDate || filters.endDate) {
            query.createdAt = {};
            if (filters.startDate) {
                const s = new Date(filters.startDate);
                if (!isNaN(s.getTime())) query.createdAt.$gte = s;
            }
            if (filters.endDate) {
                const e = new Date(filters.endDate);
                if (!isNaN(e.getTime())) {
                    e.setHours(23, 59, 59, 999);
                    query.createdAt.$lte = e;
                }
            }
        }

        if (filters.search) {
            const regex = new RegExp(filters.search.trim(), 'i');
            query.$or = [
                { actorEmail: regex },
                { targetEmail: regex },
                { companyName: regex },
                { description: regex },
                { ipAddress: regex },
            ];
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [logs, total] = await Promise.all([
            AuditLog.find(query)
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            AuditLog.countDocuments(query),
        ]);

        const items = logs.map((log: any) => ({
            id: log._id,
            action: log.action,
            actorId: log.actorId,
            actorEmail: log.actorEmail,
            actorRole: log.actorRole,
            targetUserId: log.targetUserId,
            targetEmail: log.targetEmail,
            companyId: log.companyId,
            companyName: log.companyName,
            metadata: log.metadata,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            success: log.success,
            description: log.description,
            createdAt: log.createdAt,
        }));

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }

    /**
     * Get single audit record safely.
     */
    public static async getLogById(auditId: string) {
        if (!Types.ObjectId.isValid(auditId)) {
            throw AppError.badRequest('Invalid audit log ID');
        }

        const log = await AuditLog.findById(auditId).lean();
        if (!log) {
            throw AppError.notFound('Audit log record not found');
        }

        // Clean metadata of any sensitive keys if accidentally present
        const sanitizedMetadata = { ...log.metadata };
        delete sanitizedMetadata.password;
        delete sanitizedMetadata.passwordHash;
        delete sanitizedMetadata.token;
        delete sanitizedMetadata.secret;

        return {
            id: log._id,
            action: log.action,
            actorId: log.actorId,
            actorEmail: log.actorEmail,
            actorRole: log.actorRole,
            targetUserId: log.targetUserId,
            targetEmail: log.targetEmail,
            companyId: log.companyId,
            companyName: log.companyName,
            metadata: sanitizedMetadata,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            success: log.success,
            description: log.description,
            createdAt: log.createdAt,
            updatedAt: log.updatedAt,
        };
    }
}
