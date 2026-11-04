import { Schema, model, Document, Types } from 'mongoose';
import { ManagerAuditAction } from '../constants/manager.constants';

export interface IAffectedResources {
    teamIds?: string[];
    employeeIds?: string[];
    projectIds?: string[];
    permissionNames?: string[];
}

export interface IManagerAssignmentAudit {
    companyId: Types.ObjectId;
    managerId: Types.ObjectId;
    assignmentId?: Types.ObjectId | null;
    action: ManagerAuditAction;
    previousState?: any;
    newState?: any;
    actorId: Types.ObjectId;
    reason?: string | null;
    affectedResources?: IAffectedResources;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IManagerAssignmentAuditDocument extends IManagerAssignmentAudit, Document {}

const managerAssignmentAuditSchema = new Schema<IManagerAssignmentAuditDocument>(
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
        assignmentId: {
            type: Schema.Types.ObjectId,
            ref: 'ManagerAssignment',
            default: null,
            index: true,
        },
        action: {
            type: String,
            enum: Object.values(ManagerAuditAction),
            required: true,
            index: true,
        },
        previousState: {
            type: Schema.Types.Mixed,
            default: null,
        },
        newState: {
            type: Schema.Types.Mixed,
            default: null,
        },
        actorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        reason: {
            type: String,
            default: null,
        },
        affectedResources: {
            teamIds: { type: [String], default: [] },
            employeeIds: { type: [String], default: [] },
            projectIds: { type: [String], default: [] },
            permissionNames: { type: [String], default: [] },
        },
    },
    {
        timestamps: true,
    }
);

managerAssignmentAuditSchema.index({ companyId: 1, managerId: 1, createdAt: -1 });
managerAssignmentAuditSchema.index({ companyId: 1, action: 1, createdAt: -1 });

export const ManagerAssignmentAudit = model<IManagerAssignmentAuditDocument>(
    'ManagerAssignmentAudit',
    managerAssignmentAuditSchema
);
export default ManagerAssignmentAudit;
