import { Schema, model } from 'mongoose';
import { IRoleDocument } from './role.types';
import '../permissions/permission.model';

const roleSchema = new Schema<IRoleDocument>(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        permissions: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Permission',
            },
        ],
    },
    {
        timestamps: true,
    }
);

export const Role = model<IRoleDocument>('Role', roleSchema);
export default Role;
