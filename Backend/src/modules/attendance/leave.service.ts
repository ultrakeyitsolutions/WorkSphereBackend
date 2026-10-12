import { Types } from 'mongoose';
import { LeaveRequest } from './leave.model';
import { Attendance } from './attendance.model';
import {
    ApplyLeaveDto,
    LeaveStatus,
    AttendanceStatus,
    LeaveDurationType,
} from './attendance.types';
import { AppError } from '../../utils/AppError';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { NotificationEventBus } from '../notifications/notification.event-bus';
import { TimezoneUtils } from './utils/timezone.utils';
import { AttendanceCalculationService } from './attendance-calculation.service';
import { LeaveCalculatorService } from '../companyadmin/leave/leave-calculator.service';
import { LeaveBalanceService } from '../companyadmin/leave/leave-balance.service';
import { LopDecisionService } from '../companyadmin/leave/lop-decision.service';
import { LeaveEmailService } from '../companyadmin/leave/leave-email.service';
import { LopDecision } from '../companyadmin/leave/lop-decision.model';
import {
    ApproveLeaveWithBreakdownDto,
    LeavePreviewRequestDto,
    LeavePreviewResponse,
    RequestLeaveRevisionDto,
} from '../companyadmin/leave/leave-policy.types';

export class LeaveService {
    /**
     * Preview leave request breakdown before submission.
     */
    static async previewLeave(
        companyId: string,
        employeeId: string,
        dto: LeavePreviewRequestDto
    ): Promise<LeavePreviewResponse> {
        if (dto.startDate > dto.endDate) {
            throw AppError.badRequest('Leave startDate cannot be later than endDate.');
        }

        const durationType = dto.durationType || LeaveDurationType.FULL_DAY;
        const targetEmployeeId = dto.employeeId || employeeId;

        const allocation = await LeaveCalculatorService.allocateLeaveAcrossMonths(
            companyId,
            targetEmployeeId,
            dto.startDate,
            dto.endDate,
            durationType,
            dto.leaveType
        );

        let explanation = `Requested ${allocation.totalDays} day(s). All days eligible as paid leave under active company policy.`;
        if (allocation.excessDays > 0) {
            explanation = `Requested ${allocation.totalDays} day(s). ${allocation.eligiblePaidDays} day(s) eligible as paid leave, ${allocation.excessDays} excess day(s) subject to company review / Loss of Pay (estimated deduction: ${allocation.currency} ${allocation.estimatedDeduction.toLocaleString()}).`;
        }

        return {
            startDate: dto.startDate,
            endDate: dto.endDate,
            leaveType: dto.leaveType,
            totalRequestedDays: allocation.totalDays,
            totalEligiblePaidDays: allocation.eligiblePaidDays,
            totalExcessDays: allocation.excessDays,
            totalProposedLopDays: allocation.proposedLopDays,
            totalUnpaidDays: allocation.unpaidDays,
            estimatedDeduction: allocation.estimatedDeduction,
            currency: allocation.currency,
            isLopApplicable: allocation.isLopApplicable,
            monthBreakdown: allocation.monthBreakdown,
            activePolicy: {
                monthlyLimit: allocation.activePolicy.monthlyLimit,
                unusedLeavePolicy: allocation.activePolicy.unusedLeavePolicy,
                excessLeaveRule: allocation.activePolicy.excessLeaveRule,
                countWeekends: allocation.activePolicy.countWeekends,
                countHolidays: allocation.activePolicy.countHolidays,
            },
            explanation,
        };
    }

    /**
     * Employee submits a leave request with automatic monthly allocation and balance reservation.
     */
    static async applyLeave(
        companyId: string,
        employeeId: string,
        dto: ApplyLeaveDto
    ) {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);

        if (dto.startDate > dto.endDate) {
            throw AppError.badRequest('Leave startDate cannot be later than endDate.');
        }

