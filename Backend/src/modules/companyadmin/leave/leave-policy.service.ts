import { Types } from 'mongoose';
import { CompanyLeavePolicy } from './leave-policy.model';
import { CompanyLopPolicy } from './lop-policy.model';
import {
    UpsertLeavePolicyDto,
    UpdateLopPolicyDto,
    SetEmployeePolicyOverrideDto,
    SetEmployeeLopOverrideDto,
} from './leave-policy.types';
import { LeaveType } from '../../attendance/attendance.types';
import { AppError } from '../../../utils/AppError';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';

export class LeavePolicyService {
    /**
     * Get all leave policies for a company. If none exist, initializes default policies.
     */
    static async getCompanyLeavePolicies(companyId: string) {
        const cId = new Types.ObjectId(companyId);
        let policies = await CompanyLeavePolicy.find({ companyId: cId, isActive: true })
            .populate('employeeOverrides.employeeId', 'name email avatar')
            .lean();

        if (policies.length === 0) {
            // Seed standard initial leave policies
            await this.seedDefaultPolicies(companyId);
            policies = await CompanyLeavePolicy.find({ companyId: cId, isActive: true })
                .populate('employeeOverrides.employeeId', 'name email avatar')
                .lean();
        }

        return policies;
    }

    /**
     * Seeds initial default policies for Casual, Sick, Paid, and Unpaid leave.
     */
    static async seedDefaultPolicies(companyId: string) {
        const cId = new Types.ObjectId(companyId);
        const defaults = [
            {
                companyId: cId,
                leaveType: LeaveType.CASUAL,
                name: 'Casual Leave',
                description: 'Short-term personal time off and unplanned casual leaves',
                monthlyLimit: 2,
                unusedLeavePolicy: 'EXPIRES' as const,
                maxCarryForwardDays: 0,
                excessLeaveRule: 'REQUIRE_REVIEW' as const,
                countWeekends: false,
                countHolidays: false,
                allowHalfDay: true,
                effectiveFrom: '2026-01-01',
                isActive: true,
            },
            {
                companyId: cId,
                leaveType: LeaveType.SICK,
                name: 'Sick Leave',
                description: 'Medical leaves and health-related absences',
                monthlyLimit: 1,
                unusedLeavePolicy: 'EXPIRES' as const,
                maxCarryForwardDays: 0,
                excessLeaveRule: 'REQUIRE_REVIEW' as const,
                countWeekends: false,
                countHolidays: false,
                allowHalfDay: true,
                effectiveFrom: '2026-01-01',
                isActive: true,
            },
            {
                companyId: cId,
                leaveType: LeaveType.PAID,
                name: 'Earned / Paid Leave',
                description: 'Accrued annual vacation and planned leaves',
                monthlyLimit: 1.5,
                unusedLeavePolicy: 'CARRIES_FORWARD' as const,
                maxCarryForwardDays: 15,
                excessLeaveRule: 'CONVERT_TO_LOP' as const,
                countWeekends: false,
                countHolidays: false,
                allowHalfDay: true,
                effectiveFrom: '2026-01-01',
                isActive: true,
            },
            {
                companyId: cId,
                leaveType: LeaveType.UNPAID,
                name: 'Unpaid Leave (Loss of Pay)',
                description: 'Leaves without salary compensation',
                monthlyLimit: 0,
                unusedLeavePolicy: 'EXPIRES' as const,
                maxCarryForwardDays: 0,
                excessLeaveRule: 'CONVERT_TO_UNPAID' as const,
                countWeekends: false,
                countHolidays: false,
                allowHalfDay: true,
                effectiveFrom: '2026-01-01',
                isActive: true,
            },
        ];

        for (const def of defaults) {
            await CompanyLeavePolicy.findOneAndUpdate(
                { companyId: cId, leaveType: def.leaveType },
                { $setOnInsert: def },
                { upsert: true, new: true }
            );
        }
    }

