import { Schema, model } from 'mongoose';
import { IAttendanceEventDocument, AttendanceEventType } from './attendance.types';

const attendanceEventSchema = new Schema<IAttendanceEventDocument>(
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
        type: {
            type: String,
            enum: Object.values(AttendanceEventType),
            required: true,
            index: true,
        },
        timestamp: {
            type: Date,
            required: true,
            default: Date.now,
            index: true,
        },
        source: {
            type: String,
            default: 'WEB',
            trim: true,
        },
        deviceId: {
            type: String,
            trim: true,
            default: null,
        },
        ipAddress: {
            type: String,
            trim: true,
            default: null,
        },
        location: {
            latitude: { type: Number, default: null },
            longitude: { type: Number, default: null },
            accuracy: { type: Number, default: null },
            address: { type: String, trim: true, default: null },
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

// Indexes for chronological event timeline lookups and audit queries
attendanceEventSchema.index({ attendanceId: 1, type: 1, timestamp: 1 });
attendanceEventSchema.index({ companyId: 1, employeeId: 1, timestamp: -1 });
attendanceEventSchema.index({ companyId: 1, timestamp: -1 });

export const AttendanceEvent = model<IAttendanceEventDocument>(
    'AttendanceEvent',
    attendanceEventSchema
);
export default AttendanceEvent;
