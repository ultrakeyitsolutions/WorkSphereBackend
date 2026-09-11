import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a colon-separated string: iv:authTag:ciphertext (all hex).
 */
export function encrypt(plaintext: string): string {
    const key = Buffer.from(env.MFA_ENCRYPTION_KEY, 'hex');
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

    const key = Buffer.from(env.MFA_ENCRYPTION_KEY, 'hex');
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
