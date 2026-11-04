import { Schema, model } from 'mongoose';
import { ITenantMembershipDocument, TenantMemberStatus } from './white-label.types';

const tenantMembershipSchema = new Schema<ITenantMembershipDocument>(
    {
        tenantId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        role: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'SUSPENDED', 'INACTIVE'] satisfies TenantMemberStatus[],
            default: 'ACTIVE',
            required: true,
            index: true,
        },
        permissions: [
            {
                type: String,
                trim: true,
            },
        ],
        joinedAt: {
            type: Date,
            default: () => new Date(),
        },
    },
    {
        timestamps: true,
    }
);

// Database-level uniqueness constraints to prevent duplicate tenant memberships
tenantMembershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
tenantMembershipSchema.index({ companyId: 1, userId: 1 }, { unique: true });
tenantMembershipSchema.index({ tenantId: 1, status: 1 });

export const TenantMembership = model<ITenantMembershipDocument>(
    'TenantMembership',
    tenantMembershipSchema
);

export default TenantMembership;
