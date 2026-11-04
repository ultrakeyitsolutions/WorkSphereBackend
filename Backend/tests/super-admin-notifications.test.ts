import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Types } from 'mongoose';
import { SuperAdminNotificationService } from '../src/modules/super-admin/notifications/super-admin-notification.service';
import { SuperAdminNotificationPreference } from '../src/modules/super-admin/notifications/super-admin-notification-preference.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { User } from '../src/modules/users/user.model';
import { Role } from '../src/modules/roles/role.model';
import { getSocketServer } from '../src/sockets/socket-server';
import { SuperAdminNotificationRedisService } from '../src/modules/super-admin/notifications/super-admin-notification-redis.service';
import { requireSuperAdmin } from '../src/modules/super-admin/shared/super-admin-guard';
import { Request, Response, NextFunction } from 'express';

// Mock dependencies
vi.mock('../src/sockets/socket-server', () => ({
    getSocketServer: vi.fn(),
}));

vi.mock('../src/modules/super-admin/notifications/super-admin-notification-redis.service', () => ({
    SuperAdminNotificationRedisService: {
        publishEvent: vi.fn().mockResolvedValue(true),
        initRedisSubscriber: vi.fn(),
    },
}));

describe('Production-Grade SuperAdmin Notification System', () => {
    const superAdminId1 = new Types.ObjectId().toString();
    const superAdminId2 = new Types.ObjectId().toString();
    const companyAdminId = new Types.ObjectId().toString();
    const employeeId = new Types.ObjectId().toString();
    const companyId = new Types.ObjectId().toString();
    const roleId = new Types.ObjectId();

    let mockSocketIO: any;
    let emittedEvents: Array<{ room: string; event: string; payload: any }> = [];

    beforeEach(() => {
        vi.restoreAllMocks();
        emittedEvents = [];

        mockSocketIO = {
            to: vi.fn().mockImplementation((room: string) => ({
                emit: vi.fn().mockImplementation((event: string, payload: any) => {
                    emittedEvents.push({ room, event, payload });
                }),
            })),
        };

        (getSocketServer as any).mockReturnValue(mockSocketIO);

        // Mock Role.findOne with lean()
        vi.spyOn(Role, 'findOne').mockReturnValue({
            lean: vi.fn().mockResolvedValue({ _id: roleId, name: 'SUPER_ADMIN' }),
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ _id: roleId, name: 'SUPER_ADMIN' }),
            }),
        } as any);

        // Mock User.find to return multiple active SuperAdmins
        vi.spyOn(User, 'find').mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    { _id: new Types.ObjectId(superAdminId1), email: 'super1@worksphere.com' },
                    { _id: new Types.ObjectId(superAdminId2), email: 'super2@worksphere.com' },
                ]),
            }),
            lean: vi.fn().mockResolvedValue([
                { _id: new Types.ObjectId(superAdminId1), email: 'super1@worksphere.com' },
                { _id: new Types.ObjectId(superAdminId2), email: 'super2@worksphere.com' },
            ]),
        } as any);

        // Mock default preferences
        vi.spyOn(SuperAdminNotificationPreference, 'findOne').mockReturnValue({
            lean: vi.fn().mockResolvedValue(null),
        } as any);

        // Default countDocuments mock
        vi.spyOn(Notification, 'countDocuments').mockResolvedValue(0);

        // Default insertMany mock
        vi.spyOn(Notification, 'insertMany').mockImplementation(async (docs: any) => {
            return docs.map((d: any) => ({
                ...d,
                _id: new Types.ObjectId(),
                createdAt: new Date(),
            }));
        });

        // Default find mock
        vi.spyOn(Notification, 'find').mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
            sort: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            populate: vi.fn().mockReturnThis(),
        } as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ─── 1. ACCESS CONTROL TESTS ───────────────────────────────────────────────
    describe('1. SuperAdmin RBAC & Access Control Guard', () => {
        const superAdminCheck = requireSuperAdmin[1] as any;

        it('should allow access to users with SUPER_ADMIN role', async () => {
            const req = {
                authenticatedUser: { id: superAdminId1, role: 'SUPER_ADMIN' },
                user: { userId: superAdminId1, role: 'SUPER_ADMIN' },
            } as unknown as Request;
            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn(),
            } as unknown as Response;
            const next = vi.fn() as NextFunction;

            await superAdminCheck(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should block and reject Company Admin access with 403 Forbidden', async () => {
            const req = {
                authenticatedUser: { id: companyAdminId, role: 'COMPANY_ADMIN', email: 'admin@company.com' },
                user: { userId: companyAdminId, role: 'COMPANY_ADMIN' },
                ip: '192.168.1.1',
                originalUrl: '/api/superadmin/notifications',
                method: 'GET',
            } as unknown as Request;
            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn(),
            } as unknown as Response;
            const next = vi.fn() as NextFunction;

            await superAdminCheck(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: 'Forbidden: Super Admin access required',
            }));
        });

        it('should block and reject Employee access with 403 Forbidden', async () => {
            const req = {
                authenticatedUser: { id: employeeId, role: 'EMPLOYEE', email: 'emp@company.com' },
                user: { userId: employeeId, role: 'EMPLOYEE' },
                ip: '192.168.1.2',
                originalUrl: '/api/superadmin/notifications',
                method: 'GET',
            } as unknown as Request;
            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn(),
            } as unknown as Response;
            const next = vi.fn() as NextFunction;

            await superAdminCheck(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
        });
    });

    // ─── 2. NOTIFICATION CREATION & MULTI-SUPERADMIN DELIVERY ─────────────────
    describe('2. Multi-SuperAdmin Delivery & Creation', () => {
        it('should deliver notifications to all active SuperAdmin accounts', async () => {
            const createdDocs: any[] = [];
            vi.spyOn(Notification, 'insertMany').mockImplementation(async (docs: any) => {
                docs.forEach((d: any) => createdDocs.push({ ...d, _id: new Types.ObjectId(), createdAt: new Date() }));
                return createdDocs as any;
            });

            const result = await SuperAdminNotificationService.dispatchNotification({
                type: 'COMPANY_REGISTERED',
                category: 'COMPANY_MANAGEMENT',
                title: 'New Company Registered',
                message: 'Acme Corp registered on the platform.',
                priority: 'HIGH',
                companyId,
                metadata: { companyName: 'Acme Corp' },
            });

            expect(result).toHaveLength(2);
            expect(createdDocs).toHaveLength(2);
            expect(createdDocs[0].recipientRole).toBe('SUPER_ADMIN');
            expect(createdDocs[1].recipientRole).toBe('SUPER_ADMIN');
            expect(createdDocs[0].priority).toBe('HIGH');
            expect(createdDocs[0].category).toBe('COMPANY_MANAGEMENT');

            // Verified socket broadcast to dedicated room
            expect(mockSocketIO.to).toHaveBeenCalledWith('superadmin');
            const newNotifEmission = emittedEvents.find(e => e.event === 'superadmin:notification:new');
            expect(newNotifEmission).toBeDefined();
            expect(newNotifEmission?.payload.title).toBe('New Company Registered');
        });
    });

    // ─── 3. DUPLICATE EVENT PREVENTION (IDEMPOTENCY) ──────────────────────────
    describe('3. Idempotency & Duplicate Event Prevention', () => {
        it('should prevent duplicate notifications with the same eventId', async () => {
            const eventId = 'webhook_evt_razorpay_98765';

            // Simulate existing notification found with this eventId
            vi.spyOn(Notification, 'countDocuments').mockResolvedValue(1);
            vi.spyOn(Notification, 'find').mockReturnValue({
                lean: vi.fn().mockResolvedValue([{ _id: new Types.ObjectId(), eventId }]),
            } as any);

            const insertManySpy = vi.spyOn(Notification, 'insertMany');

            const result = await SuperAdminNotificationService.dispatchNotification({
                eventId,
                type: 'PAYMENT_SUCCESS',
                category: 'SUBSCRIPTION_PAYMENTS',
                title: 'Payment Successful',
                message: 'INR 50,000 paid by Enterprise Corp',
                priority: 'MEDIUM',
            });

            expect(result).toHaveLength(1);
            expect(insertManySpy).not.toHaveBeenCalled();
            expect(emittedEvents.filter(e => e.event === 'superadmin:notification:new')).toHaveLength(0);
        });
    });

    // ─── 4. ALERT THROTTLING & COOLDOWN FOR HEALTH ALERTS ─────────────────────
    describe('4. Deduplication & Throttling of Repetitive System Health Alerts', () => {
        it('should throttle repeated system health alerts during failure bursts', async () => {
            // First alert
            const firstDispatch = await SuperAdminNotificationService.dispatchNotification({
                type: 'MONGODB_CONNECTION_FAILED',
                category: 'SYSTEM_HEALTH',
                title: 'MongoDB Connection Lost',
                message: 'Unable to reach primary replica set',
                priority: 'CRITICAL',
            });
            expect(firstDispatch.length).toBeGreaterThan(0);

            // Immediate second alert with same type and category should be suppressed by cooldown
            const secondDispatch = await SuperAdminNotificationService.dispatchNotification({
                type: 'MONGODB_CONNECTION_FAILED',
                category: 'SYSTEM_HEALTH',
                title: 'MongoDB Connection Lost',
                message: 'Unable to reach primary replica set (retry 2)',
                priority: 'CRITICAL',
            });

            expect(secondDispatch).toHaveLength(0);
        });
    });

    // ─── 5. READ / UNREAD OPERATIONS ──────────────────────────────────────────
    describe('5. Read & Unread Operations', () => {
        it('should mark a notification as read and emit updated count', async () => {
            const notifId = new Types.ObjectId().toString();
            const fakeUpdatedNotif = {
                _id: new Types.ObjectId(notifId),
                recipientId: new Types.ObjectId(superAdminId1),
                isRead: true,
                readAt: new Date(),
            };

            vi.spyOn(Notification, 'findOneAndUpdate').mockResolvedValue(fakeUpdatedNotif as any);

            const updated = await SuperAdminNotificationService.markAsRead(notifId, superAdminId1);
            expect(updated?.isRead).toBe(true);
            expect(updated?.readAt).toBeInstanceOf(Date);

            // Verify socket unread-count emission
            const countEmission = emittedEvents.find(e => e.event === 'superadmin:notification:unread-count');
            expect(countEmission).toBeDefined();
            expect(countEmission?.payload.unreadCount).toBe(0);
        });

        it('should mark all notifications as read for a SuperAdmin', async () => {
            vi.spyOn(Notification, 'updateMany').mockResolvedValue({ modifiedCount: 5 } as any);

            const modified = await SuperAdminNotificationService.markAllAsRead(superAdminId1);
            expect(modified).toBe(5);

            const countEmission = emittedEvents.find(e => e.event === 'superadmin:notification:unread-count');
            expect(countEmission?.payload.unreadCount).toBe(0);
        });

        it('should return accurate unread notification count', async () => {
            vi.spyOn(Notification, 'countDocuments').mockResolvedValue(3);

            const count = await SuperAdminNotificationService.getUnreadCount(superAdminId1);
            expect(count).toBe(3);
        });
    });

    // ─── 6. PAGINATION & FILTERING ────────────────────────────────────────────
    describe('6. Pagination, Categorization & Filtering', () => {
        it('should support pagination and filtering by category, priority, and isRead', async () => {
            const mockFind = {
                sort: vi.fn().mockReturnThis(),
                skip: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: new Types.ObjectId(),
                        category: 'SECURITY_ACCESS',
                        priority: 'CRITICAL',
                        isRead: false,
                    },
                ]),
            };

            vi.spyOn(Notification, 'find').mockReturnValue(mockFind as any);
            vi.spyOn(Notification, 'countDocuments').mockResolvedValue(1);

            const result = await SuperAdminNotificationService.getNotifications(superAdminId1, {
                category: 'SECURITY_ACCESS',
                priority: 'CRITICAL',
                isRead: false,
                page: 1,
                limit: 10,
            });

            expect(result.notifications).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(result.page).toBe(1);
            expect(result.totalPages).toBe(1);
            expect(mockFind.sort).toHaveBeenCalledWith({ createdAt: -1 });
        });
    });

    // ─── 7. PREFERENCE ENFORCEMENT & CRITICAL ALERT PROTECTION ────────────────
    describe('7. SuperAdmin Preferences & Critical Alert Policy', () => {
        it('should prevent silently disabling SECURITY_ACCESS or SYSTEM_HEALTH without explicit policy', async () => {
            await expect(
                SuperAdminNotificationService.updatePreferences(superAdminId1, {
                    categories: {
                        SECURITY_ACCESS: false,
                    },
                })
            ).rejects.toThrow(/Critical security and system health alerts cannot be disabled/);
        });

        it('should allow disabling non-critical categories such as EMPLOYEE_WORKFORCE', async () => {
            const updatedDoc = {
                userId: new Types.ObjectId(superAdminId1),
                categories: {
                    EMPLOYEE_WORKFORCE: false,
                    COMPANY_MANAGEMENT: true,
                    SECURITY_ACCESS: true,
                    SYSTEM_HEALTH: true,
                },
                minPriority: 'LOW',
                channels: { inApp: true, email: true, push: true },
                allowDisableCriticalSecurity: false,
            };

            vi.spyOn(SuperAdminNotificationPreference, 'findOneAndUpdate').mockReturnValue({
                lean: vi.fn().mockResolvedValue(updatedDoc),
            } as any);

            const result = await SuperAdminNotificationService.updatePreferences(superAdminId1, {
                categories: {
                    EMPLOYEE_WORKFORCE: false,
                },
            });

            expect(result.categories.EMPLOYEE_WORKFORCE).toBe(false);
        });
    });

    // ─── 8. RESILIENCE: REDIS AND SOCKET FAILURES ─────────────────────────────
    describe('8. Production Resilience (Socket & Redis Failures)', () => {
        it('should persist notification in MongoDB even if Socket.IO broadcast throws an error', async () => {
            mockSocketIO.to.mockImplementation(() => {
                throw new Error('Socket transport write timeout');
            });

            vi.spyOn(Notification, 'insertMany').mockResolvedValue([
                {
                    _id: new Types.ObjectId(),
                    recipientId: superAdminId1,
                    title: 'Resilience Test',
                    recipientRole: 'SUPER_ADMIN',
                },
            ] as any);

            // Should complete successfully without crashing
            const result = await SuperAdminNotificationService.dispatchNotification({
                type: 'BACKEND_SERVICE_DOWN',
                category: 'SYSTEM_HEALTH',
                title: 'Backend Node Crashed',
                message: 'Worker PID 1245 was terminated',
                priority: 'CRITICAL',
            });

            expect(result).toHaveLength(1);
        });

        it('should fall back gracefully to direct socket delivery when Redis Pub/Sub fails', async () => {
            (SuperAdminNotificationRedisService.publishEvent as any).mockRejectedValue(
                new Error('ECONNREFUSED Redis connection lost')
            );

            vi.spyOn(Notification, 'insertMany').mockResolvedValue([
                {
                    _id: new Types.ObjectId(),
                    recipientId: superAdminId1,
                    title: 'Redis Fallback Test',
                    recipientRole: 'SUPER_ADMIN',
                },
            ] as any);

            const result = await SuperAdminNotificationService.dispatchNotification({
                type: 'REDIS_CONNECTION_FAILED',
                category: 'SYSTEM_HEALTH',
                title: 'Redis Connection Error',
                message: 'Redis server is unreachable',
                priority: 'CRITICAL',
            });

            expect(result).toHaveLength(1);
            // Confirms socket direct emission occurred despite Redis failure
            expect(mockSocketIO.to).toHaveBeenCalledWith('superadmin');
        });
    });

    // ─── 9. DELETION OPERATIONS ───────────────────────────────────────────────
    describe('9. Deletion Operations', () => {
        it('should delete a single notification for the SuperAdmin', async () => {
            const notifId = new Types.ObjectId().toString();
            vi.spyOn(Notification, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as any);

            const success = await SuperAdminNotificationService.deleteNotification(notifId, superAdminId1);
            expect(success).toBe(true);
            expect(Notification.deleteOne).toHaveBeenCalledWith({
                _id: new Types.ObjectId(notifId),
                recipientId: new Types.ObjectId(superAdminId1),
            });
        });

        it('should delete all read notifications for the SuperAdmin', async () => {
            vi.spyOn(Notification, 'deleteMany').mockResolvedValue({ deletedCount: 8 } as any);

            const count = await SuperAdminNotificationService.deleteReadNotifications(superAdminId1);
            expect(count).toBe(8);
            expect(Notification.deleteMany).toHaveBeenCalledWith({
                recipientId: new Types.ObjectId(superAdminId1),
                isRead: true,
            });
        });
    });
});
