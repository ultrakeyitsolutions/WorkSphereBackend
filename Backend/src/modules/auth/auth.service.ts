import { UserService } from '../users/user.service';
import { Role } from '../roles/role.model';
import { hashPassword, comparePassword } from '../../utils/password';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/tokens';

export class AuthService {
    static async register(data: any) {
        const existingUser = await UserService.findByEmail(data.email);
        if (existingUser) {
            throw new Error('Email is already registered');
        }

        // Role resolution or creation
        const roleName = data.roleName || 'User';
        let role = await Role.findOne({ name: roleName });
        if (!role) {
            role = new Role({ name: roleName });
            await role.save();
        }

        const hashedPassword = await hashPassword(data.password);
        const user = await UserService.createUser({
            name: data.name,
            email: data.email,
            password: hashedPassword,
            role: role._id as any,
            isActive: true,
        });

        return user;
    }

    static async login(data: any) {
        const user = await UserService.findByEmail(data.email);
        if (!user) {
            throw new Error('Invalid email or password');
        }

        if (!user.isActive) {
            throw new Error('Your account is deactivated');
        }

        const isMatch = await comparePassword(data.password, user.password || '');
        if (!isMatch) {
            throw new Error('Invalid email or password');
        }

        const userRole = (user.role as any)?.name || 'User';
        const payload = {
            userId: String(user._id),
            email: user.email,
            role: userRole,
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        return {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: userRole,
            },
            accessToken,
            refreshToken,
        };
    }

    static async refresh(token: string) {
        const decoded = verifyRefreshToken(token);
        const user = await UserService.findById(decoded.userId);
        if (!user) {
            throw new Error('User not found');
        }
        if (!user.isActive) {
            throw new Error('User account is deactivated');
        }

        const userRole = (user.role as any)?.name || 'User';
        const payload = {
            userId: String(user._id),
            email: user.email,
            role: userRole,
        };

        const accessToken = generateAccessToken(payload);
        const newRefreshToken = generateRefreshToken(payload);

        return {
            accessToken,
            refreshToken: newRefreshToken,
        };
    }
}
