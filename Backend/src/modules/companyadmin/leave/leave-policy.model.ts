import { Schema, model } from 'mongoose';
import {
    ICompanyLeavePolicyDocument,
    IEmployeeLeavePolicyOverride,
} from './leave-policy.types';
import { LeaveType } from '../../attendance/attendance.types';

const employeeLeavePolicyOverrideSchema = new Schema<IEmployeeLeavePolicyOverride>(
    {
        employeeId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        monthlyLimit: {
            type: Number,
            required: true,
            min: 0,
        },
        effectiveFrom: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}-\d{2}$/,
        },
        effectiveTo: {
            type: String,
            default: null,
            match: /^\d{4}-\d{2}-\d{2}$/,
        },
        reason: {
            type: String,
            trim: true,
            default: '',
        },
    },
    { _id: false }
);

const companyLeavePolicySchema = new Schema<ICompanyLeavePolicyDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        leaveType: {
            type: String,
            enum: Object.values(LeaveType),
            required: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
            default: '',
        },
        monthlyLimit: {
            type: Number,
            required: true,
            min: 0,
            default: 1.5,
        },
        unusedLeavePolicy: {
            type: String,
            enum: ['EXPIRES', 'CARRIES_FORWARD'],
            default: 'EXPIRES',
        },
        maxCarryForwardDays: {
            type: Number,
            min: 0,
            default: 0,
        },
        excessLeaveRule: {
            type: String,
            enum: ['REQUIRE_REVIEW', 'CONVERT_TO_LOP', 'CONVERT_TO_UNPAID'],
            default: 'REQUIRE_REVIEW',
        },
        countWeekends: {
            type: Boolean,
            default: false,
        },
        countHolidays: {
            type: Boolean,
            default: false,
        },
        allowHalfDay: {
            type: Boolean,
            default: true,
        },
        effectiveFrom: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}-\d{2}$/,
            default: '2026-01-01',
        },
        effectiveTo: {
            type: String,
            default: null,
            match: /^\d{4}-\d{2}-\d{2}$/,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        employeeOverrides: {
            type: [employeeLeavePolicyOverrideSchema],
            default: [],
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

// Compound index for active policy per leave type per company
companyLeavePolicySchema.index({ companyId: 1, leaveType: 1, isActive: 1 });
companyLeavePolicySchema.index({ companyId: 1, effectiveFrom: 1, effectiveTo: 1 });

export const CompanyLeavePolicy = model<ICompanyLeavePolicyDocument>(
    'CompanyLeavePolicy',
    companyLeavePolicySchema
);
export default CompanyLeavePolicy;
