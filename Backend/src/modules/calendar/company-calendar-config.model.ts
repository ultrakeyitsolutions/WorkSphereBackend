import { Schema, model } from 'mongoose';
import { ICompanyCalendarConfigDocument } from './calendar.types';

const companyCalendarConfigSchema = new Schema<ICompanyCalendarConfigDocument>(
    {
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
        clientId: {
            type: String,
            required: true,
            trim: true,
        },
        clientSecretEncrypted: {
            type: String,
            required: true,
        },
        redirectUri: {
            type: String,
            trim: true,
            default: '',
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'company_calendar_configs',
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: any) => {
                ret.id = ret._id ? ret._id.toString() : ret.id;
                delete ret.clientSecretEncrypted;
                delete ret.__v;
                return ret;
            },
        },
    }
);

// Compound unique index ensuring one provider configuration per company
companyCalendarConfigSchema.index({ companyId: 1, provider: 1 }, { unique: true });

export const CompanyCalendarConfig = model<ICompanyCalendarConfigDocument>(
    'CompanyCalendarConfig',
    companyCalendarConfigSchema
);
export default CompanyCalendarConfig;
