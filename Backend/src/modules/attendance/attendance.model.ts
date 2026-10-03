import { Schema, model, Types } from 'mongoose';
import {
    IAttendanceDocument,
    AttendanceStatus,
    PunchStatus,
    CheckoutStatus,
} from './attendance.types';

export { AttendanceStatus } from './attendance.types';
export type { IAttendanceDocument as IAttendance } from './attendance.types';

const attendanceSchema = new Schema<IAttendanceDocument>(
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
        date: {
            type: String,
            required: true,
            trim: true,
            match: /^\d{4}-\d{2}-\d{2}$/, // "YYYY-MM-DD"
            index: true,
        },
        status: {
            type: String,
            enum: Object.values(AttendanceStatus),
            default: AttendanceStatus.PENDING,
            required: true,
            index: true,
        },
        shiftId: {
            type: Schema.Types.ObjectId,
            ref: 'Shift',
            default: null,
            index: true,
        },
        scheduled: {
            startTime: { type: Date, default: null },
            endTime: { type: Date, default: null },
            workingMinutes: { type: Number, default: 480 },
        },
        actual: {
            firstCheckIn: { type: Date, default: null },
            lastCheckOut: { type: Date, default: null },
            workedMinutes: { type: Number, default: 0 },
        },
        metrics: {
            lateMinutes: { type: Number, default: 0 },
            earlyLeaveMinutes: { type: Number, default: 0 },
            overtimeMinutes: { type: Number, default: 0 },
        },
        leave: {
            leaveId: { type: Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },
            leaveType: { type: String, default: null },
            durationType: { type: String, default: null },
        },
        holiday: {
            holidayId: { type: Schema.Types.ObjectId, ref: 'Holiday', default: null },
            holidayName: { type: String, default: null },
        },
        source: {
            type: String,
            default: 'WEB',
            trim: true,
        },
        punchStatus: {
            type: String,
            enum: ['ON_TIME', 'LATE', 'HALF_DAY'],
            default: 'ON_TIME',
        },
        checkoutStatus: {
            type: String,
            enum: ['ON_TIME', 'EARLY_OUT', 'OVERTIME'],
            default: 'ON_TIME',
        },
        isOvernight: {
            type: Boolean,
            default: false,
        },
        isFinalized: {
            type: Boolean,
            default: false,
            index: true,
        },
        notes: {
            type: String,
            trim: true,
            default: '',
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// ─── Backwards-Compatible Virtuals & Aliases ──────────────────────────────────
attendanceSchema.virtual('userId')
    .get(function () {
        return this.employeeId;
    })
    .set(function (val: Types.ObjectId) {
        this.employeeId = val;
    });

attendanceSchema.virtual('checkInTime')
    .get(function () {
        return this.actual?.firstCheckIn || null;
    })
    .set(function (val: Date) {
        if (!this.actual) {
            this.actual = { firstCheckIn: val, lastCheckOut: null, workedMinutes: 0 };
        } else {
            this.actual.firstCheckIn = val;
        }
    });

attendanceSchema.virtual('checkOutTime')
    .get(function () {
        return this.actual?.lastCheckOut || null;
    })
    .set(function (val: Date) {
        if (!this.actual) {
            this.actual = { firstCheckIn: null, lastCheckOut: val, workedMinutes: 0 };
        } else {
            this.actual.lastCheckOut = val;
        }
    });

attendanceSchema.virtual('attendanceDate')
    .get(function () {
        return this.date;
    })
    .set(function (val: string) {
        this.date = val;
    });

attendanceSchema.virtual('workDurationMinutes')
    .get(function () {
        return this.actual?.workedMinutes || 0;
    })
    .set(function (val: number) {
        if (!this.actual) {
            this.actual = { firstCheckIn: null, lastCheckOut: null, workedMinutes: val };
        } else {
            this.actual.workedMinutes = val;
        }
    });

attendanceSchema.virtual('lateMinutes')
    .get(function () {
        return this.metrics?.lateMinutes || 0;
    })
    .set(function (val: number) {
        if (!this.metrics) {
            this.metrics = { lateMinutes: val, earlyLeaveMinutes: 0, overtimeMinutes: 0 };
        } else {
            this.metrics.lateMinutes = val;
        }
    });

attendanceSchema.virtual('earlyDepartureMinutes')
    .get(function () {
        return this.metrics?.earlyLeaveMinutes || 0;
    })
    .set(function (val: number) {
        if (!this.metrics) {
            this.metrics = { lateMinutes: 0, earlyLeaveMinutes: val, overtimeMinutes: 0 };
        } else {
            this.metrics.earlyLeaveMinutes = val;
        }
    });

attendanceSchema.virtual('overtimeMinutes')
    .get(function () {
        return this.metrics?.overtimeMinutes || 0;
    })
    .set(function (val: number) {
        if (!this.metrics) {
            this.metrics = { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: val };
        } else {
            this.metrics.overtimeMinutes = val;
        }
    });

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Unique index to prevent duplicate attendance record per employee per date in a company
attendanceSchema.index({ companyId: 1, employeeId: 1, date: 1 }, { unique: true });

// Optimizing dashboard filtering, reporting, and calendar lookups
attendanceSchema.index({ companyId: 1, date: 1, status: 1 });
attendanceSchema.index({ employeeId: 1, date: 1 });
attendanceSchema.index({ companyId: 1, shiftId: 1, date: 1 });
attendanceSchema.index({ companyId: 1, isFinalized: 1, date: 1 });
attendanceSchema.index({ companyId: 1, 'actual.firstCheckIn': 1 });

export const Attendance = model<IAttendanceDocument>('Attendance', attendanceSchema);
export default Attendance;
