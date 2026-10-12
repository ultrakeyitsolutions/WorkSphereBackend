import { Schema, model } from 'mongoose';
import { IEmployeeMonthlyLeaveBalanceDocument } from './leave-policy.types';
import { LeaveType } from '../../attendance/attendance.types';

const employeeMonthlyLeaveBalanceSchema = new Schema<IEmployeeMonthlyLeaveBalanceDocument>(
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
        month: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}$/, // "YYYY-MM"
            index: true,
        },
        leaveType: {
            type: String,
            enum: Object.values(LeaveType),
            required: true,
            index: true,
        },
        allocatedPaidDays: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
        },
        carriedForwardPaidDays: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
        },
        totalEligiblePaidDays: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
        },
        requestedDays: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
        },
        approvedPaidDays: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
        },
        pendingPaidDays: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
        },
        unpaidLeaveDays: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
        },
        lopDays: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
        },
        rejectedCancelledDays: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
        },
        remainingPaidBalance: {
            type: Number,
            required: true,
            default: 0,
        },
        availablePaidBalance: {
            type: Number,
            required: true,
            default: 0,
        },
        lastRecalculatedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

// Unique compound index: One record per company, employee, month, and leave type
employeeMonthlyLeaveBalanceSchema.index(
    { companyId: 1, employeeId: 1, month: 1, leaveType: 1 },
    { unique: true }
);

export const EmployeeMonthlyLeaveBalance = model<IEmployeeMonthlyLeaveBalanceDocument>(
    'EmployeeMonthlyLeaveBalance',
    employeeMonthlyLeaveBalanceSchema
);
export default EmployeeMonthlyLeaveBalance;
