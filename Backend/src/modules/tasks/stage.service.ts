import { Stage } from './stage.model';
import { Project } from '../companyadmin/projects/project.model';

const DEFAULT_STAGES = [
    { name: 'New', color: '#6B7280', orderIndex: 1, isMaster: true, isDefault: true },
    { name: 'In Progress', color: '#3B82F6', orderIndex: 2, isMaster: true, isDefault: false },
    { name: 'Hold', color: '#F59E0B', orderIndex: 3, isMaster: true, isDefault: false },
    { name: 'Completed', color: '#10B981', orderIndex: 4, isMaster: true, isDefault: false },
    { name: 'Paused', color: '#8B5CF6', orderIndex: 5, isMaster: true, isDefault: false }
];

export class StageService {

    /** Seed default stages when a project is created */
    static async seedDefaultStages(projectId: string, companyId: string, userId: string) {
        const stages = DEFAULT_STAGES.map(s => ({
            ...s,
            companyId,
            projectId,
            createdBy: userId
        }));
        await Stage.insertMany(stages, { ordered: false });
    }

    static async listStages(projectId: string, companyId: string) {
        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        const stages = await Stage.find({ projectId, isActive: true })
            .sort({ orderIndex: 1 })
            .lean();

        return stages.map(s => ({
            id: s._id,
            name: s.name,
            color: s.color,
            orderIndex: s.orderIndex,
            isMaster: s.isMaster,
            isDefault: s.isDefault,
            isActive: s.isActive
        }));
    }

    static async createStage(projectId: string, data: any, companyId: string, userId: string) {
        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        const existing = await Stage.findOne({ projectId, name: data.name, isActive: true }).lean();
        if (existing) throw new Error('STAGE_ALREADY_EXISTS');

        const lastStage = await Stage.findOne({ projectId }).sort({ orderIndex: -1 }).lean();
        const orderIndex = lastStage ? lastStage.orderIndex + 1 : 1;

        const stage = await Stage.create({
            companyId,
            projectId,
            name: data.name,
            color: data.color || '#6B7280',
            orderIndex: data.orderIndex ?? orderIndex,
            isMaster: false,
            isDefault: false,
            createdBy: userId
        });

        return stage;
    }

    static async updateStage(stageId: string, data: any, companyId: string) {
        const stage = await Stage.findOne({ _id: stageId, isActive: true });
        if (!stage) throw new Error('STAGE_NOT_FOUND');

        const project = await Project.findOne({ _id: stage.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        if (data.name && data.name !== stage.name) {
            const existing = await Stage.findOne({ projectId: stage.projectId, name: data.name, isActive: true, _id: { $ne: stageId } }).lean();
            if (existing) throw new Error('STAGE_ALREADY_EXISTS');
        }

        Object.assign(stage, data);
        await stage.save();
        return stage;
    }

    static async deleteStage(stageId: string, companyId: string) {
        const stage = await Stage.findOne({ _id: stageId, isActive: true });
        if (!stage) throw new Error('STAGE_NOT_FOUND');

        if (stage.isMaster) throw new Error('CANNOT_DELETE_MASTER_STAGE');

        const project = await Project.findOne({ _id: stage.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        stage.isActive = false;
        await stage.save();
        return true;
    }

    /** Returns the default (first/initial) stage for a project */
    static async getDefaultStage(projectId: string) {
        return Stage.findOne({ projectId, isDefault: true, isActive: true }).lean();
    }
}
