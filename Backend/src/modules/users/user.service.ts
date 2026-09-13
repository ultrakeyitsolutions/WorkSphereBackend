import { performance } from 'perf_hooks';
import { User } from './user.model';
import { IUser } from './user.types';

export class UserService {
    static async findByEmail(email: string) {
        const start = performance.now();

        const user = await User.findOne({ email });

        console.log(
            `[LOGIN DEBUG] User.findOne: ${(performance.now() - start).toFixed(2)}ms`
        );

        if (user && typeof (user as any).populate === 'function') {
            const populateStart = performance.now();

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

            console.log(
                `[LOGIN DEBUG] populate: ${(performance.now() - populateStart).toFixed(2)}ms`
            );
        }

        console.log(
            `[LOGIN DEBUG] findByEmail total: ${(performance.now() - start).toFixed(2)}ms`
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
