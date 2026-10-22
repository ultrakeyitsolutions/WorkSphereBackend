import { Document, Types } from 'mongoose';

export interface IUser {
    name: string;
    email: string;
    password?: string; // Opt out when resolving user details if not needed, but required in doc
    role: Types.ObjectId; // Reference to Role model
    companyId?: Types.ObjectId; // Reference to Company model (null for SUPER_ADMIN)
    mustChangePassword?: boolean;
    isActive: boolean;
    status: 'ACTIVE' | 'INACTIVE' | 'DEACTIVATED' | 'SUSPENDED';
    mfaEnabled?: boolean;
    grantedPermissions?: Types.ObjectId[]; // Reference to Permission model
    revokedPermissions?: Types.ObjectId[]; // Reference to Permission model

    // Soft-deletion and account recovery lifecycle
    isDeleted?: boolean;
    deletedAt?: Date | null;
    deletedBy?: Types.ObjectId | null;
    deletionReason?: string | null;
    accountStatus?: 'ACTIVE' | 'DELETED' | 'SUSPENDED' | 'RECOVERY_PENDING' | 'RECOVERY_APPROVED' | 'RECOVERY_REJECTED';
    recoveryEligibleUntil?: Date | null;
    restoredAt?: Date | null;
    restoredBy?: Types.ObjectId | null;
    restoredViaRequestId?: Types.ObjectId | null;
}

export interface IUserDocument extends IUser, Document {
    createdAt: Date;
    updatedAt: Date;
}
