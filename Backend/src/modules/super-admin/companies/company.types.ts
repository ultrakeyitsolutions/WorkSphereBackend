import { Document, Schema } from 'mongoose';

// ─── Company Status ───────────────────────────────────────────────────────────
export type CompanyStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'DELETED';

// ─── Core Interface ───────────────────────────────────────────────────────────
export interface ICompany {
    name: string;
    slug: string;                        // URL-safe unique identifier
    domain?: string;                     // Optional custom domain
    industry?: string;
    size?: 'STARTUP' | 'SME' | 'ENTERPRISE';
    logoUrl?: string;
    adminId?: Schema.Types.ObjectId;     // Back-reference to Company Admin user
    status: CompanyStatus;
    isActive: boolean;

    // Profile details
    companyEmail?: string;
    companyPhone?: string;
    website?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    timezone?: string;
    currency?: string;

    // Suspension audit trail
    suspendedAt?: Date;
    suspendedBy?: Schema.Types.ObjectId;
    suspensionReason?: string;

    // Soft delete audit trail
    deletedAt?: Date;
    deletedBy?: Schema.Types.ObjectId;

    // Activation audit trail
    activatedAt?: Date;
    activatedBy?: Schema.Types.ObjectId;
}

// ─── Mongoose Document ────────────────────────────────────────────────────────
export interface ICompanyDocument extends ICompany, Document {
    createdAt: Date;
    updatedAt: Date;
}

// ─── Service / Controller DTOs ────────────────────────────────────────────────
export interface CreateCompanyInput {
    companyName: string;
    companyDomain?: string;
    companyIndustry?: string;
    companySize?: ICompany['size'];
    adminName: string;
    adminEmail: string;
    adminPassword: string;
}
