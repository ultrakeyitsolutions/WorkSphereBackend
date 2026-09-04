import { TaskTemplate } from './task-template.model';

export class TaskTemplateService {

    static async listTemplates(companyId: string) {
        const templates = await TaskTemplate.find({ companyId, isActive: true })
            .populate('createdBy', 'firstName lastName')
            .populate('designationId', 'name')
            .sort({ createdAt: -1 })
            .lean();

        return templates.map(t => ({
            id: t._id,
            name: t.name,
            description: t.description,
            designationId: t.designationId ? (t.designationId as any)._id : null,
            designationName: t.designationId ? (t.designationId as any).name : '',
            priority: t.priority,
            taskType: t.taskType,
            criticality: t.criticality,
            estimatedTime: t.estimatedTime,
            tags: t.tags || [],
            notes: t.notes || [],
            checklist: t.checklist || [],
            createdByUserName: t.createdBy
                ? `${(t.createdBy as any).firstName || ''} ${(t.createdBy as any).lastName || ''}`.trim()
                : '',
            createdAt: t.createdAt
        }));
    }

    static async getTemplateById(templateId: string, companyId: string) {
        const template = await TaskTemplate.findOne({ _id: templateId, companyId, isActive: true })
            .populate('createdBy', 'firstName lastName')
            .populate('designationId', 'name')
            .lean();
        if (!template) throw new Error('TEMPLATE_NOT_FOUND');
        return template;
    }

    static async createTemplate(data: any, companyId: string, userId: string) {
        const existing = await TaskTemplate.findOne({ companyId, name: data.name, isActive: true }).lean();
        if (existing) throw new Error('TEMPLATE_ALREADY_EXISTS');

        const template = await TaskTemplate.create({
            companyId,
            name: data.name,
            description: data.description,
            designationId: data.designationId || undefined,
            moduleId: data.moduleId || undefined,
            priority: data.priority,
            taskType: data.taskType || 'TASK',
            criticality: data.criticality || 'NON_CRITICAL',
            estimatedTime: data.estimatedTime,
            tags: data.tags || [],
            notes: data.notes || [],
            checklist: data.checklist || [],
            createdBy: userId
        });

        return template;
    }

    static async updateTemplate(templateId: string, data: any, companyId: string) {
        const template = await TaskTemplate.findOne({ _id: templateId, companyId, isActive: true });
        if (!template) throw new Error('TEMPLATE_NOT_FOUND');

        if (data.name && data.name !== template.name) {
            const existing = await TaskTemplate.findOne({ companyId, name: data.name, isActive: true, _id: { $ne: templateId } }).lean();
            if (existing) throw new Error('TEMPLATE_ALREADY_EXISTS');
        }

        Object.assign(template, data);
        await template.save();
        return template;
    }

    static async deleteTemplate(templateId: string, companyId: string) {
        const template = await TaskTemplate.findOne({ _id: templateId, companyId, isActive: true });
        if (!template) throw new Error('TEMPLATE_NOT_FOUND');

        template.isActive = false;
        await template.save();
        return true;
    }
}
