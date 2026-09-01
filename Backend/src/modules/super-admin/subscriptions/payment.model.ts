import { Schema, model } from 'mongoose';
import { IPaymentDocument, PaymentStatus } from './payment.types';

const paymentSchema = new Schema<IPaymentDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
        },
        subscriptionId: {
            type: Schema.Types.ObjectId,
            ref: 'Subscription',
            required: true,
        },
        amount: {
            // Using Number is okay for simple cases, but often it's recommended to store as integer in smallest unit (e.g. cents).
            // We'll trust the user to remember floating-point rules or implement them here.
            type: Number,
            required: true,
        },
        currency: {
            type: String,
            required: true,
            uppercase: true,
        },
        status: {
            type: String,
            enum: Object.values(PaymentStatus),
            default: PaymentStatus.PENDING,
            required: true,
        },
        paymentMethod: {
            type: String,
        },
        provider: {
            type: String,
        },
        providerPaymentId: {
            type: String,
        },
        paidAt: {
            type: Date,
        },
        failedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

paymentSchema.index({ companyId: 1 });
paymentSchema.index({ subscriptionId: 1 });

export const Payment = model<IPaymentDocument>('Payment', paymentSchema);
export default Payment;
