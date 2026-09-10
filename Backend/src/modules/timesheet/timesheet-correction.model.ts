import { Schema, model, Document, Types } from 'mongoose';

export interface ITimesheetCorrection extends Document {
    companyId: Types.ObjectId;
    /** The employee whose record is being corrected */
    userId: Types.ObjectId;
    /** One of the three optional refs must be present */
    attendanceId?: Types.ObjectId;
    trackingId?: Types.ObjectId;
    activityId?: Types.ObjectId;
    /** Name of the field that was changed, e.g. "checkOutTime" or "workedSeconds" */
    fieldChanged: string;
    /** Original value before correction (stored as Mixed for flexibility) */
    originalValue: any;
    /** New value after correction */
    newValue: any;
    /** The admin user who made the correction */
    changedBy: Types.ObjectId;
    /** Human-readable justification — required */
    reason: string;
    createdAt: Date;
    updatedAt: Date;
}

const timesheetCorrectionSchema = new Schema<ITimesheetCorrection>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        attendanceId: {
            type: Schema.Types.ObjectId,
            ref: 'Attendance'
        },
        trackingId: {
            type: Schema.Types.ObjectId,
            ref: 'TimeTracking'
        },
        activityId: {
            type: Schema.Types.ObjectId,
            ref: 'TaskActivity'
        },
        fieldChanged: {
            type: String,
            required: true,
            trim: true
        },
        originalValue: {
            type: Schema.Types.Mixed,
            required: true
        },
        newValue: {
            type: Schema.Types.Mixed,
            required: true
        },
        changedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        reason: {
            type: String,
            required: true,
            trim: true
        }
    },
    { timestamps: true }
);

// Enable fast lookup of corrections for a specific employee
timesheetCorrectionSchema.index({ companyId: 1, userId: 1, createdAt: -1 });

export const TimesheetCorrection = model<ITimesheetCorrection>('TimesheetCorrection', timesheetCorrectionSchema);
export default TimesheetCorrection;
