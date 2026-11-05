import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { User } from './user.model';
import { CompanyMember } from '../companyadmin/invitations/company-member.model';
import { sendSuccess, sendError } from '../../utils/response';
import { catchAsync } from '../../utils/catchAsync';
import { AppError } from '../../utils/AppError';

export class UserProfileController {
    /**
     * GET /api/v1/user/profile
     * GET /api/v1/member/profile
     * Fetch the logged-in user's profile with completeness and mandatory requirements status.
     */
    static getProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const userId = req.user?.userId;
        if (!userId) {
            throw AppError.unauthorized('User context is required');
        }

        const user = await User.findById(userId)
            .select('-password')
            .populate('role', 'name description')
            .populate('companyId', 'name logoUrl size industry domain')
            .lean();

        if (!user) {
            throw AppError.notFound('User not found');
        }

        // Fetch company member metadata if user belongs to a company
        let memberDetails: any = null;
        if (user.companyId) {
            memberDetails = await CompanyMember.findOne({
                userId: user._id,
                companyId: (user.companyId as any)._id || user.companyId
            })
                .populate('roleId', 'name')
                .populate('designationId', 'name')
                .lean();
        }

        // Mandatory profile requirements evaluation
        const missingRequirements: string[] = [];
        if (!user.avatar || user.avatar.trim() === '') {
            missingRequirements.push('AVATAR_MISSING');
        }
        if (!user.phoneNumber || user.phoneNumber.trim() === '') {
            missingRequirements.push('PHONE_MISSING');
        }
        if (!user.name || user.name.trim() === '') {
            missingRequirements.push('NAME_MISSING');
        }

        const totalRequirements = 3;
        const completedRequirements = totalRequirements - missingRequirements.length;
        const completionPercentage = Math.round((completedRequirements / totalRequirements) * 100);
        const isProfileComplete = missingRequirements.length === 0;

        return sendSuccess(res, 'Profile retrieved successfully', {
            id: user._id,
            name: user.name,
            email: user.email,
            phoneNumber: (user as any).phoneNumber || null,
            avatar: (user as any).avatar || null,
            status: user.status,
            role: user.role,
            company: user.companyId,
            member: memberDetails
                ? {
                    designation: memberDetails.designationId,
                    biometricId: memberDetails.biometricId || null,
                    status: memberDetails.status,
                    joinedAt: memberDetails.joinedAt
                }
                : null,
            requirements: {
                isProfileComplete,
                completionPercentage,
                missingRequirements,
                mandatoryNotice: !isProfileComplete
                    ? 'Mandatory Requirement: Please upload your profile photo and verify contact details.'
                    : null
            }
        });
    });

    /**
     * PATCH /api/v1/user/profile
     * PUT /api/v1/user/profile
     * PATCH /api/v1/member/profile
     * Update the logged-in user's profile (name, phone, avatar/profile image).
     */
    static updateProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const userId = req.user?.userId;
        if (!userId) {
            throw AppError.unauthorized('User context is required');
        }

        const { name, phoneNumber, avatar } = req.body;

        const updateFields: Record<string, any> = {};
        if (typeof name === 'string' && name.trim()) {
            updateFields.name = name.trim();
        }
        if (phoneNumber !== undefined) {
            updateFields.phoneNumber = phoneNumber ? String(phoneNumber).trim() : null;
        }
        if (avatar !== undefined) {
            updateFields.avatar = avatar ? String(avatar).trim() : null;
        }

        if (Object.keys(updateFields).length === 0) {
            throw AppError.badRequest('No valid profile fields provided for update');
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateFields },
            { returnDocument: 'after', runValidators: true }
        )
            .select('-password')
            .populate('role', 'name description')
            .populate('companyId', 'name logoUrl size industry domain')
            .lean();

        if (!updatedUser) {
            throw AppError.notFound('User not found');
        }

        // Recompute completeness
        const missingRequirements: string[] = [];
        if (!updatedUser.avatar || updatedUser.avatar.trim() === '') {
            missingRequirements.push('AVATAR_MISSING');
        }
        if (!updatedUser.phoneNumber || updatedUser.phoneNumber.trim() === '') {
            missingRequirements.push('PHONE_MISSING');
        }
        if (!updatedUser.name || updatedUser.name.trim() === '') {
            missingRequirements.push('NAME_MISSING');
        }

        const totalRequirements = 3;
        const completedRequirements = totalRequirements - missingRequirements.length;
        const completionPercentage = Math.round((completedRequirements / totalRequirements) * 100);
        const isProfileComplete = missingRequirements.length === 0;

        return sendSuccess(res, 'Profile updated successfully', {
            id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            phoneNumber: (updatedUser as any).phoneNumber || null,
            avatar: (updatedUser as any).avatar || null,
            status: updatedUser.status,
            role: updatedUser.role,
            company: updatedUser.companyId,
            requirements: {
                isProfileComplete,
                completionPercentage,
                missingRequirements,
                mandatoryNotice: !isProfileComplete
                    ? 'Mandatory Requirement: Please upload your profile photo and verify contact details.'
                    : null
            }
        });
    });
}
