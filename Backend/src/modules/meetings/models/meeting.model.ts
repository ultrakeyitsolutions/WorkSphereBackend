import { Schema, model } from 'mongoose';
import { IMeetingDocument, MeetingStatus, MeetingType } from '../meeting.types';

const meetingSchema = new Schema<IMeetingDocument>(
    {
        meetingId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        organizerId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },
        agenda: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 4000,
            default: null,
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            default: null,
            index: true,
        },
        taskId: {
            type: Schema.Types.ObjectId,
            ref: 'Task',
            default: null,
            index: true,
        },
        meetingType: {
            type: String,
            enum: Object.values(MeetingType),
            default: MeetingType.QUICK,
            required: true,
        },
        meetingLink: {
            type: String,
            default: null,
            trim: true,
        },
        meetingProvider: {
            type: String,
            default: null,
            trim: true,
        },
        externalMeetingId: {
            type: String,
            default: null,
            trim: true,
        },
        calendarEventId: {
            type: Schema.Types.ObjectId,
            ref: 'CalendarEvent',
            default: null,
        },
        scheduledStartAt: {
            type: Date,
            required: true,
            index: true,
        },
        scheduledEndAt: {
            type: Date,
            required: true,
            index: true,
        },
        durationMinutes: {
            type: Number,
            required: true,
            min: 5,
            max: 480,
            default: 30,
        },
        timezone: {
            type: String,
            default: 'UTC',
        },
        status: {
            type: String,
            enum: Object.values(MeetingStatus),
            default: MeetingStatus.PENDING,
            required: true,
            index: true,
        },
        currentVersion: {
            type: Number,
            default: 1,
        },
        reminded15Min: {
            type: Boolean,
            default: false,
            index: true,
        },
        reminded5Min: {
            type: Boolean,
            default: false,
            index: true,
        },
        acceptedAt: {
            type: Date,
            default: null,
        },
        rejectedAt: {
            type: Date,
            default: null,
        },
        cancelledAt: {
            type: Date,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
        cancellationReason: {
            type: String,
            default: null,
        },
        rejectionReason: {
            type: String,
            default: null,
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

// Compound indexes for optimal multi-tenant and scheduler querying
meetingSchema.index({ companyId: 1, scheduledStartAt: 1 });
meetingSchema.index({ companyId: 1, status: 1 });
meetingSchema.index({ organizerId: 1, scheduledStartAt: 1 });
meetingSchema.index({ status: 1, scheduledStartAt: 1 });

export const Meeting = model<IMeetingDocument>('Meeting', meetingSchema);
export default Meeting;
