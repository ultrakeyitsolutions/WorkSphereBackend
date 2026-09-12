import { AppError } from '../../utils/AppError';
import { Attendance, AttendanceStatus, IAttendance } from './attendance.model';

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

        const newSession = await Attendance.create({
            companyId,
            userId,
            status: AttendanceStatus.CHECKED_IN,
            checkInTime: new Date()
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

        activeSession.status = AttendanceStatus.CHECKED_OUT;
        activeSession.checkOutTime = new Date();
        await activeSession.save();

        return activeSession;
    }

    static async getCurrentStatus(companyId: string, userId: string): Promise<IAttendance | null> {
        return await Attendance.findOne({
            companyId,
            userId,
            status: AttendanceStatus.CHECKED_IN
        }).lean();
    }
}
