import { Schema, model, Document, Types } from 'mongoose';
import { TimesheetApprovalStatus } from './timesheet.types';

export interface ITimesheetApproval extends Document {
    companyId: Types.ObjectId;
    userId: Types.ObjectId;
    periodStart: Date;
    periodEnd: Date;
    status: TimesheetApprovalStatus;
    submittedAt?: Date;
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    rejectionReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const timesheetApprovalSchema = new Schema<ITimesheetApproval>(
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
        periodStart: {
            type: Date,
            required: true
        },
        periodEnd: {
            type: Date,
            required: true
        },
        status: {
            type: String,
            enum: Object.values(TimesheetApprovalStatus),
            default: TimesheetApprovalStatus.DRAFT,
            required: true
        },
        submittedAt: {
            type: Date
        },
        reviewedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        reviewedAt: {
            type: Date
        },
        rejectionReason: {
            type: String,
            trim: true
        }
    },
    { timestamps: true }
);

// One approval record per employee per period — enforce uniqueness
timesheetApprovalSchema.index(
    { companyId: 1, userId: 1, periodStart: 1, periodEnd: 1 },
    { unique: true }
);

// Fast lookup by status for admin review queues
timesheetApprovalSchema.index({ companyId: 1, status: 1 });

export const TimesheetApproval = model<ITimesheetApproval>('TimesheetApproval', timesheetApprovalSchema);
export default TimesheetApproval;
