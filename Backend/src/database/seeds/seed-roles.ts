import { Role } from '../../modules/roles/role.model';
import { Permission } from '../../modules/permissions/permission.model';
import { Types } from 'mongoose';

export interface RoleSeedResult {
    created: number;
    updated: number;
    total: number;
}

export const BASE_MEMBER_PERMISSION_NAMES = [
    'DASHBOARD_READ',
    'PROJECT_READ',
    'TASK_READ',
    'MEETING_READ',
    'REPORT_READ',
    'NOTIFICATION_SOUND_READ',
];

/**
 * Idempotently seeds system roles:
 * - SUPER_ADMIN (assigned ALL permissions)
 * - COMPANY_ADMIN (assigned all COMPANY_MEMBER permissions)
 * - User / EMPLOYEE (assigned standard base member permissions)
 *
 * Never removes existing customized permissions on roles.
 */
export async function seedRoles(dryRun = false): Promise<RoleSeedResult> {
    const allPermissions = await Permission.find({}).lean();
    const allPermissionIds = allPermissions.map((p) => p._id as Types.ObjectId);

    const memberPermissions = allPermissions.filter((p) => p.scope === 'COMPANY_MEMBER');
    const memberPermissionIds = memberPermissions.map((p) => p._id as Types.ObjectId);

    const basePermissions = allPermissions.filter((p) =>
        BASE_MEMBER_PERMISSION_NAMES.includes(p.name)
    );
    const basePermissionIds = basePermissions.map((p) => p._id as Types.ObjectId);

    const roleDefinitions = [
        {
            name: 'SUPER_ADMIN',
            description: 'System Super Administrator with unrestricted platform-wide access',
            targetPermissionIds: allPermissionIds,
        },
        {
            name: 'COMPANY_ADMIN',
            description: 'Tenant Administrator with management authority across all company modules',
            targetPermissionIds: memberPermissionIds,
        },
        {
            name: 'User',
            description: 'Standard company workspace member',
            targetPermissionIds: basePermissionIds,
        },
        {
            name: 'EMPLOYEE',
            description: 'Standard company employee role',
            targetPermissionIds: basePermissionIds,
        },
    ];

    let created = 0;
    let updated = 0;

    for (const def of roleDefinitions) {
        const existingRole = await Role.findOne({ name: def.name });

        if (!existingRole) {
            if (!dryRun) {
                await Role.create({
                    name: def.name,
                    permissions: def.targetPermissionIds as any,
                });
            }
            created++;
        } else {
            const currentIds = (existingRole.permissions || []).map(String);
            const missingIds = def.targetPermissionIds.filter(
                (id) => !currentIds.includes(String(id))
            );

            if (missingIds.length > 0) {
                if (!dryRun) {
                    existingRole.permissions.push(...(missingIds as any));
                    await existingRole.save();
                }
                updated++;
            }
        }
    }

    return {
        created,
        updated,
        total: roleDefinitions.length,
    };
}
