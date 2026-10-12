import { Schema, model, Document, Types } from 'mongoose';
import { AlertType, AlertSeverity, AlertStatus } from '../live-monitoring.types';

export interface IMonitoringAlertDocument extends Document {
    companyId: Types.ObjectId;
    alertType: AlertType;
    severity: AlertSeverity;
    title: string;
    summary: string;
    dedupKey: string; // Used to prevent spamming duplicate unresolved alerts
    resourceType?: 'TASK' | 'PROJECT' | 'EMPLOYEE' | 'ATTENDANCE';
    resourceId?: Types.ObjectId | null;
    status: AlertStatus;
    acknowledgedById?: Types.ObjectId | null;
    acknowledgedAt?: Date | null;
    resolvedById?: Types.ObjectId | null;
    resolvedAt?: Date | null;
    metadata: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

const monitoringAlertSchema = new Schema<IMonitoringAlertDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        alertType: {
            type: String,
            enum: Object.values(AlertType),
            required: true,
            index: true,
        },
        severity: {
            type: String,
            enum: Object.values(AlertSeverity),
            required: true,
            default: AlertSeverity.WARNING,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        summary: {
            type: String,
            required: true,
            trim: true,
        },
        dedupKey: {
            type: String,
            required: true,
            index: true,
        },
        resourceType: {
            type: String,
            enum: ['TASK', 'PROJECT', 'EMPLOYEE', 'ATTENDANCE'],
            default: null,
        },
        resourceId: {
            type: Schema.Types.ObjectId,
            default: null,
            index: true,
        },
        status: {
            type: String,
            enum: Object.values(AlertStatus),
            default: AlertStatus.ACTIVE,
            required: true,
            index: true,
        },
        acknowledgedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        acknowledgedAt: {
            type: Date,
            default: null,
        },
        resolvedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        resolvedAt: {
            type: Date,
            default: null,
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
monitoringAlertSchema.index({ companyId: 1, status: 1, severity: 1, createdAt: -1 });
monitoringAlertSchema.index({ companyId: 1, dedupKey: 1, status: 1 });

export const MonitoringAlert = model<IMonitoringAlertDocument>(
    'MonitoringAlert',
    monitoringAlertSchema
);
export const MonitoringAlertModel = MonitoringAlert;
export default MonitoringAlert;

