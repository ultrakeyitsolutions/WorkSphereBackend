import nodemailer, { Transporter } from 'nodemailer';
import { env } from './env';

// ─── Mail transporter (lazy-initialised singleton) ────────────────────────────

let _transporter: Transporter | null = null;

export function getMailTransporter(): Transporter {
    if (_transporter) return _transporter;

    const driver = env.MAIL_DRIVER;

    if (driver === 'smtp') {
        const isSecure = env.MAIL_ENCRYPTION === 'ssl' || (env.MAIL_PORT === 465 && env.MAIL_ENCRYPTION !== 'none');
        _transporter = nodemailer.createTransport({
            host: env.MAIL_HOST,
            port: env.MAIL_PORT,
            secure: isSecure, // true for port 465 (SMTPS), false for 587 (STARTTLS)
            auth: {
                user: env.MAIL_USERNAME,
                pass: env.MAIL_PASSWORD,
            },
            tls: {
                // Allow self-signed certificates in development
                rejectUnauthorized: env.NODE_ENV === 'production',
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 20000,
        });
    } else if (driver === 'sendmail') {
        _transporter = nodemailer.createTransport({ sendmail: true });
    } else {
        // Fallback: log-only (development / test)
        _transporter = nodemailer.createTransport({ jsonTransport: true });
    }

    return _transporter;
}

export const mailDefaults = {
    from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_ADDRESS}>`,
};

/**
 * Validates the mail transport connection and logs actionable diagnostics.
 * Especially useful on VPS deployments (e.g. Hostinger) to quickly detect blocked outbound SMTP ports.
 */
export async function verifyMailConnection(): Promise<boolean> {
    try {
        const transporter = getMailTransporter();
        if (env.MAIL_DRIVER === 'smtp') {
            await transporter.verify();
            console.log(`[Mail] SMTP transport connection verified successfully (${env.MAIL_HOST}:${env.MAIL_PORT}, secure=${env.MAIL_ENCRYPTION === 'ssl' || env.MAIL_PORT === 465}).`);
            return true;
        }
        return true;
    } catch (error: any) {
        console.error('[Mail] CRITICAL: SMTP transport verification failed on startup:', {
            host: env.MAIL_HOST,
            port: env.MAIL_PORT,
            encryption: env.MAIL_ENCRYPTION,
            from: env.MAIL_FROM_ADDRESS,
            errorCode: error.code || error.name || 'UNKNOWN',
            command: error.command || null,
            responseCode: error.responseCode || null,
            errorMessage: error.message,
            smtpResponse: error.response || null,
            diagnosticHint: 'If deployed on a VPS/Hostinger, check if outbound mail ports 465/587 are blocked by provider firewall, or if credentials / MAIL_FROM_ADDRESS match the SMTP user.',
        });
        return false;
    }
}
