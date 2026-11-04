import { Schema, model, Document, Types } from 'mongoose';
import { DEFAULT_MANAGER_PERMISSIONS } from '../constants/manager.constants';

export interface IManagerPermission {
    companyId: Types.ObjectId;
    managerId: Types.ObjectId;
    permissions: string[];
    restrictions: string[];
    isSuspended: boolean;
    suspendedAt?: Date | null;
    suspendedBy?: Types.ObjectId | null;
    suspensionReason?: string | null;
    grantedBy: Types.ObjectId;
    updatedBy: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IManagerPermissionDocument extends IManagerPermission, Document {}

const managerPermissionSchema = new Schema<IManagerPermissionDocument>(
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
        permissions: {
            type: [String],
            default: () => [...DEFAULT_MANAGER_PERMISSIONS],
        },
        restrictions: {
            type: [String],
            default: [],
        },
        isSuspended: {
            type: Boolean,
            default: false,
            index: true,
        },
        suspendedAt: {
            type: Date,
            default: null,
        },
        suspendedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        suspensionReason: {
            type: String,
            default: null,
        },
        grantedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// One manager permission document per manager per company
managerPermissionSchema.index({ companyId: 1, managerId: 1 }, { unique: true });

export const ManagerPermission = model<IManagerPermissionDocument>('ManagerPermission', managerPermissionSchema);
export default ManagerPermission;
