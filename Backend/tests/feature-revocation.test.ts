import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    FeatureRevocationService,
    FEATURE_REVOCATION_REDIS_CHANNEL,
} from '../src/modules/companyadmin/settings/feature-revocation.service';
import { FeatureAccessService } from '../src/modules/companyadmin/settings/feature-access.service';
import { CompanySettingsService } from '../src/modules/companyadmin/settings/company-settings.service';
import { RealtimeEventService } from '../src/modules/companyadmin/live-monitoring/services/realtime-event.service';
import { MONITORING_SOCKET_EVENTS } from '../src/modules/companyadmin/live-monitoring/live-monitoring.types';

const COMPANY_A = '64e0a1b2c3d4e5f6a7b8c9d0';
const COMPANY_B = '64e0a1b2c3d4e5f6a7b8c9d9';
const USER_A1 = '64e0a1b2c3d4e5f6a7b8c9d1';
const USER_B1 = '64e0a1b2c3d4e5f6a7b8c9d2';

const mockSockets = new Map<string, any>();

const mockIoServer = {
    sockets: {
        sockets: mockSockets,
    },
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
};

vi.mock('../src/sockets/socket-server', () => ({
    getSocketServer: () => mockIoServer,
    initSocketServer: vi.fn(),
    default: () => mockIoServer,
}));

let subscriberMessageHandler: ((channel: string, message: string) => void) | null = null;
let mockDuplicateSubscriber: any = null;

const mocks = vi.hoisted(() => ({
    companySettingsFindOne: vi.fn(),
    companySettingsCreate: vi.fn(),
    companySettingsFindOneAndUpdate: vi.fn(),
    companyFindById: vi.fn(),
    companyFindByIdAndUpdate: vi.fn(),
    entitlementHasFeature: vi.fn(),
    entitlementGetDetails: vi.fn(),
    auditLog: vi.fn(),
    redisPublish: vi.fn(),
    getRedisClient: vi.fn(),
}));

vi.mock('../src/modules/companyadmin/settings/company-settings.model', async () => {
    const actual = (await vi.importActual('../src/modules/companyadmin/settings/company-settings.model')) as any;
    return {
        ...actual,
        CompanySettings: {
            findOne: mocks.companySettingsFindOne,
            create: mocks.companySettingsCreate,
            findOneAndUpdate: mocks.companySettingsFindOneAndUpdate,
        },
        default: {
            findOne: mocks.companySettingsFindOne,
            create: mocks.companySettingsCreate,
            findOneAndUpdate: mocks.companySettingsFindOneAndUpdate,
        },
    };
});

vi.mock('../src/modules/companyadmin/live-monitoring/models/monitoring-activity.model', () => ({
    MonitoringActivity: {
        findOne: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({ sequence: 10 }),
                }),
            }),
        }),
    },
    MonitoringActivityModel: {
        find: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([]),
                }),
            }),
        }),
    },
    default: {
        findOne: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: mocks.companyFindById,
        findByIdAndUpdate: mocks.companyFindByIdAndUpdate,
    },
    default: {
        findById: mocks.companyFindById,
        findByIdAndUpdate: mocks.companyFindByIdAndUpdate,
    },
}));

vi.mock('../src/services/entitlement.service', () => ({
    EntitlementService: {
        hasFeature: mocks.entitlementHasFeature,
        getEntitlementDetails: mocks.entitlementGetDetails,
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: mocks.auditLog,
    },
}));

vi.mock('../src/config/redis', () => ({
    getRedisClient: mocks.getRedisClient,
    redisGet: vi.fn().mockResolvedValue(null),
    redisSet: vi.fn().mockResolvedValue(undefined),
}));

