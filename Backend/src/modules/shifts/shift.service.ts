import { Types } from 'mongoose';
import { Shift } from './shift.model';
import { EmployeeShiftAssignment } from './employee-shift-assignment.model';
import { CreateShiftDto, UpdateShiftDto, ShiftListQuery, ShiftOverviewCounts } from './shift.types';
import CompanyMember from '../companyadmin/invitations/company-member.model';
import User from '../users/user.model';
import { Attendance } from '../attendance/attendance.model';
import { AttendanceEvaluationService } from './attendance-evaluation.service';
import { AppError } from '../../utils/AppError';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';

export class ShiftService {
    /**
     * Create a new Shift in the company.
     */
    static async createShift(companyId: string, userId: string, dto: CreateShiftDto) {
        const cleanCode = dto.code.trim().toUpperCase();

        const existing = await Shift.findOne({
            companyId: new Types.ObjectId(companyId),
            code: cleanCode,
        }).lean();

        if (existing) {
            throw AppError.conflict(`Shift with code "${cleanCode}" already exists in this company.`);
        }

        const [sH, sM] = dto.startTime.split(':').map(Number);
        const [eH, eM] = dto.endTime.split(':').map(Number);
        const crossesMidnight = (eH * 60 + eM) <= (sH * 60 + sM);

        if (dto.isDefault) {
            await Shift.updateMany(
                { companyId: new Types.ObjectId(companyId), isDefault: true },
                { $set: { isDefault: false } }
            );
        }

        const shift = await Shift.create({
            companyId: new Types.ObjectId(companyId),
            name: dto.name.trim(),
            code: cleanCode,
            startTime: dto.startTime.trim(),
            endTime: dto.endTime.trim(),
            crossesMidnight,
            timezone: dto.timezone || 'Asia/Kolkata',
            gracePeriodMinutes: dto.gracePeriodMinutes ?? 10,
            earlyCheckoutGracePeriodMinutes: dto.earlyCheckoutGracePeriodMinutes ?? 5,
            workingDays: dto.workingDays && dto.workingDays.length > 0 ? dto.workingDays : [1, 2, 3, 4, 5],
            breakDurationMinutes: dto.breakDurationMinutes ?? 0,
            halfDayThresholdMinutes: dto.halfDayThresholdMinutes ?? 240,
            fullDayThresholdMinutes: dto.fullDayThresholdMinutes ?? 480,
            isActive: dto.isActive !== undefined ? dto.isActive : true,
            isDefault: dto.isDefault || false,
            description: dto.description || '',
            createdBy: new Types.ObjectId(userId),
            updatedBy: new Types.ObjectId(userId),
        });

        AuditLogService.log({
            action: AuditAction.SHIFT_CREATED,
            actorId: userId,
            companyId,
            metadata: { shiftId: shift._id.toString(), name: shift.name, code: shift.code },
            description: `Shift "${shift.name}" (${shift.code}) was created`,
        });

        return shift;
    }

