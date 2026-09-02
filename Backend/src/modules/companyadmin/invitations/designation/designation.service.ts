import { Types } from 'mongoose';
import { Designation } from './designation.model';

export interface CreateDesignationDto {
    companyId: string;
    name: string;
    description?: string;
    createdBy: string;
}

export interface UpdateDesignationDto {
    name?: string;
    description?: string;
}

export class DesignationService {

    static async create(dto: CreateDesignationDto) {
        const desig = new Designation({
            companyId: new Types.ObjectId(dto.companyId),
            name: dto.name.trim(),
            description: dto.description?.trim(),
            createdBy: new Types.ObjectId(dto.createdBy),
        });
        return desig.save();
    }

    static async listByCompany(companyId: string) {
        return Designation.find({ companyId: new Types.ObjectId(companyId) })
            .sort({ createdAt: -1 })
            .lean();
    }

    static async findByIdAndCompany(designationId: string, companyId: string) {
        return Designation.findOne({
            _id: new Types.ObjectId(designationId),
            companyId: new Types.ObjectId(companyId),
        }).lean();
    }

    static async update(designationId: string, companyId: string, dto: UpdateDesignationDto) {
        const desig = await Designation.findOne({
            _id: new Types.ObjectId(designationId),
            companyId: new Types.ObjectId(companyId),
        });
        if (!desig) throw new Error('Designation not found or does not belong to this company');

        if (dto.name !== undefined) desig.name = dto.name.trim();
        if (dto.description !== undefined) desig.description = dto.description.trim();

        return desig.save();
    }

    static async setStatus(designationId: string, companyId: string, isActive: boolean) {
        const desig = await Designation.findOne({
            _id: new Types.ObjectId(designationId),
            companyId: new Types.ObjectId(companyId),
        });
        if (!desig) throw new Error('Designation not found or does not belong to this company');

        desig.isActive = isActive;
        return desig.save();
    }

    static async delete(designationId: string, companyId: string) {
        const result = await Designation.deleteOne({
            _id: new Types.ObjectId(designationId),
            companyId: new Types.ObjectId(companyId),
        });
        if (result.deletedCount === 0) {
            throw new Error('Designation not found or does not belong to this company');
        }
    }
}
