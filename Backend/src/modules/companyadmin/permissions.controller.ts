import { Response } from 'express';
import { sendSuccess, sendError } from '../../utils/response';
import { AuthenticatedRequest } from '../auth/auth.types';
import { User } from '../users/user.model';
import { Permission } from '../permissions/permission.model';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { Types } from 'mongoose';

export class PermissionsController {
    static async updateBulkPermissions(req: AuthenticatedRequest, res: Response) {
        try {
            const requester = req.user;
            if (!requester || !requester.companyId) {
                return sendError(res, 'User context or company not found', 401);
            }

            const { userIds, changes } = req.body;
            if (!Array.isArray(userIds) || userIds.length === 0) {
                return sendError(res, 'userIds must be a non-empty array', 400);
            }

            if (!changes || typeof changes !== 'object') {
                return sendError(res, 'Invalid changes payload', 400);
            }

            const grants: string[] = Array.isArray(changes.grant) ? changes.grant : [];
            const revokes: string[] = Array.isArray(changes.revoke) ? changes.revoke : [];

            // Ensure no overlap between grants and revokes in the request itself
            const overlap = grants.some(g => revokes.includes(g));
            if (overlap) {
                return sendError(res, 'A permission cannot be both granted and revoked in the same request', 400);
            }

            const ALLOWED_PERMISSIONS = [
                'QUICK_MEETING_CREATE',
                'LIVE_MONITORING_READ',
                'USER_REVIEW_READ'
            ];

            const finalGrants = [...new Set(grants)];
            const finalRevokes = [...new Set(revokes)];

            const allPermissionNames = [...new Set([...finalGrants, ...finalRevokes])];

            const isValid = allPermissionNames.every(p => ALLOWED_PERMISSIONS.includes(p));
            if (!isValid) {
                return sendError(res, 'One or more requested permissions are not allowed to be managed via this API', 400);
            }
            
            let permissionDocs: any[] = [];
            if (allPermissionNames.length > 0) {
                permissionDocs = await Permission.find({ name: { $in: allPermissionNames } });
                if (permissionDocs.length !== allPermissionNames.length) {
                    return sendError(res, 'One or more requested permissions do not exist', 400);
                }
            }

            // Boundary Check for Company Admin
            const userRole = requester.role as any;
            if (userRole?.name === 'COMPANY_ADMIN') {
                for (const doc of permissionDocs) {
                    if (doc.scope !== 'COMPANY_MEMBER' || !doc.assignableBy.includes('COMPANY_ADMIN')) {
                        return sendError(res, `Forbidden: You are not authorized to assign the permission ${doc.name}`, 403);
                    }
                }
            }

            // Map string names to their resolved ObjectIds
            const nameToIdMap = new Map();
            permissionDocs.forEach(doc => {
                nameToIdMap.set(doc.name, doc._id);
            });

            const grantIds = finalGrants.map(name => String(nameToIdMap.get(name)));
            const revokeIds = finalRevokes.map(name => String(nameToIdMap.get(name)));

            // Load and verify users
            const targetUsers = await User.find({ _id: { $in: userIds } });
            
            if (targetUsers.length !== new Set(userIds).size) {
                return sendError(res, 'One or more users not found', 404);
            }

            for (const user of targetUsers) {
                if (String(user.companyId) !== String(requester.companyId)) {
                    return sendError(res, 'Forbidden: Cannot modify users from another company', 403);
                }
            }

            const updatedUsers = [];

            // Apply updates
            for (const user of targetUsers) {
                // Ensure arrays are initialized
                const currentGranted = (user.grantedPermissions || []).map(id => String(id));
                const currentRevoked = (user.revokedPermissions || []).map(id => String(id));

                const newGrantedSet = new Set(currentGranted);
                const newRevokedSet = new Set(currentRevoked);

                // Apply new grants: add to granted, remove from revoked
                for (const g of grantIds) {
                    newGrantedSet.add(g);
                    newRevokedSet.delete(g);
                }

                // Apply new revokes: add to revoked, remove from granted
                for (const r of revokeIds) {
                    newRevokedSet.add(r);
                    newGrantedSet.delete(r);
                }

                user.grantedPermissions = Array.from(newGrantedSet).map(id => new Types.ObjectId(id)) as any;
                user.revokedPermissions = Array.from(newRevokedSet).map(id => new Types.ObjectId(id)) as any;

                await user.save();
                updatedUsers.push({
                    id: user._id,
                    grantedPermissions: user.grantedPermissions,
                    revokedPermissions: user.revokedPermissions
                });
            }

            // Log Audit
            await AuditLogService.log({
                action: AuditAction.USER_PERMISSIONS_UPDATED,
                actorId: requester.userId as any,
                targetUserId: null,
                companyId: requester.companyId as any,
                success: true,
                description: `Bulk updated permissions for ${userIds.length} user(s). Granted: ${grants.length}, Revoked: ${revokes.length}`,
                metadata: {
                    targetUserIds: userIds,
                    changes
                },
                req
            });

            return sendSuccess(res, 'User access updated successfully', { updatedUsers });
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to update permissions', 500);
        }
    }
}
