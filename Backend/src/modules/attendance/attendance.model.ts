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
    createdAt: Date;
    updatedAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        status: { type: String, enum: Object.values(AttendanceStatus), default: AttendanceStatus.CHECKED_IN },
        checkInTime: { type: Date, required: true },
        checkOutTime: { type: Date }
    },
    { timestamps: true }
);

// Optimize for fetching active check-ins & performance analytics
attendanceSchema.index({ userId: 1, status: 1 });
attendanceSchema.index({ companyId: 1, userId: 1, checkInTime: 1 });

export const Attendance = model<IAttendance>('Attendance', attendanceSchema);
export default Attendance;
