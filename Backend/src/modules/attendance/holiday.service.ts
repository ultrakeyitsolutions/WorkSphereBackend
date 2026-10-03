import { Types } from 'mongoose';
import { Holiday } from './holiday.model';
import { CreateHolidayDto } from './attendance.types';
import { AppError } from '../../utils/AppError';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { NotificationEventBus } from '../notifications/notification.event-bus';

export class HolidayService {
    /**
     * Create a new company holiday.
     */
    static async createHoliday(companyId: string, actorId: string, dto: CreateHolidayDto) {
        const companyObjId = new Types.ObjectId(companyId);
        const userObjId = new Types.ObjectId(actorId);

        // Check duplicate on same date
        const existing = await Holiday.findOne({
            companyId: companyObjId,
            date: dto.date,
        });

        if (existing) {
            throw AppError.conflict(`A holiday named "${existing.name}" is already registered on ${dto.date}.`);
        }

        const holiday = await Holiday.create({
            companyId: companyObjId,
            name: dto.name.trim(),
            date: dto.date,
            description: dto.description?.trim() || '',
            isRecurring: dto.isRecurring ?? false,
            createdBy: userObjId,
        });

        // Audit Log
        AuditLogService.log({
            action: AuditAction.HOLIDAY_CREATED,
            actorId,
            companyId,
            metadata: {
                holidayId: holiday._id.toString(),
                name: holiday.name,
                date: holiday.date,
                isRecurring: holiday.isRecurring,
            },
            description: `Created company holiday "${holiday.name}" on ${holiday.date}`,
        });

        // Notification announcement
        NotificationEventBus.getInstance().publish({
            type: 'HOLIDAY_ANNOUNCEMENT',
            companyId,
            actorId,
            entityId: holiday._id.toString(),
            entityType: 'HOLIDAY',
            metadata: {
                holidayName: holiday.name,
                date: holiday.date,
            },
        });

        return holiday;
    }

    /**
     * List holidays for a company with optional year or date filtering.
     */
    static async getHolidays(companyId: string, query: { year?: string | number; startDate?: string; endDate?: string }) {
        const filter: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
        };

        if (query.year) {
            filter.date = { $regex: new RegExp(`^${query.year}-`) };
        } else if (query.startDate && query.endDate) {
            filter.date = { $gte: query.startDate, $lte: query.endDate };
        }

        const holidays = await Holiday.find(filter)
            .sort({ date: 1 })
            .populate('createdBy', 'name email')
            .lean();

        return holidays;
    }

    /**
     * Update an existing holiday.
     */
    static async updateHoliday(
        companyId: string,
        holidayId: string,
        actorId: string,
        dto: Partial<CreateHolidayDto>
    ) {
        const holiday = await Holiday.findOne({
            _id: new Types.ObjectId(holidayId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!holiday) {
            throw AppError.notFound('Holiday not found.');
        }

        if (dto.name) holiday.name = dto.name.trim();
        if (dto.date) {
            // Check conflict if date changed
            if (dto.date !== holiday.date) {
                const existing = await Holiday.findOne({
                    companyId: new Types.ObjectId(companyId),
                    date: dto.date,
                    _id: { $ne: holiday._id },
                });
                if (existing) {
                    throw AppError.conflict(`A holiday named "${existing.name}" is already registered on ${dto.date}.`);
                }
            }
            holiday.date = dto.date;
        }
        if (dto.description !== undefined) holiday.description = dto.description.trim();
        if (dto.isRecurring !== undefined) holiday.isRecurring = dto.isRecurring;

        await holiday.save();

        AuditLogService.log({
            action: AuditAction.HOLIDAY_UPDATED,
            actorId,
            companyId,
            metadata: { holidayId: holiday._id.toString(), name: holiday.name, date: holiday.date },
            description: `Updated holiday "${holiday.name}"`,
        });

        return holiday;
    }

    /**
     * Delete a holiday.
     */
    static async deleteHoliday(companyId: string, holidayId: string, actorId: string) {
        const holiday = await Holiday.findOneAndDelete({
            _id: new Types.ObjectId(holidayId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!holiday) {
            throw AppError.notFound('Holiday not found.');
        }

        AuditLogService.log({
            action: AuditAction.HOLIDAY_DELETED,
            actorId,
            companyId,
            metadata: { holidayId: holiday._id.toString(), name: holiday.name, date: holiday.date },
            description: `Deleted holiday "${holiday.name}"`,
        });

        return { success: true, message: 'Holiday deleted successfully.' };
    }
}
