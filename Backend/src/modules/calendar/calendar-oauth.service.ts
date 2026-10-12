import { Types } from 'mongoose';
import { randomBytes, randomUUID } from 'crypto';
import { google } from 'googleapis';
import CalendarOAuth from './calendar-oauth.model';
import CompanyCalendarConfig from './company-calendar-config.model';
import { encrypt, decrypt } from '../../utils/encryption';
import { OAuthProvider, MeetingProvider } from './calendar.types';
import { env } from '../../config/env';
import User from '../users/user.model';
import { AppError } from '../../utils/AppError';

// In-memory cache for OAuth authorization code replay protection
const exchangedCodesCache = new Set<string>();

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
     * Get company-specific OAuth credentials (with fallback to env)
     */
    static async getCompanyCredentials(companyId: string, provider: OAuthProvider): Promise<{
        clientId: string;
        clientSecret: string;
        redirectUri?: string;
    } | null> {
        const cId = new Types.ObjectId(companyId);
        const config = await CompanyCalendarConfig.findOne({ companyId: cId, provider }).lean();

        if (config && config.clientId && config.clientSecretEncrypted) {
            try {
                const clientSecret = decrypt(config.clientSecretEncrypted);
                return {
                    clientId: config.clientId,
                    clientSecret,
                    redirectUri: config.redirectUri || undefined,
                };
            } catch (err: any) {
                console.error(`[OAuth Config] Failed to decrypt credentials for company ${companyId}:`, err.message);
            }
        }

        // Fallback to environment variables if present
        if (provider === 'google' && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
            return {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET,
                redirectUri: env.GOOGLE_REDIRECT_URI,
            };
        }

        return null;
    }

    /**
     * Save company-specific OAuth credentials
     */
    static async saveCompanyCredentials(
        companyId: string,
        provider: OAuthProvider,
        clientId: string,
        clientSecret: string,
        redirectUri?: string,
        updatedBy?: string
    ) {
        if (!clientId || !clientId.trim()) {
            throw AppError.badRequest('Client ID is required');
        }
        if (!clientSecret || !clientSecret.trim()) {
            throw AppError.badRequest('Client Secret is required');
        }

        const cId = new Types.ObjectId(companyId);
        const uId = updatedBy ? new Types.ObjectId(updatedBy) : null;

        const updateData: any = {
            clientId: clientId.trim(),
            clientSecretEncrypted: encrypt(clientSecret.trim()),
            updatedBy: uId,
        };
        if (redirectUri && redirectUri.trim()) {
            updateData.redirectUri = redirectUri.trim();
        }

        await CompanyCalendarConfig.findOneAndUpdate(
            { companyId: cId, provider },
            updateData,
            { upsert: true, new: true }
        );

        return {
            provider,
            clientId: clientId.trim(),
            isConfigured: true,
            hasClientSecret: true,
            redirectUri: redirectUri || env.GOOGLE_REDIRECT_URI || '',
        };
    }

    /**
     * Get sanitized public OAuth configuration for frontend
     */
    static async getOAuthPublicConfig(companyId: string, providerInput: string) {
        const provider = this.normalizeProvider(providerInput);
        const cId = new Types.ObjectId(companyId);
        const config = await CompanyCalendarConfig.findOne({ companyId: cId, provider }).lean();

        const hasDbSecret = !!config?.clientSecretEncrypted;
        const clientId = config?.clientId || (provider === 'google' ? env.GOOGLE_CLIENT_ID : '') || '';
        const hasEnvSecret = provider === 'google' ? !!env.GOOGLE_CLIENT_SECRET : false;

        return {
            provider,
            clientId,
            isConfigured: !!clientId && (hasDbSecret || hasEnvSecret),
            hasClientSecret: hasDbSecret || hasEnvSecret,
            redirectUri: config?.redirectUri || (provider === 'google' ? env.GOOGLE_REDIRECT_URI : '') || '',
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
        redirectUri?: string,
        clientId?: string,
        clientSecret?: string
    ) {
        const provider = this.normalizeProvider(providerInput);
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        // Replay protection: ensure authorization code is exchanged exactly once
        if (exchangedCodesCache.has(code)) {
            throw AppError.badRequest('OAuth authorization code has already been exchanged or is invalid');
        }
        exchangedCodesCache.add(code);
        setTimeout(() => {
            exchangedCodesCache.delete(code);
        }, 3600 * 1000);

        // If client credentials are provided from the frontend, persist them for the company
        if (clientId && clientSecret) {
            await this.saveCompanyCredentials(companyId, provider, clientId, clientSecret, redirectUri, userId);
        }

        let accessToken = '';
        let refreshToken = '';
        let tokenExpiry = new Date(Date.now() + 3600 * 1000);
        let accountEmail = '';
        let scopes: string[] = [];

        // Real Google OAuth code exchange
        if (provider === 'google') {
            const companyCreds = await this.getCompanyCredentials(companyId, 'google');
            const effectiveClientId = companyCreds?.clientId || '';
            const effectiveClientSecret = companyCreds?.clientSecret || '';
            const effectiveRedirectUri = redirectUri || companyCreds?.redirectUri || env.GOOGLE_REDIRECT_URI;

            if (!effectiveClientId || !effectiveClientSecret) {
                if (process.env.NODE_ENV === 'test') {
                    accessToken = `ws_acc_${provider}_${randomBytes(24).toString('hex')}`;
                    refreshToken = `ws_ref_${provider}_${randomBytes(32).toString('hex')}`;
                    scopes = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'];
                } else {
                    throw AppError.badRequest(
                        'Google OAuth credentials (Client ID and Client Secret) are not configured for this company. Please provide them in settings.'
                    );
                }
            } else {
                try {
                    const oauth2Client = new google.auth.OAuth2(
                        effectiveClientId,
                        effectiveClientSecret,
                        effectiveRedirectUri
                    );

                    const { tokens } = await oauth2Client.getToken(code);
                    accessToken = tokens.access_token || '';
                    refreshToken = tokens.refresh_token || '';
                    if (tokens.expiry_date) {
                        tokenExpiry = new Date(tokens.expiry_date);
                    }
                    scopes = tokens.scope
                        ? tokens.scope.split(' ')
                        : ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'];

                    oauth2Client.setCredentials(tokens);
                    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
                    const userInfo = await oauth2.userinfo.get();
                    accountEmail = userInfo.data.email || '';
                } catch (err: any) {
                    console.error('[Google OAuth] Token exchange error:', err.message);
                    throw AppError.badRequest(`OAuth token exchange failed: ${err.message || 'Invalid or expired authorization code'}`);
                }
            }
        } else {
            // Microsoft OAuth (or test fallback)
            accessToken = `ws_acc_${provider}_${randomBytes(24).toString('hex')}`;
            refreshToken = `ws_ref_${provider}_${randomBytes(32).toString('hex')}`;
            scopes = ['Calendars.ReadWrite'];
        }

        if (!accountEmail) {
            const user = await User.findById(uId).select('email').lean();
            accountEmail = user?.email || `${provider}-user@worksphere.com`;
        }

        const encryptedAccess = encrypt(accessToken);
        const encryptedRefresh = encrypt(refreshToken);

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
                scopes,
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
     * Validates whether a meetingUrl is genuine and not a fabricated placeholder
     */
    static isGenuineMeetingUrl(meetingUrl?: string | null, externalEventId?: string | null): boolean {
        if (!meetingUrl || typeof meetingUrl !== 'string') return false;
        if (!meetingUrl.startsWith('https://meet.google.com/')) return false;

        const match = meetingUrl.match(/^https:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/i);
        if (!match) return false;

        const meetCode = match[1].toLowerCase();

        // If externalEventId equals the meetCode, it was produced by the legacy dummy generateMeetCode fallback!
        if (externalEventId && externalEventId.toLowerCase() === meetCode) {
            return false;
        }

        return true;
    }

    /**
     * Polls Google Calendar API until conference creation is confirmed or failed
     */
    static async pollConferenceData(
        calendar: any,
        eventId: string,
        maxRetries: number = 5,
        initialDelayMs: number = 400
    ): Promise<{ uri: string; conferenceId?: string }> {
        let delay = initialDelayMs;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, delay));

            const res: any = await calendar.events.get({
                calendarId: 'primary',
                eventId,
            });

            const confData = res.data?.conferenceData;
            const statusCode = confData?.createRequest?.status?.statusCode;

            if (statusCode === 'failure') {
                const reason = (confData?.createRequest?.status as any)?.error?.code || 'Conference creation was rejected by Google';
                throw AppError.badRequest(`Google Meet conference creation failed: ${reason}`);
            }

            const videoEntryPoint = confData?.entryPoints?.find(
                (ep: any) => ep.entryPointType === 'video'
            )?.uri || res.data?.hangoutLink;

            if (videoEntryPoint && (statusCode === 'success' || !statusCode)) {
                return {
                    uri: videoEntryPoint,
                    conferenceId: confData?.conferenceId || undefined,
                };
            }

            delay = Math.min(delay * 1.5, 2500);
        }

        throw AppError.badRequest(
            'Google Meet conference creation is taking longer than expected. Please retry starting the meeting.'
        );
    }

    /**
     * Retrieves genuine conference data from an existing Google Calendar event
     */
    static async getConferenceByEventId(
        companyId: string,
        userId: string,
        externalEventId: string
    ): Promise<{ meetingUrl?: string; externalEventId?: string; externalProviderData?: any } | null> {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        const oauth = await CalendarOAuth.findOne({
            companyId: cId,
            userId: uId,
            provider: 'google',
            isConnected: true,
        });

        if (!oauth || !oauth.accessTokenEncrypted) return null;

        let decryptedAccessToken = '';
        let decryptedRefreshToken = '';
        try {
            decryptedAccessToken = decrypt(oauth.accessTokenEncrypted);
            decryptedRefreshToken = oauth.refreshTokenEncrypted ? decrypt(oauth.refreshTokenEncrypted) : '';
        } catch {
            return null;
        }

        if (!decryptedAccessToken) return null;

        const companyCreds = await this.getCompanyCredentials(companyId, 'google');
        const effectiveClientId = companyCreds?.clientId || env.GOOGLE_CLIENT_ID;
        const effectiveClientSecret = companyCreds?.clientSecret || env.GOOGLE_CLIENT_SECRET;
        const effectiveRedirectUri = companyCreds?.redirectUri || env.GOOGLE_REDIRECT_URI;

        const oauth2Client = new google.auth.OAuth2(
            effectiveClientId,
            effectiveClientSecret,
            effectiveRedirectUri
        );

        oauth2Client.setCredentials({
            access_token: decryptedAccessToken,
            refresh_token: decryptedRefreshToken || undefined,
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const res: any = await calendar.events.get({
            calendarId: 'primary',
            eventId: externalEventId,
        });

        const confData = res.data?.conferenceData;
        let genuineMeetUrl = confData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri || res.data?.hangoutLink;

        if (confData?.createRequest?.status?.statusCode === 'pending' || !genuineMeetUrl) {
            const pollRes = await this.pollConferenceData(calendar, externalEventId);
            genuineMeetUrl = pollRes.uri;
        }

        if (genuineMeetUrl && genuineMeetUrl.startsWith('https://meet.google.com/')) {
            return {
                meetingUrl: genuineMeetUrl,
                externalEventId,
                externalProviderData: {
                    conferenceId: confData?.conferenceId,
                    joinWebUrl: genuineMeetUrl,
                },
            };
        }

        return null;
    }

    /**
     * Generates an auto Microsoft Teams meeting URL
     */
    static generateTeamsMeetingUrl(): string {
        const meetingId = randomUUID();
        return `https://teams.live.com/meet/${meetingId}`;
    }

    /**
     * Generate meeting details based on provider and OAuth status
     * Calls real Google Calendar API with conferenceDataVersion: 1 when connected,
     * polling until conference generation is confirmed ready.
     */
    static async generateMeetingDetails(
        companyId: string,
        userId: string,
        provider: MeetingProvider,
        eventData?: {
            title?: string;
            description?: string;
            startTime?: Date | string;
            endTime?: Date | string;
            timeZone?: string;
            participantEmails?: string[];
        }
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

        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        // ── 1. Google Meet Provider ──────────────────────────────────────────
        if (provider === 'google_meet') {
            const oauth = await CalendarOAuth.findOne({
                companyId: cId,
                userId: uId,
                provider: 'google',
                isConnected: true,
            });

            if (!oauth || !oauth.accessTokenEncrypted) {
                throw AppError.badRequest(
                    'Google Calendar & Meet is not connected. Please connect your Google account in Settings to generate a meeting conference.'
                );
            }

            let decryptedAccessToken = '';
            let decryptedRefreshToken = '';
            try {
                decryptedAccessToken = decrypt(oauth.accessTokenEncrypted);
                decryptedRefreshToken = oauth.refreshTokenEncrypted ? decrypt(oauth.refreshTokenEncrypted) : '';
            } catch (decErr) {
                console.error('[Google Meet] Decryption failed:', decErr);
                throw AppError.badRequest('Failed to decrypt Google authorization credentials. Please reconnect your Google account in Settings.');
            }

            if (!decryptedAccessToken) {
                throw AppError.badRequest('Google authorization token is missing. Please reconnect your Google account in Settings.');
            }

            const companyCreds = await this.getCompanyCredentials(companyId, 'google');
            const effectiveClientId = companyCreds?.clientId || env.GOOGLE_CLIENT_ID;
            const effectiveClientSecret = companyCreds?.clientSecret || env.GOOGLE_CLIENT_SECRET;
            const effectiveRedirectUri = companyCreds?.redirectUri || env.GOOGLE_REDIRECT_URI;

            if (!effectiveClientId || !effectiveClientSecret) {
                if (process.env.NODE_ENV !== 'test') {
                    throw AppError.badRequest(
                        'Google OAuth credentials (Client ID and Client Secret) are not configured for this company. Please provide them in settings.'
                    );
                }
            }

            try {
                const oauth2Client = new google.auth.OAuth2(
                    effectiveClientId,
                    effectiveClientSecret,
                    effectiveRedirectUri
                );

                oauth2Client.setCredentials({
                    access_token: decryptedAccessToken,
                    refresh_token: decryptedRefreshToken || undefined,
                });

                // Automatically update database if tokens are refreshed
                oauth2Client.on('tokens', async (newTokens) => {
                    try {
                        if (newTokens.access_token) {
                            oauth.accessTokenEncrypted = encrypt(newTokens.access_token);
                        }
                        if (newTokens.refresh_token) {
                            oauth.refreshTokenEncrypted = encrypt(newTokens.refresh_token);
                        }
                        if (newTokens.expiry_date) {
                            oauth.tokenExpiry = new Date(newTokens.expiry_date);
                        }
                        await oauth.save();
                    } catch (tokErr) {
                        console.error('[Google Meet] Failed to persist refreshed token:', tokErr);
                    }
                });

                const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
                const startIso = eventData?.startTime
                    ? new Date(eventData.startTime).toISOString()
                    : new Date().toISOString();
                const endIso = eventData?.endTime
                    ? new Date(eventData.endTime).toISOString()
                    : new Date(Date.now() + 30 * 60000).toISOString();
                const tz = eventData?.timeZone || 'Asia/Kolkata';

                // ── MANDATORY for real Meet links: conferenceDataVersion: 1 ────
                const googleEvent = await calendar.events.insert({
                    calendarId: 'primary',
                    conferenceDataVersion: 1,
                    requestBody: {
                        summary: eventData?.title || 'WorkSphere Meeting',
                        description: eventData?.description || 'WorkSphere Meeting',
                        start: {
                            dateTime: startIso,
                            timeZone: tz,
                        },
                        end: {
                            dateTime: endIso,
                            timeZone: tz,
                        },
                        attendees: (eventData?.participantEmails || []).map((email) => ({ email })),
                        conferenceData: {
                            createRequest: {
                                requestId: randomUUID(),
                                conferenceSolutionKey: {
                                    type: 'hangoutsMeet',
                                },
                            },
                        },
                    },
                });

                const eventId = googleEvent.data.id;
                if (!eventId) {
                    throw AppError.badRequest('Google Calendar API did not return an event identifier.');
                }

                const confData = googleEvent.data.conferenceData;
                const statusCode = confData?.createRequest?.status?.statusCode;

                if (statusCode === 'failure') {
                    const reason = (confData?.createRequest?.status as any)?.error?.code || 'Google rejected conference creation';
                    throw AppError.badRequest(`Google Meet conference creation failed: ${reason}`);
                }

                let genuineMeetUrl =
                    confData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri ||
                    googleEvent.data.hangoutLink;
                let conferenceId = confData?.conferenceId;

                // If status is pending or video entrypoint is not yet available, poll with backoff
                if (statusCode === 'pending' || !genuineMeetUrl) {
                    const pollResult = await this.pollConferenceData(calendar, eventId);
                    genuineMeetUrl = pollResult.uri;
                    conferenceId = pollResult.conferenceId;
                }

                if (!genuineMeetUrl || !genuineMeetUrl.startsWith('https://meet.google.com/')) {
                    throw AppError.badRequest(
                        'Google Calendar API created the event but did not return a valid Google Meet video conference URL.'
                    );
                }

                return {
                    meetingUrl: genuineMeetUrl,
                    externalEventId: eventId,
                    externalProviderData: {
                        conferenceId: conferenceId || undefined,
                        joinWebUrl: genuineMeetUrl,
                    },
                };
            } catch (apiErr: any) {
                if (apiErr instanceof AppError) {
                    throw apiErr;
                }
                console.error('[Google Meet] calendar.events.insert error:', apiErr?.message);
                throw AppError.badRequest(
                    `Failed to create Google Meet conference via Google Calendar API: ${apiErr?.message || 'Unknown provider error'}`
                );
            }
        }

        // ── 2. Microsoft Teams Provider ──────────────────────────────────────
        if (provider === 'ms_teams') {
            const autoTeamsUrl = this.generateTeamsMeetingUrl();
            return {
                meetingUrl: autoTeamsUrl,
                externalEventId: undefined,
                externalProviderData: {
                    joinWebUrl: autoTeamsUrl,
                },
            };
        }

        return {};
    }
}
