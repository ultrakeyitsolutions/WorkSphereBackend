import { Schema, model, Document, Types } from 'mongoose';

export type QuotaResourceType = 'projects' | 'tasks' | 'users' | 'storage';
export type QuotaReservationStatus = 'PENDING' | 'COMMITTED' | 'RELEASED';

export interface IQuotaReservation {
    companyId: Types.ObjectId;
    resource: QuotaResourceType;
    contextId?: string | null;
    amount: number;
    status: QuotaReservationStatus;
    expiresAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IQuotaReservationDocument extends IQuotaReservation, Document {}

const quotaReservationSchema = new Schema<IQuotaReservationDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        resource: {
            type: String,
            enum: ['projects', 'tasks', 'users', 'storage'],
            required: true,
            index: true,
        },
        contextId: {
            type: String,
            default: null,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
            default: 1,
            min: 0,
        },
        status: {
            type: String,
            enum: ['PENDING', 'COMMITTED', 'RELEASED'],
            default: 'PENDING',
            required: true,
            index: true,
        },
        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 },
        },
    },
    { timestamps: true }
);

// Compound indexes for sub-millisecond active reservations lookup
quotaReservationSchema.index({ companyId: 1, resource: 1, status: 1, expiresAt: 1 });
quotaReservationSchema.index({ companyId: 1, resource: 1, contextId: 1, status: 1, expiresAt: 1 });

export const QuotaReservation = model<IQuotaReservationDocument>('QuotaReservation', quotaReservationSchema);
export default QuotaReservation;
