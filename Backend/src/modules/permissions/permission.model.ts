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
    },
    {
        timestamps: true,
    }
);

export const Permission = model<IPermissionDocument>('Permission', permissionSchema);
export default Permission;
