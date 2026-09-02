import { Schema, model, Document, Types } from 'mongoose';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ICompanyRole {
    companyId: Types.ObjectId;
    name: string;
    description?: string;
    isActive: boolean;
    createdBy: Types.ObjectId;
}

export interface ICompanyRoleDocument extends ICompanyRole, Document { }

// ─── Schema ───────────────────────────────────────────────────────────────────

const companyRoleSchema = new Schema<ICompanyRoleDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    { timestamps: true }
);

// Unique: same company cannot have duplicate role names
companyRoleSchema.index({ companyId: 1, name: 1 }, { unique: true });

export const CompanyRole = model<ICompanyRoleDocument>('CompanyRole', companyRoleSchema);
export default CompanyRole;
