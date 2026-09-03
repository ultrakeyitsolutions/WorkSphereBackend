import mongoose, { Types, Document } from 'mongoose';
import { Project, ProjectSettings, ProjectInCharge, ProjectTeamMember, ProjectClient } from './project.model';
import { ProjectStatus, IProjectDocument } from './project.types';
import { User } from '../../users/user.model';
import { Company } from '../../super-admin/companies/company.model';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';
import { CreateProjectBody } from './project.validator';
import { AppError } from '../../../utils/AppError';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserSummary {
    id: string;
    name: string;
}

interface ProjectSettingsOutput {
    allowTeamMembersToCreateTasks: boolean;
    showTaskItemNumber: boolean;
    allowExplanation: boolean;
    deliveryDateMandatory: boolean;
    isConfidential: boolean;
    enableTemplateHierarchy: boolean;
}

export interface CreateProjectResponse {
    id: string;
    name: string;
    description: string | null;
    type: string;
    priority: string;
    status: string;
    startDate: string;
    endDate: string;
    createdBy: UserSummary;
    projectManager: UserSummary;
    teamMembers: UserSummary[];
    clients: UserSummary[];
    settings: ProjectSettingsOutput;
    stats: {
        teamMembers: number;
        clients: number;
        tasks: number;
        modules: number;
        documents: number;
    };
    createdAt: Date;
    updatedAt: Date;
}

