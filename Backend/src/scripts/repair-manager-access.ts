import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { Role } from '../modules/roles/role.model';
import { User } from '../modules/users/user.model';
import { CompanyMember } from '../modules/companyadmin/invitations/company-member.model';
import { ManagerPermission } from '../modules/manager/models/manager-permission.model';
import { ManagerAssignment } from '../modules/manager/models/manager-assignment.model';
import { Team } from '../modules/teams/team.model';
import {
    DEFAULT_MANAGER_PERMISSIONS,
    ManagerAccessLevel,
    ManagerAssignmentType,
} from '../modules/manager/constants/manager.constants';
import { TeamAccessService } from '../modules/manager/services/team-access.service';

dotenv.config();

/**
 * Repairs manager access for members typed as MANAGER that never received:
 *   1. a ManagerPermission record  -> every /v1/manager/* route answers 403
 *      "Missing required manager permission: ..." (resolveScope yields no permissions)
 *   2. a team scope (assignment / lead / manager) -> GET /v1/manager/teams returns []
 *
 * Usage:
 *   npm run repair:manager-access
 *   npm run repair:manager-access -- --dry-run
 *   npm run repair:manager-access -- --no-assignments
 *   npm run repair:manager-access -- --email=someone@corp.com
 */

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipAssignments = args.includes('--no-assignments');
const emailFilter = args.find((a) => a.startsWith('--email='))?.split('=')[1]?.toLowerCase();

const log = (msg: string) => console.log(msg);

