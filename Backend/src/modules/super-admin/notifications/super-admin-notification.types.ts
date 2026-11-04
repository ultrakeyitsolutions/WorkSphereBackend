import { Types } from 'mongoose';
import {
    NotificationCategory,
    NotificationPriority,
    NotificationType,
} from '../../notifications/notification.types';

export const SUPERADMIN_CATEGORIES: NotificationCategory[] = [
    'COMPANY_MANAGEMENT',
    'SUBSCRIPTION_PAYMENTS',
    'SECURITY_ACCESS',
    'SYSTEM_HEALTH',
    'EMPLOYEE_WORKFORCE',
    'SUPPORT_COMPLAINTS',
];

export const SUPERADMIN_PRIORITIES: NotificationPriority[] = [
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW',
];

export interface SuperAdminNotificationChannels {
    inApp: boolean;
    email: boolean;
    push: boolean;
}

export interface ISuperAdminPreference {
    userId: Types.ObjectId | string;
    categories: Record<string, boolean>;
    minPriority: NotificationPriority;
    channels: SuperAdminNotificationChannels;
    allowDisableCriticalSecurity?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface SuperAdminNotificationFilter {
    category?: string | string[];
    priority?: NotificationPriority | NotificationPriority[] | 'ALL';
    isRead?: boolean;
    startDate?: string | Date;
    endDate?: string | Date;
    companyId?: string;
    search?: string;
    page?: number;
    limit?: number;
}

export interface SuperAdminDispatchPayload {
    type: NotificationType;
    category?: NotificationCategory | string;
    title?: string;
    message?: string;
    priority?: NotificationPriority;
    companyId?: string | Types.ObjectId | null;
    actorId?: string | Types.ObjectId | null;
    entityId?: string | Types.ObjectId | null;
    entityType?: string;
    actionUrl?: string;
    metadata?: Record<string, any>;
    eventId?: string; // Idempotency key
    targetSuperAdminIds?: Array<string | Types.ObjectId>; // Optional: if targeting specific SuperAdmin(s)
}
