import { Schema, model, Document, Types } from 'mongoose';

export enum AttendanceStatus {
    CHECKED_IN = 'CHECKED_IN',
    CHECKED_OUT = 'CHECKED_OUT'
}

export interface IAttendance extends Document {
    companyId: Types.ObjectId;
    userId: Types.ObjectId;
    status: AttendanceStatus;
    checkInTime: Date;
    checkOutTime?: Date;
    shiftId?: Types.ObjectId;
    attendanceDate?: string;
    scheduledStartTime?: Date;
    scheduledEndTime?: Date;
    lateMinutes?: number;
    earlyDepartureMinutes?: number;
    workDurationMinutes?: number;
    overtimeMinutes?: number;
    punchStatus?: 'ON_TIME' | 'LATE' | 'HALF_DAY';
    checkoutStatus?: 'ON_TIME' | 'EARLY_OUT' | 'OVERTIME';
    isOvernight?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        status: { type: String, enum: Object.values(AttendanceStatus), default: AttendanceStatus.CHECKED_IN },
        checkInTime: { type: Date, required: true },
        checkOutTime: { type: Date },
        shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', default: null, index: true },
        attendanceDate: { type: String, default: null, index: true }, // "YYYY-MM-DD"
        scheduledStartTime: { type: Date, default: null },
        scheduledEndTime: { type: Date, default: null },
        lateMinutes: { type: Number, default: 0 },
        earlyDepartureMinutes: { type: Number, default: 0 },
        workDurationMinutes: { type: Number, default: 0 },
        overtimeMinutes: { type: Number, default: 0 },
        punchStatus: { type: String, enum: ['ON_TIME', 'LATE', 'HALF_DAY'], default: 'ON_TIME' },
        checkoutStatus: { type: String, enum: ['ON_TIME', 'EARLY_OUT', 'OVERTIME'], default: 'ON_TIME' },
        isOvernight: { type: Boolean, default: false },
    },
    { timestamps: true }
);

// Optimize for fetching active check-ins & performance analytics
attendanceSchema.index({ userId: 1, status: 1 });
attendanceSchema.index({ companyId: 1, userId: 1, checkInTime: 1 });
attendanceSchema.index({ companyId: 1, attendanceDate: 1, userId: 1 });
attendanceSchema.index({ companyId: 1, shiftId: 1, checkInTime: 1 });

export const Attendance = model<IAttendance>('Attendance', attendanceSchema);
export default Attendance;
