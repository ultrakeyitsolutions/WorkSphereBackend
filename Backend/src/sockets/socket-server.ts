import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/tokens';
import { env } from '../config/env';
import { User } from '../modules/users/user.model';
import { Company } from '../modules/super-admin/companies/company.model';
import CompanyMember from '../modules/companyadmin/invitations/company-member.model';
import { PresenceService } from './presence.service';
import { registerChatHandlers } from '../modules/chat/chat.socket';
import { registerCallHandlers } from '../modules/calls/call.socket';
import { registerLiveMonitoringHandlers } from '../modules/companyadmin/live-monitoring/live-monitoring.socket';
import { RealtimeEventService } from '../modules/companyadmin/live-monitoring/services/realtime-event.service';
import { MONITORING_SOCKET_EVENTS } from '../modules/companyadmin/live-monitoring/live-monitoring.types';
import { FeatureRevocationService } from '../modules/companyadmin/settings/feature-revocation.service';
import { CompanyThemeRealtimeService } from '../modules/companyadmin/settings/company-theme-realtime.service';

let ioInstance: Server | null = null;


export const getSocketServer = (): Server | null => {
    return ioInstance;
};

export const initSocketServer = (httpServer: HttpServer): Server => {
    const allowedOrigins = (env.CORS_ORIGIN || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

    const io = new Server(httpServer, {
        cors: {
            origin: (origin, callback) => {
                if (!origin) return callback(null, true);
                if (env.NODE_ENV !== 'production') return callback(null, true);
                if (
                    allowedOrigins.includes(origin) ||
                    allowedOrigins.includes('*') ||
                    origin.endsWith('.vercel.app') ||
                    origin.includes('localhost')
                ) {
                    return callback(null, true);
                }
                return callback(null, true);
            },
            credentials: true,
            methods: ['GET', 'POST'],
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 20000,
        pingInterval: 25000,
    });

    // ─── Socket Authentication Middleware ───────────────────────────────────────
    io.use(async (socket: Socket, next) => {
        try {
            // Extract token from handshake auth or authorization header
            let token = socket.handshake.auth?.token;
            if (!token && socket.handshake.headers?.authorization) {
                token = socket.handshake.headers.authorization;
            }

            if (typeof token === 'string' && token.startsWith('Bearer ')) {
                token = token.slice(7).trim();
            }

            if (!token) {
                return next(new Error('Authentication error: Missing access token.'));
            }

            const decoded = verifyAccessToken(token);
            if (!decoded || !decoded.userId) {
                return next(new Error('Authentication error: Invalid or expired token.'));
            }

            // Verify user in database if not SUPER_ADMIN
            if (decoded.role !== 'SUPER_ADMIN') {
                const user = await User.findById(decoded.userId).lean();
                if (!user || !user.isActive || user.isDeleted || user.status === 'SUSPENDED' || user.status === 'DEACTIVATED' || user.status === 'INACTIVE' || (user as any).accountStatus === 'SUSPENDED') {
                    return next(new Error('Authentication error: User account is suspended or inactive.'));
                }

                if (user.companyId) {
                    const company = await Company.findById(user.companyId).lean();
                    if (!company || company.status === 'SUSPENDED' || company.status === 'DELETED' || !company.isActive) {
                        return next(new Error('Authentication error: Organization account is suspended.'));
                    }

                    if (decoded.role !== 'COMPANY_ADMIN' && decoded.role !== 'Admin') {
                        const member = await CompanyMember.findOne({ userId: user._id, companyId: user.companyId }).lean();
                        if (member && (member.status === 'SUSPENDED' || member.status === 'INACTIVE')) {
                            return next(new Error('Authentication error: User account is suspended.'));
                        }
                    }
                }
            }

            // Bind verified user securely to socket data (never trust client-supplied sender/user IDs)
            socket.data.user = decoded;
            return next();
        } catch (err: any) {
            return next(new Error(`Authentication error: ${err.message || 'Unauthorized'}`));
        }
    });

    // ─── Socket Connection & Lifecycle ──────────────────────────────────────────
    io.on('connection', (socket: Socket) => {
        const user = socket.data.user;
        if (!user || !user.userId) {
            socket.disconnect(true);
            return;
        }

        const userId = user.userId;
        const companyId = user.companyId;

        // Join personal notification room (delivers calls & unread count across all user's devices)
        socket.join(`user:${userId}`);

        // Join company room (for company-wide presence)
        if (companyId) {
            socket.join(`company:${companyId}`);
        }

        // Track multi-device presence
        const isFirstConnection = PresenceService.addConnection(userId, socket.id);
        if (isFirstConnection && companyId) {
            // Broadcast user online event to company colleagues
            socket.to(`company:${companyId}`).emit('user_online', { userId });
            // Broadcast real-time presence transition to live monitoring dashboards
            RealtimeEventService.broadcastMonitoringEvent(companyId, MONITORING_SOCKET_EVENTS.PRESENCE_UPDATED, {
                employeeId: userId,
                presenceStatus: 'ONLINE',
                lastSeenAt: new Date().toISOString(),
            });
        }

        // Register feature handlers
        registerChatHandlers(io, socket);
        registerCallHandlers(io, socket);
        registerLiveMonitoringHandlers(io, socket);

        // Disconnect handler
        socket.on('disconnect', () => {
            const { isLast } = PresenceService.removeConnection(socket.id);
            if (isLast && companyId) {
                // Broadcast user offline event only when last connection disconnects
                socket.to(`company:${companyId}`).emit('user_offline', { userId });
                // Broadcast real-time presence transition to live monitoring dashboards
                RealtimeEventService.broadcastMonitoringEvent(companyId, MONITORING_SOCKET_EVENTS.PRESENCE_UPDATED, {
                    employeeId: userId,
                    presenceStatus: 'OFFLINE',
                    lastSeenAt: new Date().toISOString(),
                });
            }
        });

    });

    FeatureRevocationService.initCrossWorkerSubscriber(io);
    CompanyThemeRealtimeService.initCrossWorkerSubscriber(io);

    ioInstance = io;
    return io;
};
export default initSocketServer;
