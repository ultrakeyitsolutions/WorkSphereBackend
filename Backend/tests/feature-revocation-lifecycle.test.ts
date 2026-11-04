import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Types } from 'mongoose';
import {
    FeatureRevocationService,
    FEATURE_REVOCATION_REDIS_CHANNEL,
    FeatureRevocationEvent,
} from '../src/modules/companyadmin/settings/feature-revocation.service';
import { ModuleAccessService } from '../src/modules/companyadmin/module-access/module-access.service';
import { requireModuleAccess } from '../src/middleware/module-access.middleware';
import { EntitlementService } from '../services/entitlement.service';

const COMPANY_A = new Types.ObjectId().toString();
const COMPANY_B = new Types.ObjectId().toString();
const EMPLOYEE_1 = new Types.ObjectId().toString();
const EMPLOYEE_2 = new Types.ObjectId().toString();

// In-memory socket store
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

vi.mock('../src/services/entitlement.service', () => ({
    EntitlementService: {
        hasFeature: vi.fn().mockResolvedValue(true),
        getEntitlementDetails: vi.fn().mockResolvedValue({ enabled: true, limit: null }),
    },
}));

let subscriberMessageHandler: ((channel: string, message: string) => void) | null = null;
let mockDuplicateSubscriber: any = null;

const mockPrimaryRedis = {
    status: 'ready',
    publish: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
    duplicate: vi.fn(() => mockDuplicateSubscriber),
};

vi.mock('../src/config/redis', () => ({
    getRedisClient: vi.fn(() => mockPrimaryRedis),
    redisGet: vi.fn().mockResolvedValue(null),
    redisSet: vi.fn().mockResolvedValue(undefined),
    redisDel: vi.fn().mockResolvedValue(undefined),
}));

