import mongoose, { Types } from 'mongoose';
import { Notification, INotification } from '../../notifications/notification.model';
import {
    NOTIFICATION_TYPES,
    NotificationPriority,
} from '../../notifications/notification.types';
import { TemplateEngine } from '../../notifications/notification.template-engine';
import { getSocketServer } from '../../../sockets/socket-server';
import { Role } from '../../roles/role.model';
import { User } from '../../users/user.model';
import {
    SuperAdminDispatchPayload,
    SuperAdminNotificationFilter,
    ISuperAdminPreference,
    SUPERADMIN_CATEGORIES,
} from './super-admin-notification.types';
import { SuperAdminNotificationPreference } from './super-admin-notification-preference.model';
import { SuperAdminNotificationRedisService } from './super-admin-notification-redis.service';
import { AppError } from '../../../utils/AppError';

// Priority weight lookup for minimum priority threshold evaluation
const PRIORITY_WEIGHTS: Record<NotificationPriority, number> = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4,
};

export class SuperAdminNotificationService {
    // In-memory cooldown tracking to prevent notification storms from repetitive failures
    private static alertCooldowns = new Map<string, number>();

    /**
     * Resolves all active SuperAdmin user IDs dynamically from the database.
     * Never hardcodes IDs.
     */
    public static async getActiveSuperAdminIds(): Promise<Types.ObjectId[]> {
        try {
            const superAdminRole = await Role.findOne({ name: 'SUPER_ADMIN' }).lean();
            if (!superAdminRole) {
                console.warn('[SuperAdminNotificationService] Role SUPER_ADMIN not found in database.');
                return [];
            }

            const superAdmins = await User.find({
                role: superAdminRole._id,
                isActive: true,
                isDeleted: { $ne: true },
                status: 'ACTIVE',
            })
                .select('_id')
                .lean();

            return superAdmins.map((u) => u._id as Types.ObjectId);
        } catch (err: any) {
            console.error('[SuperAdminNotificationService] Failed to resolve SuperAdmin users:', err?.message);
            return [];
        }
    }

    /**
     * Alias for dispatch to provide flexible invocation syntax.
     */
    public static async dispatchNotification(payload: any): Promise<INotification[]> {
        return this.dispatch(payload);
    }

