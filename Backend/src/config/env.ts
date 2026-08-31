import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const requiredEnv = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET'
];

const isTest = process.env.NODE_ENV === 'test';

// Check required environment variables
for (const key of requiredEnv) {
    if (!isTest && !process.env[key]) {
        throw new Error(`Configuration Error: Environment variable "${key}" is required but not defined.`);
    }
}

export const env = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '5000', 10),
    MONGODB_URI: (process.env.MONGODB_URI || 'mongodb://localhost:27017/worksphere_test') as string,
    JWT_ACCESS_SECRET: (process.env.JWT_ACCESS_SECRET || 'test_access_secret_1234567890') as string,
    JWT_REFRESH_SECRET: (process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_1234567890') as string,
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
};
