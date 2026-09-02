import { Schema, model, Document, Types } from 'mongoose';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';

export interface IInvitation {
    companyId: Types.ObjectId;
    email?: string;
    phoneNumber?: string;
    roleId: Types.ObjectId;
    designationId: Types.ObjectId;
    memberType: 'EMPLOYEE' | 'CLIENT' | 'MANAGER';
    invitedByUserId: Types.ObjectId;
    /** SHA-256 hash of the raw invitation token */
    tokenHash: string;
    status: InvitationStatus;
    expiresAt: Date;
    acceptedUserId?: Types.ObjectId | null;
    acceptedAt?: Date | null;
    cancelledAt?: Date | null;
}

export interface IInvitationDocument extends IInvitation, Document { }

// ─── Schema ───────────────────────────────────────────────────────────────────

const invitationSchema = new Schema<IInvitationDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
        },
        phoneNumber: {
            type: String,
            trim: true,
        },
        roleId: {
            type: Schema.Types.ObjectId,
            ref: 'CompanyRole',
            required: true,
        },
        designationId: {
            type: Schema.Types.ObjectId,
            ref: 'Designation',
            required: true,
        },
        memberType: {
            type: String,
            enum: ['EMPLOYEE', 'CLIENT', 'MANAGER'],
            required: true,
        },
        invitedByUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        tokenHash: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED'] satisfies InvitationStatus[],
            default: 'PENDING',
            required: true,
        },
        expiresAt: {
            type: Date,
            required: true,
            index: true,
        },
        acceptedUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        acceptedAt: {
            type: Date,
            default: null,
        },
        cancelledAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

// Index for looking up pending invitations by email/phone under a company
invitationSchema.index({ companyId: 1, email: 1, status: 1 });
invitationSchema.index({ companyId: 1, phoneNumber: 1, status: 1 });

export const Invitation = model<IInvitationDocument>('Invitation', invitationSchema);
export default Invitation;
