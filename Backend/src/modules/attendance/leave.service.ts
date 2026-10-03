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

export class LeaveService {
    /**
     * Employee submits a leave request.
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

        // Check for overlapping pending or approved leave requests
        const overlapping = await LeaveRequest.findOne({
            companyId: companyObjId,
            employeeId: employeeObjId,
            status: { $in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
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

        const dateList = TimezoneUtils.getDateRangeArray(dto.startDate, dto.endDate);
        const totalDays = dto.durationType === LeaveDurationType.HALF_DAY ? 0.5 : dateList.length;

        const leave = await LeaveRequest.create({
            companyId: companyObjId,
            employeeId: employeeObjId,
            leaveType: dto.leaveType,
            durationType: dto.durationType || LeaveDurationType.FULL_DAY,
            halfDayPeriod: dto.halfDayPeriod || null,
            startDate: dto.startDate,
            endDate: dto.endDate,
            totalDays,
            reason: dto.reason.trim(),
            status: LeaveStatus.PENDING,
            appliedAt: new Date(),
        });

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
                totalDays,
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
            },
        });

        return leave;
    }

    /**
     * Get paginated leaves for an employee or company admin.
     */
    static async getLeaves(
        companyId: string,
        query: {
            employeeId?: string;
            status?: LeaveStatus | string;
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
     * Admin/Manager approves leave and automatically synchronizes Attendance records.
     */
    static async approveLeave(
        companyId: string,
        leaveId: string,
        approverId: string
    ) {
        const leave = await LeaveRequest.findOne({
            _id: new Types.ObjectId(leaveId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!leave) {
            throw AppError.notFound('Leave request not found.');
        }

        if (leave.status !== LeaveStatus.PENDING) {
            throw AppError.badRequest(`Leave request is already ${leave.status.toLowerCase()}.`);
        }

        leave.status = LeaveStatus.APPROVED;
        leave.approvedBy = new Types.ObjectId(approverId);
        leave.approvedAt = new Date();
        await leave.save();

        // Synchronize Attendance calendar records for each date in leave period
        const dates = TimezoneUtils.getDateRangeArray(leave.startDate, leave.endDate);
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

        for (const dateStr of dates) {
            const shiftResolution = await AttendanceCalculationService.resolveShiftSchedule(
                companyId,
                leave.employeeId.toString(),
                new Date(`${dateStr}T12:00:00Z`),
                timezone
            );

            const attendanceStatus =
                leave.durationType === LeaveDurationType.HALF_DAY
                    ? AttendanceStatus.HALF_DAY
                    : AttendanceStatus.LEAVE;

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
            },
        });

        return leave;
    }

    /**
     * Admin/Manager rejects leave request.
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

        if (leave.status !== LeaveStatus.PENDING) {
            throw AppError.badRequest(`Leave request is already ${leave.status.toLowerCase()}.`);
        }

        leave.status = LeaveStatus.REJECTED;
        leave.approvedBy = new Types.ObjectId(approverId);
        leave.approvedAt = new Date();
        leave.rejectionReason = reason?.trim() || 'Leave request declined by administrator.';
        await leave.save();

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
}
