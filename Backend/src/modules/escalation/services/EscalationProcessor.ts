import { Types } from 'mongoose';
import { EscalationEvent } from '../models/EscalationEvent';
import { EscalationCase } from '../models/EscalationCase';
import {
    EscalationCategory,
    EscalationResetPeriod,
    VerificationStatus,
} from '../constants/escalation.constants';
import { IEscalationRuleDocument } from '../types/escalation.types';
import LeaveRequest from '../../attendance/leave.model';
import Holiday from '../../attendance/holiday.model';
import AttendanceAdjustment from '../../attendance/attendance-adjustment.model';
import { AdjustmentStatus } from '../../attendance/attendance.types';

export interface CycleBoundary {
    startDate: Date;
    endDate: Date;
}

export class EscalationProcessor {
    /**
     * Compute cycle start and end boundaries based on rule resetPeriod.
     */
    public static computeCycleBoundaries(
        resetPeriod: EscalationResetPeriod,
        refDate: Date = new Date()
    ): CycleBoundary {
        const d = new Date(refDate);

        if (resetPeriod === EscalationResetPeriod.WEEKLY) {
            // Find current week Monday 00:00:00 UTC
            const day = d.getUTCDay(); // 0 is Sunday, 1 is Monday...
            const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
            const startDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff, 0, 0, 0, 0));
            const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
            return { startDate, endDate };
        }

        if (resetPeriod === EscalationResetPeriod.MONTHLY) {
            const startDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
            // Last millisecond of month
            const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
            const endDate = new Date(nextMonth.getTime() - 1);
            return { startDate, endDate };
        }

        // NEVER resets
        return {
            startDate: new Date(0),
            endDate: new Date(Date.UTC(9999, 11, 31, 23, 59, 59, 999)),
        };
    }

    /**
     * Check if the employee has an approved exception (leave, holiday, adjustment).
     */
    public static async checkApprovedExceptions(
        companyId: string,
        employeeId: string,
        eventDate: string // YYYY-MM-DD
    ): Promise<{ isExempt: boolean; reason?: string }> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);

        // 1. Check Approved Leave for this date
        const leave = await LeaveRequest.findOne({
            companyId: companyObjId,
            employeeId: employeeObjId,
            status: 'APPROVED',
            startDate: { $lte: eventDate },
            endDate: { $gte: eventDate },
        } as any).lean();

        if (leave) {
            return {
                isExempt: true,
                reason: `Approved Leave: ${leave.leaveType || 'General Leave'}`,
            };
        }

        // 2. Check Company Holiday for this date
        const holiday = await Holiday.findOne({
            companyId: companyObjId,
            date: eventDate,
        }).lean();

        if (holiday) {
            return {
                isExempt: true,
                reason: `Official Holiday: ${holiday.name || 'Holiday'}`,
            };
        }

        // 3. Check Approved Attendance Adjustment for this date
        const adjustment = await AttendanceAdjustment.findOne({
            companyId: companyObjId,
            employeeId: employeeObjId,
            date: eventDate,
            status: AdjustmentStatus.APPROVED,
        }).lean();

        if (adjustment) {
            return {
                isExempt: true,
                reason: 'Approved Attendance Adjustment exists for this date',
            };
        }

        return { isExempt: false };
    }

    /**
     * Calculate occurrence count within the current cycle.
     */
    public static async calculateOccurrenceCount(
        companyId: string,
        employeeId: string,
        category: EscalationCategory,
        cycleStartDate: Date,
        cycleEndDate: Date
    ): Promise<number> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);

        const count = await EscalationEvent.countDocuments({
            companyId: companyObjId,
            employeeId: employeeObjId,
            category,
            verificationStatus: { $ne: VerificationStatus.EXEMPTED },
            eventTimestamp: { $gte: cycleStartDate, $lte: cycleEndDate },
        });

        // The current event is included or adds 1
        return Math.max(1, count);
    }

    /**
     * Determine escalation level based on occurrence count and rule configuration.
     * Standard progression:
     * Occurrence 1 -> Level 1 (Employee)
     * Occurrence 2 -> Level 2 (Reporting Manager)
     * Occurrence 3 -> Level 3 (Manager + Company Admin)
     * Occurrence 4+ -> Level 4 (Superior / Executive)
     */
    public static determineEscalationLevel(
        occurrenceCount: number,
        rule?: IEscalationRuleDocument | null
    ): number {
        if (!rule || !rule.escalationLevels || rule.escalationLevels.length === 0) {
            if (occurrenceCount <= 1) return 1;
            if (occurrenceCount === 2) return 2;
            if (occurrenceCount === 3) return 3;
            return 4;
        }

        const maxConfiguredLevel = Math.max(...rule.escalationLevels.map((l) => l.level));
        const matchedLevel = rule.escalationLevels.find((l) => l.level === occurrenceCount);

        if (matchedLevel) {
            return matchedLevel.level;
        }

        // If occurrence exceeds configured levels, cap at maxConfiguredLevel
        return Math.min(occurrenceCount, maxConfiguredLevel);
    }
}
export default EscalationProcessor;
