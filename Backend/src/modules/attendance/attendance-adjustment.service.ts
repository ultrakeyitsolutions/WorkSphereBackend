import { Types } from 'mongoose';
import { AttendanceAdjustment } from './attendance-adjustment.model';
import { Attendance } from './attendance.model';
import {
    RequestAdjustmentDto,
    AdjustmentStatus,
    AttendanceStatus,
} from './attendance.types';
import { AppError } from '../../utils/AppError';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { NotificationEventBus } from '../notifications/notification.event-bus';
import { AttendanceCalculationService } from './attendance-calculation.service';
import { TimezoneUtils } from './utils/timezone.utils';

export class AttendanceAdjustmentService {
    /**
     * Employee submits an attendance correction / adjustment request.
     */
    static async requestAdjustment(
        companyId: string,
        employeeId: string,
        dto: RequestAdjustmentDto
    ) {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const attendanceObjId = new Types.ObjectId(dto.attendanceId);

        // Verify Attendance record exists and belongs to employee
        const attendance = await Attendance.findOne({
            _id: attendanceObjId,
            companyId: companyObjId,
            employeeId: employeeObjId,
        });

        if (!attendance) {
            throw AppError.notFound('Attendance record not found for this date.');
        }

        // Check if pending adjustment already exists for this attendance record
        const existingPending = await AttendanceAdjustment.findOne({
            attendanceId: attendanceObjId,
            status: AdjustmentStatus.PENDING,
        });

        if (existingPending) {
            throw AppError.conflict('An active adjustment request is already pending review for this attendance record.');
        }

        const firstCheckIn = dto.firstCheckIn ? new Date(dto.firstCheckIn) : attendance.actual?.firstCheckIn || null;
        const lastCheckOut = dto.lastCheckOut ? new Date(dto.lastCheckOut) : attendance.actual?.lastCheckOut || null;

        let workedMinutes = attendance.actual?.workedMinutes || 0;
        if (firstCheckIn && lastCheckOut) {
            workedMinutes = AttendanceCalculationService.calculateWorkedMinutes(firstCheckIn, lastCheckOut, 0);
        }

        const adjustment = await AttendanceAdjustment.create({
            companyId: companyObjId,
            employeeId: employeeObjId,
            attendanceId: attendanceObjId,
            date: attendance.date,
            oldValues: {
                status: attendance.status,
                firstCheckIn: attendance.actual?.firstCheckIn || null,
                lastCheckOut: attendance.actual?.lastCheckOut || null,
                workedMinutes: attendance.actual?.workedMinutes || 0,
            },
            requestedValues: {
                status: dto.status || attendance.status,
                firstCheckIn,
                lastCheckOut,
                workedMinutes,
            },
            reason: dto.reason.trim(),
            requestedBy: employeeObjId,
            status: AdjustmentStatus.PENDING,
        });

        // Audit Log
        AuditLogService.log({
            action: AuditAction.ATTENDANCE_ADJUSTMENT_REQUESTED,
            actorId: employeeId,
            companyId,
            metadata: {
                adjustmentId: adjustment._id.toString(),
                attendanceId: dto.attendanceId,
                date: attendance.date,
                reason: dto.reason,
            },
            description: `Requested attendance adjustment for ${attendance.date}`,
        });

        // Notification
        NotificationEventBus.getInstance().publish({
            type: 'ATTENDANCE_ADJUSTMENT_REQUESTED',
            companyId,
            actorId: employeeId,
            entityId: adjustment._id.toString(),
            entityType: 'ATTENDANCE_ADJUSTMENT',
            metadata: {
                date: attendance.date,
                reason: dto.reason,
            },
        });

        return adjustment;
    }

