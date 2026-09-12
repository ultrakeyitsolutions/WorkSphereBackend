import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const requiredEnv = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
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
    APP_URL: process.env.APP_URL || 'http://localhost:3000',

    MONGODB_URI: (process.env.MONGODB_URI || 'mongodb://localhost:27017/worksphere_test') as string,
    JWT_ACCESS_SECRET: (process.env.JWT_ACCESS_SECRET || 'test_access_secret_1234567890') as string,
    JWT_REFRESH_SECRET: (process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_1234567890') as string,
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',

    // ── Mail ─────────────────────────────────────────────────────────────────
    MAIL_DRIVER: (process.env.MAIL_DRIVER || 'smtp') as string,
    MAIL_HOST: (process.env.MAIL_HOST || 'smtp.mailtrap.io') as string,
    MAIL_PORT: parseInt(process.env.MAIL_PORT || '587', 10),
    MAIL_USERNAME: (process.env.MAIL_USERNAME || '') as string,
    MAIL_PASSWORD: (process.env.MAIL_PASSWORD || '') as string,
    MAIL_ENCRYPTION: (process.env.MAIL_ENCRYPTION || 'tls') as string,   // 'tls' | 'ssl' | 'none'
    MAIL_FROM_ADDRESS: (process.env.MAIL_FROM_ADDRESS || 'noreply@worksphere.com') as string,
    MAIL_FROM_NAME: (process.env.MAIL_FROM_NAME || 'WorkSphere') as string,

    // Invitation token TTL (days)
    INVITATION_EXPIRES_DAYS: parseInt(process.env.INVITATION_EXPIRES_DAYS || '7', 10),

    // ── MFA ──────────────────────────────────────────────────────────────────
    // 32-byte hex key for AES-256-GCM encryption of TOTP secrets.
    // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    MFA_ENCRYPTION_KEY: (process.env.MFA_ENCRYPTION_KEY || '') as string,

    // ── Global Storage (Fallback for development/test) ────────────────────────
    BUNNY_STORAGE_ZONE: (process.env.BUNNY_STORAGE_ZONE || '') as string,
    BUNNY_STORAGE_ACCESS_KEY: (process.env.BUNNY_STORAGE_ACCESS_KEY || '') as string,
    BUNNY_STORAGE_REGION: (process.env.BUNNY_STORAGE_REGION || '') as string,
    BUNNY_PULL_ZONE_URL: (process.env.BUNNY_PULL_ZONE_URL || '') as string,
    BUNNY_STORAGE_BASE_PATH: (process.env.BUNNY_STORAGE_BASE_PATH || 'worksphere') as string,
};
