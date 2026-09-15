import { Types } from 'mongoose';
import { randomBytes } from 'crypto';
import CalendarOAuth from './calendar-oauth.model';
import { encrypt, decrypt } from '../../utils/encryption';
import { OAuthProvider, MeetingProvider } from './calendar.types';
import User from '../users/user.model';

function generateMeetSlug(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const pick = (len: number) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

function generateTeamsSlug(): string {
    return randomBytes(16).toString('hex');
}

export class CalendarOAuthService {
    static normalizeProvider(provider: string): OAuthProvider {
        const lower = provider.toLowerCase();
        if (lower === 'google' || lower === 'google_meet') return 'google';
        if (lower === 'microsoft' || lower === 'ms_teams') return 'microsoft';
        throw new Error(`Unsupported OAuth provider: ${provider}`);
    }

    /**
     * Get Integration Status for Google & Microsoft
     */
    static async getIntegrationStatus(companyId: string, userId: string) {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        const tokens = await CalendarOAuth.find({ companyId: cId, userId: uId });

        const googleToken = tokens.find((t) => t.provider === 'google' && t.isConnected);
        const msToken = tokens.find((t) => t.provider === 'microsoft' && t.isConnected);

        return {
            googleConnected: !!googleToken,
            googleEmail: googleToken ? googleToken.accountEmail || null : null,
            googleConnectedAt: googleToken ? (googleToken.updatedAt || googleToken.createdAt) : null,
            msConnected: !!msToken,
            msEmail: msToken ? msToken.accountEmail || null : null,
            msConnectedAt: msToken ? (msToken.updatedAt || msToken.createdAt) : null,
        };
    }

    /**
     * Connect an OAuth Provider with authorization code
     */
    static async connectProvider(
        companyId: string,
        userId: string,
        providerInput: string,
        code: string,
        redirectUri?: string
    ) {
        const provider = this.normalizeProvider(providerInput);
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        const user = await User.findById(uId).select('email').lean();
        const accountEmail = user?.email || `${provider}-user@worksphere.com`;

        // Generate or mock tokens (AES-256 encrypted storage)
        const mockAccessToken = `ws_acc_${provider}_${randomBytes(24).toString('hex')}`;
        const mockRefreshToken = `ws_ref_${provider}_${randomBytes(32).toString('hex')}`;

        const encryptedAccess = encrypt(mockAccessToken);
        const encryptedRefresh = encrypt(mockRefreshToken);

        const tokenExpiry = new Date(Date.now() + 3600 * 1000); // 1 hour validity

        const updated = await CalendarOAuth.findOneAndUpdate(
            { companyId: cId, userId: uId, provider },
            {
                companyId: cId,
                userId: uId,
                provider,
                accessTokenEncrypted: encryptedAccess,
                refreshTokenEncrypted: encryptedRefresh,
                tokenExpiry,
                accountEmail,
                scopes: provider === 'google'
                    ? ['https://www.googleapis.com/auth/calendar']
                    : ['Calendars.ReadWrite'],
                isConnected: true,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        return {
            provider,
            isConnected: updated.isConnected,
            accountEmail: updated.accountEmail,
        };
    }

    /**
     * Disconnect an OAuth Provider
     */
    static async disconnectProvider(companyId: string, userId: string, providerInput: string) {
        const provider = this.normalizeProvider(providerInput);
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        await CalendarOAuth.findOneAndUpdate(
            { companyId: cId, userId: uId, provider },
            { isConnected: false }
        );

        return { success: true };
    }

    /**
     * Generate meeting details based on provider and OAuth status
     */
    static async generateMeetingDetails(
        companyId: string,
        userId: string,
        provider: MeetingProvider,
        _title?: string
    ): Promise<{
        meetingUrl?: string;
        externalEventId?: string;
        externalProviderData?: {
            conferenceId?: string;
            joinWebUrl?: string;
            dialIn?: string;
        };
    }> {
        if (provider === 'none') {
            return {};
        }

        const oauthProvider = provider === 'google_meet' ? 'google' : 'microsoft';
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        const oauth = await CalendarOAuth.findOne({
            companyId: cId,
            userId: uId,
            provider: oauthProvider,
            isConnected: true,
        });

        // If connected and token expired, check refresh capability
        if (oauth && oauth.tokenExpiry && new Date(oauth.tokenExpiry) < new Date()) {
            try {
                // Refresh simulation / decryption
                const rawRefresh = decrypt(oauth.refreshTokenEncrypted);
                if (rawRefresh) {
                    oauth.tokenExpiry = new Date(Date.now() + 3600 * 1000);
                    await oauth.save();
                }
            } catch {
                // Ignore refresh errors and fallback gracefully
            }
        }

        if (provider === 'google_meet') {
            const slug = generateMeetSlug();
            const meetingUrl = `https://meet.google.com/${slug}`;
            const externalEventId = `gcal_${Date.now()}_${randomBytes(4).toString('hex')}`;
            return {
                meetingUrl,
                externalEventId,
                externalProviderData: {
                    conferenceId: slug,
                    joinWebUrl: meetingUrl,
                },
            };
        }

        if (provider === 'ms_teams') {
            const slug = generateTeamsSlug();
            const meetingUrl = `https://teams.microsoft.com/l/meetup-join/${slug}`;
            const externalEventId = `teams_${Date.now()}_${randomBytes(4).toString('hex')}`;
            return {
                meetingUrl,
                externalEventId,
                externalProviderData: {
                    conferenceId: slug,
                    joinWebUrl: meetingUrl,
                },
            };
        }

        return {};
    }
}
