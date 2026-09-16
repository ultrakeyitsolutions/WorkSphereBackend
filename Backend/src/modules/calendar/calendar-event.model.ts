import { Schema, model } from 'mongoose';
import { ICalendarEventDocument } from './calendar.types';

const participantSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        avatar: {
            type: String,
            default: null,
        },
        role: {
            type: String,
            default: null,
        },
        designation: {
            type: String,
            default: null,
        },
        status: {
            type: String,
            enum: ['organizer', 'accepted', 'pending', 'declined', 'tentative'],
            default: 'pending',
            required: true,
        },
        isCoOrganizer: {
            type: Boolean,
            default: false,
        },
        respondedAt: {
            type: Date,
            default: null,
        },
    },
    {
        _id: false,
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: any) => {
                if (ret.userId) {
                    ret.id = ret.userId.toString();
                }
                return ret;
            },
        },
    }
);

const organizerSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        avatar: {
            type: String,
            default: null,
        },
    },
    {
        _id: false,
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: any) => {
                if (ret.userId) {
                    ret.id = ret.userId.toString();
                }
                return ret;
            },
        },
    }
);

const calendarEventSchema = new Schema<ICalendarEventDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: '',
            trim: true,
        },
        startTime: {
            type: Date,
            required: true,
            index: true,
        },
        endTime: {
            type: Date,
            required: true,
        },
        allDay: {
            type: Boolean,
            default: false,
        },
        timeZone: {
            type: String,
            default: 'Asia/Kolkata',
            trim: true,
        },
        organizer: {
            type: organizerSchema,
            required: true,
        },
        coOrganizers: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        participants: [participantSchema],
        meetingType: {
            type: String,
            enum: ['video', 'in_person', 'phone', 'sync'],
            default: 'video',
            required: true,
        },
        provider: {
            type: String,
            enum: ['none', 'google_meet', 'ms_teams'],
            default: 'none',
            required: true,
        },
        meetingUrl: {
            type: String,
            default: null,
        },
        externalEventId: {
            type: String,
            default: null,
        },
        externalProviderData: {
            conferenceId: { type: String, default: null },
            joinWebUrl: { type: String, default: null },
            dialIn: { type: String, default: null },
        },
        agenda: {
            type: [String],
            default: [],
        },
        reminderMinutes: {
            type: Number,
            enum: [0, 5, 10, 15, 30, 60],
            default: 15,
            required: true,
        },
        recurrence: {
            type: String,
            enum: ['none', 'daily', 'weekly', 'monthly'],
            default: 'none',
            required: true,
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
        },
        taskId: {
            type: Schema.Types.ObjectId,
            ref: 'Task',
            default: null,
        },
        taskName: {
            type: String,
            default: null,
        },
        color: {
            type: String,
            default: '#F97316',
        },
        isQuickMeeting: {
            type: Boolean,
            default: false,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: 'calendar_events',
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: any) => {
                ret.id = ret._id ? ret._id.toString() : ret.id;
                delete ret.__v;
                return ret;
            },
        },
        toObject: {
            virtuals: true,
            transform: (_doc, ret: any) => {
                ret.id = ret._id ? ret._id.toString() : ret.id;
                delete ret.__v;
                return ret;
            },
        },
    }
);

// Compound indexes for queries & multi-tenant isolation
calendarEventSchema.index({ companyId: 1, startTime: 1, endTime: 1 });
calendarEventSchema.index({ companyId: 1, 'participants.userId': 1 });
calendarEventSchema.index({ companyId: 1, 'organizer.userId': 1 });
calendarEventSchema.index({ companyId: 1, 'participants.userId': 1, startTime: 1 });
calendarEventSchema.index({ companyId: 1, 'organizer.userId': 1, startTime: 1 });
calendarEventSchema.index({ companyId: 1, isQuickMeeting: 1, createdAt: 1 });

export const CalendarEvent = model<ICalendarEventDocument>('CalendarEvent', calendarEventSchema);
export default CalendarEvent;