async function resolveActorId(companyId: mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId> {
    const adminRoles = await Role.find({ name: { $in: ['COMPANY_ADMIN', 'ADMIN', 'SUPER_ADMIN'] } })
        .select('_id')
        .lean();
    const adminMember = await CompanyMember.findOne({
        companyId,
        roleId: { $in: adminRoles.map((r) => r._id) },
        status: 'ACTIVE',
    })
        .select('userId')
        .lean();
    return (adminMember?.userId as mongoose.Types.ObjectId) ?? (null as any);
}

async function main() {
    await connectDatabase();
    log(`\n${dryRun ? '[DRY RUN] ' : ''}Repairing manager access...\n`);

    const members = await CompanyMember.find({ status: 'ACTIVE', memberType: 'MANAGER' })
        .select('companyId userId memberType status')
        .lean();

    if (members.length === 0) {
        log('No ACTIVE members with memberType=MANAGER found. Nothing to do.');
        await mongoose.disconnect();
        return;
    }

    const summary = {
        permissionsCreated: 0,
        permissionsRepaired: 0,
        assignmentsCreated: 0,
        alreadyHealthy: 0,
        orphaned: [] as string[],
        noTeamMembership: [] as string[],
    };

    for (const member of members) {
        const companyId = member.companyId as mongoose.Types.ObjectId;
        const userId = member.userId as mongoose.Types.ObjectId;

        const user = await User.findById(userId).select('email name').lean();
        const label = `• ${String(userId)} (${String(companyId).slice(-6)})`;

        // Orphaned membership: the user account is gone, so no request can ever
        // authenticate as this manager. Skip instead of writing dead records.
        if (!user) {
            summary.orphaned.push(String(userId));
            log(`${label}\n    SKIPPED: no user account exists for this member record`);
            continue;
        }

        const email = (user as any)?.email ?? String(userId);
        if (emailFilter && String(email).toLowerCase() !== emailFilter) continue;

        const actorId = await resolveActorId(companyId);
        const prefixed = `• ${email} (${String(companyId).slice(-6)})`;

        // ── 1. ManagerPermission record ───────────────────────────────────────
        const perm = await ManagerPermission.findOne({ companyId, managerId: userId }).lean();
        let permState = 'ok';

        if (!perm) {
            permState = 'missing -> create';
            summary.permissionsCreated++;
            if (!dryRun) {
                await ManagerPermission.create({
                    companyId,
                    managerId: userId,
                    permissions: [...DEFAULT_MANAGER_PERMISSIONS],
                    restrictions: [],
                    isSuspended: false,
                    grantedBy: actorId ?? userId,
                    updatedBy: actorId ?? userId,
                });
            }
        } else if ((perm.permissions || []).length === 0) {
            permState = 'empty -> default';
            summary.permissionsRepaired++;
            if (!dryRun) {
                await ManagerPermission.updateOne(
                    { _id: perm._id },
                    { $set: { permissions: [...DEFAULT_MANAGER_PERMISSIONS], restrictions: [], updatedBy: actorId ?? userId } }
                );
            }
        }

        // ── 2. Team scope ────────────────────────────────────────────────────
        const activeAssignments = await ManagerAssignment.countDocuments({
            companyId,
            managerId: userId,
            isActive: true,
        });
        const ledTeams = await Team.countDocuments({
            companyId,
            $or: [{ leadId: userId }, { managerIds: userId }],
            isActive: true,
            isArchived: false,
        });

        let teamState = 'already scoped';
        const hasScope = activeAssignments > 0 || ledTeams > 0;

        if (!hasScope && skipAssignments) {
            teamState = 'skipped (--no-assignments)';
        } else if (!hasScope) {
            const memberTeams = await Team.find({
                companyId,
                memberIds: userId,
                isActive: true,
                isArchived: false,
            })
                .select('name')
                .lean();

            if (memberTeams.length === 0) {
                teamState = 'NO TEAM MEMBERSHIP';
                summary.noTeamMembership.push(String(email));
            } else {
                teamState = `${memberTeams.map((t) => t.name).join(', ')} -> assignment`;
                summary.assignmentsCreated += memberTeams.length;
                if (!dryRun) {
                    for (let i = 0; i < memberTeams.length; i++) {
                        const team = memberTeams[i];
                        const already = await ManagerAssignment.exists({
                            companyId,
                            managerId: userId,
                            teamId: team._id,
                            isActive: true,
                        });
                        if (already) continue;
                        await ManagerAssignment.create({
                            companyId,
                            managerId: userId,
                            assignmentType:
                                i === 0 ? ManagerAssignmentType.PRIMARY_TEAM : ManagerAssignmentType.ADDITIONAL_TEAM,
                            teamId: team._id,
                            accessLevel: ManagerAccessLevel.FULL,
                            permissions: [],
                            isActive: true,
                            startDate: new Date(),
                            assignedBy: actorId ?? userId,
                        });
                    }
                }
            }
        } else {
            summary.alreadyHealthy++;
        }

        log(`${prefixed}\n    permissions: ${permState}\n    teams:       ${teamState}`);
    }

    if (!dryRun) {
        for (const member of members) {
            await TeamAccessService.invalidateScopeCache(
                String(member.companyId),
                String(member.userId)
            );
        }
    }

    log(`\n─────────────────────────────────────────────`);
    log(`${dryRun ? '[DRY RUN] ' : ''}Summary`);
    log(`  permission records created : ${summary.permissionsCreated}`);
    log(`  permission records repaired : ${summary.permissionsRepaired}`);
    log(`  team assignments created   : ${summary.assignmentsCreated}`);
    log(`  managers already healthy   : ${summary.alreadyHealthy}`);
    if (summary.orphaned.length > 0) {
        log(`  ⚠ Orphaned member records (no user account) : ${summary.orphaned.length}`);
        summary.orphaned.forEach((id) => log(`    - ${id}`));
    }
    if (summary.noTeamMembership.length > 0) {
        log(`\n  ⚠ Still with NO team scope (assign a team via`);
        log(`    POST /api/v1/companyadmin/managers/:managerId/assignments):`);
        summary.noTeamMembership.forEach((e) => log(`    - ${e}`));
    }
    if (dryRun) {
        log(`\n  (dry run - no writes performed)`);
    }
    log('');

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(async (e) => {
    console.error('repair:manager-access failed:', e?.message || e);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
