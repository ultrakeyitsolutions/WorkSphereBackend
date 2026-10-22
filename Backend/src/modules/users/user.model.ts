import { Schema, model } from 'mongoose';
import { IUserDocument } from './user.types';
import '../roles/role.model';
import '../super-admin/companies/company.model';

const userSchema = new Schema<IUserDocument>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        password: {
            type: String,
            required: true,
        },
        role: {
            type: Schema.Types.ObjectId,
            ref: 'Role',
            required: true,
        },
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            default: null,
        },
        mustChangePassword: {
            type: Boolean,
            default: false,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        mfaEnabled: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'INACTIVE', 'DEACTIVATED', 'SUSPENDED'],
            default: 'ACTIVE',
            required: true,
        },
        grantedPermissions: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Permission',
            }
        ],
        revokedPermissions: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Permission',
            }
        ],
        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },
        deletedAt: {
            type: Date,
            default: null,
        },
        deletedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        deletionReason: {
            type: String,
            default: null,
        },
        accountStatus: {
            type: String,
            enum: ['ACTIVE', 'DELETED', 'SUSPENDED', 'RECOVERY_PENDING', 'RECOVERY_APPROVED', 'RECOVERY_REJECTED'],
            default: 'ACTIVE',
            index: true,
        },
        recoveryEligibleUntil: {
            type: Date,
            default: null,
        },
        restoredAt: {
            type: Date,
            default: null,
        },
        restoredBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        restoredViaRequestId: {
            type: Schema.Types.ObjectId,
            ref: 'AccountRecoveryRequest',
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

userSchema.index({ email: 1, isDeleted: 1 });

export const User = model<IUserDocument>('User', userSchema);
export default User;