    /**
     * Get paginated shifts for a company with assigned employee counts.
     */
    static async getShifts(companyId: string, query: ShiftListQuery) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
        };

        if (query.isActive !== undefined && query.isActive !== '') {
            filter.isActive = query.isActive === 'true' || query.isActive === true;
        }

        if (query.search && query.search.trim()) {
            const searchRegex = new RegExp(query.search.trim(), 'i');
            filter.$or = [
                { name: searchRegex },
                { code: searchRegex },
                { description: searchRegex },
            ];
        }

        const sortField = query.sortBy || 'createdAt';
        const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

        const [shifts, total] = await Promise.all([
            Shift.find(filter)
                .sort({ isDefault: -1, [sortField]: sortOrder })
                .skip(skip)
                .limit(limit)
                .populate('createdBy', 'name email')
                .populate('updatedBy', 'name email')
                .lean(),
            Shift.countDocuments(filter),
        ]);

        // Aggregate active assigned employee count per shift in one single query
        const shiftIds = shifts.map((s) => s._id);
        const now = new Date();

        const employeeCounts = await EmployeeShiftAssignment.aggregate([
            {
                $match: {
                    companyId: new Types.ObjectId(companyId),
                    shiftId: { $in: shiftIds },
                    status: 'ACTIVE',
                    effectiveFrom: { $lte: now },
                    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }],
                },
            },
            {
                $group: {
                    _id: '$shiftId',
                    count: { $addToSet: '$employeeId' },
                },
            },
            {
                $project: {
                    _id: 1,
                    employeeCount: { $size: '$count' },
                },
            },
        ]);

        const countMap = new Map<string, number>(
            employeeCounts.map((c) => [c._id.toString(), c.employeeCount])
        );

        const enrichedShifts = shifts.map((s) => ({
            ...s,
            assignedEmployeesCount: countMap.get(s._id.toString()) || 0,
        }));

        return {
            shifts: enrichedShifts,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get a single shift by ID.
     */
    static async getShiftById(companyId: string, shiftId: string) {
        const shift = await Shift.findOne({
            _id: new Types.ObjectId(shiftId),
            companyId: new Types.ObjectId(companyId),
        })
            .populate('createdBy', 'name email')
            .populate('updatedBy', 'name email')
            .lean();

        if (!shift) {
            throw AppError.notFound('Shift not found in this company.');
        }

        const now = new Date();
        const activeAssignmentsCount = await EmployeeShiftAssignment.countDocuments({
            companyId: new Types.ObjectId(companyId),
            shiftId: new Types.ObjectId(shiftId),
            status: 'ACTIVE',
            effectiveFrom: { $lte: now },
            $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }],
        });

        return {
            ...shift,
            assignedEmployeesCount: activeAssignmentsCount,
        };
    }

    /**
     * Update an existing shift.
     */
    static async updateShift(companyId: string, shiftId: string, userId: string, dto: UpdateShiftDto) {
        const shift = await Shift.findOne({
            _id: new Types.ObjectId(shiftId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!shift) {
            throw AppError.notFound('Shift not found.');
        }

        if (dto.code) {
            const cleanCode = dto.code.trim().toUpperCase();
            if (cleanCode !== shift.code) {
                const duplicate = await Shift.findOne({
                    companyId: new Types.ObjectId(companyId),
                    code: cleanCode,
                    _id: { $ne: shift._id },
                }).lean();

                if (duplicate) {
                    throw AppError.conflict(`Shift with code "${cleanCode}" already exists in this company.`);
                }
                shift.code = cleanCode;
            }
        }

        if (dto.name) shift.name = dto.name.trim();
        if (dto.startTime) shift.startTime = dto.startTime.trim();
        if (dto.endTime) shift.endTime = dto.endTime.trim();

        if (dto.startTime || dto.endTime) {
            const [sH, sM] = shift.startTime.split(':').map(Number);
            const [eH, eM] = shift.endTime.split(':').map(Number);
            shift.crossesMidnight = (eH * 60 + eM) <= (sH * 60 + sM);
        }

        if (dto.timezone) shift.timezone = dto.timezone;
        if (dto.gracePeriodMinutes !== undefined) shift.gracePeriodMinutes = dto.gracePeriodMinutes;
        if (dto.earlyCheckoutGracePeriodMinutes !== undefined) shift.earlyCheckoutGracePeriodMinutes = dto.earlyCheckoutGracePeriodMinutes;
        if (dto.workingDays && dto.workingDays.length > 0) shift.workingDays = dto.workingDays;
        if (dto.breakDurationMinutes !== undefined) shift.breakDurationMinutes = dto.breakDurationMinutes;
        if (dto.halfDayThresholdMinutes !== undefined) shift.halfDayThresholdMinutes = dto.halfDayThresholdMinutes;
        if (dto.fullDayThresholdMinutes !== undefined) shift.fullDayThresholdMinutes = dto.fullDayThresholdMinutes;
        if (dto.isActive !== undefined) shift.isActive = dto.isActive;
        if (dto.description !== undefined) shift.description = dto.description;

        if (dto.isDefault && !shift.isDefault) {
            await Shift.updateMany(
                { companyId: new Types.ObjectId(companyId), isDefault: true },
                { $set: { isDefault: false } }
            );
            shift.isDefault = true;
        } else if (dto.isDefault === false) {
            shift.isDefault = false;
        }

        shift.updatedBy = new Types.ObjectId(userId);
        await shift.save();

        AuditLogService.log({
            action: AuditAction.SHIFT_UPDATED,
            actorId: userId,
            companyId,
            metadata: { shiftId: shift._id.toString(), name: shift.name, code: shift.code },
            description: `Shift "${shift.name}" (${shift.code}) was updated`,
        });

        return shift;
    }

    /**
     * Soft delete or deactivate a shift.
     */
    static async deactivateShift(companyId: string, shiftId: string, userId: string) {
        const shift = await Shift.findOne({
            _id: new Types.ObjectId(shiftId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!shift) {
            throw AppError.notFound('Shift not found.');
        }

        shift.isActive = false;
        shift.updatedBy = new Types.ObjectId(userId);
        await shift.save();

        AuditLogService.log({
            action: AuditAction.SHIFT_DEACTIVATED,
            actorId: userId,
            companyId,
            metadata: { shiftId: shift._id.toString(), name: shift.name, code: shift.code },
            description: `Shift "${shift.name}" (${shift.code}) was deactivated`,
        });

        return shift;
    }

    /**
     * Get aggregate shift overview metrics computed from real database records.
     */
    static async getShiftOverview(companyId: string): Promise<ShiftOverviewCounts> {
        const companyObjId = new Types.ObjectId(companyId);
        const now = new Date();
        const todayStr = AttendanceEvaluationService.formatDateString(now);

        // 1. Shifts counts
        const [totalShifts, activeShifts, overnightShifts, defaultShift] = await Promise.all([
            Shift.countDocuments({ companyId: companyObjId }),
            Shift.countDocuments({ companyId: companyObjId, isActive: true }),
            Shift.countDocuments({ companyId: companyObjId, isActive: true, crossesMidnight: true }),
            Shift.findOne({ companyId: companyObjId, isDefault: true, isActive: true }).select('name').lean(),
        ]);

        // 2. Total active members in company
        const [activeCompanyMembersCount, activeUsersCount] = await Promise.all([
            CompanyMember.countDocuments({ companyId: companyObjId, status: 'ACTIVE' }),
            User.countDocuments({ companyId: companyObjId, isActive: true, isDeleted: false }),
        ]);
        const totalEmployees = Math.max(activeCompanyMembersCount, activeUsersCount);

        // 3. Assigned employees currently covered by an active/scheduled assignment
        const assignedEmployeeIds = await EmployeeShiftAssignment.distinct('employeeId', {
            companyId: companyObjId,
            status: { $in: ['ACTIVE', 'SCHEDULED'] },
            effectiveFrom: { $lte: now },
            $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }],
        });
        const assignedEmployees = assignedEmployeeIds.length;
        const noAssignment = Math.max(0, totalEmployees - assignedEmployees);

        // 4. Currently working: active check-in today without checkout
        const currentlyWorking = await Attendance.countDocuments({
            companyId: companyObjId,
            date: todayStr,
            'actual.firstCheckIn': { $ne: null },
            'actual.lastCheckOut': null,
        });

        // 5. Today's day of week (1=Monday ... 7=Sunday)
        const jsDay = now.getDay();
        const currentIsoDay = jsDay === 0 ? 7 : jsDay;

        // Find active shifts operating today
        const activeTodayShifts = await Shift.find({
            companyId: companyObjId,
            isActive: true,
            workingDays: currentIsoDay,
        }).lean();

        const currentHour = now.getHours();
        const currentMin = now.getMinutes();
        const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;

        // Upcoming shifts starting later today
        const upcomingShifts = activeTodayShifts.filter((s) => s.startTime > currentTimeStr).length;

        // Employees scheduled for today who haven't checked in yet
        const activeTodayShiftIds = activeTodayShifts.map((s) => s._id);
        const scheduledTodayEmployees = await EmployeeShiftAssignment.distinct('employeeId', {
            companyId: companyObjId,
            shiftId: { $in: activeTodayShiftIds },
            status: { $in: ['ACTIVE', 'SCHEDULED'] },
            effectiveFrom: { $lte: now },
            $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }],
        });

        const checkedInTodayEmployees = await Attendance.distinct('employeeId', {
            companyId: companyObjId,
            date: todayStr,
            'actual.firstCheckIn': { $ne: null },
        });

        const checkedInSet = new Set(checkedInTodayEmployees.map((id) => id.toString()));
        const notCheckedIn = scheduledTodayEmployees.filter((id) => !checkedInSet.has(id.toString())).length;

        return {
            totalShifts,
            activeShifts,
            assignedEmployees,
            currentlyWorking,
            notCheckedIn,
            upcomingShifts,
            noAssignment,
            overnightShifts,
            defaultShiftName: defaultShift?.name || null,
        };
    }
}
