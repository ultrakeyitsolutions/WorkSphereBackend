import argon2 from 'argon2';

export const hashPassword = async (password: string): Promise<string> => {
    return argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536, // 64MB memory
        timeCost: 3,       // 3 iterations
        parallelism: 4,    // 4 threads
    });
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
    try {
        return await argon2.verify(hash, password);
    } catch (error) {
        return false;
    }
};
