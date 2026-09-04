import { Status } from './status.model';

const DEFAULT_STATUSES = [
    { name: 'New', color: '#6B7280', orderIndex: 1, isMaster: true },
    { name: 'In Progress', color: '#3B82F6', orderIndex: 2, isMaster: true },
    { name: 'Completed', color: '#10B981', orderIndex: 3, isMaster: true },
    { name: 'Archive', color: '#374151', orderIndex: 4, isMaster: true }
];

export class StatusService {

    /** Seed default statuses when a company is created */
    static async seedDefaultStatuses(companyId: string, userId: string) {
        const statuses = DEFAULT_STATUSES.map(s => ({ ...s, companyId, createdBy: userId }));
        await Status.insertMany(statuses, { ordered: false });
    }

    static async listStatuses(companyId: string) {
        const statuses = await Status.find({ companyId, isActive: true })
            .sort({ orderIndex: 1 })
            .lean();

        return statuses.map(s => ({
            id: s._id,
            name: s.name,
            color: s.color,
            orderIndex: s.orderIndex,
            isMaster: s.isMaster,
            isActive: s.isActive
        }));
    }

    static async createStatus(data: any, companyId: string, userId: string) {
        const existing = await Status.findOne({ companyId, name: data.name, isActive: true }).lean();
        if (existing) throw new Error('STATUS_ALREADY_EXISTS');

        const lastStatus = await Status.findOne({ companyId }).sort({ orderIndex: -1 }).lean();
        const orderIndex = lastStatus ? lastStatus.orderIndex + 1 : 1;

        const status = await Status.create({
            companyId,
            name: data.name,
            color: data.color || '#6B7280',
            orderIndex: data.orderIndex ?? orderIndex,
            isMaster: false,
            createdBy: userId
        });

        return status;
    }

    static async updateStatus(statusId: string, data: any, companyId: string) {
        const status = await Status.findOne({ _id: statusId, companyId, isActive: true });
        if (!status) throw new Error('STATUS_NOT_FOUND');

        if (data.name && data.name !== status.name) {
            const existing = await Status.findOne({ companyId, name: data.name, isActive: true, _id: { $ne: statusId } }).lean();
            if (existing) throw new Error('STATUS_ALREADY_EXISTS');
        }

        Object.assign(status, data);
        await status.save();
        return status;
    }

    static async deleteStatus(statusId: string, companyId: string) {
        const status = await Status.findOne({ _id: statusId, companyId, isActive: true });
        if (!status) throw new Error('STATUS_NOT_FOUND');

        if (status.isMaster) throw new Error('CANNOT_DELETE_MASTER_STATUS');

        status.isActive = false;
        await status.save();
        return true;
    }
}
