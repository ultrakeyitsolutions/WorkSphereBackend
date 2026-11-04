import { Schema, model, Document, Types } from 'mongoose';
import { ManagerAssignmentType, ManagerAccessLevel } from '../constants/manager.constants';

export interface IManagerAssignment {
    companyId: Types.ObjectId;
    managerId: Types.ObjectId;
    assignmentType: ManagerAssignmentType;
    teamId?: Types.ObjectId | null;
    employeeId?: Types.ObjectId | null;
    projectId?: Types.ObjectId | null;
    departmentId?: Types.ObjectId | null;
    permissions: string[];
    accessLevel: ManagerAccessLevel;
    isActive: boolean;
    startDate: Date;
    endDate?: Date | null;
    assignedBy: Types.ObjectId;
    revokedBy?: Types.ObjectId | null;
    revokedAt?: Date | null;
    revocationReason?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IManagerAssignmentDocument extends IManagerAssignment, Document {}

const managerAssignmentSchema = new Schema<IManagerAssignmentDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        managerId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        assignmentType: {
            type: String,
            enum: Object.values(ManagerAssignmentType),
            required: true,
            index: true,
        },
        teamId: {
            type: Schema.Types.ObjectId,
            ref: 'Team',
            default: null,
            index: true,
        },
        employeeId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            default: null,
            index: true,
        },
        departmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Designation',
            default: null,
            index: true,
        },
        permissions: {
            type: [String],
            default: [],
        },
        accessLevel: {
            type: String,
            enum: Object.values(ManagerAccessLevel),
            default: ManagerAccessLevel.FULL,
            required: true,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        startDate: {
            type: Date,
            default: Date.now,
            required: true,
        },
        endDate: {
            type: Date,
            default: null,
        },
        assignedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        revokedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        revokedAt: {
            type: Date,
            default: null,
        },
        revocationReason: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Compound indexes
managerAssignmentSchema.index({ companyId: 1, managerId: 1, isActive: 1 });
managerAssignmentSchema.index({ companyId: 1, teamId: 1, isActive: 1 });
managerAssignmentSchema.index({ companyId: 1, employeeId: 1, isActive: 1 });
managerAssignmentSchema.index({ companyId: 1, projectId: 1, isActive: 1 });
managerAssignmentSchema.index({ companyId: 1, managerId: 1, assignmentType: 1, isActive: 1 });

// Prevent duplicate active assignment for identical resource targets
managerAssignmentSchema.index(
    { companyId: 1, managerId: 1, assignmentType: 1, teamId: 1, employeeId: 1, projectId: 1, isActive: 1 },
    {
        unique: true,
        partialFilterExpression: { isActive: true },
    }
);

export const ManagerAssignment = model<IManagerAssignmentDocument>('ManagerAssignment', managerAssignmentSchema);
export default ManagerAssignment;
