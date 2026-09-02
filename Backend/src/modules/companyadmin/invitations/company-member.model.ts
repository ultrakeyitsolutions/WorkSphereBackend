import { Schema, model, Document, Types } from 'mongoose';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type MemberStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type MemberType = 'EMPLOYEE' | 'CLIENT' | 'MANAGER';

export interface ICompanyMember {
    companyId: Types.ObjectId;
    userId: Types.ObjectId;
    roleId: Types.ObjectId;
    designationId: Types.ObjectId;
    memberType: MemberType;
    biometricId?: string | null;
    status: MemberStatus;
    joinedAt: Date;
}

export interface ICompanyMemberDocument extends ICompanyMember, Document { }

// ─── Schema ───────────────────────────────────────────────────────────────────

const companyMemberSchema = new Schema<ICompanyMemberDocument>(
    {
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
            enum: ['EMPLOYEE', 'CLIENT', 'MANAGER'] satisfies MemberType[],
            required: true,
        },
        biometricId: {
            type: String,
            default: null,
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] satisfies MemberStatus[],
            default: 'ACTIVE',
            required: true,
        },
        joinedAt: {
            type: Date,
            default: () => new Date(),
        },
    },
    { timestamps: true }
);

// Unique: a user can only be a member of a company once
companyMemberSchema.index({ companyId: 1, userId: 1 }, { unique: true });

// Biometric ID must be unique within a company if provided
companyMemberSchema.index(
    { companyId: 1, biometricId: 1 },
    { unique: true, partialFilterExpression: { biometricId: { $type: 'string', $ne: null } } }
);

export const CompanyMember = model<ICompanyMemberDocument>('CompanyMember', companyMemberSchema);
export default CompanyMember;
