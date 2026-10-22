import { Schema, model, Document, Types } from 'mongoose';

export type AccountRecoveryRequestStatus =
    | 'PENDING'
    | 'APPROVED'
    | 'REJECTED'
    | 'COMPLETED'
    | 'EXPIRED';

export interface IAccountRecoveryRequest {
    requestId: string;
    userId: Types.ObjectId;
    accountEmail: string;
    communicationEmail: string;
    status: AccountRecoveryRequestStatus;
    submittedAt: Date;
    reviewedBy?: Types.ObjectId | null;
    reviewedAt?: Date | null;
    adminReason?: string | null;
    verificationTokenHash?: string | null;
    verificationTokenExpiresAt?: Date | null;
    verificationTokenUsed: boolean;
    completedAt?: Date | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    emailDeliveryStatus?: 'PENDING' | 'SENT' | 'FAILED';
    emailDeliveryError?: string | null;
}

export interface IAccountRecoveryRequestDocument extends IAccountRecoveryRequest, Document {
    createdAt: Date;
    updatedAt: Date;
}

const accountRecoveryRequestSchema = new Schema<IAccountRecoveryRequestDocument>(
    {
        requestId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        accountEmail: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        communicationEmail: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'EXPIRED'],
            default: 'PENDING',
            required: true,
            index: true,
        },
        submittedAt: {
            type: Date,
            default: Date.now,
            required: true,
            index: true,
        },
        reviewedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        reviewedAt: {
            type: Date,
            default: null,
        },
        adminReason: {
            type: String,
            trim: true,
            default: null,
        },
        verificationTokenHash: {
            type: String,
            default: null,
            index: true,
        },
        verificationTokenExpiresAt: {
            type: Date,
            default: null,
        },
        verificationTokenUsed: {
            type: Boolean,
            default: false,
        },
        completedAt: {
            type: Date,
            default: null,
        },
        ipAddress: {
            type: String,
            default: null,
        },
        userAgent: {
            type: String,
            default: null,
        },
        emailDeliveryStatus: {
            type: String,
            enum: ['PENDING', 'SENT', 'FAILED'],
            default: 'PENDING',
        },
        emailDeliveryError: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'account_recovery_requests',
    }
);

accountRecoveryRequestSchema.index({ userId: 1, status: 1 });
accountRecoveryRequestSchema.index({ communicationEmail: 1, status: 1 });
accountRecoveryRequestSchema.index({ submittedAt: -1 });

export const AccountRecoveryRequest = model<IAccountRecoveryRequestDocument>(
    'AccountRecoveryRequest',
    accountRecoveryRequestSchema
);

export default AccountRecoveryRequest;
