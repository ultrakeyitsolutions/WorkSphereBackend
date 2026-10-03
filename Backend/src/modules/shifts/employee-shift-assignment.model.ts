import { Schema, model } from 'mongoose';
import { IEmployeeShiftAssignmentDocument } from './shift.types';

const employeeShiftAssignmentSchema = new Schema<IEmployeeShiftAssignmentDocument>(
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
        shiftId: {
            type: Schema.Types.ObjectId,
            ref: 'Shift',
            required: true,
            index: true,
        },
        effectiveFrom: {
            type: Date,
            required: true,
            index: true,
        },
        effectiveTo: {
            type: Date,
            default: null,
            index: true,
        },
        assignedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        reason: {
            type: String,
            trim: true,
            maxlength: 500,
            default: null,
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'SCHEDULED', 'EXPIRED', 'CANCELLED'],
            default: 'ACTIVE',
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Compound indexes for high-speed resolution, overlap prevention, and history lookups
employeeShiftAssignmentSchema.index({ companyId: 1, employeeId: 1, effectiveFrom: 1, effectiveTo: 1 });
employeeShiftAssignmentSchema.index({ companyId: 1, employeeId: 1, status: 1 });
employeeShiftAssignmentSchema.index({ companyId: 1, shiftId: 1, status: 1 });
employeeShiftAssignmentSchema.index({ companyId: 1, createdAt: -1 });

export const EmployeeShiftAssignment = model<IEmployeeShiftAssignmentDocument>(
    'EmployeeShiftAssignment',
    employeeShiftAssignmentSchema
);
export default EmployeeShiftAssignment;
