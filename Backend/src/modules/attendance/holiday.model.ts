import { Schema, model } from 'mongoose';
import { IHolidayDocument } from './attendance.types';

const holidaySchema = new Schema<IHolidayDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 150,
        },
        date: {
            type: String,
            required: true,
            trim: true,
            match: /^\d{4}-\d{2}-\d{2}$/, // "YYYY-MM-DD"
            index: true,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 500,
            default: '',
        },
        isRecurring: {
            type: Boolean,
            default: false,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Unique holiday per date within a company
holidaySchema.index({ companyId: 1, date: 1 }, { unique: true });
holidaySchema.index({ companyId: 1, isRecurring: 1 });

export const Holiday = model<IHolidayDocument>('Holiday', holidaySchema);
export default Holiday;
