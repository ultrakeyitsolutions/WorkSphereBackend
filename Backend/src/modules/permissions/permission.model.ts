import { Schema, model } from 'mongoose';
import { IPermissionDocument } from './permission.types';

const permissionSchema = new Schema<IPermissionDocument>(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        category: {
            type: String,
            trim: true,
            default: 'GENERAL',
        },
        scope: {
            type: String,
            enum: ['COMPANY_MEMBER', 'SYSTEM'],
            default: 'COMPANY_MEMBER',
        },
        assignableBy: {
            type: [String],
            default: [],
        }
    },
    {
        timestamps: true,
    }
);

export const Permission = model<IPermissionDocument>('Permission', permissionSchema);
export default Permission;
