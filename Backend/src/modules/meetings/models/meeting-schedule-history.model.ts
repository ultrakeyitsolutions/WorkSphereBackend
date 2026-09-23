import { Schema, model } from 'mongoose';
import { IMeetingScheduleHistoryDocument, RescheduleStatus } from '../meeting.types';

const meetingScheduleHistorySchema = new Schema<IMeetingScheduleHistoryDocument>(
    {
        meetingId: {
            type: Schema.Types.ObjectId,
            ref: 'Meeting',
            required: true,
            index: true,
        },
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        previousStartAt: {
            type: Date,
            required: true,
        },
        previousEndAt: {
            type: Date,
            required: true,
        },
        proposedStartAt: {
            type: Date,
            required: true,
        },
        proposedEndAt: {
            type: Date,
            required: true,
        },
        durationMinutes: {
            type: Number,
            required: true,
        },
        requestedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        approvedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        reason: {
            type: String,
            default: null,
            trim: true,
        },
        status: {
            type: String,
            enum: Object.values(RescheduleStatus),
            default: RescheduleStatus.PENDING,
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: any) => {
                delete ret.__v;
                return ret;
            },
        },
    }
);

meetingScheduleHistorySchema.index({ meetingId: 1, createdAt: -1 });

export const MeetingScheduleHistory = model<IMeetingScheduleHistoryDocument>(
    'MeetingScheduleHistory',
    meetingScheduleHistorySchema
);
export default MeetingScheduleHistory;
