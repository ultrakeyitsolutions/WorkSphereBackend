import { Schema, model } from 'mongoose';
import {
    ILeaveRequestDocument,
    LeaveType,
    LeaveDurationType,
    HalfDayPeriod,
    LeaveStatus,
} from './attendance.types';

const leaveRequestSchema = new Schema<ILeaveRequestDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        employeeId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        leaveType: {
            type: String,
            enum: Object.values(LeaveType),
            required: true,
            default: LeaveType.CASUAL,
        },
        durationType: {
            type: String,
            enum: Object.values(LeaveDurationType),
            required: true,
            default: LeaveDurationType.FULL_DAY,
        },
        halfDayPeriod: {
            type: String,
            enum: Object.values(HalfDayPeriod),
            default: null,
        },
        startDate: {
            type: String,
            required: true,
            trim: true,
            match: /^\d{4}-\d{2}-\d{2}$/, // "YYYY-MM-DD"
            index: true,
        },
        endDate: {
            type: String,
            required: true,
            trim: true,
            match: /^\d{4}-\d{2}-\d{2}$/, // "YYYY-MM-DD"
            index: true,
        },
        totalDays: {
            type: Number,
            required: true,
            min: 0.5,
            default: 1,
        },
        reason: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000,
        },
        status: {
            type: String,
            enum: Object.values(LeaveStatus),
            default: LeaveStatus.PENDING,
            index: true,
        },
        appliedAt: {
            type: Date,
            default: Date.now,
        },
        approvedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        approvedAt: {
            type: Date,
            default: null,
        },
        rejectionReason: {
            type: String,
            trim: true,
            maxlength: 500,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Optimize compound queries for employee leave history & company approvals
leaveRequestSchema.index({ companyId: 1, employeeId: 1, status: 1 });
leaveRequestSchema.index({ companyId: 1, startDate: 1, endDate: 1, status: 1 });
leaveRequestSchema.index({ employeeId: 1, startDate: 1, endDate: 1 });
leaveRequestSchema.index({ companyId: 1, createdAt: -1 });

export const LeaveRequest = model<ILeaveRequestDocument>('LeaveRequest', leaveRequestSchema);
export default LeaveRequest;
