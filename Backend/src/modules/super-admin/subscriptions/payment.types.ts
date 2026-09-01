import { Document, Types } from 'mongoose';

export enum PaymentStatus {
    PENDING = 'PENDING',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    REFUNDED = 'REFUNDED',
    CANCELLED = 'CANCELLED',
}

export interface IPayment {
    companyId: Types.ObjectId;
    subscriptionId: Types.ObjectId;

    amount: number;
    currency: string;

    status: PaymentStatus;
    paymentMethod?: string;

    provider?: string;
    providerPaymentId?: string;

    paidAt?: Date;
    failedAt?: Date;
}

export interface IPaymentDocument extends IPayment, Document {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}
