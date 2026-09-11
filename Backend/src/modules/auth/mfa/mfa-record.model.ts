import { Schema, model, Document, Types } from 'mongoose';

export interface IUserMfaDocument extends Document {
    userId: Types.ObjectId;
    method: 'totp';
    secretEncrypted: string;
    recoveryCodeHashes: string[];
    enabledAt?: Date | null;
    setupExpiresAt?: Date | null;
    lastUsedCode?: string | null;
    lastUsedCodeAt?: Date | null;
    keyOtpHash?: string | null;
    keyOtpExpiresAt?: Date | null;
    keyOtpAttempts?: number;
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
        setupExpiresAt: {
            type: Date,
            default: null,
        },
        lastUsedCode: {
            type: String,
            default: null,
        },
        lastUsedCodeAt: {
            type: Date,
            default: null,
        },
        keyOtpHash: {
            type: String,
            default: null,
        },
        keyOtpExpiresAt: {
            type: Date,
            default: null,
        },
        keyOtpAttempts: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
        collection: 'user_mfa',
    }
);

export const UserMfa = model<IUserMfaDocument>('UserMfa', userMfaSchema);
export default UserMfa;
