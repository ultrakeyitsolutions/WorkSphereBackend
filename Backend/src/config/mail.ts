import nodemailer, { Transporter } from 'nodemailer';
import { env } from './env';

// ─── Mail transporter (lazy-initialised singleton) ────────────────────────────

let _transporter: Transporter | null = null;

export function getMailTransporter(): Transporter {
    if (_transporter) return _transporter;

    const driver = env.MAIL_DRIVER;

    if (driver === 'smtp') {
        _transporter = nodemailer.createTransport({
            host: env.MAIL_HOST,
            port: env.MAIL_PORT,
            secure: env.MAIL_ENCRYPTION === 'ssl', // true for port 465, false for others
            auth: {
                user: env.MAIL_USERNAME,
                pass: env.MAIL_PASSWORD,
            },
            tls: {
                // Allow self-signed certificates in development
                rejectUnauthorized: env.NODE_ENV === 'production',
            },
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
