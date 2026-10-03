import { Types } from 'mongoose';
import { Shift } from './shift.model';
import { EmployeeShiftAssignment } from './employee-shift-assignment.model';
import {
    AssignShiftDto,
    BulkAssignShiftDto,
    ShiftAssignmentListQuery,
    ResolvedEmployeeShift,
} from './shift.types';
import CompanyMember from '../companyadmin/invitations/company-member.model';
import User from '../users/user.model';
import { AppError } from '../../utils/AppError';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { NotificationEventBus } from '../notifications/notification.event-bus';

export class EmployeeShiftAssignmentService {
    /**
     * Helper to normalize a date to start-of-day in UTC (or local).
     */
    private static parseStartDate(dateInput: string | Date): Date {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) {
            throw AppError.badRequest('Invalid date format for effectiveFrom.');
        }
        d.setUTCHours(0, 0, 0, 0);
        return d;
    }

    private static parseEndDate(dateInput?: string | Date | null): Date | null {
        if (!dateInput) return null;
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) {
            throw AppError.badRequest('Invalid date format for effectiveTo.');
        }
        d.setUTCHours(23, 59, 59, 999);
        return d;
    }

    /**
     * Assign a shift to a single employee with conflict/overlap detection.
     */
    static async assignShift(
        companyId: string,
        actorId: string,
        dto: AssignShiftDto
    ) {
        const employeeObjId = new Types.ObjectId(dto.employeeId);
        const shiftObjId = new Types.ObjectId(dto.shiftId);
        const companyObjId = new Types.ObjectId(companyId);

        // 1. Verify Employee is an accepted member of the company
        const member = await CompanyMember.findOne({
            companyId: companyObjId,
            userId: employeeObjId,
            status: 'ACTIVE',
        }).lean();

        if (!member) {
            // Check if User exists in company directly
            const user = await User.findOne({
                _id: employeeObjId,
                companyId: companyObjId,
                isActive: true,
            }).lean();

            if (!user) {
                throw AppError.notFound('Employee is not an active member of this company.');
            }
        }

        // 2. Verify Shift belongs to this company and is active
        const shift = await Shift.findOne({
            _id: shiftObjId,
            companyId: companyObjId,
            isActive: true,
        }).lean();

        if (!shift) {
            throw AppError.notFound('Shift not found or is currently inactive.');
        }

        const effectiveFrom = this.parseStartDate(dto.effectiveFrom);
        const effectiveTo = this.parseEndDate(dto.effectiveTo);

        if (effectiveTo && effectiveTo < effectiveFrom) {
            throw AppError.badRequest('effectiveTo date cannot be earlier than effectiveFrom date.');
        }

        // 3. Detect Overlapping Assignments for this employee
        const overlapQuery: Record<string, any> = {
            companyId: companyObjId,
            employeeId: employeeObjId,
            status: { $in: ['ACTIVE', 'SCHEDULED'] },
            $and: [
                { effectiveFrom: { $lte: effectiveTo || new Date('2099-12-31') } },
                {
                    $or: [
                        { effectiveTo: null },
                        { effectiveTo: { $gte: effectiveFrom } },
                    ],
                },
            ],
        };

        const conflicting = await EmployeeShiftAssignment.find(overlapQuery).lean();

        // If there's an ongoing open-ended assignment starting before the new one, automatically close it
        const now = new Date();
        for (const conf of conflicting) {
            if (!conf.effectiveTo && conf.effectiveFrom < effectiveFrom) {
                const dayBefore = new Date(effectiveFrom);
                dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
                dayBefore.setUTCHours(23, 59, 59, 999);

                await EmployeeShiftAssignment.updateOne(
                    { _id: conf._id },
                    { $set: { effectiveTo: dayBefore, status: dayBefore < now ? 'EXPIRED' : 'ACTIVE' } }
                );
            } else {
                throw AppError.conflict(
                    `Employee already has an overlapping shift assignment from ${new Date(conf.effectiveFrom).toISOString().slice(0, 10)} to ${conf.effectiveTo ? new Date(conf.effectiveTo).toISOString().slice(0, 10) : 'ongoing'}.`
                );
            }
        }

        const status = effectiveFrom > now ? 'SCHEDULED' : 'ACTIVE';

        const assignment = await EmployeeShiftAssignment.create({
            companyId: companyObjId,
            employeeId: employeeObjId,
            shiftId: shiftObjId,
            effectiveFrom,
            effectiveTo,
            assignedBy: new Types.ObjectId(actorId),
            reason: dto.reason?.trim() || null,
            status,
        });

        // Audit Log
        AuditLogService.log({
            action: AuditAction.SHIFT_ASSIGNED,
            actorId,
            companyId,
            metadata: {
                assignmentId: assignment._id.toString(),
                employeeId: dto.employeeId,
                shiftId: dto.shiftId,
                shiftName: shift.name,
                effectiveFrom,
                effectiveTo,
            },
            description: `Assigned shift "${shift.name}" to employee`,
        });

        // Notification Event Dispatch
        NotificationEventBus.getInstance().publish({
            type: 'SHIFT_ASSIGNED',
            companyId,
            actorId,
            entityId: assignment._id.toString(),
            entityType: 'SHIFT',
            recipientIds: [dto.employeeId],
            metadata: {
                shiftName: shift.name,
                startTime: shift.startTime,
                endTime: shift.endTime,
                effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
            },
        });

        return assignment;
    }

    /**
     * Bulk Assign a Shift to Multiple Employees in a Single Efficient Operation.
     */
    static async bulkAssignShift(
        companyId: string,
        actorId: string,
        dto: BulkAssignShiftDto
    ) {
        if (!dto.employeeIds || !Array.isArray(dto.employeeIds) || dto.employeeIds.length === 0) {
            throw AppError.badRequest('Please provide at least one employeeId for bulk assignment.');
        }

        const uniqueEmployeeIds = Array.from(new Set(dto.employeeIds.map((id) => id.trim())));
        const companyObjId = new Types.ObjectId(companyId);
        const shiftObjId = new Types.ObjectId(dto.shiftId);

        // 1. Verify Shift in a single query
        const shift = await Shift.findOne({
            _id: shiftObjId,
            companyId: companyObjId,
            isActive: true,
        }).lean();

        if (!shift) {
            throw AppError.notFound('Shift not found or is currently inactive.');
        }

        const effectiveFrom = this.parseStartDate(dto.effectiveFrom);
        const effectiveTo = this.parseEndDate(dto.effectiveTo);

        if (effectiveTo && effectiveTo < effectiveFrom) {
            throw AppError.badRequest('effectiveTo date cannot be earlier than effectiveFrom date.');
        }

        // 2. Verify all Employees belong to the company in a single batch query
        const employeeObjIds = uniqueEmployeeIds.map((id) => new Types.ObjectId(id));

        const [validMembers, validUsers] = await Promise.all([
            CompanyMember.find({
                companyId: companyObjId,
                userId: { $in: employeeObjIds },
                status: 'ACTIVE',
            })
                .select('userId')
                .lean(),
            User.find({
                _id: { $in: employeeObjIds },
                companyId: companyObjId,
                isActive: true,
            })
                .select('_id')
                .lean(),
        ]);

        const validIdSet = new Set<string>();
        validMembers.forEach((m) => validIdSet.add(m.userId.toString()));
        validUsers.forEach((u) => validIdSet.add(u._id.toString()));

        const invalidIds = uniqueEmployeeIds.filter((id) => !validIdSet.has(id));
        if (invalidIds.length > 0) {
            throw AppError.badRequest(
                `The following employee IDs do not belong to active members of this company: ${invalidIds.slice(0, 5).join(', ')}${invalidIds.length > 5 ? ` and ${invalidIds.length - 5} more` : ''}`
            );
        }

        const now = new Date();
        const status = effectiveFrom > now ? 'SCHEDULED' : 'ACTIVE';
        const actorObjId = new Types.ObjectId(actorId);

        // 3. For any open-ended previous assignments, auto-close them to prevent overlap
        const dayBefore = new Date(effectiveFrom);
        dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
        dayBefore.setUTCHours(23, 59, 59, 999);

        await EmployeeShiftAssignment.updateMany(
            {
                companyId: companyObjId,
                employeeId: { $in: employeeObjIds },
                effectiveTo: null,
                effectiveFrom: { $lt: effectiveFrom },
                status: { $in: ['ACTIVE', 'SCHEDULED'] },
            },
            {
                $set: {
                    effectiveTo: dayBefore,
                    status: dayBefore < now ? 'EXPIRED' : 'ACTIVE',
                },
            }
        );

        // 4. Batch insert using bulkWrite
        const operations = employeeObjIds.map((empId) => ({
            insertOne: {
                document: {
                    companyId: companyObjId,
                    employeeId: empId,
                    shiftId: shiftObjId,
                    effectiveFrom,
                    effectiveTo,
                    assignedBy: actorObjId,
                    reason: dto.reason?.trim() || null,
                    status,
                    createdAt: now,
                    updatedAt: now,
                },
            },
        }));

        const result = await EmployeeShiftAssignment.bulkWrite(operations, { ordered: false });

        // Audit Log
        AuditLogService.log({
            action: AuditAction.SHIFT_BULK_ASSIGNED,
            actorId,
            companyId,
            metadata: {
                shiftId: dto.shiftId,
                shiftName: shift.name,
                assignedCount: result.insertedCount,
                employeeIds: uniqueEmployeeIds,
                effectiveFrom,
                effectiveTo,
            },
            description: `Bulk assigned shift "${shift.name}" to ${result.insertedCount} employees`,
        });

        // Notifications
        for (const empId of uniqueEmployeeIds) {
            NotificationEventBus.getInstance().publish({
                type: 'SHIFT_ASSIGNED',
                companyId,
                actorId,
                entityId: shift._id.toString(),
                entityType: 'SHIFT',
                recipientIds: [empId],
                metadata: {
                    shiftName: shift.name,
                    startTime: shift.startTime,
                    endTime: shift.endTime,
                    effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
                },
            });
        }

        return {
            success: true,
            totalRequested: uniqueEmployeeIds.length,
            assignedCount: result.insertedCount,
            shiftName: shift.name,
            shiftCode: shift.code,
            effectiveFrom,
            effectiveTo,
        };
    }

    /**
     * Get paginated shift assignments with rich employee and shift details.
     */
    static async getShiftAssignments(companyId: string, query: ShiftAssignmentListQuery) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
        };

        if (query.shiftId) {
            filter.shiftId = new Types.ObjectId(query.shiftId);
        }

        if (query.employeeId) {
            filter.employeeId = new Types.ObjectId(query.employeeId);
        }

        if (query.status) {
            filter.status = query.status;
        }

        if (query.date) {
            const targetDate = new Date(query.date);
            if (!isNaN(targetDate.getTime())) {
                filter.effectiveFrom = { $lte: targetDate };
                filter.$or = [{ effectiveTo: null }, { effectiveTo: { $gte: targetDate } }];
            }
        }

        const [assignments, total] = await Promise.all([
            EmployeeShiftAssignment.find(filter)
                .sort({ effectiveFrom: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('employeeId', 'name email avatar status')
                .populate('shiftId', 'name code startTime endTime crossesMidnight timezone workingDays')
                .populate('assignedBy', 'name email')
                .lean(),
            EmployeeShiftAssignment.countDocuments(filter),
        ]);

        return {
            assignments,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get complete shift history for a specific employee.
     */
    static async getEmployeeShiftHistory(companyId: string, employeeId: string) {
        const assignments = await EmployeeShiftAssignment.find({
            companyId: new Types.ObjectId(companyId),
            employeeId: new Types.ObjectId(employeeId),
        })
            .sort({ effectiveFrom: -1, createdAt: -1 })
            .populate('shiftId', 'name code startTime endTime crossesMidnight timezone workingDays isDefault')
            .populate('assignedBy', 'name email')
            .lean();

        return assignments;
    }

    /**
     * Resolve the exact active shift applicable to an employee on a given target date.
     */
    static async resolveEmployeeShift(
        companyId: string,
        employeeId: string,
        targetDate: Date = new Date()
    ): Promise<ResolvedEmployeeShift | null> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);

        // 1. Check for specific employee shift assignment covering targetDate
        const assignment = await EmployeeShiftAssignment.findOne({
            companyId: companyObjId,
            employeeId: employeeObjId,
            effectiveFrom: { $lte: targetDate },
            $or: [{ effectiveTo: null }, { effectiveTo: { $gte: targetDate } }],
            status: { $in: ['ACTIVE', 'SCHEDULED'] },
        })
            .populate('shiftId')
            .sort({ effectiveFrom: -1 })
            .lean();

        if (assignment && assignment.shiftId) {
            const s: any = assignment.shiftId;
            if (s.isActive) {
                return {
                    shiftId: s._id.toString(),
                    name: s.name,
                    code: s.code,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    crossesMidnight: s.crossesMidnight,
                    timezone: s.timezone || 'Asia/Kolkata',
                    gracePeriodMinutes: s.gracePeriodMinutes ?? 10,
                    earlyCheckoutGracePeriodMinutes: s.earlyCheckoutGracePeriodMinutes ?? 5,
                    workingDays: s.workingDays || [1, 2, 3, 4, 5],
                    isAssigned: true,
                    assignmentId: assignment._id.toString(),
                };
            }
        }

        // 2. Fallback to Company Default Shift if configured
        const defaultShift = await Shift.findOne({
            companyId: companyObjId,
            isDefault: true,
            isActive: true,
        }).lean();

        if (defaultShift) {
            return {
                shiftId: defaultShift._id.toString(),
                name: defaultShift.name,
                code: defaultShift.code,
                startTime: defaultShift.startTime,
                endTime: defaultShift.endTime,
                crossesMidnight: defaultShift.crossesMidnight,
                timezone: defaultShift.timezone || 'Asia/Kolkata',
                gracePeriodMinutes: defaultShift.gracePeriodMinutes ?? 10,
                earlyCheckoutGracePeriodMinutes: defaultShift.earlyCheckoutGracePeriodMinutes ?? 5,
                workingDays: defaultShift.workingDays || [1, 2, 3, 4, 5],
                isAssigned: false,
            };
        }

        // 3. Fallback to any active shift in company (deterministic first created)
        const anyShift = await Shift.findOne({
            companyId: companyObjId,
            isActive: true,
        })
            .sort({ createdAt: 1 })
            .lean();

        if (anyShift) {
            return {
                shiftId: anyShift._id.toString(),
                name: anyShift.name,
                code: anyShift.code,
                startTime: anyShift.startTime,
                endTime: anyShift.endTime,
                crossesMidnight: anyShift.crossesMidnight,
                timezone: anyShift.timezone || 'Asia/Kolkata',
                gracePeriodMinutes: anyShift.gracePeriodMinutes ?? 10,
                earlyCheckoutGracePeriodMinutes: anyShift.earlyCheckoutGracePeriodMinutes ?? 5,
                workingDays: anyShift.workingDays || [1, 2, 3, 4, 5],
                isAssigned: false,
            };
        }

        return null;
    }

    /**
     * Terminate or cancel a shift assignment.
     */
    static async endAssignment(companyId: string, assignmentId: string, actorId: string, reason?: string) {
        const assignment = await EmployeeShiftAssignment.findOne({
            _id: new Types.ObjectId(assignmentId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!assignment) {
            throw AppError.notFound('Shift assignment not found.');
        }

        const now = new Date();
        assignment.effectiveTo = now;
        assignment.status = 'CANCELLED';
        if (reason) assignment.reason = reason;
        await assignment.save();

        AuditLogService.log({
            action: AuditAction.SHIFT_ASSIGNMENT_ENDED,
            actorId,
            companyId,
            metadata: { assignmentId, employeeId: assignment.employeeId.toString() },
            description: `Ended shift assignment for employee`,
        });

        return assignment;
    }
}