    /**
     * Upsert a company leave policy for a leave type.
     */
    static async upsertLeavePolicy(
        companyId: string,
        dto: UpsertLeavePolicyDto,
        actorId?: string
    ) {
        if (dto.monthlyLimit < 0) {
            throw AppError.badRequest('Monthly limit cannot be negative.');
        }

        if (dto.maxCarryForwardDays && dto.maxCarryForwardDays < 0) {
            throw AppError.badRequest('Max carry forward days cannot be negative.');
        }

        if (dto.effectiveTo && dto.effectiveFrom > dto.effectiveTo) {
            throw AppError.badRequest('effectiveFrom cannot be later than effectiveTo.');
        }

        const cId = new Types.ObjectId(companyId);
        const name = dto.name || `${dto.leaveType} Leave`;

        const policy = await CompanyLeavePolicy.findOneAndUpdate(
            { companyId: cId, leaveType: dto.leaveType },
            {
                $set: {
                    name,
                    description: dto.description || '',
                    monthlyLimit: dto.monthlyLimit,
                    unusedLeavePolicy: dto.unusedLeavePolicy || 'EXPIRES',
                    maxCarryForwardDays: dto.maxCarryForwardDays || 0,
                    excessLeaveRule: dto.excessLeaveRule || 'REQUIRE_REVIEW',
                    countWeekends: dto.countWeekends ?? false,
                    countHolidays: dto.countHolidays ?? false,
                    allowHalfDay: dto.allowHalfDay ?? true,
                    effectiveFrom: dto.effectiveFrom,
                    effectiveTo: dto.effectiveTo || null,
                    isActive: dto.isActive ?? true,
                    updatedBy: actorId ? new Types.ObjectId(actorId) : null,
                },
                $setOnInsert: {
                    companyId: cId,
                    leaveType: dto.leaveType,
                    createdBy: actorId ? new Types.ObjectId(actorId) : null,
                },
            },
            { upsert: true, new: true }
        );

        if (actorId) {
            AuditLogService.log({
                action: AuditAction.COMPANY_SETTINGS_UPDATED,
                actorId,
                companyId,
                metadata: {
                    policyId: policy._id.toString(),
                    leaveType: policy.leaveType,
                    monthlyLimit: policy.monthlyLimit,
                    excessLeaveRule: policy.excessLeaveRule,
                },
                description: `Updated leave policy for ${policy.leaveType}`,
            });
        }

        return policy;
    }

