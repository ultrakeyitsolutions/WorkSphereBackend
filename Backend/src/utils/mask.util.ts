/**
 * Safely masks an email address for structured logging without leaking PII.
 * Example: 'superadmin@uworksphere.com' -> 's***n@uworksphere.com'
 */
export function maskEmail(email?: string | null): string {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
        return '***';
    }
    const [local, domain] = email.split('@');
    if (!local || local.length === 0) {
        return `***@${domain || 'unknown'}`;
    }
    if (local.length <= 2) {
        return `${local[0]}***@${domain}`;
    }
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
}
