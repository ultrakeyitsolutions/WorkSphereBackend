import { Schema, model } from 'mongoose';
import { IShiftDocument } from './shift.types';

const shiftSchema = new Schema<IShiftDocument>(
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
            maxlength: 100,
        },
        code: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            maxlength: 50,
        },
        startTime: {
            type: String,
            required: true,
            trim: true,
            match: /^([01]\d|2[0-3]):([0-5]\d)$/, // "HH:mm"
        },
        endTime: {
            type: String,
            required: true,
            trim: true,
            match: /^([01]\d|2[0-3]):([0-5]\d)$/, // "HH:mm"
        },
        crossesMidnight: {
            type: Boolean,
            default: false,
        },
        timezone: {
            type: String,
            default: 'Asia/Kolkata',
            trim: true,
        },
        gracePeriodMinutes: {
            type: Number,
            default: 10,
            min: 0,
            max: 240,
        },
        earlyCheckoutGracePeriodMinutes: {
            type: Number,
            default: 5,
            min: 0,
            max: 240,
        },
        workingDays: {
            type: [Number],
            default: [1, 2, 3, 4, 5], // Mon-Fri
            validate: {
                validator: (val: number[]) => val.every((d) => d >= 1 && d <= 7),
                message: 'Working days must be numbers between 1 (Monday) and 7 (Sunday)',
            },
        },
        halfDayThresholdMinutes: {
            type: Number,
            default: 240,
            min: 0,
        },
        fullDayThresholdMinutes: {
            type: Number,
            default: 480,
            min: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        isDefault: {
            type: Boolean,
            default: false,
            index: true,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 500,
            default: '',
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Pre-save hook to compute crossesMidnight
shiftSchema.pre('save', function () {
    if (this.isModified('startTime') || this.isModified('endTime')) {
        const [sH, sM] = this.startTime.split(':').map(Number);
        const [eH, eM] = this.endTime.split(':').map(Number);
        const startMinutes = sH * 60 + sM;
        const endMinutes = eH * 60 + eM;
        this.crossesMidnight = endMinutes <= startMinutes;
    }
});

// Indexes for optimal tenant isolation and lookups
shiftSchema.index({ companyId: 1, code: 1 }, { unique: true });
shiftSchema.index({ companyId: 1, isActive: 1, isDefault: 1 });
shiftSchema.index({ companyId: 1, createdAt: -1 });

export const Shift = model<IShiftDocument>('Shift', shiftSchema);
export default Shift;
