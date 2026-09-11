import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

/**
 * Returns a 32-byte key for AES-256-GCM.
 * Uses MFA_ENCRYPTION_KEY if set (64 hex characters);
 * otherwise securely derives a stable 32-byte key from JWT_ACCESS_SECRET.
 */
function getKey(): Buffer {
    if (env.MFA_ENCRYPTION_KEY && env.MFA_ENCRYPTION_KEY.length === 64) {
        return Buffer.from(env.MFA_ENCRYPTION_KEY, 'hex');
    }
    // Fallback: derive 32-byte key from JWT secret to avoid hardcoding secrets in source code
    const secretSource = env.JWT_ACCESS_SECRET || 'worksphere_mfa_fallback_key';
    return createHash('sha256').update(secretSource).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a colon-separated string: iv:authTag:ciphertext (all hex).
 */
export function encrypt(plaintext: string): string {
    const key = getKey();
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
        iv.toString('hex'),
        tag.toString('hex'),
        encrypted.toString('hex'),
    ].join(':');
}

/**
 * Decrypts a string produced by `encrypt()`.
 */
export function decrypt(ciphertext: string): string {
    const [ivHex, tagHex, dataHex] = ciphertext.split(':');
    if (!ivHex || !tagHex || !dataHex) {
        throw new Error('Invalid encrypted payload format');
    }

    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final(),
    ]);

    return decrypted.toString('utf8');
}
