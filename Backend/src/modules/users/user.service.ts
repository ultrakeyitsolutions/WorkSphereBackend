import { User } from './user.model';
import { IUser } from './user.types';

export class UserService {
    static async findByEmail(email: string) {
        return User.findOne({ email }).populate({
            path: 'role',
            populate: {
                path: 'permissions',
            },
        });
    }

    static async findById(id: string) {
        return User.findById(id).populate({
            path: 'role',
            populate: {
                path: 'permissions',
            },
        });
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
}
