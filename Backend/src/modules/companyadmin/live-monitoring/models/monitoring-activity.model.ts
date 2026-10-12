import { Schema, model, Document, Types } from 'mongoose';
import { MonitoringEventType } from '../live-monitoring.types';

export interface IMonitoringActivityDocument extends Document {
    companyId: Types.ObjectId;
    eventId: string;
    sequence: number;
    eventType: MonitoringEventType;
    actorId?: Types.ObjectId | null;
    actorName?: string | null;
    actorAvatar?: string | null;
    employeeId?: Types.ObjectId | null;
    employeeName?: string | null;
    projectId?: Types.ObjectId | null;
    projectName?: string | null;
    taskId?: Types.ObjectId | null;
    taskTitle?: string | null;
    meetingId?: Types.ObjectId | null;
    summary: string;
    metadata: Record<string, any>;
    occurredAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const monitoringActivitySchema = new Schema<IMonitoringActivityDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        eventId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        sequence: {
            type: Number,
            required: true,
            index: true,
        },
        eventType: {
            type: String,
            required: true,
            index: true,
        },
        actorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        actorName: {
            type: String,
            default: null,
            trim: true,
        },
        actorAvatar: {
            type: String,
            default: null,
        },
        employeeId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        employeeName: {
            type: String,
            default: null,
            trim: true,
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            default: null,
            index: true,
        },
        projectName: {
            type: String,
            default: null,
            trim: true,
        },
        taskId: {
            type: Schema.Types.ObjectId,
            ref: 'Task',
            default: null,
            index: true,
        },
        taskTitle: {
            type: String,
            default: null,
            trim: true,
        },
        meetingId: {
            type: Schema.Types.ObjectId,
            ref: 'Meeting',
            default: null,
            index: true,
        },
        summary: {
            type: String,
            required: true,
            trim: true,
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
        occurredAt: {
            type: Date,
            required: true,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Compound indexes for fast cursor-based pagination and tenant scoping
monitoringActivitySchema.index({ companyId: 1, sequence: -1 });
monitoringActivitySchema.index({ companyId: 1, occurredAt: -1 });
monitoringActivitySchema.index({ companyId: 1, eventType: 1, occurredAt: -1 });
monitoringActivitySchema.index({ companyId: 1, projectId: 1, occurredAt: -1 });
monitoringActivitySchema.index({ companyId: 1, employeeId: 1, occurredAt: -1 });

// TTL retention index: 90 days
monitoringActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const MonitoringActivity = model<IMonitoringActivityDocument>(
    'MonitoringActivity',
    monitoringActivitySchema
);
export const MonitoringActivityModel = MonitoringActivity;
export default MonitoringActivity;

