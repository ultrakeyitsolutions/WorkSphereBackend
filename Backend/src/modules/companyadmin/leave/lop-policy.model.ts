import { Schema, model } from 'mongoose';
import {
    ICompanyLopPolicyDocument,
    IEmployeeLopOverride,
} from './leave-policy.types';

const employeeLopOverrideSchema = new Schema<IEmployeeLopOverride>(
    {
        employeeId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        calculationMethod: {
            type: String,
            enum: ['FIXED_AMOUNT', 'SALARY_DIVISOR'],
            default: 'SALARY_DIVISOR',
        },
        fixedDailyAmount: {
            type: Number,
            min: 0,
            default: null,
        },
        customSalary: {
            type: Number,
            min: 0,
            default: null,
        },
        fixedDivisor: {
            type: Number,
            min: 1,
            max: 365,
            default: null,
        },
        reason: {
            type: String,
            trim: true,
            default: '',
        },
    },
    { _id: false }
);

const companyLopPolicySchema = new Schema<ICompanyLopPolicyDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            unique: true,
            index: true,
        },
        isAutoCalculationEnabled: {
            type: Boolean,
            default: true,
        },
        calculationMethod: {
            type: String,
            enum: ['FIXED_AMOUNT', 'SALARY_DIVISOR'],
            default: 'SALARY_DIVISOR',
        },
        fixedDailyAmount: {
            type: Number,
            min: 0,
            default: 1000,
        },
        salaryBasis: {
            type: String,
            enum: ['MONTHLY_BASE_SALARY', 'MONTHLY_GROSS_SALARY'],
            default: 'MONTHLY_BASE_SALARY',
        },
        divisorType: {
            type: String,
            enum: ['FIXED_DIVISOR', 'CALENDAR_DAYS_IN_MONTH', 'WORKING_DAYS_IN_MONTH'],
            default: 'FIXED_DIVISOR',
        },
        fixedDivisor: {
            type: Number,
            min: 1,
            max: 365,
            default: 30,
        },
        currency: {
            type: String,
            default: 'INR',
            uppercase: true,
            trim: true,
        },
        roundingRule: {
            type: String,
            enum: ['NONE', 'ROUND_UP', 'ROUND_DOWN', 'ROUND_HALF_UP'],
            default: 'ROUND_HALF_UP',
        },
        requiresAdminApproval: {
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
        employeeOverrides: {
            type: [employeeLopOverrideSchema],
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

export const CompanyLopPolicy = model<ICompanyLopPolicyDocument>(
    'CompanyLopPolicy',
    companyLopPolicySchema
);
export default CompanyLopPolicy;
