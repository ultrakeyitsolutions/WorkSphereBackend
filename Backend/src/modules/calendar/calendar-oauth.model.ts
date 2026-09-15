import { Schema, model } from 'mongoose';
import { ICalendarOAuthDocument } from './calendar.types';

const calendarOAuthSchema = new Schema<ICalendarOAuthDocument>(
    {
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
        provider: {
            type: String,
            enum: ['google', 'microsoft'],
            required: true,
        },
        accessTokenEncrypted: {
            type: String,
            required: true,
        },
        refreshTokenEncrypted: {
            type: String,
            required: true,
        },
        tokenExpiry: {
            type: Date,
            default: null,
        },
        accountEmail: {
            type: String,
            trim: true,
            lowercase: true,
            default: null,
        },
        scopes: {
            type: [String],
            default: [],
        },
        isConnected: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
        collection: 'calendar_oauth_tokens',
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: any) => {
                ret.id = ret._id ? ret._id.toString() : ret.id;
                delete ret.accessTokenEncrypted;
                delete ret.refreshTokenEncrypted;
                delete ret.__v;
                return ret;
            },
        },
    }
);

// Compound unique index ensuring one provider token per user per company
calendarOAuthSchema.index({ companyId: 1, userId: 1, provider: 1 }, { unique: true });

export const CalendarOAuth = model<ICalendarOAuthDocument>('CalendarOAuth', calendarOAuthSchema);
export default CalendarOAuth;
