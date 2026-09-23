import { Schema, model } from 'mongoose';
import { IMeetingParticipantDocument, ParticipantRole, ParticipantResponseStatus } from '../meeting.types';

const meetingParticipantSchema = new Schema<IMeetingParticipantDocument>(
    {
        meetingId: {
            type: Schema.Types.ObjectId,
            ref: 'Meeting',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        role: {
            type: String,
            enum: Object.values(ParticipantRole),
            default: ParticipantRole.REQUIRED,
            required: true,
        },
        responseStatus: {
            type: String,
            enum: Object.values(ParticipantResponseStatus),
            default: ParticipantResponseStatus.PENDING,
            required: true,
            index: true,
        },
        responseAt: {
            type: Date,
            default: null,
        },
        joinedAt: {
            type: Date,
            default: null,
        },
        leftAt: {
            type: Date,
            default: null,
        },
        rescheduleRequested: {
            type: Boolean,
            default: false,
        },
        rescheduleReason: {
            type: String,
            default: null,
        },
        declineReason: {
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

// Prevent duplicate participant records in the same meeting
meetingParticipantSchema.index({ meetingId: 1, userId: 1 }, { unique: true });
meetingParticipantSchema.index({ userId: 1, responseStatus: 1 });
meetingParticipantSchema.index({ companyId: 1, userId: 1 });

export const MeetingParticipant = model<IMeetingParticipantDocument>(
    'MeetingParticipant',
    meetingParticipantSchema
);
export default MeetingParticipant;
