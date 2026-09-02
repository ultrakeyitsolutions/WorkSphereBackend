import { Schema, model, Document, Types } from 'mongoose';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type DeliveryChannel = 'EMAIL' | 'SMS';
export type DeliveryStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED';

export interface IInvitationDelivery {
    invitationId: Types.ObjectId;
    channel: DeliveryChannel;
    status: DeliveryStatus;
    attemptCount: number;
    providerMessageId?: string;
    failureReason?: string;
    sentAt?: Date | null;
    deliveredAt?: Date | null;
    failedAt?: Date | null;
}

export interface IInvitationDeliveryDocument extends IInvitationDelivery, Document { }

// ─── Schema ───────────────────────────────────────────────────────────────────

const invitationDeliverySchema = new Schema<IInvitationDeliveryDocument>(
    {
        invitationId: {
            type: Schema.Types.ObjectId,
            ref: 'Invitation',
            required: true,
            index: true,
        },
        channel: {
            type: String,
            enum: ['EMAIL', 'SMS'] satisfies DeliveryChannel[],
            required: true,
        },
        status: {
            type: String,
            enum: ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED'] satisfies DeliveryStatus[],
            default: 'QUEUED',
            required: true,
        },
        attemptCount: {
            type: Number,
            default: 0,
        },
        providerMessageId: {
            type: String,
            trim: true,
        },
        failureReason: {
            type: String,
            trim: true,
        },
        sentAt: {
            type: Date,
            default: null,
        },
        deliveredAt: {
            type: Date,
            default: null,
        },
        failedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

export const InvitationDelivery = model<IInvitationDeliveryDocument>(
    'InvitationDelivery',
    invitationDeliverySchema
);
export default InvitationDelivery;