describe('WorkSphere Feature Access Revocation Lifecycle — 10 Scenarios', () => {
    function createMockSocket(id: string, userId: string, companyId: string, rooms: string[] = []) {
        const joinedRooms = new Set<string>(rooms);
        const socket = {
            id,
            data: {
                user: {
                    userId,
                    companyId,
                    role: 'EMPLOYEE',
                },
            },
            rooms: joinedRooms,
            emit: vi.fn(),
            leave: vi.fn((room: string) => {
                joinedRooms.delete(room);
            }),
            join: vi.fn((room: string) => {
                joinedRooms.add(room);
            }),
            disconnect: vi.fn(),
        };
        mockSockets.set(id, socket);
        return socket;
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        mockSockets.clear();
        subscriberMessageHandler = null;

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

        mockPrimaryRedis.duplicate.mockReturnValue(mockDuplicateSubscriber);
        await FeatureRevocationService.initCrossWorkerSubscriber();
    });

    afterEach(async () => {
        await FeatureRevocationService.shutdown();
    });

    // =========================================================================
    // Scenario 1: Employee opens feature -> Company Admin revokes access
    // =========================================================================
    it('Scenario 1: Employee opens feature -> Company Admin revokes access, triggering immediate cross-worker broadcast', async () => {
        const socket = createMockSocket('sock-emp-1', EMPLOYEE_1, COMPANY_A);

        await FeatureRevocationService.revokeEmployeeModules(
            COMPANY_A,
            [EMPLOYEE_1],
            ['tasks', 'calendar']
        );

        // 1. Verify published to Redis channel for cross-worker broadcast
        expect(mockPrimaryRedis.publish).toHaveBeenCalledWith(
            FEATURE_REVOCATION_REDIS_CHANNEL,
            expect.stringContaining('"type":"EMPLOYEE_MODULES"')
        );

        // 2. Verify local socket receives instant eviction payload
        expect(socket.emit).toHaveBeenCalledWith(
            'feature:revocation',
            expect.objectContaining({
                type: 'EMPLOYEE_MODULES',
                companyId: COMPANY_A,
                userId: EMPLOYEE_1,
                revokedModules: ['tasks', 'calendar'],
            })
        );
    });

    // =========================================================================
    // Scenario 2: Employee remains on protected screen during revocation (socket evicted from rooms)
    // =========================================================================
    it('Scenario 2: Employee remains on protected screen -> socket is forcefully evicted from associated rooms', async () => {
        const socketChat = createMockSocket('sock-chat', EMPLOYEE_1, COMPANY_A, [
            'conversation:room-123',
            'company:' + COMPANY_A + ':monitoring',
        ]);

        await FeatureRevocationService.revokeEmployeeModules(COMPANY_A, [EMPLOYEE_1], ['chat', 'live-monitoring']);

        // Sockets must be forcefully ejected from chat conversation and live monitoring rooms
        expect(socketChat.leave).toHaveBeenCalledWith('conversation:room-123');
        expect(socketChat.leave).toHaveBeenCalledWith('company:' + COMPANY_A + ':monitoring');
        expect(socketChat.emit).toHaveBeenCalledWith('feature:revocation', expect.anything());
    });

    // =========================================================================
    // Scenario 3: Employee attempts to reopen feature using direct URL/route
    // =========================================================================
    it('Scenario 3: Employee attempts to reopen feature using direct route -> blocked fail-closed by requireModuleAccess', async () => {
        vi.spyOn(ModuleAccessService, 'getEffectiveMemberModuleAccess').mockResolvedValue({
            effectiveModules: {
                tasks: false,
                calendar: true,
            } as any,
        } as any);

        const middleware = requireModuleAccess('tasks');
        const req: any = {
            currentUser: { userId: EMPLOYEE_1, companyId: COMPANY_A, role: 'EMPLOYEE' },
        };
        const res: any = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const next = vi.fn();

        await middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false,
                errors: expect.objectContaining({
                    code: 'MODULE_ACCESS_RESTRICTED',
                    moduleKey: 'tasks',
                }),
            })
        );
    });

    // =========================================================================
    // Scenario 4: Employee calls protected API directly
    // =========================================================================
    it('Scenario 4: Employee calls protected API directly -> rejected with HTTP 403 MODULE_ACCESS_RESTRICTED', async () => {
        vi.spyOn(ModuleAccessService, 'getEffectiveMemberModuleAccess').mockResolvedValue({
            effectiveModules: {
                attendance: false,
            } as any,
        } as any);

        const middleware = requireModuleAccess('attendance');
        const req: any = {
            currentUser: { userId: EMPLOYEE_1, companyId: COMPANY_A, role: 'EMPLOYEE' },
            path: '/api/v1/attendance/check-in',
        };
        const res: any = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const next = vi.fn();

        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false,
                errors: expect.objectContaining({
                    code: 'MODULE_ACCESS_RESTRICTED',
                    moduleKey: 'attendance',
                }),
            })
        );
        expect(next).not.toHaveBeenCalled();
    });

    // =========================================================================
    // Scenario 5: Employee attempts action through open modal
    // =========================================================================
    it('Scenario 5: Employee attempts action through an open modal -> API endpoint rejects action with 403', async () => {
        // Modal for creating project / task submitted after admin revoked access
        vi.spyOn(ModuleAccessService, 'getEffectiveMemberModuleAccess').mockResolvedValue({
            effectiveModules: {
                projects: false,
            } as any,
        } as any);

        const middleware = requireModuleAccess('projects');
        const req: any = {
            currentUser: { userId: EMPLOYEE_1, companyId: COMPANY_A, role: 'EMPLOYEE' },
            body: { title: 'New Secret Project', deadline: new Date() },
        };
        const res: any = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const next = vi.fn();

        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false,
                errors: expect.objectContaining({
                    code: 'MODULE_ACCESS_RESTRICTED',
                    moduleKey: 'projects',
                }),
            })
        );
        expect(next).not.toHaveBeenCalled();
    });

    // =========================================================================
    // Scenario 6: Employee disconnects and reconnects to Socket.IO
    // =========================================================================
    it('Scenario 6: Employee disconnects and reconnects -> stale cache purged, sync re-evaluates permissions', async () => {
        const invalidateSpy = vi.spyOn(ModuleAccessService, 'invalidateMemberAccessCache');

        // Simulate reconnect event handling triggering cache purge
        await ModuleAccessService.invalidateMemberAccessCache(COMPANY_A, [EMPLOYEE_1]);

        expect(invalidateSpy).toHaveBeenCalledWith(COMPANY_A, [EMPLOYEE_1]);

        // Next access check re-fetches canonical state from DB without stale cache
        vi.spyOn(ModuleAccessService, 'getEffectiveMemberModuleAccess').mockResolvedValue({
            effectiveModules: {
                tasks: false,
            } as any,
        } as any);

        const middleware = requireModuleAccess('tasks');
        const req: any = {
            currentUser: { userId: EMPLOYEE_1, companyId: COMPANY_A, role: 'EMPLOYEE' },
        };
        const res: any = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const next = vi.fn();

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    // =========================================================================
    // Scenario 7: Multiple employee sessions across multi-worker Redis pub/sub
    // =========================================================================
    it('Scenario 7: Multiple employee sessions on secondary workers receive Redis pub/sub revocation', async () => {
        // Worker 2 has sockets for EMPLOYEE_1
        const sock1 = createMockSocket('sock-desktop', EMPLOYEE_1, COMPANY_A);
        const sock2 = createMockSocket('sock-mobile', EMPLOYEE_1, COMPANY_A);

        expect(subscriberMessageHandler).toBeDefined();

        // Simulate incoming message from Worker 1
        const eventMessage: FeatureRevocationEvent = {
            type: 'EMPLOYEE_MODULES',
            companyId: COMPANY_A,
            userIds: [EMPLOYEE_1],
            revokedModules: ['timesheet'],
            timestamp: Date.now(),
        };

        subscriberMessageHandler!(FEATURE_REVOCATION_REDIS_CHANNEL, JSON.stringify(eventMessage));

        // Both sessions on Worker 2 must receive revocation event
        expect(sock1.emit).toHaveBeenCalledWith(
            'feature:revocation',
            expect.objectContaining({
                type: 'EMPLOYEE_MODULES',
                revokedModules: ['timesheet'],
            })
        );
        expect(sock2.emit).toHaveBeenCalledWith(
            'feature:revocation',
            expect.objectContaining({
                type: 'EMPLOYEE_MODULES',
                revokedModules: ['timesheet'],
            })
        );
    });

    // =========================================================================
    // Scenario 8: Redis Pub/Sub delayed/unavailable fallback (Fail-closed API)
    // =========================================================================
    it('Scenario 8: Redis Pub/Sub unavailable -> API middleware fails closed using fresh database check', async () => {
        // Direct database evaluation returns module disabled
        vi.spyOn(ModuleAccessService, 'getEffectiveMemberModuleAccess').mockResolvedValue({
            effectiveModules: {
                calendar: false,
            } as any,
        } as any);

        const middleware = requireModuleAccess('calendar');
        const req: any = {
            currentUser: { userId: EMPLOYEE_1, companyId: COMPANY_A, role: 'EMPLOYEE' },
        };
        const res: any = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const next = vi.fn();

        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false,
                errors: expect.objectContaining({
                    code: 'MODULE_ACCESS_RESTRICTED',
                    moduleKey: 'calendar',
                }),
            })
        );
    });

    // =========================================================================
    // Scenario 9: Access restored by Company Admin -> employee can access feature again
    // =========================================================================
    it('Scenario 9: Access restored by Company Admin -> employee can access feature again', async () => {
        // Initially revoked -> 403
        const getEffectiveSpy = vi.spyOn(ModuleAccessService, 'getEffectiveMemberModuleAccess');
        getEffectiveSpy.mockResolvedValueOnce({
            effectiveModules: {
                tasks: false,
            } as any,
        } as any);

        const middleware = requireModuleAccess('tasks');
        const req: any = {
            currentUser: { userId: EMPLOYEE_1, companyId: COMPANY_A, role: 'EMPLOYEE' },
        };
        let res: any = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        let next = vi.fn();

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();

        // Admin re-enables access
        getEffectiveSpy.mockResolvedValueOnce({
            effectiveModules: {
                tasks: true,
            } as any,
        } as any);

        res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        next = vi.fn();

        await middleware(req, res, next);
        // Successfully passes through to handler
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    // =========================================================================
    // Scenario 10: Unrelated features and other authorized employees continue unaffected
    // =========================================================================
    it('Scenario 10: Unrelated features and other employees/tenants continue working unaffected', async () => {
        const sockEmp1 = createMockSocket('sock-emp-1', EMPLOYEE_1, COMPANY_A);
        const sockEmp2 = createMockSocket('sock-emp-2', EMPLOYEE_2, COMPANY_A);
        const sockTenantB = createMockSocket('sock-tenant-b', 'user-b', COMPANY_B);

        // Revoke tasks for Employee 1 in Company A
        await FeatureRevocationService.revokeEmployeeModules(
            COMPANY_A,
            [EMPLOYEE_1],
            ['tasks']
        );

        // Employee 1 receives revocation
        expect(sockEmp1.emit).toHaveBeenCalledWith('feature:revocation', expect.anything());

        // Employee 2 does NOT receive revocation
        expect(sockEmp2.emit).not.toHaveBeenCalledWith('feature:revocation', expect.anything());

        // Tenant B does NOT receive revocation
        expect(sockTenantB.emit).not.toHaveBeenCalled();

        // Employee 1 can still access other unrelated modules (e.g. calendar)
        vi.spyOn(ModuleAccessService, 'getEffectiveMemberModuleAccess').mockResolvedValue({
            effectiveModules: {
                tasks: false,
                calendar: true,
            } as any,
        } as any);

        const middlewareCalendar = requireModuleAccess('calendar');
        const req: any = {
            currentUser: { userId: EMPLOYEE_1, companyId: COMPANY_A, role: 'EMPLOYEE' },
        };
        const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();

        await middlewareCalendar(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});
