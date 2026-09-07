import { User } from './user.model';
import { IUser } from './user.types';

export class UserService {
    static async findByEmail(email: string) {
        return User.findOne({ email })
            .populate({
                path: 'role',
                populate: {
                    path: 'permissions',
                },
            })
            .populate('grantedPermissions')
            .populate('revokedPermissions');
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
        if (role?.name === 'Admin' || role?.name === 'SUPER_ADMIN') {
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
