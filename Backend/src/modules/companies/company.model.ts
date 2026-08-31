import { Schema, model } from 'mongoose';
import { ICompanyDocument } from './company.types';

const companySchema = new Schema<ICompanyDocument>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        domain: {
            type: String,
            trim: true,
            lowercase: true,
        },
        industry: {
            type: String,
            trim: true,
        },
        size: {
            type: String,
            enum: ['STARTUP', 'SME', 'ENTERPRISE'],
        },
        logoUrl: {
            type: String,
            trim: true,
        },
        adminId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED'],
            default: 'ACTIVE',
            required: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },

        // Profile details
        companyEmail: {
            type: String,
            trim: true,
            lowercase: true,
            unique: true,
            sparse: true,
        },
        companyPhone: {
            type: String,
            trim: true,
        },
        website: {
            type: String,
            trim: true,
        },
        address: {
            type: String,
            trim: true,
        },
        city: {
            type: String,
            trim: true,
        },
        state: {
            type: String,
            trim: true,
        },
        country: {
            type: String,
            trim: true,
        },
        postalCode: {
            type: String,
            trim: true,
        },
        timezone: {
            type: String,
            trim: true,
        },
        currency: {
            type: String,
            trim: true,
        },

        // Suspension audit trail
        suspendedAt: {
            type: Date,
        },
        suspendedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        suspensionReason: {
            type: String,
            trim: true,
        },

        // Soft delete audit trail
        deletedAt: {
            type: Date,
        },
        deletedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },

        // Activation audit trail
        activatedAt: {
            type: Date,
        },
        activatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    {
        timestamps: true,
    }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
companySchema.index({ domain: 1 });

export const Company = model<ICompanyDocument>('Company', companySchema);
export default Company;
