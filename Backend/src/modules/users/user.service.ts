import { performance } from 'perf_hooks';
import { User } from './user.model';
import { IUser } from './user.types';
import { Role } from '../roles/role.model';
import { Permission } from '../permissions/permission.model';

export class UserService {
    static async findByEmail(email: string) {
        // =========================================================================
        // [TEMPORARY PERFORMANCE DIAGNOSTIC: ROLE & PERMISSION INVESTIGATION]
        // =========================================================================
        const diagTotalStart = performance.now();

        // A. User.findOne({ email }) without any populate
        const userStart = performance.now();
        const user = await User.findOne({ email });
        const userQueryTime = performance.now() - userStart;

        if (!user) {
            return null;
        }

        let roleQueryTime = 0;
        let rolePermissionCount = 0;
        let permQueryTime = 0;
        let permResultCount = 0;
        let permHydrationTime = 0;
        let permFindMongooseTime = 0;

        try {
            // B. Fetch the Role document separately using user's role ObjectId
            const roleId = (user.role as any)?._id || user.role;
            if (roleId) {
                const roleStart = performance.now();
                const roleDoc = typeof Role.findById === 'function'
                    ? await Role.findById(roleId)
                    : (typeof Role.findOne === 'function' ? await Role.findOne({ _id: roleId }) : null);
                roleQueryTime = performance.now() - roleStart;

                // C. Extract role.permissions ObjectIds & count
                const permIds = (roleDoc?.permissions || []) as any[];
                rolePermissionCount = permIds.length;

                if (permIds.length > 0) {
                    // D. Measure raw query time (pure MongoDB wire & query time, 0 Mongoose hydration)
                    const rawStart = performance.now();
                    const rawDocs = await Permission.collection
                        .find({ _id: { $in: permIds } })
                        .toArray();
                    permQueryTime = performance.now() - rawStart;
                    permResultCount = rawDocs.length;

                    // E. Measure Mongoose Permission.find (query + Mongoose Document hydration)
                    const mStart = performance.now();
                    await Permission.find({ _id: { $in: permIds } });
                    permFindMongooseTime = performance.now() - mStart;

                    // F. Measure pure in-memory Mongoose Document hydration
                    const hydrateStart = performance.now();
                    rawDocs.forEach((doc: any) => Permission.hydrate(doc));
                    const directHydrateTime = performance.now() - hydrateStart;

                    permHydrationTime = directHydrateTime > 0
                        ? directHydrateTime
                        : Math.max(0, permFindMongooseTime - permQueryTime);
                }
            }
        } catch (diagErr) {
            console.warn('[DIAGNOSTIC] Warning during diagnostic execution:', diagErr);
        }

        const diagTotalTime = performance.now() - diagTotalStart;

        console.log(`[DIAGNOSTIC] ───────────────────────────────────────────────`);
        console.log(`[DIAGNOSTIC] User query: ${userQueryTime.toFixed(2)} ms`);
        console.log(`[DIAGNOSTIC] Role query: ${roleQueryTime.toFixed(2)} ms`);
        console.log(`[DIAGNOSTIC] Role permission count: ${rolePermissionCount}`);
        console.log(`[DIAGNOSTIC] Permission query: ${permQueryTime.toFixed(2)} ms`);
        console.log(`[DIAGNOSTIC] Permission find (Mongoose total): ${permFindMongooseTime.toFixed(2)} ms`);
        console.log(`[DIAGNOSTIC] Permission processing/hydration: ${permHydrationTime.toFixed(2)} ms`);
        console.log(`[DIAGNOSTIC] Permission result count: ${permResultCount}`);
        console.log(`[DIAGNOSTIC] Total diagnostic time: ${diagTotalTime.toFixed(2)} ms`);
        console.log(`[DIAGNOSTIC] ───────────────────────────────────────────────`);
        // =========================================================================
        // [END TEMPORARY PERFORMANCE DIAGNOSTIC]
        // =========================================================================

        // Preserve exact existing login behavior: populate user before returning
        if (typeof (user as any).populate === 'function') {
            await (user as any).populate([
                {
                    path: 'role',
                    populate: {
                        path: 'permissions',
                    },
                },
                {
                    path: 'grantedPermissions',
                },
                {
                    path: 'revokedPermissions',
                },
            ]);
        }

        return user;
    }

    static async findById(id: string) {
        return User.findById(id)
            .populate({
                path: 'role',
                populate: {
                    path: 'permissions',
                },
            })
            .populate('grantedPermissions')
            .populate('revokedPermissions');
    }

    static async createUser(data: Partial<IUser> & { password: string }) {
        const user = new User(data);
        await user.save();
        const populatedUser = await this.findById(String(user._id));
        if (!populatedUser) {
            throw new Error('Failed to create and retrieve user');
        }
        return populatedUser;
    }

    static async hasPermission(userId: string, requiredPermission: string): Promise<boolean> {
        const user = await this.findById(userId);
        if (!user) return false;

        const role = user.role as any;
        const roleName = (typeof role === 'string' ? role : role?.name || '').toUpperCase();
        if (roleName === 'ADMIN' || roleName === 'SUPER_ADMIN' || roleName === 'COMPANY_ADMIN') {
            return true;
        }

        const baseRolePermissions: string[] = (role?.permissions || []).map(
            (perm: any) => (typeof perm === 'object' && perm ? perm.name : '')
        ).filter(Boolean);

        const grantedPermissions: string[] = ((user as any).grantedPermissions || []).map(
            (perm: any) => (typeof perm === 'object' && perm ? perm.name : '')
        ).filter(Boolean);

        const revokedPermissions: string[] = ((user as any).revokedPermissions || []).map(
            (perm: any) => (typeof perm === 'object' && perm ? perm.name : '')
        ).filter(Boolean);

        const effectivePermissionsSet = new Set(baseRolePermissions);
        grantedPermissions.forEach(perm => effectivePermissionsSet.add(perm));
        revokedPermissions.forEach(perm => effectivePermissionsSet.delete(perm));

        return effectivePermissionsSet.has(requiredPermission);
    }
}