    /**
     * List adjustments for an employee or company admin.
     */
    static async getAdjustments(
        companyId: string,
        query: {
            employeeId?: string;
            status?: AdjustmentStatus | string;
            startDate?: string;
            endDate?: string;
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

        if (query.startDate && query.endDate) {
            filter.date = { $gte: query.startDate, $lte: query.endDate };
        }

        const [adjustments, total] = await Promise.all([
            AttendanceAdjustment.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('employeeId', 'name email avatar status')
                .populate('requestedBy', 'name email')
                .populate('approvedBy', 'name email')
                .populate('attendanceId')
                .lean(),
            AttendanceAdjustment.countDocuments(filter),
        ]);

        return {
            adjustments,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Admin/Manager approves attendance adjustment.
     * Recalculates metrics and updates attendance record while maintaining full auditability.
     */
    static async approveAdjustment(
        companyId: string,
        adjustmentId: string,
        approverId: string
    ) {
        const adjustment = await AttendanceAdjustment.findOne({
            _id: new Types.ObjectId(adjustmentId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!adjustment) {
            throw AppError.notFound('Adjustment request not found.');
        }

        if (adjustment.status !== AdjustmentStatus.PENDING) {
            throw AppError.badRequest(`Adjustment is already ${adjustment.status.toLowerCase()}.`);
        }

        const attendance = await Attendance.findOne({
            _id: adjustment.attendanceId,
            companyId: new Types.ObjectId(companyId),
        });

        if (!attendance) {
            throw AppError.notFound('Corresponding attendance record was not found.');
        }

        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

        // Resolve shift schedule for this date
        const shiftResolution = await AttendanceCalculationService.resolveShiftSchedule(
            companyId,
            adjustment.employeeId.toString(),
            attendance.scheduled?.startTime || new Date(`${attendance.date}T12:00:00Z`),
            timezone
        );

        const newFirstCheckIn = adjustment.requestedValues.firstCheckIn || attendance.actual?.firstCheckIn || null;
        const newLastCheckOut = adjustment.requestedValues.lastCheckOut || attendance.actual?.lastCheckOut || null;

        // Recalculate metrics
        let lateMinutes = 0;
        let punchStatus: any = 'ON_TIME';
        if (newFirstCheckIn && shiftResolution.scheduledStartTime) {
            const lateEval = AttendanceCalculationService.calculateLateMinutes(
                newFirstCheckIn,
                shiftResolution.scheduledStartTime,
                shiftResolution.gracePeriodMinutes
            );
            lateMinutes = lateEval.lateMinutes;
            punchStatus = lateEval.punchStatus;
        }

        let earlyLeaveMinutes = 0;
        let overtimeMinutes = 0;
        let checkoutStatus: 'ON_TIME' | 'EARLY_OUT' | 'OVERTIME' = 'ON_TIME';
        if (newLastCheckOut && shiftResolution.scheduledEndTime) {
            const checkoutEval = AttendanceCalculationService.calculateEarlyLeaveAndOvertime(
                newLastCheckOut,
                shiftResolution.scheduledEndTime,
                shiftResolution.earlyCheckoutGraceMinutes
            );
            earlyLeaveMinutes = checkoutEval.earlyLeaveMinutes;
            overtimeMinutes = checkoutEval.overtimeMinutes;
            checkoutStatus = checkoutEval.checkoutStatus;
        }

        const workedMinutes = AttendanceCalculationService.calculateWorkedMinutes(
            newFirstCheckIn,
            newLastCheckOut,
            0
        );

        // Apply new values to Attendance record
        attendance.actual = {
            firstCheckIn: newFirstCheckIn,
            lastCheckOut: newLastCheckOut,
            workedMinutes,
        };

        attendance.metrics = {
            lateMinutes,
            earlyLeaveMinutes,
            overtimeMinutes,
        };

        attendance.punchStatus = punchStatus;
        attendance.checkoutStatus = checkoutStatus;
        attendance.status = (adjustment.requestedValues.status as AttendanceStatus) || AttendanceStatus.PRESENT;
        attendance.source = 'ADJUSTMENT';
        attendance.isFinalized = true;

        await attendance.save();

        // Update adjustment document
        adjustment.status = AdjustmentStatus.APPROVED;
        adjustment.approvedBy = new Types.ObjectId(approverId);
        adjustment.approvedAt = new Date();
        await adjustment.save();

        // Audit Log with complete diff
        AuditLogService.log({
            action: AuditAction.ATTENDANCE_ADJUSTMENT_APPROVED,
            actorId: approverId,
            targetUserId: adjustment.employeeId.toString(),
            companyId,
            metadata: {
                adjustmentId: adjustment._id.toString(),
                attendanceId: attendance._id.toString(),
                date: attendance.date,
                oldValues: adjustment.oldValues,
                newValues: {
                    status: attendance.status,
                    firstCheckIn: newFirstCheckIn,
                    lastCheckOut: newLastCheckOut,
                    workedMinutes,
                },
            },
            description: `Approved attendance adjustment for date ${attendance.date}`,
        });

        // Notification to employee
        NotificationEventBus.getInstance().publish({
            type: 'ATTENDANCE_ADJUSTMENT_APPROVED',
            companyId,
            actorId: approverId,
            recipientIds: [adjustment.employeeId.toString()],
            entityId: adjustment._id.toString(),
            entityType: 'ATTENDANCE_ADJUSTMENT',
            metadata: {
                date: attendance.date,
            },
        });

        return { adjustment, attendance };
    }

    /**
     * Admin/Manager rejects attendance adjustment.
     */
    static async rejectAdjustment(
        companyId: string,
        adjustmentId: string,
        approverId: string,
        reason?: string
    ) {
        const adjustment = await AttendanceAdjustment.findOne({
            _id: new Types.ObjectId(adjustmentId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!adjustment) {
            throw AppError.notFound('Adjustment request not found.');
        }

        if (adjustment.status !== AdjustmentStatus.PENDING) {
            throw AppError.badRequest(`Adjustment is already ${adjustment.status.toLowerCase()}.`);
        }

        adjustment.status = AdjustmentStatus.REJECTED;
        adjustment.approvedBy = new Types.ObjectId(approverId);
        adjustment.approvedAt = new Date();
        adjustment.rejectionReason = reason?.trim() || 'Adjustment request declined by administrator.';
        await adjustment.save();

        // Audit Log
        AuditLogService.log({
            action: AuditAction.ATTENDANCE_ADJUSTMENT_REJECTED,
            actorId: approverId,
            targetUserId: adjustment.employeeId.toString(),
            companyId,
            metadata: {
                adjustmentId: adjustment._id.toString(),
                attendanceId: adjustment.attendanceId.toString(),
                date: adjustment.date,
                reason: adjustment.rejectionReason,
            },
            description: `Rejected attendance adjustment for ${adjustment.date}`,
        });

        // Notification to employee
        NotificationEventBus.getInstance().publish({
            type: 'ATTENDANCE_ADJUSTMENT_REJECTED',
            companyId,
            actorId: approverId,
            recipientIds: [adjustment.employeeId.toString()],
            entityId: adjustment._id.toString(),
            entityType: 'ATTENDANCE_ADJUSTMENT',
            metadata: {
                date: adjustment.date,
                reason: adjustment.rejectionReason,
            },
        });

        return adjustment;
    }
}
