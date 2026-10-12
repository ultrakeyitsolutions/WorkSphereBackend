import { Schema, model } from 'mongoose';
import { ICompanyModuleAccessDocument } from './module-access.types';
import { DEFAULT_GLOBAL_MODULE_SETTINGS } from './module-access.constants';

const employeeOverrideSchema = new Schema(
    {
        employeeId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        overrides: {
            type: Map,
            of: String, // 'INHERIT' | 'ENABLED' | 'DISABLED'
            default: {},
        },
        updatedAt: {
            type: Date,
            default: Date.now,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { _id: false }
);

const auditEntrySchema = new Schema(
    {
        actorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        action: {
            type: String,
            enum: ['GLOBAL_UPDATE', 'EMPLOYEE_OVERRIDE_UPDATE', 'BULK_OVERRIDE_UPDATE', 'OVERRIDE_RESET'],
            required: true,
        },
        affectedModuleKeys: [{ type: String }],
        affectedEmployeeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
        details: { type: String },
        timestamp: { type: Date, default: Date.now },
    },
    { _id: false }
);

const companyModuleAccessSchema = new Schema<ICompanyModuleAccessDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            unique: true,
            index: true,
        },
        globalSettings: {
            dashboard: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.dashboard },
            attendance: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.attendance },
            projects: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.projects },
            tasks: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.tasks },
            dropbox: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.dropbox },
            chat: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.chat },
            meetings: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.meetings },
            'live-monitoring': { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS['live-monitoring'] },
            'detailed-monitoring': { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS['detailed-monitoring'] },
            timesheet: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.timesheet },
            leave: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.leave },
            reports: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.reports },
            'user-reviews': { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS['user-reviews'] },
            'status-updates': { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS['status-updates'] },
            calendar: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.calendar },
            shifts: { type: Boolean, default: DEFAULT_GLOBAL_MODULE_SETTINGS.shifts },
        },
        employeeOverrides: [employeeOverrideSchema],
        auditHistory: [auditEntrySchema],
        schemaVersion: {
            type: Number,
            default: 1,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'company_module_access',
    }
);

export const CompanyModuleAccess = model<ICompanyModuleAccessDocument>(
    'CompanyModuleAccess',
    companyModuleAccessSchema
);
export default CompanyModuleAccess;
