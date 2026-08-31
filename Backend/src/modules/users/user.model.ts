import { Schema, model } from 'mongoose';
import { IUserDocument } from './user.types';

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
        isActive: {
            type: Boolean,
            default: true,
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'INACTIVE', 'DEACTIVATED'],
            default: 'ACTIVE',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

export const User = model<IUserDocument>('User', userSchema);
export default User;
