import { z } from 'zod';

/**
 * Checks whether an outbound destination host is safe from SSRF attacks.
 * Blocks private networks, cloud metadata services, loopback, and internal TLDs.
 */
export function isSafeOutboundHost(hostRaw: string): boolean {
    if (!hostRaw || typeof hostRaw !== 'string') return false;

    const host = hostRaw.trim().toLowerCase();

    // 1. Block empty or localhost variants
    if (
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host === '::1' ||
        host === '[::1]'
    ) {
        return false;
    }

    // 2. Block internal / cloud metadata domains
    const blockedSuffixes = [
        '.local',
        '.internal',
        '.lan',
        '.home',
        '.corp',
        '.domain',
        'metadata.google.internal',
        'instance-data',
        '169.254.169.254',
    ];
    for (const suffix of blockedSuffixes) {
        if (host === suffix || host.endsWith(suffix)) {
            return false;
        }
    }

    // 3. IPv4 pattern check
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = host.match(ipv4Regex);
    if (ipv4Match) {
        const [, o1Str, o2Str, o3Str, o4Str] = ipv4Match;
        const o1 = parseInt(o1Str, 10);
        const o2 = parseInt(o2Str, 10);
        const o3 = parseInt(o3Str, 10);
        const o4 = parseInt(o4Str, 10);

        if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return false;

        // 127.0.0.0/8 (Loopback)
        if (o1 === 127) return false;
        // 0.0.0.0/8 (Current network)
        if (o1 === 0) return false;
        // 10.0.0.0/8 (Private RFC 1918)
        if (o1 === 10) return false;
        // 172.16.0.0/12 (Private RFC 1918: 172.16 - 172.31)
        if (o1 === 172 && o2 >= 16 && o2 <= 31) return false;
        // 192.168.0.0/16 (Private RFC 1918)
        if (o1 === 192 && o2 === 168) return false;
        // 169.254.0.0/16 (Link-local / Cloud metadata)
        if (o1 === 169 && o2 === 254) return false;
        // 100.64.0.0/10 (Carrier-grade NAT: 100.64 - 100.127)
        if (o1 === 100 && o2 >= 64 && o2 <= 127) return false;
        // Broadcast (255.255.255.255) or Multicast (224.0.0.0/4: 224-239)
        if (o1 >= 224) return false;
    }

    // 4. IPv6 check
    if (host.includes(':')) {
        const cleanIpv6 = host.replace(/^\[|\]$/g, '');
        if (cleanIpv6 === '::1' || cleanIpv6 === '::' || cleanIpv6.startsWith('fe80:') || cleanIpv6.startsWith('fc') || cleanIpv6.startsWith('fd')) {
            return false;
        }
    }

    return true;
}

const safeHostSchema = z.string().trim().min(3).max(255).refine(isSafeOutboundHost, {
    message: 'Invalid SMTP host: internal, private, loopback, or metadata addresses are not permitted.',
});

// Allowed SMTP ports: 25, 465, 587, 2525 or custom valid non-system service ports
const safePortSchema = z.number().int().min(1).max(65535).refine((port) => {
    // Disallow dangerous common protocol ports
    const forbiddenPorts = [21, 22, 23, 53, 80, 110, 135, 139, 143, 443, 445, 1433, 1521, 3306, 3389, 5432, 6379, 8080, 8443, 27017];
    return !forbiddenPorts.includes(port);
}, {
    message: 'Invalid SMTP port: port is reserved or prohibited for mail transport.',
});

export const companySmtpSchema = z.object({
    host: safeHostSchema,
    port: safePortSchema,
    secure: z.boolean().optional().default(false),
    username: z.string().trim().min(1).max(255),
    password: z.string().min(1).max(500).optional(),
}).strict();

export const updateCompanyEmailSchema = z.object({
    body: z.object({
        mode: z.enum(['PLATFORM', 'COMPANY']).optional(),
        senderEmail: z.string().trim().email('Invalid sender email address').max(254).toLowerCase().optional(),
        senderName: z.string().trim().min(1).max(100).optional(),
        replyTo: z.string().trim().email('Invalid reply-to email address').max(254).toLowerCase().optional(),
        smtp: companySmtpSchema.optional().nullable(),
    }).strict(),
});

export const confirmEmailVerificationSchema = z.object({
    body: z.object({
        code: z.string().trim().length(6, 'Verification code must be 6 characters'),
    }).strict(),
});

export const sendTestEmailSchema = z.object({
    body: z.object({
        recipientEmail: z.string().trim().email('Invalid recipient email address').max(254).toLowerCase().optional(),
    }).strict(),
});
