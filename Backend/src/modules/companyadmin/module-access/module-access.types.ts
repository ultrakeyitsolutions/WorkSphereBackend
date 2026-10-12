import { Document, Types } from 'mongoose';
import { FeatureFlagKey } from '../settings/company-settings.types';

export type ModuleKey =
    | 'dashboard'
    | 'attendance'
    | 'projects'
    | 'tasks'
    | 'dropbox'
    | 'chat'
    | 'meetings'
    | 'live-monitoring'
    | 'detailed-monitoring'
    | 'timesheet'
    | 'leave'
    | 'reports'
    | 'user-reviews'
    | 'status-updates'
    | 'calendar'
    | 'shifts';

export type OverrideState = 'INHERIT' | 'ENABLED' | 'DISABLED';

export type AggregateState = 'ALL_ENABLED' | 'ALL_DISABLED' | 'MIXED';

export interface IModuleDefinition {
    key: ModuleKey;
    name: string;
    description: string;
    category: 'Core' | 'Collaboration' | 'Productivity' | 'Management';
    defaultEnabled: boolean;
    featureFlag?: FeatureFlagKey;
    entitlement?: string;
    route: string;
    iconName?: string;
}

export interface IEmployeeOverride {
    employeeId: Types.ObjectId;
    overrides: Map<string, OverrideState> | Record<string, OverrideState>;
    updatedAt?: Date;
    updatedBy?: Types.ObjectId | null;
}

export interface IModuleAccessAuditEntry {
    actorId: Types.ObjectId;
    action: 'GLOBAL_UPDATE' | 'EMPLOYEE_OVERRIDE_UPDATE' | 'BULK_OVERRIDE_UPDATE' | 'OVERRIDE_RESET';
    affectedModuleKeys: ModuleKey[];
    affectedEmployeeIds?: Types.ObjectId[];
    details?: string;
    timestamp: Date;
}

export interface ICompanyModuleAccess {
    companyId: Types.ObjectId;
    globalSettings: Record<ModuleKey, boolean>;
    employeeOverrides: IEmployeeOverride[];
    auditHistory: IModuleAccessAuditEntry[];
    schemaVersion: number;
    updatedBy?: Types.ObjectId | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ICompanyModuleAccessDocument extends ICompanyModuleAccess, Document {
    _id: Types.ObjectId;
}

export interface UpdateGlobalModuleAccessDto {
    modules: Partial<Record<ModuleKey, boolean>>;
}

export interface UpdateEmployeeOverrideDto {
    overrides?: Partial<Record<ModuleKey, OverrideState | boolean>>;
    modules?: Partial<Record<ModuleKey, boolean>>;
}

export interface BulkUpdateEmployeeOverridesDto {
    employeeIds?: string[];
    memberIds?: string[];
    action?: 'SET' | 'RESET' | 'ENABLE' | 'DISABLE';
    moduleKey?: ModuleKey;
    overrides?: Partial<Record<ModuleKey, OverrideState | boolean>>;
    modules?: Partial<Record<ModuleKey, boolean>>;
}

export interface AggregateModuleState {
    moduleKey: ModuleKey;
    name: string;
    state: AggregateState;
    enabledCount: number;
    disabledCount: number;
    totalCount: number;
    isCompanyRestricted: boolean;
    restrictionReason: string | null;
}

export interface EffectiveEmployeeModuleAccess {
    employeeId: string;
    employeeName: string;
    employeeEmail: string;
    avatar?: string | null;
    memberType: string;
    designationName?: string;
    roleName?: string;
    overrideCount: number;
    overrides: Record<ModuleKey, OverrideState>;
    effectiveAccess: Record<ModuleKey, boolean>;
    globalSettings: Record<ModuleKey, boolean>;
    featureRestrictions: Partial<Record<ModuleKey, { disabledByCompany?: boolean; disabledByPlan?: boolean }>>;
}

export interface SelectedMembersAccessResponse {
    members: EffectiveEmployeeModuleAccess[];
    aggregate: Record<ModuleKey, AggregateModuleState>;
    summary: {
        totalSelected: number;
        totalModules: number;
        allEnabledModulesCount: number;
        allDisabledModulesCount: number;
        mixedModulesCount: number;
    };
}

export interface BulkUpdateResult {
    success: boolean;
    affectedEmployeesCount: number;
    affectedModuleKeys: ModuleKey[];
    message: string;
    aggregate?: Record<ModuleKey, AggregateModuleState>;
    updatedEmployees?: EffectiveEmployeeModuleAccess[];
}

export interface MemberEffectiveModuleAccessResponse {
    effectiveModules: Record<ModuleKey, boolean>;
    modulesMetadata: IModuleDefinition[];
}