    /**
     * Set employee-specific policy override.
     */
    static async setEmployeePolicyOverride(
        companyId: string,
        policyId: string,
        dto: SetEmployeePolicyOverrideDto,
        actorId?: string
    ) {
        if (dto.monthlyLimit < 0) {
            throw AppError.badRequest('Monthly limit cannot be negative.');
        }

        const policy = await CompanyLeavePolicy.findOne({
            _id: new Types.ObjectId(policyId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!policy) {
            throw AppError.notFound('Leave policy not found.');
        }

        const empObjId = new Types.ObjectId(dto.employeeId);
        // Remove existing override if present
        policy.employeeOverrides = policy.employeeOverrides.filter(
            (o) => o.employeeId.toString() !== dto.employeeId
        );

        policy.employeeOverrides.push({
            employeeId: empObjId,
            monthlyLimit: dto.monthlyLimit,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo || null,
            reason: dto.reason || '',
        });

        policy.updatedBy = actorId ? new Types.ObjectId(actorId) : null;
        await policy.save();

        return policy;
    }

    /**
     * Remove employee-specific policy override.
     */
    static async removeEmployeePolicyOverride(
        companyId: string,
        policyId: string,
        employeeId: string,
        actorId?: string
    ) {
        const policy = await CompanyLeavePolicy.findOne({
            _id: new Types.ObjectId(policyId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!policy) {
            throw AppError.notFound('Leave policy not found.');
        }

        policy.employeeOverrides = policy.employeeOverrides.filter(
            (o) => o.employeeId.toString() !== employeeId
        );
        policy.updatedBy = actorId ? new Types.ObjectId(actorId) : null;
        await policy.save();

        return policy;
    }

    /**
     * Get or initialize LOP Deduction Policy for a company.
     */
    static async getOrCreateLopPolicy(companyId: string) {
        const cId = new Types.ObjectId(companyId);
        let policy = await CompanyLopPolicy.findOne({ companyId: cId })
            .populate('employeeOverrides.employeeId', 'name email avatar')
            .lean();

        if (!policy) {
            policy = await CompanyLopPolicy.create({
                companyId: cId,
                isAutoCalculationEnabled: true,
                calculationMethod: 'SALARY_DIVISOR',
                fixedDailyAmount: 1000,
                salaryBasis: 'MONTHLY_BASE_SALARY',
                divisorType: 'FIXED_DIVISOR',
                fixedDivisor: 30,
                currency: 'INR',
                roundingRule: 'ROUND_HALF_UP',
                requiresAdminApproval: true,
                effectiveFrom: '2026-01-01',
                employeeOverrides: [],
            });
        }

        return policy;
    }

    /**
     * Update LOP Deduction Policy for a company.
     */
    static async updateLopPolicy(
        companyId: string,
        dto: UpdateLopPolicyDto,
        actorId?: string
    ) {
        if (dto.fixedDivisor != null && (dto.fixedDivisor < 1 || dto.fixedDivisor > 365)) {
            throw AppError.badRequest('fixedDivisor must be between 1 and 365.');
        }
        if (dto.fixedDailyAmount != null && dto.fixedDailyAmount < 0) {
            throw AppError.badRequest('fixedDailyAmount cannot be negative.');
        }

        const cId = new Types.ObjectId(companyId);
        const policy = await CompanyLopPolicy.findOneAndUpdate(
            { companyId: cId },
            {
                $set: {
                    ...(dto.isAutoCalculationEnabled !== undefined && {
                        isAutoCalculationEnabled: dto.isAutoCalculationEnabled,
                    }),
                    ...(dto.calculationMethod && { calculationMethod: dto.calculationMethod }),
                    ...(dto.fixedDailyAmount != null && { fixedDailyAmount: dto.fixedDailyAmount }),
                    ...(dto.salaryBasis && { salaryBasis: dto.salaryBasis }),
                    ...(dto.divisorType && { divisorType: dto.divisorType }),
                    ...(dto.fixedDivisor != null && { fixedDivisor: dto.fixedDivisor }),
                    ...(dto.currency && { currency: dto.currency.toUpperCase().trim() }),
                    ...(dto.roundingRule && { roundingRule: dto.roundingRule }),
                    ...(dto.requiresAdminApproval !== undefined && {
                        requiresAdminApproval: dto.requiresAdminApproval,
                    }),
                    ...(dto.effectiveFrom && { effectiveFrom: dto.effectiveFrom }),
                    ...(dto.effectiveTo !== undefined && { effectiveTo: dto.effectiveTo }),
                    updatedBy: actorId ? new Types.ObjectId(actorId) : null,
                },
                $setOnInsert: {
                    companyId: cId,
                    createdBy: actorId ? new Types.ObjectId(actorId) : null,
                },
            },
            { upsert: true, new: true }
        );

        if (actorId) {
            AuditLogService.log({
                action: AuditAction.COMPANY_SETTINGS_UPDATED,
                actorId,
                companyId,
                metadata: {
                    lopPolicyId: policy._id.toString(),
                    calculationMethod: policy.calculationMethod,
                    fixedDivisor: policy.fixedDivisor,
                },
                description: 'Updated Loss of Pay (LOP) deduction policy',
            });
        }

        return policy;
    }

    /**
     * Set employee-specific LOP override.
     */
    static async setEmployeeLopOverride(
        companyId: string,
        dto: SetEmployeeLopOverrideDto,
        actorId?: string
    ) {
        if (dto.fixedDivisor != null && (dto.fixedDivisor < 1 || dto.fixedDivisor > 365)) {
            throw AppError.badRequest('fixedDivisor must be between 1 and 365.');
        }
        if (dto.fixedDailyAmount != null && dto.fixedDailyAmount < 0) {
            throw AppError.badRequest('fixedDailyAmount cannot be negative.');
        }
        if (dto.customSalary != null && dto.customSalary < 0) {
            throw AppError.badRequest('customSalary cannot be negative.');
        }

        const cId = new Types.ObjectId(companyId);
        const policy = await CompanyLopPolicy.findOne({ companyId: cId });
        if (!policy) {
            throw AppError.notFound('LOP policy not found. Please initialize LOP policy first.');
        }

        const empObjId = new Types.ObjectId(dto.employeeId);
        policy.employeeOverrides = policy.employeeOverrides.filter(
            (o) => o.employeeId.toString() !== dto.employeeId
        );

        policy.employeeOverrides.push({
            employeeId: empObjId,
            calculationMethod: dto.calculationMethod,
            fixedDailyAmount: dto.fixedDailyAmount,
            customSalary: dto.customSalary,
            fixedDivisor: dto.fixedDivisor,
            reason: dto.reason || '',
        });

        policy.updatedBy = actorId ? new Types.ObjectId(actorId) : null;
        await policy.save();

        return policy;
    }

    /**
     * Remove employee-specific LOP override.
     */
    static async removeEmployeeLopOverride(
        companyId: string,
        employeeId: string,
        actorId?: string
    ) {
        const cId = new Types.ObjectId(companyId);
        const policy = await CompanyLopPolicy.findOne({ companyId: cId });
        if (!policy) {
            throw AppError.notFound('LOP policy not found.');
        }

        policy.employeeOverrides = policy.employeeOverrides.filter(
            (o) => o.employeeId.toString() !== employeeId
        );
        policy.updatedBy = actorId ? new Types.ObjectId(actorId) : null;
        await policy.save();

        return policy;
    }
}
export default LeavePolicyService;
