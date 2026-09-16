import { Schema, model, Document, Types } from 'mongoose';

export enum TrackingState {
    NOT_STARTED = 'NOT_STARTED',
    TRACKING = 'TRACKING',
    PAUSED = 'PAUSED',
    ON_HOLD = 'ON_HOLD',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED'
}

export enum IntervalType {
    WORK = 'WORK',
    BREAK = 'BREAK',
    HOLD = 'HOLD'
}

export interface ITrackingInterval {
    type: IntervalType;
    startedAt: Date;
    endedAt?: Date;
    reason?: string;
}

export interface ITimeTracking extends Document {
    companyId: Types.ObjectId;
    userId: Types.ObjectId;
    projectId: Types.ObjectId;
    taskId: Types.ObjectId;
    state: TrackingState;
    startedAt: Date;
    endedAt?: Date;
    workedSeconds: number;
    intervals: ITrackingInterval[];
    createdAt: Date;
    updatedAt: Date;
}

const trackingIntervalSchema = new Schema<ITrackingInterval>({
    type: { type: String, enum: Object.values(IntervalType), required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
    reason: { type: String }
}, { _id: false });

const timeTrackingSchema = new Schema<ITimeTracking>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
        taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
        state: { type: String, enum: Object.values(TrackingState), default: TrackingState.NOT_STARTED, required: true },
        startedAt: { type: Date, required: true },
        endedAt: { type: Date },
        workedSeconds: { type: Number, default: 0 },
        intervals: [trackingIntervalSchema]
    },
    { timestamps: true }
);

// Crucial: Prevent duplicate active tracking sessions for the same user.
// Using partial filter expression to only apply unique index on ACTIVE states.
timeTrackingSchema.index(
    { userId: 1 }, 
    { 
        unique: true, 
        partialFilterExpression: { 
            state: { $in: [TrackingState.TRACKING, TrackingState.PAUSED, TrackingState.ON_HOLD] } 
        } 
    }
);

// Also index for finding tracking logs by task & performance analytics
timeTrackingSchema.index({ taskId: 1, userId: 1 });
timeTrackingSchema.index({ companyId: 1, userId: 1, startedAt: 1 });

export const TimeTracking = model<ITimeTracking>('TimeTracking', timeTrackingSchema);
export default TimeTracking;
