import { Schema, model, Document } from 'mongoose';

export interface IPasswordResetDocument extends Document {
    email: string;
    otpHash: string;
    expiresAt: Date;
    attempts: number;
    usedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const passwordResetSchema = new Schema<IPasswordResetDocument>(
    {
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        otpHash: {
            type: String,
            required: true,
        },
        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 }, // MongoDB TTL index to auto-remove expired documents
        },
        attempts: {
            type: Number,
            default: 0,
        },
        usedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'password_resets',
    }
);

export const PasswordReset = model<IPasswordResetDocument>('PasswordReset', passwordResetSchema);
export default PasswordReset;