        // Check for overlapping pending, approved, or changes_requested leave requests
        const overlapping = await LeaveRequest.findOne({
            companyId: companyObjId,
            employeeId: employeeObjId,
            status: { $in: [LeaveStatus.PENDING, LeaveStatus.APPROVED, LeaveStatus.CHANGES_REQUESTED] },
            $and: [
                { startDate: { $lte: dto.endDate } },
                { endDate: { $gte: dto.startDate } },
            ],
        });

        if (overlapping) {
            throw AppError.conflict(
                `An existing ${overlapping.status.toLowerCase()} leave request already covers ${overlapping.startDate} to ${overlapping.endDate}.`
            );
        }

        const durationType = dto.durationType || LeaveDurationType.FULL_DAY;

        // Calculate multi-month allocation and working days
        const allocation = await LeaveCalculatorService.allocateLeaveAcrossMonths(
            companyId,
            employeeId,
            dto.startDate,
            dto.endDate,
            durationType,
            dto.leaveType
        );

        if (allocation.totalDays <= 0) {
            throw AppError.badRequest('No working days found in the selected date range under company policy.');
        }

        const leave = await LeaveRequest.create({
            companyId: companyObjId,
            employeeId: employeeObjId,
            leaveType: dto.leaveType,
            durationType,
            halfDayPeriod: dto.halfDayPeriod || null,
            startDate: dto.startDate,
            endDate: dto.endDate,
            totalDays: allocation.totalDays,
            paidDays: allocation.eligiblePaidDays,
            unpaidDays: allocation.unpaidDays,
            lopDays: allocation.proposedLopDays,
            excessDays: allocation.excessDays,
            isLopProposed: allocation.isLopApplicable,
            monthBreakdown: allocation.monthBreakdown,
            reason: dto.reason.trim(),
            status: LeaveStatus.PENDING,
            appliedAt: new Date(),
            decisionHistory: [
                {
                    action: 'APPLIED',
                    actorId: employeeObjId,
                    timestamp: new Date(),
                    details: `Applied for ${dto.leaveType} leave (${allocation.totalDays} days, Paid: ${allocation.eligiblePaidDays}, Excess/LOP: ${allocation.proposedLopDays})`,
                    snapshot: { allocation },
                },
            ],
        });

        // Reserve pending balance
        await LeaveBalanceService.reservePendingBalance(
            companyId,
            employeeId,
            dto.leaveType,
            allocation.monthBreakdown
        );

        // Propose LOP decisions if applicable
        if (allocation.proposedLopDays > 0) {
            for (const monthItem of allocation.monthBreakdown) {
                if (monthItem.proposedLopDays > 0) {
                    const lopDecision = await LopDecisionService.proposeLopDecision(
                        companyId,
                        employeeId,
                        leave._id.toString(),
                        monthItem.month,
                        monthItem.proposedLopDays,
                        dto.startDate
                    );
                    if (lopDecision && !leave.lopDecisionId) {
                        leave.lopDecisionId = lopDecision._id;
                        await leave.save();
                    }
                }
            }
        }

        // Audit Log
        AuditLogService.log({
            action: AuditAction.LEAVE_REQUESTED,
            actorId: employeeId,
            companyId,
            metadata: {
                leaveId: leave._id.toString(),
                startDate: leave.startDate,
                endDate: leave.endDate,
                leaveType: leave.leaveType,
                totalDays: allocation.totalDays,
                paidDays: allocation.eligiblePaidDays,
                lopDays: allocation.proposedLopDays,
                estimatedDeduction: allocation.estimatedDeduction,
            },
            description: `Applied for ${leave.leaveType} leave from ${leave.startDate} to ${leave.endDate}`,
        });

        // Publish Notification
        NotificationEventBus.getInstance().publish({
            type: 'LEAVE_REQUESTED',
            companyId,
            actorId: employeeId,
            entityId: leave._id.toString(),
            entityType: 'LEAVE',
            metadata: {
                startDate: leave.startDate,
                endDate: leave.endDate,
                leaveType: leave.leaveType,
                reason: leave.reason,
                totalDays: allocation.totalDays,
                paidDays: allocation.eligiblePaidDays,
                lopDays: allocation.proposedLopDays,
            },
        });