describe('WorkSphere Real-Time WebSocket Feature Revocation & Eviction', () => {
    let socketCompanyA: any;
    let socketCompanyB: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSockets.clear();
        FeatureAccessService.invalidateCache(COMPANY_A);
        FeatureAccessService.invalidateCache(COMPANY_B);

        mockDuplicateSubscriber = {
            status: 'ready',
            on: vi.fn((event: string, handler: any) => {
                if (event === 'message') {
                    subscriberMessageHandler = handler;
                }
            }),
            connect: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn().mockResolvedValue(1),
            unsubscribe: vi.fn().mockResolvedValue(1),
            quit: vi.fn().mockResolvedValue('OK'),
            disconnect: vi.fn(),
        };

        const mockPrimaryRedis = {
            status: 'ready',
            publish: mocks.redisPublish.mockResolvedValue(1),
            duplicate: vi.fn().mockReturnValue(mockDuplicateSubscriber),
        };

        mocks.getRedisClient.mockReturnValue(mockPrimaryRedis);

        socketCompanyA = {
            id: 'socket_comp_a',
            data: {
                user: {
                    userId: USER_A1,
                    companyId: COMPANY_A,
                    role: 'COMPANY_ADMIN',
                },
            },
            rooms: new Set([
                'socket_comp_a',
                `user:${USER_A1}`,
                `company:${COMPANY_A}`,
                `company:${COMPANY_A}:monitoring`,
                `company:${COMPANY_A}:employee:${USER_A1}`,
                'conversation:conv_123',
            ]),
            leave: vi.fn((room: string) => {
                socketCompanyA.rooms.delete(room);
            }),
            emit: vi.fn(),
        };

        socketCompanyB = {
            id: 'socket_comp_b',
            data: {
                user: {
                    userId: USER_B1,
                    companyId: COMPANY_B,
                    role: 'COMPANY_ADMIN',
                },
            },
            rooms: new Set([
                'socket_comp_b',
                `user:${USER_B1}`,
                `company:${COMPANY_B}`,
                `company:${COMPANY_B}:monitoring`,
                'conversation:conv_456',
            ]),
            leave: vi.fn((room: string) => {
                socketCompanyB.rooms.delete(room);
            }),
            emit: vi.fn(),
        };

        mockSockets.set('socket_comp_a', socketCompanyA);
        mockSockets.set('socket_comp_b', socketCompanyB);
    });

    afterEach(async () => {
        await FeatureRevocationService.shutdown();
    });

    describe('Event Validation & Strict Schema Guard', () => {
        it('should pass valid feature revocation event', () => {
            const valid = FeatureRevocationService.validateRevocationEvent({
                companyId: COMPANY_A,
                disabledFeatures: ['enableLiveMonitoring', 'enableChat'],
                timestamp: Date.now(),
            });

            expect(valid).not.toBeNull();
            expect(valid?.companyId).toBe(COMPANY_A);
            expect(valid?.disabledFeatures).toEqual(['enableLiveMonitoring', 'enableChat']);
        });

        it('should reject invalid companyId (non-hex / malformed)', () => {
            const invalid = FeatureRevocationService.validateRevocationEvent({
                companyId: 'invalid_company_id_123',
                disabledFeatures: ['enableLiveMonitoring'],
                timestamp: Date.now(),
            });
            expect(invalid).toBeNull();
        });

        it('should reject unknown / invalid feature keys', () => {
            const invalid = FeatureRevocationService.validateRevocationEvent({
                companyId: COMPANY_A,
                disabledFeatures: ['enableLiveMonitoring', 'invalidFakeFeature' as any],
                timestamp: Date.now(),
            });
            expect(invalid).toBeNull();
        });

        it('should reject empty disabledFeatures array', () => {
            const invalid = FeatureRevocationService.validateRevocationEvent({
                companyId: COMPANY_A,
                disabledFeatures: [],
                timestamp: Date.now(),
            });
            expect(invalid).toBeNull();
        });

        it('should reject timestamps too far in future or ancient history', () => {
            const future = FeatureRevocationService.validateRevocationEvent({
                companyId: COMPANY_A,
                disabledFeatures: ['enableChat'],
                timestamp: Date.now() + 600_000, // 10 minutes in future
            });
            expect(future).toBeNull();

            const past = FeatureRevocationService.validateRevocationEvent({
                companyId: COMPANY_A,
                disabledFeatures: ['enableChat'],
                timestamp: Date.now() - 86_400_000, // 1 day in past
            });
            expect(past).toBeNull();
        });
    });

    describe('FeatureRevocationService.evictLocalSockets', () => {
        it('should evict company A socket from live monitoring rooms when enableLiveMonitoring is disabled', () => {
            FeatureRevocationService.evictLocalSockets(COMPANY_A, ['enableLiveMonitoring']);

            expect(socketCompanyA.leave).toHaveBeenCalledWith(`company:${COMPANY_A}:monitoring`);
            expect(socketCompanyA.leave).toHaveBeenCalledWith(`company:${COMPANY_A}:employee:${USER_A1}`);
            expect(socketCompanyA.emit).toHaveBeenCalledWith(
                MONITORING_SOCKET_EVENTS.ERROR,
                expect.objectContaining({ code: 'FEATURE_DISABLED_BY_COMPANY' })
            );

            // Sockets of Company B must NOT be touched
            expect(socketCompanyB.leave).not.toHaveBeenCalled();
            expect(socketCompanyB.rooms.has(`company:${COMPANY_B}:monitoring`)).toBe(true);

            // Non-monitoring rooms of Company A must remain intact
            expect(socketCompanyA.rooms.has(`user:${USER_A1}`)).toBe(true);
            expect(socketCompanyA.rooms.has(`company:${COMPANY_A}`)).toBe(true);
            expect(socketCompanyA.rooms.has('conversation:conv_123')).toBe(true);
        });

        it('should evict company A socket from conversation rooms when enableChat is disabled', () => {
            FeatureRevocationService.evictLocalSockets(COMPANY_A, ['enableChat']);

            expect(socketCompanyA.leave).toHaveBeenCalledWith('conversation:conv_123');
            expect(socketCompanyA.emit).toHaveBeenCalledWith(
                'chat:feature_disabled',
                expect.objectContaining({ code: 'FEATURE_DISABLED_BY_COMPANY' })
            );

            // Sockets of Company B must NOT be touched
            expect(socketCompanyB.leave).not.toHaveBeenCalled();
            expect(socketCompanyB.rooms.has('conversation:conv_456')).toBe(true);

            // Live monitoring room of Company A must remain untouched
            expect(socketCompanyA.rooms.has(`company:${COMPANY_A}:monitoring`)).toBe(true);
        });

        it('should handle multiple simultaneous disabled features cleanly', () => {
            FeatureRevocationService.evictLocalSockets(COMPANY_A, ['enableLiveMonitoring', 'enableChat']);

            expect(socketCompanyA.leave).toHaveBeenCalledWith(`company:${COMPANY_A}:monitoring`);
            expect(socketCompanyA.leave).toHaveBeenCalledWith(`company:${COMPANY_A}:employee:${USER_A1}`);
            expect(socketCompanyA.leave).toHaveBeenCalledWith('conversation:conv_123');

            expect(socketCompanyA.rooms.has(`company:${COMPANY_A}:monitoring`)).toBe(false);
            expect(socketCompanyA.rooms.has('conversation:conv_123')).toBe(false);
            expect(socketCompanyA.rooms.has(`company:${COMPANY_A}`)).toBe(true);
        });

        it('should be idempotent and safe on repeated revocation calls', () => {
            FeatureRevocationService.evictLocalSockets(COMPANY_A, ['enableLiveMonitoring']);
            FeatureRevocationService.evictLocalSockets(COMPANY_A, ['enableLiveMonitoring']);

            expect(socketCompanyA.rooms.has(`company:${COMPANY_A}:monitoring`)).toBe(false);
            expect(socketCompanyB.rooms.has(`company:${COMPANY_B}:monitoring`)).toBe(true);
        });
    });

    describe('Cross-Worker Synchronization & Redis Subscriber Lifecycle', () => {
        it('should initialize subscriber and process incoming revocation message from peer worker', async () => {
            const initResult = await FeatureRevocationService.initCrossWorkerSubscriber();
            expect(initResult).toBe(true);
            expect(FeatureRevocationService.getSubscriptionStatus().isSubscribed).toBe(true);

            // Simulate peer worker publishing revocation event to Redis channel
            expect(subscriberMessageHandler).not.toBeNull();
            subscriberMessageHandler!(
                FEATURE_REVOCATION_REDIS_CHANNEL,
                JSON.stringify({
                    companyId: COMPANY_A,
                    disabledFeatures: ['enableLiveMonitoring'],
                    timestamp: Date.now(),
                })
            );

            // Verify local socket was evicted upon processing message
            expect(socketCompanyA.leave).toHaveBeenCalledWith(`company:${COMPANY_A}:monitoring`);
            expect(socketCompanyA.rooms.has(`company:${COMPANY_A}:monitoring`)).toBe(false);
        });

        it('should ignore and drop malformed message received on Redis channel', async () => {
            await FeatureRevocationService.initCrossWorkerSubscriber();

            // Simulate malformed message
            subscriberMessageHandler!(
                FEATURE_REVOCATION_REDIS_CHANNEL,
                JSON.stringify({
                    companyId: 'not-valid-id',
                    disabledFeatures: ['badKey'],
                    timestamp: 12345,
                })
            );

            // Sockets must NOT be evicted
            expect(socketCompanyA.leave).not.toHaveBeenCalled();
            expect(socketCompanyA.rooms.has(`company:${COMPANY_A}:monitoring`)).toBe(true);
        });

        it('should prevent duplicate subscriber initializations', async () => {
            const first = await FeatureRevocationService.initCrossWorkerSubscriber();
            const second = await FeatureRevocationService.initCrossWorkerSubscriber();

            expect(first).toBe(true);
            expect(second).toBe(true);
            expect(mockDuplicateSubscriber.subscribe).toHaveBeenCalledTimes(1);
        });

        it('should retry Redis publication upon transient publish failure', async () => {
            mocks.redisPublish
                .mockRejectedValueOnce(new Error('Transient connection reset'))
                .mockResolvedValueOnce(1);

            const result = await FeatureRevocationService.revokeCompanyFeatures(COMPANY_A, ['enableLiveMonitoring']);

            expect(result.localEvicted).toBe(true);
            expect(result.publishedToRedis).toBe(true);
            expect(mocks.redisPublish).toHaveBeenCalledTimes(2);
        });

        it('should purge in-memory cache upon Redis subscriber ready event on reconnect', async () => {
            let readyHandler: (() => void) | null = null;
            mockDuplicateSubscriber.on = vi.fn((event: string, handler: any) => {
                if (event === 'ready') {
                    readyHandler = handler;
                }
            });

            const clearCacheSpy = vi.spyOn(FeatureAccessService, 'clearAllCache');
            await FeatureRevocationService.initCrossWorkerSubscriber();

            expect(readyHandler).not.toBeNull();
            readyHandler!();

            expect(clearCacheSpy).toHaveBeenCalled();
        });
    });

    describe('CompanySettingsService Settings Update Integration', () => {
        it('should trigger revocation when Company Admin disables enableLiveMonitoring', async () => {
            mocks.companyFindById.mockResolvedValue({ _id: COMPANY_A, name: 'Acme Corp' });
            mocks.companySettingsFindOneAndUpdate.mockResolvedValue({
                companyId: COMPANY_A,
                features: { enableLiveMonitoring: false, enableChat: true },
            });

            const revokeSpy = vi.spyOn(FeatureRevocationService, 'revokeCompanyFeatures');

            await CompanySettingsService.updateSettings(
                COMPANY_A,
                { features: { enableLiveMonitoring: false } },
                USER_A1
            );

            expect(revokeSpy).toHaveBeenCalledWith(COMPANY_A, ['enableLiveMonitoring']);
            expect(socketCompanyA.leave).toHaveBeenCalledWith(`company:${COMPANY_A}:monitoring`);
        });

        it('should NOT trigger revocation when general settings like timezone are updated', async () => {
            mocks.companyFindById.mockResolvedValue({ _id: COMPANY_A, name: 'Acme Corp', timezone: 'UTC' });
            mocks.companySettingsFindOneAndUpdate.mockResolvedValue({
                companyId: COMPANY_A,
                general: { timezone: 'Asia/Kolkata' },
            });

            const revokeSpy = vi.spyOn(FeatureRevocationService, 'revokeCompanyFeatures');

            await CompanySettingsService.updateSettings(
                COMPANY_A,
                { general: { timezone: 'Asia/Kolkata' } },
                USER_A1
            );

            expect(revokeSpy).not.toHaveBeenCalled();
            expect(socketCompanyA.leave).not.toHaveBeenCalled();
        });

        it('should NOT trigger revocation if validation or company lookup fails', async () => {
            mocks.companyFindById.mockResolvedValue(null);
            const revokeSpy = vi.spyOn(FeatureRevocationService, 'revokeCompanyFeatures');

            await expect(
                CompanySettingsService.updateSettings(COMPANY_A, { features: { enableChat: false } }, USER_A1)
            ).rejects.toThrow('Company not found');

            expect(revokeSpy).not.toHaveBeenCalled();
            expect(socketCompanyA.leave).not.toHaveBeenCalled();
        });
    });

    describe('RealtimeEventService Broadcast Guarding & Authorization Post-Revocation', () => {
        it('should block monitoring event broadcast when enableLiveMonitoring is disabled', async () => {
            mocks.companySettingsFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    companyId: COMPANY_A,
                    features: { enableLiveMonitoring: false },
                }),
            });

            await RealtimeEventService.broadcastMonitoringEvent(COMPANY_A, MONITORING_SOCKET_EVENTS.PRESENCE_UPDATED, {
                employeeId: USER_A1,
                presenceStatus: 'ONLINE',
            });

            // io.to().emit should not have been called for monitoring room
            expect(mockIoServer.to).not.toHaveBeenCalledWith(`company:${COMPANY_A}:monitoring`);
        });

        it('should deny new socket subscriptions immediately post-revocation', async () => {
            mocks.companySettingsFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    companyId: COMPANY_A,
                    features: { enableLiveMonitoring: false, enableChat: false },
                }),
            });

            const liveAccess = await FeatureAccessService.checkAccess(COMPANY_A, 'enableLiveMonitoring');
            expect(liveAccess.allowed).toBe(false);
            expect(liveAccess.reason).toBe('FEATURE_DISABLED_BY_COMPANY');

            const chatAccess = await FeatureAccessService.checkAccess(COMPANY_A, 'enableChat');
            expect(chatAccess.allowed).toBe(false);
            expect(chatAccess.reason).toBe('FEATURE_DISABLED_BY_COMPANY');
        });
    });
});
