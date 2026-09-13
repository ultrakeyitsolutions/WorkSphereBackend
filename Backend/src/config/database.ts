import mongoose from 'mongoose';
import { env } from './env';
import { performance } from 'perf_hooks';

export const connectDatabase = async (): Promise<void> => {
    const start = performance.now();
    try {
        await mongoose.connect(env.MONGODB_URI);

        console.log(
            `[DB] mongoose.connect: ${(performance.now() - start).toFixed(2)}ms`
        );

        console.log('Successfully connected to MongoDB.');

        const pingStart = performance.now();
        await mongoose.connection.db?.command({ ping: 1 });
        console.log(
            `[DB] ping: ${(performance.now() - pingStart).toFixed(2)}ms`
        );
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
    }
};