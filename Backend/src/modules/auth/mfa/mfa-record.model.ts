import { Schema, model, Document, Types } from 'mongoose';

export interface IUserMfaDocument extends Document {
    userId: Types.ObjectId;
    method: 'totp';
    secretEncrypted: string;
    recoveryCodeHashes: string[];
    enabledAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const userMfaSchema = new Schema<IUserMfaDocument>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        method: {
            type: String,
            enum: ['totp'],
            default: 'totp',
            required: true,
        },
        secretEncrypted: {
            type: String,
            required: true,
        },
        recoveryCodeHashes: {
            type: [String],
            default: [],
        },
        enabledAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'user_mfa',
    }
);

export const UserMfa = model<IUserMfaDocument>('UserMfa', userMfaSchema);
export default UserMfa;
