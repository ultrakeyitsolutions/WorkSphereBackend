import { Schema, model, Types } from 'mongoose';
import {
    IEscalationRuleDocument,
    IEscalationLevelConfig,
} from '../types/escalation.types';
import {
    EscalationCategory,
    EscalationSeverity,
    EscalationResetPeriod,
    DEFAULT_ESCALATION_LEVELS,
} from '../constants/escalation.constants';

const escalationLevelSchema = new Schema<IEscalationLevelConfig>(
    {
        level: { type: Number, required: true },
        name: { type: String, required: true, trim: true },
        notifyRole: { type: String, required: true, trim: true },
        notifyUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
        deadlineHours: { type: Number, default: 48 },
    },
    { _id: false }
);

const escalationRuleSchema = new Schema<IEscalationRuleDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        ruleName: {
            type: String,
            required: true,
            trim: true,
        },
        category: {
            type: String,
            enum: Object.values(EscalationCategory),
            required: true,
            index: true,
        },
        description: {
            type: String,
            trim: true,
            default: '',
        },
        isEnabled: {
            type: Boolean,
            default: true,
            index: true,
        },
        severity: {
            type: String,
            enum: Object.values(EscalationSeverity),
            default: EscalationSeverity.MEDIUM,
        },
        gracePeriod: {
            type: Number,
            default: 15, // in minutes
            min: 0,
        },
        thresholds: {
            maxViolationDuration: { type: Number, default: 0 },
            occurrenceThreshold: { type: Number, default: 1 },
            idleThresholdMinutes: { type: Number, default: 30 },
            breakDurationLimitMinutes: { type: Number, default: 60 },
            reopenCountThreshold: { type: Number, default: 2 },
            projectDelayDays: { type: Number, default: 3 },
            consecutiveDaysThreshold: { type: Number, default: 3 },
            customMetricThreshold: { type: Number, default: 0 },
        },
        escalationLevels: {
            type: [escalationLevelSchema],
            default: () => [...DEFAULT_ESCALATION_LEVELS],
        },
        resetPeriod: {
            type: String,
            enum: Object.values(EscalationResetPeriod),
            default: EscalationResetPeriod.MONTHLY,
        },
        notificationRecipients: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        applicableDepartments: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Designation',
            },
        ],
        applicableEmployees: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        applicableShifts: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Shift',
            },
        ],
        resolutionDeadline: {
            type: Number,
            default: 48, // hours
            min: 1,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: any) => {
                ret.id = ret._id ? ret._id.toString() : ret.id;
                delete ret.__v;
                return ret;
            },
        },
        toObject: { virtuals: true },
    }
);

// Indexes
escalationRuleSchema.index({ companyId: 1, category: 1, isEnabled: 1 });
escalationRuleSchema.index({ companyId: 1, ruleName: 1 });

export const EscalationRule = model<IEscalationRuleDocument>(
    'EscalationRule',
    escalationRuleSchema
);
export default EscalationRule;
