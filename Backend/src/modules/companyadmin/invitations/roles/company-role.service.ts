import { Types } from 'mongoose';
import { CompanyRole } from './company-role.model';

export interface CreateRoleDto {
    companyId: string;
    name: string;
    description?: string;
    createdBy: string;
}

export interface UpdateRoleDto {
    name?: string;
    description?: string;
}

export class CompanyRoleService {

    /** Create a role scoped to a company */
    static async create(dto: CreateRoleDto) {
        const role = new CompanyRole({
            companyId: new Types.ObjectId(dto.companyId),
            name: dto.name.trim(),
            description: dto.description?.trim(),
            createdBy: new Types.ObjectId(dto.createdBy),
        });
        return role.save();
    }

    /** List all roles for a company */
    static async listByCompany(companyId: string) {
        return CompanyRole.find({ companyId: new Types.ObjectId(companyId) })
            .sort({ createdAt: -1 })
            .lean();
    }

    /** Find a role and verify company ownership */
    static async findByIdAndCompany(roleId: string, companyId: string) {
        return CompanyRole.findOne({
            _id: new Types.ObjectId(roleId),
            companyId: new Types.ObjectId(companyId),
        }).lean();
    }

    /** Full update (PUT) */
    static async update(roleId: string, companyId: string, dto: UpdateRoleDto) {
        const role = await CompanyRole.findOne({
            _id: new Types.ObjectId(roleId),
            companyId: new Types.ObjectId(companyId),
        });
        if (!role) throw new Error('Role not found or does not belong to this company');

        if (dto.name !== undefined) role.name = dto.name.trim();
        if (dto.description !== undefined) role.description = dto.description.trim();

        return role.save();
    }

    /** Toggle role active status */
    static async setStatus(roleId: string, companyId: string, isActive: boolean) {
        const role = await CompanyRole.findOne({
            _id: new Types.ObjectId(roleId),
            companyId: new Types.ObjectId(companyId),
        });
        if (!role) throw new Error('Role not found or does not belong to this company');

        role.isActive = isActive;
        return role.save();
    }

    /** Delete a role */
    static async delete(roleId: string, companyId: string) {
        const result = await CompanyRole.deleteOne({
            _id: new Types.ObjectId(roleId),
            companyId: new Types.ObjectId(companyId),
        });
        if (result.deletedCount === 0) {
            throw new Error('Role not found or does not belong to this company');
        }
    }
}
