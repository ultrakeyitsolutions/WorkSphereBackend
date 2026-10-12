import { Schema, model } from 'mongoose';
import {
    ILeaveRequestDocument,
    LeaveType,
    LeaveDurationType,
    HalfDayPeriod,
    LeaveStatus,
} from './attendance.types';

const leaveMonthAllocationSchema = new Schema(
    {
        month: { type: String, required: true }, // "YYYY-MM"
        totalDays: { type: Number, required: true },
        eligiblePaidDays: { type: Number, required: true },
        excessDays: { type: Number, required: true },
        proposedLopDays: { type: Number, required: true },
        unpaidDays: { type: Number, required: true },
        calendarDays: [{ type: String }],
    },
    { _id: false }
);

const leaveRevisionRequestSchema = new Schema(
    {
        requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        notes: { type: String, required: true, trim: true },
        requestedAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['PENDING', 'RESOLVED'], default: 'PENDING' },
    },
    { _id: false }
);

const leaveDecisionHistorySchema = new Schema(
    {
        action: { type: String, required: true },
        actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        timestamp: { type: Date, default: Date.now },
        details: { type: String, trim: true },
        snapshot: { type: Schema.Types.Mixed },
    },
    { _id: false }
);

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
        paidDays: {
            type: Number,
            default: 0,
        },
        unpaidDays: {
            type: Number,
            default: 0,
        },
        lopDays: {
            type: Number,
            default: 0,
        },
        excessDays: {
            type: Number,
            default: 0,
        },
        isLopProposed: {
            type: Boolean,
            default: false,
        },
        lopDecisionId: {
            type: Schema.Types.ObjectId,
            ref: 'LopDecision',
            default: null,
        },
        monthBreakdown: {
            type: [leaveMonthAllocationSchema],
            default: [],
        },
        revisionRequests: {
            type: [leaveRevisionRequestSchema],
            default: [],
        },
        decisionHistory: {
            type: [leaveDecisionHistorySchema],
            default: [],
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
        emailDeliveryStatus: {
            type: String,
            enum: ['PENDING', 'SENT', 'FAILED', 'SKIPPED'],
            default: 'PENDING',
        },
        emailDeliveryError: {
            type: String,
            default: null,
        },
        emailSentAt: {
            type: Date,
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
