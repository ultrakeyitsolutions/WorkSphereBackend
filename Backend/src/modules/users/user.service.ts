import { performance } from 'perf_hooks';
import { User } from './user.model';
import { IUser } from './user.types';

export class UserService {
    static async findByEmail(email: string) {
        // [PERF DEBUG] Measure individual find and populate operations
        const totalStart = performance.now();

        // 1. User.findOne
        const findStart = performance.now();
        const user = await User.findOne({ email });
        console.log(
            `[LOGIN DEBUG] 1. User.findOne: ${(performance.now() - findStart).toFixed(2)}ms`
        );

        if (user && typeof (user as any).populate === 'function') {
            const populateTotalStart = performance.now();

            // 2. populate role
            const roleStart = performance.now();
            await (user as any).populate('role');
            console.log(
                `[LOGIN DEBUG] 2. populate role: ${(performance.now() - roleStart).toFixed(2)}ms`
            );

            // 3. populate role.permissions
            const rolePermStart = performance.now();
            if (user.role) {
                if (typeof (user.role as any).populate === 'function') {
                    await (user.role as any).populate('permissions');
                } else if (typeof (user as any).populate === 'function') {
                    await (user as any).populate({ path: 'role.permissions' });
                }
            }
            console.log(
                `[LOGIN DEBUG] 3. populate role.permissions: ${(performance.now() - rolePermStart).toFixed(2)}ms`
            );

            // 4. populate grantedPermissions
            const grantedStart = performance.now();
            await (user as any).populate('grantedPermissions');
            console.log(
                `[LOGIN DEBUG] 4. populate grantedPermissions: ${(performance.now() - grantedStart).toFixed(2)}ms`
            );

            // 5. populate revokedPermissions
            const revokedStart = performance.now();
            await (user as any).populate('revokedPermissions');
            console.log(
                `[LOGIN DEBUG] 5. populate revokedPermissions: ${(performance.now() - revokedStart).toFixed(2)}ms`
            );

            console.log(
                `[LOGIN DEBUG] populate total: ${(performance.now() - populateTotalStart).toFixed(2)}ms`
            );
        }

        // 6. total findByEmail time
        console.log(
            `[LOGIN DEBUG] 6. findByEmail total: ${(performance.now() - totalStart).toFixed(2)}ms`
        );

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