export interface ListProjectItem {
    id: string;
    name: string;
    status: string;
    priority: string;
    startDate: string;
    endDate: string;
    projectManager: UserSummary | null;
    stats: {
        teamMembers: number;
        tasks: number;
    };
    createdAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * De-duplicate an array of string IDs.
 */
function deduplicateIds(ids: string[]): string[] {
    return [...new Set(ids)];
}

/**
 * Validate a batch of user IDs against a company, ensuring:
 *  - All IDs exist
 *  - All belong to the given company
 *  - All are active and not deactivated
 *
 * Returns a Map of id → {id, name} for easy lookup.
 * Throws a descriptive error if any ID fails validation.
 */
async function validateCompanyUsers(
    userIds: string[],
    companyId: string,
    label: string
): Promise<Map<string, UserSummary>> {
    if (userIds.length === 0) return new Map();

    const objectIds = userIds.map((id) => {
        if (!Types.ObjectId.isValid(id)) {
            throw AppError.unprocessable(`Invalid ${label} ID: ${id}`);
        }
        return new Types.ObjectId(id);
    });

    const users = await User.find({
        _id: { $in: objectIds },
        companyId: new Types.ObjectId(companyId),
        isActive: true,
        status: { $ne: 'DEACTIVATED' },
    }).select('_id name companyId isActive status').lean();

    // Check all IDs were found — produce targeted error messages
    const foundIds = new Set(users.map((u) => String(u._id)));
    for (const id of userIds) {
        if (!foundIds.has(id)) {
            const rawUser = await User.findById(id).lean();
            if (!rawUser) {
                throw AppError.notFound(`${label} not found: ${id}`);
            }
            if (String(rawUser.companyId) !== companyId) {
                throw AppError.unprocessable(`${label} ${id} does not belong to your company`);
            }
            if (!rawUser.isActive || (rawUser as any).status === 'DEACTIVATED') {
                throw AppError.unprocessable(`${label} ${id} is not active`);
            }
            throw AppError.unprocessable(`${label} ${id} is not eligible`);
        }
    }

    const map = new Map<string, UserSummary>();
    for (const u of users) {
        map.set(String(u._id), { id: String(u._id), name: u.name });
    }
    return map;
}

/**
 * Build a safe settings output object from optional settings input.
 */
function buildSettings(settingsInput: Record<string, boolean | undefined>): ProjectSettingsOutput {
    return {
        allowTeamMembersToCreateTasks: settingsInput['allowTeamMembersToCreateTasks'] ?? true,
        showTaskItemNumber: settingsInput['showTaskItemNumber'] ?? true,
        allowExplanation: settingsInput['allowExplanation'] ?? true,
        deliveryDateMandatory: settingsInput['deliveryDateMandatory'] ?? false,
        isConfidential: settingsInput['isConfidential'] ?? false,
        enableTemplateHierarchy: settingsInput['enableTemplateHierarchy'] ?? false,
    };
}

// ─── ProjectService ───────────────────────────────────────────────────────────

export class ProjectService {
    /**
     * Create a new project atomically inside a transaction.
     * All sub-operations (settings, in-charge, team members, clients)
     * are rolled back if any step fails.
     */
    static async createProject(
        input: CreateProjectBody,
        currentUserId: string,
        companyId: string,
        actorEmail: string,
        actorRole: string
    ): Promise<CreateProjectResponse> {

        // ── 1. Validate company ───────────────────────────────────────────────
        const company = await Company.findById(companyId).lean();
        if (!company) throw AppError.notFound('Company not found');
        if (!company.isActive || company.status !== 'ACTIVE') {
            throw AppError.unprocessable('Your company account is not active');
        }

        // ── 2. Check name uniqueness within company ───────────────────────────
        const existingProject = await Project.findOne({
            companyId: new Types.ObjectId(companyId),
            name: { $regex: `^${input.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
            isActive: true,
        });
        if (existingProject) {
            throw AppError.conflict(`A project named "${input.name.trim()}" already exists in your company`);
        }

        // ── 3. De-duplicate input arrays ──────────────────────────────────────
        const uniqueTeamMemberIds = deduplicateIds(input.teamMemberIds ?? []);
        const uniqueClientIds = deduplicateIds(input.clientIds ?? []);

        // ── 4. Validate project manager ───────────────────────────────────────
        const managerMap = await validateCompanyUsers(
            [input.projectManagerId],
            companyId,
            'Project manager'
        );
        const projectManager = managerMap.get(input.projectManagerId)!;

        // ── 5. Validate team members (batch) ──────────────────────────────────
        // Remove manager from team members to avoid duplicate relationship
        const filteredTeamMemberIds = uniqueTeamMemberIds.filter(
            (id) => id !== input.projectManagerId
        );
        const teamMemberMap = await validateCompanyUsers(
            filteredTeamMemberIds,
            companyId,
            'Team member'
        );

        // ── 6. Validate clients (batch) ───────────────────────────────────────
        const clientMap = await validateCompanyUsers(
            uniqueClientIds,
            companyId,
            'Client'
        );

        // ── 7. Validate creator ───────────────────────────────────────────────
        const creatorDoc = await User.findOne({
            _id: new Types.ObjectId(currentUserId),
            isActive: true,
        }).select('_id name').lean();
        if (!creatorDoc) throw AppError.unauthorized('Authenticated user not found or inactive');

        // ── 8. Normalise settings input ───────────────────────────────────────
        const settingsInput: Record<string, boolean | undefined> = input.settings ?? {};

        // ── 9. Transaction ────────────────────────────────────────────────────
        const session = await mongoose.startSession();
        session.startTransaction();

        let projectId: Types.ObjectId;
        let projectName: string;
        let projectDescription: string | null;
        let projectType: string;
        let projectPriority: string;
        let projectStatus: string;
        let projectStartDate: Date;
        let projectEndDate: Date;
        let projectCreatedAt: Date;
        let projectUpdatedAt: Date;

        try {
            const now = new Date();

            // Insert Project document using session
            const projectDoc = new Project({
                companyId: new Types.ObjectId(companyId),
                name: input.name.trim(),
                description: input.description?.trim() ?? null,
                type: input.type,
                priority: input.priority,
                status: ProjectStatus.ACTIVE,
                startDate: new Date(input.startDate),
                endDate: new Date(input.endDate),
                createdById: new Types.ObjectId(currentUserId),
                isActive: true,
                isArchived: false,
            });
            await projectDoc.save({ session });

            projectId = projectDoc._id as Types.ObjectId;
            projectName = projectDoc.name;
            projectDescription = (projectDoc as any).description ?? null;
            projectType = projectDoc.type;
            projectPriority = projectDoc.priority;
            projectStatus = projectDoc.status;
            projectStartDate = projectDoc.startDate;
            projectEndDate = projectDoc.endDate;
            projectCreatedAt = (projectDoc as any).createdAt ?? now;
            projectUpdatedAt = (projectDoc as any).updatedAt ?? now;

            // Create Project Settings
            const settingsDoc = new ProjectSettings({
                projectId,
                allowTeamMembersToCreateTasks: settingsInput['allowTeamMembersToCreateTasks'] ?? true,
                showTaskItemNumber: settingsInput['showTaskItemNumber'] ?? true,
                allowExplanation: settingsInput['allowExplanation'] ?? true,
                deliveryDateMandatory: settingsInput['deliveryDateMandatory'] ?? false,
                isConfidential: settingsInput['isConfidential'] ?? false,
                enableTemplateHierarchy: settingsInput['enableTemplateHierarchy'] ?? false,
            });
            await settingsDoc.save({ session });

            // Create Project In-Charge (manager)
            const inChargeDoc = new ProjectInCharge({
                projectId,
                userId: new Types.ObjectId(input.projectManagerId),
                addedById: new Types.ObjectId(currentUserId),
                addedAt: now,
            });
            await inChargeDoc.save({ session });

            // Create Team Member relationships
            for (const memberId of filteredTeamMemberIds) {
                const teamMemberDoc = new ProjectTeamMember({
                    projectId,
                    userId: new Types.ObjectId(memberId),
                    addedById: new Types.ObjectId(currentUserId),
                    canCreateTasks: settingsInput['allowTeamMembersToCreateTasks'] ?? true,
                    addedAt: now,
                });
                await teamMemberDoc.save({ session });
            }

            // Create Client relationships
            for (const clientId of uniqueClientIds) {
                const clientDoc = new ProjectClient({
                    projectId,
                    userId: new Types.ObjectId(clientId),
                    addedById: new Types.ObjectId(currentUserId),
                    addedAt: now,
                });
                await clientDoc.save({ session });
            }

            await session.commitTransaction();

        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }

        // ── 10. Fire audit event (fire-and-forget, outside transaction) ───────
        AuditLogService.log({
            action: AuditAction.PROJECT_CREATED,
            actorId: currentUserId,
            actorEmail,
            actorRole,
            companyId,
            metadata: {
                projectId: String(projectId),
                projectName,
            },
            description: `Project "${projectName}" created`,
            success: true,
        });

        // ── 11. Build response ────────────────────────────────────────────────
        const teamMembers = filteredTeamMemberIds.map((id) => teamMemberMap.get(id)!);
        const clients = uniqueClientIds.map((id) => clientMap.get(id)!);
        const settings: ProjectSettingsOutput = {
            allowTeamMembersToCreateTasks: (settingsInput['allowTeamMembersToCreateTasks'] as boolean) ?? true,
            showTaskItemNumber: (settingsInput['showTaskItemNumber'] as boolean) ?? true,
            allowExplanation: (settingsInput['allowExplanation'] as boolean) ?? true,
            deliveryDateMandatory: (settingsInput['deliveryDateMandatory'] as boolean) ?? false,
            isConfidential: (settingsInput['isConfidential'] as boolean) ?? false,
            enableTemplateHierarchy: (settingsInput['enableTemplateHierarchy'] as boolean) ?? false,
        };

        return {
            id: String(projectId),
            name: projectName,
            description: projectDescription,
            type: projectType,
            priority: projectPriority,
            status: projectStatus,
            startDate: projectStartDate.toISOString().split('T')[0],
            endDate: projectEndDate.toISOString().split('T')[0],
            createdBy: { id: String(creatorDoc._id), name: creatorDoc.name },
            projectManager,
            teamMembers,
            clients,
            settings,
            stats: {
                teamMembers: teamMembers.length,
                clients: clients.length,
                tasks: 0,
                modules: 0,
                documents: 0,
            },
            createdAt: projectCreatedAt,
            updatedAt: projectUpdatedAt,
        };
    }

    /**
     * Get paginated list of projects for a company.
     * Lightweight response — no heavy nested data.
     */
    static async listProjects(
        companyId: string,
        query: {
            page?: number;
            limit?: number;
            status?: string;
            priority?: string;
            search?: string;
        }
    ): Promise<{ data: ListProjectItem[]; pagination: object }> {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(100, Math.max(1, query.limit ?? 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
            isActive: true,
        };
        if (query.status) filter['status'] = query.status;
        if (query.priority) filter['priority'] = query.priority;
        if (query.search) {
            filter['name'] = { $regex: query.search, $options: 'i' };
        }

        const [projects, total] = await Promise.all([
            Project.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('_id name status priority startDate endDate createdAt')
                .lean(),
            Project.countDocuments(filter),
        ]);

        // Fetch project managers for listed projects
        const projectIds = projects.map((p) => p._id as Types.ObjectId);
        const managers = await ProjectInCharge.find({
            projectId: { $in: projectIds },
        })
            .populate<{ userId: { _id: Types.ObjectId; name: string } }>('userId', 'name')
            .lean();

        const managerByProjectId = new Map<string, UserSummary>();
        for (const mgr of managers) {
            const user = mgr.userId as any;
            if (user?._id) {
                managerByProjectId.set(String(mgr.projectId), {
                    id: String(user._id),
                    name: user.name,
                });
            }
        }

        // Fetch team member counts
        const memberCounts = await ProjectTeamMember.aggregate([
            { $match: { projectId: { $in: projectIds } } },
            { $group: { _id: '$projectId', count: { $sum: 1 } } },
        ]);
        const memberCountMap = new Map<string, number>();
        for (const mc of memberCounts) {
            memberCountMap.set(String(mc._id), mc.count);
        }

        const data: ListProjectItem[] = projects.map((p) => ({
            id: String(p._id),
            name: p.name,
            status: p.status,
            priority: p.priority,
            startDate: (p.startDate as Date).toISOString().split('T')[0],
            endDate: (p.endDate as Date).toISOString().split('T')[0],
            projectManager: managerByProjectId.get(String(p._id)) ?? null,
            stats: {
                teamMembers: memberCountMap.get(String(p._id)) ?? 0,
                tasks: 0,
            },
            createdAt: (p as any).createdAt as Date,
        }));

        return {
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get full project detail.
     * Returns all relationships without sensitive user fields.
     */
    static async getProjectById(
        projectId: string,
        companyId: string
    ): Promise<CreateProjectResponse> {
        if (!Types.ObjectId.isValid(projectId)) {
            throw AppError.unprocessable('Invalid project ID');
        }

        const project: any = await Project.findOne({
            _id: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
            isActive: true,
        })
            .populate<{ createdById: { _id: Types.ObjectId; name: string } }>('createdById', 'name')
            .lean();

        if (!project) throw AppError.notFound('Project not found');

        const [settings, inCharges, teamMembers, clients] = await Promise.all([
            ProjectSettings.findOne({ projectId: new Types.ObjectId(projectId) }).lean(),
            ProjectInCharge.find({ projectId: new Types.ObjectId(projectId) })
                .populate<{ userId: { _id: Types.ObjectId; name: string } }>('userId', 'name')
                .lean(),
            ProjectTeamMember.find({ projectId: new Types.ObjectId(projectId) })
                .populate<{ userId: { _id: Types.ObjectId; name: string } }>('userId', 'name')
                .lean(),
            ProjectClient.find({ projectId: new Types.ObjectId(projectId) })
                .populate<{ userId: { _id: Types.ObjectId; name: string } }>('userId', 'name')
                .lean(),
        ]);

        const managerUser = inCharges[0]?.userId as any;
        const creatorUser = project.createdById as any;

        return {
            id: String(project._id),
            name: project.name,
            description: project.description ?? null,
            type: project.type,
            priority: project.priority,
            status: project.status,
            startDate: (project.startDate as Date).toISOString().split('T')[0],
            endDate: (project.endDate as Date).toISOString().split('T')[0],
            createdBy: creatorUser
                ? { id: String(creatorUser._id), name: creatorUser.name }
                : { id: String(project.createdById), name: 'Unknown' },
            projectManager: managerUser
                ? { id: String(managerUser._id), name: managerUser.name }
                : { id: '', name: 'Unknown' },
            teamMembers: teamMembers.map((m) => {
                const u = m.userId as any;
                return { id: String(u._id), name: u.name };
            }),
            clients: clients.map((c) => {
                const u = c.userId as any;
                return { id: String(u._id), name: u.name };
            }),
            settings: {
                allowTeamMembersToCreateTasks: settings?.allowTeamMembersToCreateTasks ?? true,
                showTaskItemNumber: settings?.showTaskItemNumber ?? true,
                allowExplanation: settings?.allowExplanation ?? true,
                deliveryDateMandatory: settings?.deliveryDateMandatory ?? false,
                isConfidential: settings?.isConfidential ?? false,
                enableTemplateHierarchy: settings?.enableTemplateHierarchy ?? false,
            },
            stats: {
                teamMembers: teamMembers.length,
                clients: clients.length,
                tasks: 0,
                modules: 0,
                documents: 0,
            },
            createdAt: project.createdAt as Date,
            updatedAt: project.updatedAt as Date,
        };
    }

    // ─── Shared helper: resolve & guard a project ─────────────────────────────

    private static async resolveProject(projectId: string, companyId: string) {
        if (!Types.ObjectId.isValid(projectId)) {
            throw AppError.unprocessable('Invalid project ID');
        }
        const project = await Project.findOne({
            _id: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
            deletedAt: null,
        }).lean();
        if (!project) throw AppError.notFound('Project not found');
        return project;
    }

    // ─── Update Project ───────────────────────────────────────────────────────

    /**
     * PATCH /api/v1/company/projects/:projectId
     * Update editable project fields and/or settings.
     */
    static async updateProject(
        projectId: string,
        companyId: string,
        input: import('./project.validator').UpdateProjectBody,
        actorId: string,
        actorEmail: string,
        actorRole: string
    ): Promise<{ id: string; message: string }> {
        const project = await ProjectService.resolveProject(projectId, companyId);

        // Check name uniqueness if name is being changed
        if (input.name && input.name.trim().toLowerCase() !== project.name.toLowerCase()) {
            const conflict = await Project.findOne({
                companyId: new Types.ObjectId(companyId),
                name: { $regex: `^${input.name.trim()}$`, $options: 'i' },
                isActive: true,
                _id: { $ne: new Types.ObjectId(projectId) },
                deletedAt: null,
            });
            if (conflict) throw AppError.conflict(`A project named "${input.name.trim()}" already exists`);
        }

        // Build project update payload
        const projectUpdate: Record<string, any> = {};
        if (input.name) projectUpdate.name = input.name.trim();
        if (input.description !== undefined) projectUpdate.description = input.description?.trim() ?? null;
        if (input.type) projectUpdate.type = input.type;
        if (input.priority) projectUpdate.priority = input.priority;
        if (input.startDate) projectUpdate.startDate = new Date(input.startDate);
        if (input.endDate) projectUpdate.endDate = new Date(input.endDate);

        // Cross-validate dates against existing stored dates
        const resolvedStart = projectUpdate.startDate ?? project.startDate;
        const resolvedEnd = projectUpdate.endDate ?? project.endDate;
        if (resolvedEnd < resolvedStart) {
            throw AppError.unprocessable('endDate must not be earlier than startDate');
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            if (Object.keys(projectUpdate).length > 0) {
                await Project.updateOne(
                    { _id: new Types.ObjectId(projectId) },
                    { $set: projectUpdate },
                    { session }
                );
            }

            // Update settings if provided
            if (input.settings) {
                const s = input.settings as Record<string, boolean | undefined>;
                const settingsUpdate: Record<string, boolean> = {};
                const boolFields = [
                    'allowTeamMembersToCreateTasks', 'showTaskItemNumber', 'allowExplanation',
                    'deliveryDateMandatory', 'isConfidential', 'enableTemplateHierarchy',
                ] as const;
                for (const key of boolFields) {
                    if (s[key] !== undefined) settingsUpdate[key] = s[key] as boolean;
                }
                if (Object.keys(settingsUpdate).length > 0) {
                    await ProjectSettings.updateOne(
                        { projectId: new Types.ObjectId(projectId) },
                        { $set: settingsUpdate },
                        { session }
                    );
                }
            }

            await session.commitTransaction();
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }

        AuditLogService.log({
            action: AuditAction.PROJECT_UPDATED,
            actorId, actorEmail, actorRole, companyId,
            metadata: { projectId, changes: Object.keys(projectUpdate) },
            description: `Project "${project.name}" updated`,
            success: true,
        });

        return { id: projectId, message: 'Project updated successfully' };
    }

    // ─── Archive Project ──────────────────────────────────────────────────────

    /**
     * PATCH /api/v1/company/projects/:projectId/archive
     */
    static async archiveProject(
        projectId: string,
        companyId: string,
        actorId: string,
        actorEmail: string,
        actorRole: string
    ): Promise<{ id: string; message: string }> {
        const project = await ProjectService.resolveProject(projectId, companyId);
        if (project.isArchived) throw AppError.conflict('Project is already archived');

        await Project.updateOne(
            { _id: new Types.ObjectId(projectId) },
            { $set: { isArchived: true, status: 'Archived' } }
        );

        AuditLogService.log({
            action: AuditAction.PROJECT_ARCHIVED,
            actorId, actorEmail, actorRole, companyId,
            metadata: { projectId },
            description: `Project "${project.name}" archived`,
            success: true,
        });

        return { id: projectId, message: 'Project archived successfully' };
    }

    // ─── Unarchive Project ────────────────────────────────────────────────────

    /**
     * PATCH /api/v1/company/projects/:projectId/unarchive
     */
    static async unarchiveProject(
        projectId: string,
        companyId: string,
        actorId: string,
        actorEmail: string,
        actorRole: string
    ): Promise<{ id: string; message: string }> {
        const project = await ProjectService.resolveProject(projectId, companyId);
        if (!project.isArchived) throw AppError.conflict('Project is not archived');

        await Project.updateOne(
            { _id: new Types.ObjectId(projectId) },
            { $set: { isArchived: false, status: 'Active' } }
        );

        AuditLogService.log({
            action: AuditAction.PROJECT_UNARCHIVED,
            actorId, actorEmail, actorRole, companyId,
            metadata: { projectId },
            description: `Project "${project.name}" unarchived`,
            success: true,
        });

        return { id: projectId, message: 'Project unarchived successfully' };
    }

    // ─── Permanent Delete ─────────────────────────────────────────────────────

    /**
     * DELETE /api/v1/company/projects/:projectId
     * Soft-deletes by setting deletedAt. All relations are preserved for audit.
     * Hard data purge can be done separately as a scheduled job.
     */
    static async permanentDeleteProject(
        projectId: string,
        companyId: string,
        actorId: string,
        actorEmail: string,
        actorRole: string
    ): Promise<{ message: string }> {
        const project = await ProjectService.resolveProject(projectId, companyId);

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const now = new Date();
            await Project.updateOne(
                { _id: new Types.ObjectId(projectId) },
                { $set: { deletedAt: now, isActive: false } },
                { session }
            );
            // Also clean up all relationship collections
            await Promise.all([
                ProjectSettings.deleteOne({ projectId: new Types.ObjectId(projectId) }, { session }),
                ProjectInCharge.deleteMany({ projectId: new Types.ObjectId(projectId) }, { session }),
                ProjectTeamMember.deleteMany({ projectId: new Types.ObjectId(projectId) }, { session }),
                ProjectClient.deleteMany({ projectId: new Types.ObjectId(projectId) }, { session }),
            ]);
            await session.commitTransaction();
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }

        AuditLogService.log({
            action: AuditAction.PROJECT_DELETED,
            actorId, actorEmail, actorRole, companyId,
            metadata: { projectId, projectName: project.name },
            description: `Project "${project.name}" permanently deleted`,
            success: true,
        });

        return { message: 'Project permanently deleted' };
    }

    // ─── Pin Project ──────────────────────────────────────────────────────────

    /**
     * PATCH /api/v1/company/projects/:projectId/pin
     */
    static async pinProject(
        projectId: string,
        companyId: string,
        actorId: string,
        actorEmail: string,
        actorRole: string
    ): Promise<{ id: string; message: string }> {
        const project = await ProjectService.resolveProject(projectId, companyId);
        if ((project as any).isPinned) throw AppError.conflict('Project is already pinned');

        await Project.updateOne(
            { _id: new Types.ObjectId(projectId) },
            { $set: { isPinned: true } }
        );

        AuditLogService.log({
            action: AuditAction.PROJECT_PINNED,
            actorId, actorEmail, actorRole, companyId,
            metadata: { projectId },
            description: `Project "${project.name}" pinned`,
            success: true,
        });

        return { id: projectId, message: 'Project pinned successfully' };
    }

    // ─── Unpin Project ────────────────────────────────────────────────────────

    /**
     * PATCH /api/v1/company/projects/:projectId/unpin
     */
    static async unpinProject(
        projectId: string,
        companyId: string,
        actorId: string,
        actorEmail: string,
        actorRole: string
    ): Promise<{ id: string; message: string }> {
        const project = await ProjectService.resolveProject(projectId, companyId);
        if (!(project as any).isPinned) throw AppError.conflict('Project is not pinned');

        await Project.updateOne(
            { _id: new Types.ObjectId(projectId) },
            { $set: { isPinned: false } }
        );

        AuditLogService.log({
            action: AuditAction.PROJECT_UNPINNED,
            actorId, actorEmail, actorRole, companyId,
            metadata: { projectId },
            description: `Project "${project.name}" unpinned`,
            success: true,
        });

        return { id: projectId, message: 'Project unpinned successfully' };
    }

    // ─── Set Active Status ────────────────────────────────────────────────────

    /**
     * PATCH /api/v1/company/projects/:projectId/activate
     * Restores a project to Active status and marks it as active.
     */
    static async activateProject(
        projectId: string,
        companyId: string,
        actorId: string,
        actorEmail: string,
        actorRole: string
    ): Promise<{ id: string; message: string }> {
        const project = await ProjectService.resolveProject(projectId, companyId);
        if (project.isActive && project.status === 'Active') {
            throw AppError.conflict('Project is already active');
        }

        await Project.updateOne(
            { _id: new Types.ObjectId(projectId) },
            { $set: { isActive: true, status: 'Active', isArchived: false } }
        );

        AuditLogService.log({
            action: AuditAction.PROJECT_ACTIVATED,
            actorId, actorEmail, actorRole, companyId,
            metadata: { projectId },
            description: `Project "${project.name}" activated`,
            success: true,
        });

        return { id: projectId, message: 'Project activated successfully' };
    }

    // ─── Set Inactive Status ──────────────────────────────────────────────────

    /**
     * PATCH /api/v1/company/projects/:projectId/deactivate
     * Puts a project on hold (inactive). Does not delete or archive it.
     */
    static async deactivateProject(
        projectId: string,
        companyId: string,
        actorId: string,
        actorEmail: string,
        actorRole: string
    ): Promise<{ id: string; message: string }> {
        const project = await ProjectService.resolveProject(projectId, companyId);
        if (!project.isActive) throw AppError.conflict('Project is already inactive');

        await Project.updateOne(
            { _id: new Types.ObjectId(projectId) },
            { $set: { isActive: false, status: 'OnHold' } }
        );

        AuditLogService.log({
            action: AuditAction.PROJECT_DEACTIVATED,
            actorId, actorEmail, actorRole, companyId,
            metadata: { projectId },
            description: `Project "${project.name}" deactivated`,
            success: true,
        });

        return { id: projectId, message: 'Project deactivated successfully' };
    }
}