        return leave;
    }

    /**
     * Get paginated leaves for an employee or company admin with enhanced breakdown fields.
     */
    static async getLeaves(
        companyId: string,
        query: {
            employeeId?: string;
            status?: LeaveStatus | string;
            startDate?: string;
            endDate?: string;
            leaveType?: string;
            isLopProposed?: boolean | string;
            page?: number | string;
            limit?: number | string;
        }
    ) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
        };

        if (query.employeeId) {
            filter.employeeId = new Types.ObjectId(query.employeeId);
        }

        if (query.status) {
            filter.status = query.status;
        }

        if (query.leaveType) {
            filter.leaveType = query.leaveType;
        }

        if (query.isLopProposed !== undefined) {
            filter.isLopProposed = query.isLopProposed === true || query.isLopProposed === 'true';
        }

        if (query.startDate && query.endDate) {
            filter.startDate = { $lte: query.endDate };
            filter.endDate = { $gte: query.startDate };
        }

        const [leaves, total] = await Promise.all([
            LeaveRequest.find(filter)
                .sort({ appliedAt: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('employeeId', 'name email avatar status')
                .populate('approvedBy', 'name email')
                .populate('lopDecisionId')
                .lean(),
            LeaveRequest.countDocuments(filter),
        ]);

        return {
            leaves,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Admin/Manager approves leave, commits balances, synchronizes attendance, and dispatches approval email.
     */
    static async approveLeave(
        companyId: string,
        leaveId: string,
        approverId: string,
        dto?: ApproveLeaveWithBreakdownDto
    ) {
        const leave = await LeaveRequest.findOne({
            _id: new Types.ObjectId(leaveId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!leave) {
            throw AppError.notFound('Leave request not found.');
        }

        if (leave.status !== LeaveStatus.PENDING && leave.status !== LeaveStatus.CHANGES_REQUESTED) {
            throw AppError.badRequest(`Leave request is already ${leave.status.toLowerCase()}.`);
        }

        // Apply admin breakdown overrides if provided
        if (dto?.approvedPaidDays != null) {
            leave.paidDays = Math.max(0, dto.approvedPaidDays);
        }
        if (dto?.approvedUnpaidDays != null) {
            leave.unpaidDays = Math.max(0, dto.approvedUnpaidDays);
        }
        if (dto?.approvedLopDays != null) {
            leave.lopDays = Math.max(0, dto.approvedLopDays);
        }

        leave.status = LeaveStatus.APPROVED;
        leave.approvedBy = new Types.ObjectId(approverId);
        leave.approvedAt = new Date();

        if (!leave.decisionHistory) {
            leave.decisionHistory = [];
        }

        leave.decisionHistory.push({
            action: 'APPROVED',
            actorId: new Types.ObjectId(approverId),
            timestamp: new Date(),
            details: dto?.notes || `Approved leave with Paid: ${leave.paidDays}, Unpaid: ${leave.unpaidDays}, LOP: ${leave.lopDays}`,
            snapshot: { paidDays: leave.paidDays, unpaidDays: leave.unpaidDays, lopDays: leave.lopDays },
        });

        await leave.save();

        // Commit approved balance
        await LeaveBalanceService.commitApprovedBalance(
            companyId,
            leave.employeeId.toString(),
            leave.leaveType,
            (leave.monthBreakdown as any) || []
        );

        // Finalize or create LOP decision if applicable
        if (leave.lopDays && leave.lopDays > 0) {
            for (const monthItem of leave.monthBreakdown || []) {
                if (monthItem.proposedLopDays > 0) {
                    const lopDecision = await LopDecisionService.proposeLopDecision(
                        companyId,
                        leave.employeeId.toString(),
                        leave._id.toString(),
                        monthItem.month,
                        monthItem.proposedLopDays,
                        leave.startDate
                    );
                    if (lopDecision) {
                        await LopDecisionService.approveLopDecision(
                            companyId,
                            lopDecision._id.toString(),
                            approverId,
                            {
                                finalDeductionAmount: dto?.customDeductionAmount,
                                overrideReason: dto?.notes,
                            }
                        );
                    }
                }
            }
        }

        // Synchronize Attendance calendar records for each date in leave period
        const dates = TimezoneUtils.getDateRangeArray(leave.startDate, leave.endDate);
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);
        const policy = await LeaveCalculatorService.resolveActivePolicy(
            companyId,
            leave.leaveType,
            leave.startDate,
            leave.employeeId.toString()
        );

        for (const dateStr of dates) {
            const shiftResolution = await AttendanceCalculationService.resolveShiftSchedule(
                companyId,
                leave.employeeId.toString(),
                new Date(`${dateStr}T12:00:00Z`),
                timezone
            );
            const holiday = await AttendanceCalculationService.resolveHoliday(companyId, dateStr);
            const isWeekOff = AttendanceCalculationService.resolveWeekOff(dateStr, shiftResolution.shift);

            let attendanceStatus: AttendanceStatus;
            if (holiday && !policy.countHolidays) {
                attendanceStatus = AttendanceStatus.HOLIDAY;
            } else if (isWeekOff && !policy.countWeekends) {
                attendanceStatus = AttendanceStatus.WEEK_OFF;
            } else {
                attendanceStatus =
                    leave.durationType === LeaveDurationType.HALF_DAY
                        ? AttendanceStatus.HALF_DAY
                        : AttendanceStatus.LEAVE;
            }

            await Attendance.findOneAndUpdate(
                {
                    companyId: leave.companyId,
                    employeeId: leave.employeeId,
                    date: dateStr,
                },
                {
                    $set: {
                        status: attendanceStatus,
                        shiftId: shiftResolution.shiftId,
                        scheduled: {
                            startTime: shiftResolution.scheduledStartTime,
                            endTime: shiftResolution.scheduledEndTime,
                            workingMinutes: shiftResolution.scheduledWorkingMinutes,
                        },
                        leave: {
                            leaveId: leave._id,
                            leaveType: leave.leaveType,
                            durationType: leave.durationType,
                        },
                        holiday: holiday
                            ? { holidayId: holiday._id, holidayName: holiday.name }
                            : { holidayId: null, holidayName: null },
                        source: 'LEAVE',
                        isFinalized: true,
                    },
                    $setOnInsert: {
                        actual: { firstCheckIn: null, lastCheckOut: null, workedMinutes: 0 },
                        metrics: { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
                    },
                },
                { upsert: true, new: true }
            );
        }

        // Audit Log
        AuditLogService.log({
            action: AuditAction.LEAVE_APPROVED,
            actorId: approverId,
            targetUserId: leave.employeeId.toString(),
            companyId,
            metadata: {
                leaveId: leave._id.toString(),
                startDate: leave.startDate,
                endDate: leave.endDate,
                leaveType: leave.leaveType,
                paidDays: leave.paidDays,
                unpaidDays: leave.unpaidDays,
                lopDays: leave.lopDays,
            },
            description: `Approved leave request for ${leave.startDate} to ${leave.endDate}`,
        });

        // Notification to employee
        NotificationEventBus.getInstance().publish({
            type: 'LEAVE_APPROVED',
            companyId,
            actorId: approverId,
            recipientIds: [leave.employeeId.toString()],
            entityId: leave._id.toString(),
            entityType: 'LEAVE',
            metadata: {
                startDate: leave.startDate,
                endDate: leave.endDate,
                leaveType: leave.leaveType,
                paidDays: leave.paidDays,
                unpaidDays: leave.unpaidDays,
                lopDays: leave.lopDays,
            },
        });

        // Trigger leave approval email asynchronously (reliable delivery)
        setImmediate(async () => {
            await LeaveEmailService.sendLeaveApprovalEmail(leave._id.toString());
        });

        return leave;
    }

    /**
     * Admin/Manager rejects leave request and releases reserved balances.
     */
    static async rejectLeave(
        companyId: string,
        leaveId: string,
        approverId: string,
        reason?: string
    ) {
        const leave = await LeaveRequest.findOne({
            _id: new Types.ObjectId(leaveId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!leave) {
            throw AppError.notFound('Leave request not found.');
        }

        if (leave.status !== LeaveStatus.PENDING && leave.status !== LeaveStatus.CHANGES_REQUESTED) {
            throw AppError.badRequest(`Leave request is already ${leave.status.toLowerCase()}.`);
        }

        leave.status = LeaveStatus.REJECTED;
        leave.approvedBy = new Types.ObjectId(approverId);
        leave.approvedAt = new Date();
        leave.rejectionReason = reason?.trim() || 'Leave request declined by administrator.';

        if (!leave.decisionHistory) {
            leave.decisionHistory = [];
        }

        leave.decisionHistory.push({
            action: 'REJECTED',
            actorId: new Types.ObjectId(approverId),
            timestamp: new Date(),
            details: leave.rejectionReason,
        });

        await leave.save();

        // Release reserved pending balance
        await LeaveBalanceService.releasePendingBalance(
            companyId,
            leave.employeeId.toString(),
            leave.leaveType,
            (leave.monthBreakdown as any) || []
        );

        // Reject associated proposed LOP decision if present
        if (leave.lopDecisionId) {
            await LopDecisionService.rejectLopDecision(
                companyId,
                leave.lopDecisionId.toString(),
                approverId,
                leave.rejectionReason
            ).catch(() => {});
        }

        // Audit Log
        AuditLogService.log({
            action: AuditAction.LEAVE_REJECTED,
            actorId: approverId,
            targetUserId: leave.employeeId.toString(),
            companyId,
            metadata: {
                leaveId: leave._id.toString(),
                startDate: leave.startDate,
                endDate: leave.endDate,
                reason: leave.rejectionReason,
            },
            description: `Rejected leave request for ${leave.startDate} to ${leave.endDate}`,
        });

        // Notification to employee
        NotificationEventBus.getInstance().publish({
            type: 'LEAVE_REJECTED',
            companyId,
            actorId: approverId,
            recipientIds: [leave.employeeId.toString()],
            entityId: leave._id.toString(),
            entityType: 'LEAVE',
            metadata: {
                startDate: leave.startDate,
                endDate: leave.endDate,
                reason: leave.rejectionReason,
            },
        });

        return leave;
    }

    /**
     * Employee or Admin cancels a leave request (pending, changes_requested, or approved) and releases balances.
     */
    static async cancelLeave(
        companyId: string,
        leaveId: string,
        employeeId: string,
        reason?: string
    ) {
        const leave = await LeaveRequest.findOne({
            _id: new Types.ObjectId(leaveId),
            companyId: new Types.ObjectId(companyId),
            employeeId: new Types.ObjectId(employeeId),
        });

        if (!leave) {
            throw AppError.notFound('Leave request not found.');
        }

        const wasApproved = leave.status === LeaveStatus.APPROVED;
        if (
            leave.status !== LeaveStatus.PENDING &&
            leave.status !== LeaveStatus.CHANGES_REQUESTED &&
            !wasApproved
        ) {
            throw AppError.badRequest(`Cannot cancel a leave request that is already ${leave.status.toLowerCase()}.`);
        }

        leave.status = LeaveStatus.CANCELLED;
        leave.rejectionReason = reason?.trim() || 'Cancelled by employee.';

        if (!leave.decisionHistory) {
            leave.decisionHistory = [];
        }

        leave.decisionHistory.push({
            action: 'CANCELLED',
            actorId: new Types.ObjectId(employeeId),
            timestamp: new Date(),
            details: leave.rejectionReason,
        });

        await leave.save();

        if (wasApproved) {
            // Release consumed approved balance
            await LeaveBalanceService.releaseApprovedBalance(
                companyId,
                employeeId,
                leave.leaveType,
                (leave.monthBreakdown as any) || []
            );

            // Revert attendance records that were marked as LEAVE
            const dates = TimezoneUtils.getDateRangeArray(leave.startDate, leave.endDate);
            const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

            for (const dateStr of dates) {
                const existingAtt = await Attendance.findOne({
                    companyId: leave.companyId,
                    employeeId: leave.employeeId,
                    date: dateStr,
                });

                if (existingAtt) {
                    const shiftRes = await AttendanceCalculationService.resolveShiftSchedule(
                        companyId,
                        employeeId,
                        new Date(`${dateStr}T12:00:00Z`),
                        timezone
                    );
                    const holiday = await AttendanceCalculationService.resolveHoliday(companyId, dateStr);
                    const isWeekOff = AttendanceCalculationService.resolveWeekOff(dateStr, shiftRes.shift);

                    const revertedStatus = AttendanceCalculationService.calculateAttendanceStatus({
                        hasCheckIn: Boolean(existingAtt.actual?.firstCheckIn),
                        hasCheckOut: Boolean(existingAtt.actual?.lastCheckOut),
                        workedMinutes: existingAtt.actual?.workedMinutes || 0,
                        scheduledWorkingMinutes: shiftRes.scheduledWorkingMinutes,
                        halfDayThresholdMinutes: (shiftRes.shift as any)?.halfDayThresholdMinutes || 240,
                        leave: null,
                        holiday,
                        isWeekOff,
                        isShiftConcluded: existingAtt.isFinalized,
                    });

                    existingAtt.status = revertedStatus;
                    existingAtt.leave = {
                        leaveId: null as any,
                        leaveType: null as any,
                        durationType: null as any,
                    };
                    await existingAtt.save();
                }
            }
        } else {
            // Release reserved pending balance
            await LeaveBalanceService.releasePendingBalance(
                companyId,
                employeeId,
                leave.leaveType,
                (leave.monthBreakdown as any) || []
            );
        }

        if (leave.lopDecisionId) {
            await LopDecision.findByIdAndUpdate(leave.lopDecisionId, {
                $set: { status: 'CANCELLED', rejectionReason: 'Leave cancelled by employee' },
            }).catch(() => {});
        }

        return leave;
    }

    /**
     * Admin requests revision / changes for a pending leave request.
     */
    static async requestRevision(
        companyId: string,
        leaveId: string,
        actorId: string,
        dto: RequestLeaveRevisionDto
    ) {
        const leave = await LeaveRequest.findOne({
            _id: new Types.ObjectId(leaveId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!leave) {
            throw AppError.notFound('Leave request not found.');
        }

        if (leave.status !== LeaveStatus.PENDING) {
            throw AppError.badRequest('Can only request revision for pending leave requests.');
        }

        leave.status = LeaveStatus.CHANGES_REQUESTED;

        if (!leave.revisionRequests) {
            leave.revisionRequests = [];
        }
        leave.revisionRequests.push({
            requestedBy: new Types.ObjectId(actorId),
            notes: dto.notes.trim(),
            requestedAt: new Date(),
            status: 'PENDING',
        });

        if (!leave.decisionHistory) {
            leave.decisionHistory = [];
        }
        leave.decisionHistory.push({
            action: 'REVISION_REQUESTED',
            actorId: new Types.ObjectId(actorId),
            timestamp: new Date(),
            details: dto.notes.trim(),
        });

        await leave.save();

        // Audit Log
        AuditLogService.log({
            action: AuditAction.COMPANY_SETTINGS_UPDATED,
            actorId,
            targetUserId: leave.employeeId.toString(),
            companyId,
            metadata: { leaveId: leave._id.toString(), notes: dto.notes },
            description: `Requested revision on leave request (${leave.startDate} - ${leave.endDate})`,
        });

        // Notification to employee
        NotificationEventBus.getInstance().publish({
            type: 'LEAVE_REVISION_REQUESTED',
            companyId,
            actorId,
            recipientIds: [leave.employeeId.toString()],
            entityId: leave._id.toString(),
            entityType: 'LEAVE',
            metadata: {
                startDate: leave.startDate,
                endDate: leave.endDate,
                notes: dto.notes,
            },
        });

        return leave;
    }
}
export default LeaveService;
