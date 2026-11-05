import { Response } from 'express';
import { AuthenticatedRequest } from '../../../modules/auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { MemberDeletionService } from './member-deletion.service';
import { sendSuccess } from '../../../utils/response';
import { Types } from 'mongoose';

export const deleteMember = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = (req.user?.companyId || '') as string;
    const memberId = (req.params.memberId || '') as string;
    const { deletionMode, confirmation } = req.body;

    if (!companyId || !Types.ObjectId.isValid(companyId)) {
        return res.status(400).json({ success: false, message: 'Company context not found or invalid' });
    }

    if (!memberId || !Types.ObjectId.isValid(memberId)) {
        return res.status(400).json({ success: false, message: 'Valid member ID is required' });
    }

    // Validate deletion mode
    const validModes: ('MEMBER_ONLY' | 'ENTIRE_RECORD')[] = ['MEMBER_ONLY', 'ENTIRE_RECORD'];
    if (!deletionMode || !validModes.includes(deletionMode as any)) {
        return res.status(400).json({ success: false, message: 'Invalid deletion mode. Use MEMBER_ONLY or ENTIRE_RECORD.' });
    }

    // For ENTIRE_RECORD mode, require confirmation
    if (deletionMode === 'ENTIRE_RECORD' && !confirmation) {
        return res.status(400).json({ success: false, message: 'Confirmation required for entire record deletion' });
    }

    // Get the initiator user ID from the authenticated request
    const initiatorId = req.user?.userId as string;
    if (!initiatorId) {
        return res.status(401).json({ success: false, message: 'User context not found in token' });
    }

    try {
        const result = await MemberDeletionService.deleteMember(
            new Types.ObjectId(companyId),
            new Types.ObjectId(memberId),
            deletionMode as 'MEMBER_ONLY' | 'ENTIRE_RECORD',
            new Types.ObjectId(initiatorId),
            deletionMode === 'ENTIRE_RECORD' ? confirmation : undefined
        );

        return sendSuccess(res, result.message, {
            success: true,
            message: result.message,
            data: {
                memberId: result.data.memberId,
                deletionMode: result.data.deletionMode,
                deletedRecords: {
                    memberProfile: 1,
                    userAccount: 1,
                    ...(result.data.affectedRecords?.projectsDeleted > 0 && { projects: result.data.affectedRecords.projectsDeleted }),
                    ...(result.data.affectedRecords?.tasksDeleted > 0 && { tasks: result.data.affectedRecords.tasksDeleted }),
                },
                preservedRecords: {
                    projects: 'all', // MEMBER_ONLY preserves all; ENTIRE_RECORD preserves shared ones
                    tasks: 'affected per mode',
                },
                status: result.data.status,
            },
        });
    } catch (err: any) {
        return res.status(400).json({ success: false, message: err.message || 'Member deletion failed' });
    }
});

export const getMemberDeletionPlan = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    // Preview endpoint - show what will be affected before executing
    const companyId = (req.user?.companyId || '') as string;
    const memberId = (req.params.memberId || '') as string;

    if (!companyId || !Types.ObjectId.isValid(companyId) || !memberId || !Types.ObjectId.isValid(memberId)) {
        return res.status(400).json({ success: false, message: 'Valid Company ID and Member ID are required' });
    }

    // Resolve member details
    const { companyMember: member, user: appUser, company } = await MemberDeletionService.resolveMemberDetails(
        new Types.ObjectId(companyId),
        new Types.ObjectId(memberId)
    );

    // Identify member's projects
    const { exclusivelyOwned, sharedOwned } = await MemberDeletionService.identifyMemberProjects(
        new Types.ObjectId(companyId),
        new Types.ObjectId(memberId)
    );

    // Identify member's tasks
    const memberTasks = await MemberDeletionService.identifyMemberTasks(
        new Types.ObjectId(companyId),
        new Types.ObjectId(memberId)
    );

    const plan = {
        memberId: String(member._id),
        memberName: appUser.name,
        memberEmail: appUser.email,
        companyName: company.name,
        deletionMode: 'preview' as const,
        affectedRecords: {
            companyMember: 1,
            userAccount: 1,
            projectsExclusivelyOwned: exclusivelyOwned.length,
            tasksCreated: memberTasks.length,
        },
        preservedRecords: {
            projects: {
                shared: sharedOwned.length,
                exclusivelyOwned: exclusivelyOwned.length,
                total: exclusivelyOwned.length + sharedOwned.length,
            },
            tasks: memberTasks.length,
        },
    };

    return sendSuccess(res, 'Deletion plan preview retrieved successfully', plan);
});