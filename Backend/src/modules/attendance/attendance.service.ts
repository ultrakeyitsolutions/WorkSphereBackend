import { AppError } from '../../utils/AppError';
import { Attendance, AttendanceStatus, IAttendance } from './attendance.model';
import { NotificationEventBus } from '../notifications/notification.event-bus';
import { AttendanceEvaluationService } from '../shifts/attendance-evaluation.service';

export class AttendanceService {
    
    static async checkIn(companyId: string, userId: string): Promise<IAttendance> {
        const activeSession = await Attendance.findOne({
            companyId,
            userId,
            status: AttendanceStatus.CHECKED_IN
        }).lean();

        if (activeSession) {
            return activeSession as IAttendance;
        }

        const checkInTime = new Date();

        // Evaluate shift and punctuality
        const evaluation = await AttendanceEvaluationService.evaluateCheckIn(
            companyId,
            userId,
            checkInTime
        );

        const newSession = await Attendance.create({
            companyId,
            userId,
            status: AttendanceStatus.CHECKED_IN,
            checkInTime,
            shiftId: evaluation.shiftId,
            attendanceDate: evaluation.attendanceDate,
            scheduledStartTime: evaluation.scheduledStartTime,
            scheduledEndTime: evaluation.scheduledEndTime,
            lateMinutes: evaluation.lateMinutes,
            punchStatus: evaluation.punchStatus,
            isOvernight: evaluation.isOvernight,
        });

        // Fire-and-forget notification event dispatch
        NotificationEventBus.getInstance().publish({
            type: 'CHECK_IN',
            companyId,
            actorId: userId,
            entityId: newSession._id.toString(),
            entityType: 'ATTENDANCE',
            metadata: {
                punchStatus: evaluation.punchStatus,
                lateMinutes: evaluation.lateMinutes,
                attendanceDate: evaluation.attendanceDate,
            },
        });

        return newSession;
    }

    static async checkOut(companyId: string, userId: string): Promise<IAttendance> {
        const activeSession = await Attendance.findOne({
            companyId,
            userId,
            status: AttendanceStatus.CHECKED_IN
        });

        if (!activeSession) {
            throw AppError.conflict('NO_ACTIVE_CHECKIN');
        }

        const checkOutTime = new Date();
        activeSession.status = AttendanceStatus.CHECKED_OUT;
        activeSession.checkOutTime = checkOutTime;

        // Evaluate checkout against scheduled end time
        if (activeSession.scheduledEndTime && activeSession.checkInTime) {
            const checkoutEval = AttendanceEvaluationService.evaluateCheckOut(
                activeSession.checkInTime,
                checkOutTime,
                activeSession.scheduledEndTime
            );

            activeSession.checkoutStatus = checkoutEval.checkoutStatus;
            activeSession.earlyDepartureMinutes = checkoutEval.earlyDepartureMinutes;
            activeSession.overtimeMinutes = checkoutEval.overtimeMinutes;
            activeSession.workDurationMinutes = checkoutEval.workDurationMinutes;
        } else if (activeSession.checkInTime) {
            activeSession.workDurationMinutes = Math.max(
                0,
                Math.round((checkOutTime.getTime() - activeSession.checkInTime.getTime()) / (60 * 1000))
            );
        }

        await activeSession.save();

        // Fire-and-forget notification event dispatch
        NotificationEventBus.getInstance().publish({
            type: 'CHECK_OUT',
            companyId,
            actorId: userId,
            entityId: activeSession._id.toString(),
            entityType: 'ATTENDANCE',
            metadata: {
                workDurationMinutes: activeSession.workDurationMinutes,
                checkoutStatus: activeSession.checkoutStatus,
                overtimeMinutes: activeSession.overtimeMinutes,
            },
        });

        return activeSession;
    }

    static async getCurrentStatus(companyId: string, userId: string): Promise<IAttendance | null> {
        return await Attendance.findOne({
            companyId,
            userId,
            status: AttendanceStatus.CHECKED_IN
        })
            .populate('shiftId', 'name code startTime endTime crossesMidnight')
            .lean();
    }
}
