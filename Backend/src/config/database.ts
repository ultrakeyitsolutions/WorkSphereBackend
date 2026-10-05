import dns from 'dns';
import mongoose from 'mongoose';
import { env } from './env';
import { performance } from 'perf_hooks';

// Ensure Node uses public DNS resolvers to handle SRV lookups reliably on Windows
try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {
    // Ignore if not supported
}

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