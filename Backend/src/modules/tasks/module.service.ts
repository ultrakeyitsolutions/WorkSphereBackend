import { Module } from './module.model';
import { Project } from '../companyadmin/projects/project.model';

export class ModuleService {

    static async listModules(projectId: string, companyId: string) {
        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        const modules = await Module.find({ projectId, isActive: true })
            .sort({ orderIndex: 1, createdAt: 1 })
            .lean();

        return modules.map(m => ({
            id: m._id,
            name: m.name,
            description: m.description,
            projectId: m.projectId,
            orderIndex: m.orderIndex,
            isActive: m.isActive,
            createdAt: m.createdAt
        }));
    }

    static async createModule(projectId: string, data: any, companyId: string, userId: string) {
        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        const existing = await Module.findOne({ projectId, name: data.name, isActive: true }).lean();
        if (existing) throw new Error('MODULE_ALREADY_EXISTS');

        const lastModule = await Module.findOne({ projectId }).sort({ orderIndex: -1 }).lean();
        const orderIndex = lastModule ? lastModule.orderIndex + 1 : 1;

        const module = await Module.create({
            companyId,
            projectId,
            name: data.name,
            description: data.description,
            orderIndex,
            createdBy: userId
        });

        return module;
    }

    static async updateModule(moduleId: string, data: any, companyId: string) {
        const module = await Module.findOne({ _id: moduleId, isActive: true });
        if (!module) throw new Error('MODULE_NOT_FOUND');

        const project = await Project.findOne({ _id: module.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        if (data.name && data.name !== module.name) {
            const existing = await Module.findOne({ projectId: module.projectId, name: data.name, isActive: true, _id: { $ne: moduleId } }).lean();
            if (existing) throw new Error('MODULE_ALREADY_EXISTS');
        }

        Object.assign(module, data);
        await module.save();
        return module;
    }

    static async deleteModule(moduleId: string, companyId: string) {
        const module = await Module.findOne({ _id: moduleId, isActive: true });
        if (!module) throw new Error('MODULE_NOT_FOUND');

        const project = await Project.findOne({ _id: module.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        module.isActive = false;
        await module.save();
        return true;
    }
}
