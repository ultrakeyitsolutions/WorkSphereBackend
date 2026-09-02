import { Schema, model, Document, Types } from 'mongoose';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface IDesignation {
    companyId: Types.ObjectId;
    name: string;
    description?: string;
    isActive: boolean;
    createdBy: Types.ObjectId;
}

export interface IDesignationDocument extends IDesignation, Document { }

// ─── Schema ───────────────────────────────────────────────────────────────────

const designationSchema = new Schema<IDesignationDocument>(
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

// Unique: same company cannot have duplicate designation names
designationSchema.index({ companyId: 1, name: 1 }, { unique: true });

export const Designation = model<IDesignationDocument>('Designation', designationSchema);
export default Designation;
