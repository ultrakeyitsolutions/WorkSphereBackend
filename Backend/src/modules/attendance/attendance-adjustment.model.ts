import { Schema, model } from 'mongoose';
import {
    IAttendanceAdjustmentDocument,
    AdjustmentStatus,
    AttendanceStatus,
} from './attendance.types';

const attendanceAdjustmentSchema = new Schema<IAttendanceAdjustmentDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        employeeId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        attendanceId: {
            type: Schema.Types.ObjectId,
            ref: 'Attendance',
            required: true,
            index: true,
        },
        date: {
            type: String,
            required: true,
            trim: true,
            match: /^\d{4}-\d{2}-\d{2}$/, // "YYYY-MM-DD"
            index: true,
        },
        oldValues: {
            status: {
                type: String,
                enum: Object.values(AttendanceStatus),
                required: true,
            },
            firstCheckIn: { type: Date, default: null },
            lastCheckOut: { type: Date, default: null },
            workedMinutes: { type: Number, default: 0 },
        },
        requestedValues: {
            status: {
                type: String,
                enum: Object.values(AttendanceStatus),
            },
            firstCheckIn: { type: Date, default: null },
            lastCheckOut: { type: Date, default: null },
            workedMinutes: { type: Number, default: 0 },
        },
        reason: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000,
        },
        requestedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(AdjustmentStatus),
            default: AdjustmentStatus.PENDING,
            index: true,
        },
        approvedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        approvedAt: {
            type: Date,
            default: null,
        },
        rejectionReason: {
            type: String,
            trim: true,
            maxlength: 500,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes for fast lookup of pending adjustment requests
attendanceAdjustmentSchema.index({ companyId: 1, status: 1, createdAt: -1 });
attendanceAdjustmentSchema.index({ companyId: 1, employeeId: 1, status: 1 });
attendanceAdjustmentSchema.index({ attendanceId: 1, status: 1 });

export const AttendanceAdjustment = model<IAttendanceAdjustmentDocument>(
    'AttendanceAdjustment',
    attendanceAdjustmentSchema
);
export default AttendanceAdjustment;