    /**
     * Dispatches a notification to all authorized SuperAdmin accounts.
     * Guaranteed safe, idempotent, and non-blocking.
     */
    public static async dispatch(payload: SuperAdminDispatchPayload): Promise<INotification[]> {
        try {
            const { type, companyId, actorId, entityId, entityType, actionUrl, metadata, eventId } = payload;

            const typeDef = NOTIFICATION_TYPES[type];
            if (!typeDef) {
                console.warn(`[SuperAdminNotificationService] Unregistered notification type: ${type}`);
                return [];
            }

            const priority: NotificationPriority =
                payload.priority || typeDef.defaultPriority || 'MEDIUM';
            const category = payload.category || typeDef.category;

            // 1. Alert Deduplication & Cooldown Tracking for continuous failures
            const cooldownKey = `${type}_${companyId || 'system'}_${metadata?.errorReason || metadata?.serviceName || ''}`;
            const cooldownMs = metadata?.cooldownMs ?? (priority === 'CRITICAL' ? 60000 : 180000); // 1 min for critical, 3 min for others
            const lastDispatched = this.alertCooldowns.get(cooldownKey);
            const now = Date.now();

            if (lastDispatched && now - lastDispatched < cooldownMs && !metadata?.bypassCooldown) {
                // Cooldown active — suppress repetitive notification
                return [];
            }
            this.alertCooldowns.set(cooldownKey, now);

            // 2. Discover target SuperAdmin recipients
            let targetRecipients: Types.ObjectId[] = [];
            if (payload.targetSuperAdminIds && payload.targetSuperAdminIds.length > 0) {
                targetRecipients = payload.targetSuperAdminIds
                    .filter((id) => Types.ObjectId.isValid(id))
                    .map((id) => new Types.ObjectId(id));
            } else {
                targetRecipients = await this.getActiveSuperAdminIds();
            }

            if (targetRecipients.length === 0) {
                return [];
            }

            // 3. Resolve Company Name & Actor Name for Template Context
            let companyName = metadata?.companyName;
            if (!companyName && companyId && Types.ObjectId.isValid(companyId) && mongoose.connection.readyState === 1) {
                try {
                    const compDoc = await mongoose.connection.collection('companies').findOne(
                        { _id: new Types.ObjectId(companyId) },
                        { projection: { name: 1 } }
                    );
                    if (compDoc?.name) {
                        companyName = compDoc.name;
                    }
                } catch {
                    // Non-blocking fallback
                }
            }

            let actorName = metadata?.actorName;
            if (!actorName && actorId && Types.ObjectId.isValid(actorId) && mongoose.connection.readyState === 1) {
                try {
                    const actorDoc = await mongoose.connection.collection('users').findOne(
                        { _id: new Types.ObjectId(actorId) },
                        { projection: { name: 1 } }
                    );
                    if (actorDoc?.name) {
                        actorName = actorDoc.name;
                    }
                } catch {
                    // Non-blocking fallback
                }
            }

            const mergedContext = {
                ...typeDef.defaultMetadata,
                companyName: companyName || 'Platform',
                actorName: actorName || 'System',
                ...metadata,
            };

            const title = payload.title || TemplateEngine.render(typeDef.defaultTitle, mergedContext);
            const message = payload.message || TemplateEngine.render(typeDef.defaultMessage, mergedContext);

            // 4. Filter recipients based on individual preferences and idempotency
            const filteredRecipients: Types.ObjectId[] = [];

            for (const superAdminId of targetRecipients) {
                // Check idempotency if eventId is provided
                if (eventId) {
                    const exists = await Notification.countDocuments({
                        eventId,
                        recipientId: superAdminId,
                    });
                    if (exists > 0) {
                        continue;
                    }
                }

                // Check SuperAdmin notification preferences
                const pref = await this.getPreferences(superAdminId.toString());
                const isCategoryEnabled = pref.categories[category] !== false;
                const minWeight = PRIORITY_WEIGHTS[pref.minPriority || 'LOW'] || 1;
                const currentWeight = PRIORITY_WEIGHTS[priority] || 2;

                const passesPriority = currentWeight >= minWeight;

                // Safety rule: Critical security and infrastructure alerts MUST NOT be silently disabled without explicit policy
                const isCriticalSafetyEvent =
                    priority === 'CRITICAL' ||
                    category === 'SECURITY_ACCESS' ||
                    category === 'SYSTEM_HEALTH';

                if (!pref.allowDisableCriticalSecurity && isCriticalSafetyEvent) {
                    // Mandatory delivery for critical security/infrastructure alerts
                    filteredRecipients.push(superAdminId);
                } else if (isCategoryEnabled && passesPriority) {
                    filteredRecipients.push(superAdminId);
                }
            }

            if (filteredRecipients.length === 0) {
                if (eventId) {
                    try {
                        const existing = await Notification.find({ eventId }).lean();
                        return existing as unknown as INotification[];
                    } catch {
                        return [];
                    }
                }
                return [];
            }

            // 5. Expiration / Retention (Default 180 days for SuperAdmin audit trail)
            const retentionDays = metadata?.retentionDays || 180;
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + retentionDays);

            const companyObjId = companyId && Types.ObjectId.isValid(companyId) ? new Types.ObjectId(companyId) : null;
            const actorObjId = actorId && Types.ObjectId.isValid(actorId) ? new Types.ObjectId(actorId) : null;
            const entityObjId = entityId && Types.ObjectId.isValid(entityId) ? new Types.ObjectId(entityId) : null;

            // 6. Build notification documents
            const docsToInsert = filteredRecipients.map((rid) => ({
                companyId: companyObjId,
                recipientId: rid,
                recipientRole: 'SUPER_ADMIN',
                actorId: actorObjId,
                type,
                category,
                title,
                message,
                priority,
                style: typeDef.defaultStyle || 'INFO',
                icon: typeDef.icon || 'bell',
                entityId: entityObjId,
                entityType,
                actionUrl: actionUrl || null,
                metadata: mergedContext,
                isRead: false,
                eventId: eventId || null,
                expiresAt,
            }));

            // 7. Persist to MongoDB
            let createdNotifications: INotification[] = [];
            try {
                createdNotifications = (await Notification.insertMany(docsToInsert, {
                    ordered: false,
                })) as INotification[];
            } catch (insertErr: any) {
                if (insertErr?.insertedDocs && insertErr.insertedDocs.length > 0) {
                    createdNotifications = insertErr.insertedDocs as INotification[];
                } else if (insertErr?.code !== 11000) {
                    console.error('[SuperAdminNotificationService] Error persisting notifications:', insertErr?.message);
                }
            }

            // 8. Real-time Delivery via Socket.IO & Redis Pub/Sub (Insulated from throwing)
            try {
                const io = getSocketServer();

                for (const notif of createdNotifications) {
                    const recipientIdStr = notif.recipientId.toString();

                    const socketPayload = {
                        id: notif._id,
                        _id: notif._id,
                        recipientId: recipientIdStr,
                        recipientRole: notif.recipientRole,
                        companyId: notif.companyId,
                        type: notif.type,
                        category: notif.category,
                        title: notif.title,
                        message: notif.message,
                        priority: notif.priority,
                        style: notif.style,
                        icon: notif.icon,
                        actionUrl: notif.actionUrl,
                        metadata: notif.metadata,
                        isRead: notif.isRead,
                        createdAt: notif.createdAt,
                    };

                    // Local Socket.IO emission to dedicated SuperAdmin room and user room
                    if (io) {
                        try {
                            io.to('superadmin').emit('superadmin:notification:new', socketPayload);
                            io.to(`user:${recipientIdStr}`).emit('superadmin:notification:new', socketPayload);

                            // Deliver updated unread count to this SuperAdmin
                            this.getUnreadCount(recipientIdStr).then((unreadCount) => {
                                io.to(`user:${recipientIdStr}`).emit('superadmin:notification:unread-count', { unreadCount });
                                SuperAdminNotificationRedisService.publishEvent({
                                    event: 'superadmin:notification:unread-count',
                                    recipientId: recipientIdStr,
                                    unreadCount,
                                    timestamp: Date.now(),
                                });
                            }).catch(() => {});
                        } catch (socketErr: any) {
                            console.error('[SuperAdminNotificationService] Socket emission failed:', socketErr?.message);
                        }
                    }

                    // Cross-worker synchronization via Redis
                    SuperAdminNotificationRedisService.publishEvent({
                        event: 'superadmin:notification:new',
                        recipientId: recipientIdStr,
                        notification: socketPayload,
                        timestamp: Date.now(),
                    });
                }
            } catch (deliveryErr: any) {
                console.error('[SuperAdminNotificationService] Real-time delivery error:', deliveryErr?.message);
            }

            return createdNotifications;
        } catch (err: any) {
            console.error('[SuperAdminNotificationService] Unexpected dispatch error:', err?.message);
            return [];
        }
    }

    // ─── Query & API Support Methods ──────────────────────────────────────────

    /**
     * Retrieve paginated and filtered notifications for a SuperAdmin.
     */
    public static async getNotifications(
        superAdminId: string,
        filter: SuperAdminNotificationFilter
    ): Promise<{
        notifications: INotification[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        unreadCount: number;
    }> {
        const page = Math.max(1, Number(filter.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
        const skip = (page - 1) * limit;

        const query: any = {
            recipientId: new Types.ObjectId(superAdminId),
        };

        // Category filtering
        if (filter.category) {
            if (Array.isArray(filter.category)) {
                query.category = { $in: filter.category };
            } else if (filter.category !== 'ALL') {
                query.category = filter.category;
            }
        }

        // Priority filtering
        if (filter.priority) {
            if (Array.isArray(filter.priority)) {
                query.priority = { $in: filter.priority };
            } else if (filter.priority !== 'ALL') {
                query.priority = filter.priority;
            }
        }

        // Read/unread filtering
        if (typeof filter.isRead === 'boolean') {
            query.isRead = filter.isRead;
        }

        // Date range filtering
        if (filter.startDate || filter.endDate) {
            query.createdAt = {};
            if (filter.startDate) {
                query.createdAt.$gte = new Date(filter.startDate);
            }
            if (filter.endDate) {
                query.createdAt.$lte = new Date(filter.endDate);
            }
        }

        // Company filter
        if (filter.companyId && Types.ObjectId.isValid(filter.companyId)) {
            query.companyId = new Types.ObjectId(filter.companyId);
        }

        // Text search
        if (filter.search && filter.search.trim()) {
            const regex = new RegExp(filter.search.trim(), 'i');
            query.$or = [{ title: regex }, { message: regex }];
        }

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('companyId', 'name slug logoUrl')
                .lean(),
            Notification.countDocuments(query),
            Notification.countDocuments({
                recipientId: new Types.ObjectId(superAdminId),
                isRead: false,
            }),
        ]);

        return {
            notifications: notifications as INotification[],
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
            unreadCount,
        };
    }

    /**
     * Get unread notification count for a SuperAdmin.
     */
    public static async getUnreadCount(superAdminId: string): Promise<number> {
        return Notification.countDocuments({
            recipientId: new Types.ObjectId(superAdminId),
            isRead: false,
        });
    }

    /**
     * Get a single notification by ID.
     */
    public static async getNotificationById(
        notificationId: string,
        superAdminId: string
    ): Promise<INotification> {
        if (!Types.ObjectId.isValid(notificationId)) {
            throw AppError.badRequest('Invalid notification ID format');
        }

        const notif = await Notification.findOne({
            _id: new Types.ObjectId(notificationId),
            recipientId: new Types.ObjectId(superAdminId),
        }).populate('companyId', 'name slug logoUrl');

        if (!notif) {
            throw AppError.notFound('Notification not found');
        }

        return notif;
    }

    /**
     * Mark a single notification as read.
     */
    public static async markAsRead(
        notificationId: string,
        superAdminId: string
    ): Promise<INotification> {
        if (!Types.ObjectId.isValid(notificationId)) {
            throw AppError.badRequest('Invalid notification ID format');
        }

        const notif = await Notification.findOneAndUpdate(
            {
                _id: new Types.ObjectId(notificationId),
                recipientId: new Types.ObjectId(superAdminId),
            },
            {
                $set: {
                    isRead: true,
                    readAt: new Date(),
                },
            },
            { new: true }
        );

        if (!notif) {
            throw AppError.notFound('Notification not found');
        }

        // Deliver updated unread count to this SuperAdmin
        const unreadCount = await this.getUnreadCount(superAdminId);
        const io = getSocketServer();
        if (io) {
            io.to(`user:${superAdminId}`).emit('superadmin:notification:unread-count', { unreadCount });
            io.to(`user:${superAdminId}`).emit('superadmin:notification:read', {
                notificationId,
                recipientId: superAdminId,
            });
        }

        SuperAdminNotificationRedisService.publishEvent({
            event: 'superadmin:notification:read',
            recipientId: superAdminId,
            notificationId,
            timestamp: Date.now(),
        });

        SuperAdminNotificationRedisService.publishEvent({
            event: 'superadmin:notification:unread-count',
            recipientId: superAdminId,
            unreadCount,
            timestamp: Date.now(),
        });

        return notif;
    }

    /**
     * Mark all unread notifications as read for a SuperAdmin.
     */
    public static async markAllAsRead(superAdminId: string): Promise<number> {
        const result = await Notification.updateMany(
            {
                recipientId: new Types.ObjectId(superAdminId),
                isRead: false,
            },
            {
                $set: {
                    isRead: true,
                    readAt: new Date(),
                },
            }
        );

        const io = getSocketServer();
        if (io) {
            io.to(`user:${superAdminId}`).emit('superadmin:notification:unread-count', { unreadCount: 0 });
        }

        SuperAdminNotificationRedisService.publishEvent({
            event: 'superadmin:notification:unread-count',
            recipientId: superAdminId,
            unreadCount: 0,
            timestamp: Date.now(),
        });

        return result.modifiedCount || 0;
    }

    /**
     * Delete a single notification.
     */
    public static async deleteNotification(
        notificationId: string,
        superAdminId: string
    ): Promise<boolean> {
        if (!Types.ObjectId.isValid(notificationId)) {
            throw AppError.badRequest('Invalid notification ID format');
        }

        const result = await Notification.deleteOne({
            _id: new Types.ObjectId(notificationId),
            recipientId: new Types.ObjectId(superAdminId),
        });

        if (result.deletedCount === 0) {
            throw AppError.notFound('Notification not found');
        }

        // Update unread count if deleted notification was unread
        const unreadCount = await this.getUnreadCount(superAdminId);
        const io = getSocketServer();
        if (io) {
            io.to(`user:${superAdminId}`).emit('superadmin:notification:unread-count', { unreadCount });
        }

        return true;
    }

    /**
     * Delete all read notifications for a SuperAdmin.
     */
    public static async deleteReadNotifications(superAdminId: string): Promise<number> {
        const result = await Notification.deleteMany({
            recipientId: new Types.ObjectId(superAdminId),
            isRead: true,
        });

        return result.deletedCount || 0;
    }

    /**
     * Get notification preferences for a SuperAdmin.
     */
    public static async getPreferences(superAdminId: string): Promise<ISuperAdminPreference> {
        const prefDoc = await SuperAdminNotificationPreference.findOne({
            userId: new Types.ObjectId(superAdminId),
        }).lean();

        if (!prefDoc) {
            // Build default preferences map
            const catMap: Record<string, boolean> = {};
            for (const cat of SUPERADMIN_CATEGORIES) {
                catMap[cat] = true;
            }

            return {
                userId: superAdminId,
                categories: catMap,
                minPriority: 'LOW',
                channels: { inApp: true, email: true, push: true },
                allowDisableCriticalSecurity: false,
            };
        }

        const rawCategories = prefDoc.categories as any;
        const categoriesObj: Record<string, boolean> = {};
        if (rawCategories instanceof Map) {
            for (const [k, v] of rawCategories.entries()) {
                categoriesObj[k] = v;
            }
        } else if (typeof rawCategories === 'object' && rawCategories !== null) {
            Object.assign(categoriesObj, rawCategories);
        }

        // Ensure all categories exist in returned object
        for (const cat of SUPERADMIN_CATEGORIES) {
            if (categoriesObj[cat] === undefined) {
                categoriesObj[cat] = true;
            }
        }

        return {
            userId: superAdminId,
            categories: categoriesObj,
            minPriority: prefDoc.minPriority || 'LOW',
            channels: prefDoc.channels || { inApp: true, email: true, push: true },
            allowDisableCriticalSecurity: Boolean(prefDoc.allowDisableCriticalSecurity),
        };
    }

    /**
     * Update notification preferences for a SuperAdmin with safety validations.
     */
    public static async updatePreferences(
        superAdminId: string,
        updates: Partial<ISuperAdminPreference>
    ): Promise<ISuperAdminPreference> {
        const current = await this.getPreferences(superAdminId);

        // Security check: Verify if disabling critical categories without policy
        if (updates.categories) {
            const disablingSecurity = updates.categories['SECURITY_ACCESS'] === false;
            const disablingHealth = updates.categories['SYSTEM_HEALTH'] === false;
            const hasExplicitOverride =
                updates.allowDisableCriticalSecurity ?? current.allowDisableCriticalSecurity;

            if ((disablingSecurity || disablingHealth) && !hasExplicitOverride) {
                throw AppError.badRequest(
                    'Critical security and system health alerts cannot be disabled without explicit administrative override policy.'
                );
            }
        }

        const mergedCategories = {
            ...current.categories,
            ...(updates.categories || {}),
        };

        const mergedChannels = {
            ...current.channels,
            ...(updates.channels || {}),
        };

        const updatedDoc = await SuperAdminNotificationPreference.findOneAndUpdate(
            { userId: new Types.ObjectId(superAdminId) },
            {
                $set: {
                    categories: mergedCategories,
                    minPriority: updates.minPriority || current.minPriority,
                    channels: mergedChannels,
                    allowDisableCriticalSecurity:
                        updates.allowDisableCriticalSecurity ?? current.allowDisableCriticalSecurity,
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        return {
            userId: superAdminId,
            categories: mergedCategories,
            minPriority: updatedDoc.minPriority || 'LOW',
            channels: mergedChannels,
            allowDisableCriticalSecurity: Boolean(updatedDoc.allowDisableCriticalSecurity),
        };
    }
}
