import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { generateAccessToken } from '../src/utils/tokens';
import { NotificationSoundLibraryService } from '../src/modules/notification-sounds/notification-sound-library.service';
import { NotificationSoundService } from '../src/modules/notification-sounds/notification-sound.service';
import { NotificationService } from '../src/modules/notifications/notification.service';

// Mock StorageConfigurationService
vi.mock('../src/modules/super-admin/storage/storage-config.service', () => ({
    StorageConfigurationService: {
        getActiveConfiguration: vi.fn().mockResolvedValue({
            provider: 'BUNNY',
            enabled: true,
            configuration: {
                basePath: 'worksphere',
                pullZoneUrl: 'https://cdn.worksphere.com',
            },
        }),
    },
}));

// Mock StorageProviderFactory
vi.mock('../src/infrastructure/storage/storage-provider.factory', () => ({
    StorageProviderFactory: {
        createProvider: vi.fn().mockReturnValue({
            uploadFile: vi.fn().mockImplementation(async (_buffer, storageKey) => ({
                storageKey,
                storageUrl: `https://cdn.worksphere.com/${storageKey}`,
                size: 1024,
            })),
            deleteFile: vi.fn().mockResolvedValue(true),
            fileExists: vi.fn().mockResolvedValue(true),
            getFileUrl: vi.fn().mockImplementation((key) => `https://cdn.worksphere.com/${key}`),
        }),
    },
}));

// Mock User and Company models for Auth Middleware
vi.mock('../src/modules/users/user.model', () => ({
    User: {
        findById: vi.fn().mockImplementation((id: string) => ({
            populate: vi.fn().mockResolvedValue({
                _id: id,
                isActive: true,
                status: 'ACTIVE',
                companyId: '507f1f77bcf86cd799439033',
                role: {
                    name: id === '507f1f77bcf86cd799439022' ? 'COMPANY_ADMIN' : 'EMPLOYEE',
                },
            }),
        })),
    },
}));

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: vi.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439033',
            isActive: true,
            status: 'ACTIVE',
        }),
    },
}));

// In-memory MongoDB Mock Data Stores
let mockSounds: any[] = [];
let mockMappings: any[] = [];
let mockAuditLogs: any[] = [];

// Helper to create Mongoose query mock that supports await, .lean(), and .sort()
function createQueryMock(result: any) {
    const promise = Promise.resolve(result);
    return Object.assign(promise, {
        lean: () => Promise.resolve(result),
        sort: () => createQueryMock(result),
    });
}

// Mock NotificationSound Model
vi.mock('../src/modules/notification-sounds/notification-sound.model', () => {
    class MockSoundDoc {
        _id: string;
        soundId: string;
        name: string;
        description: string;
        fileUrl: string;
        storageKey: string;
        mimeType: string;
        fileSize: number;
        durationMs: number;
        isActive: boolean;
        isDefault: boolean;
        platformSounds: any;
        createdBy: any;
        updatedBy: any;
        deletedAt: any;
        createdAt: Date;
        updatedAt: Date;

        constructor(data: any) {
            this._id = data._id || `sound_${Date.now()}_${Math.random()}`;
            this.soundId = data.soundId;
            this.name = data.name;
            this.description = data.description || '';
            this.fileUrl = data.fileUrl;
            this.storageKey = data.storageKey;
            this.mimeType = data.mimeType;
            this.fileSize = data.fileSize;
            this.durationMs = data.durationMs || 0;
            this.isActive = data.isActive !== undefined ? data.isActive : true;
            this.isDefault = Boolean(data.isDefault);
            this.platformSounds = data.platformSounds || {};
            this.createdBy = data.createdBy || null;
            this.updatedBy = data.updatedBy || null;
            this.deletedAt = data.deletedAt || null;
            this.createdAt = data.createdAt || new Date();
            this.updatedAt = data.updatedAt || new Date();
        }

        async save() {
            const idx = mockSounds.findIndex((x) => x._id === this._id || x.soundId === this.soundId);
            if (idx !== -1) {
                mockSounds[idx] = this;
            } else {
                mockSounds.push(this);
            }
            return this;
        }
    }

    const NotificationSoundMock = {
        find: vi.fn().mockImplementation((filter: any = {}) => {
            let results = mockSounds.filter((s) => {
                if (filter.deletedAt === null && s.deletedAt !== null) return false;
                if (filter.isActive !== undefined && s.isActive !== filter.isActive) return false;
                return true;
            });
            return createQueryMock(results);
        }),
        findOne: vi.fn().mockImplementation((filter: any = {}) => {
            const found = mockSounds.find((s) => {
                if (filter.soundId && s.soundId !== filter.soundId) return false;
                if (filter.deletedAt === null && s.deletedAt !== null) return false;
                if (filter.isActive !== undefined && s.isActive !== filter.isActive) return false;
                if (filter.isDefault !== undefined && s.isDefault !== filter.isDefault) return false;
                return true;
            });

            if (!found) {
                return createQueryMock(null);
            }
            const doc = new MockSoundDoc(found);
            return createQueryMock(doc);
        }),
        create: vi.fn().mockImplementation(async (data: any) => {
            const doc = new MockSoundDoc(data);
            mockSounds.push(doc);
            return doc;
        }),
        updateMany: vi.fn().mockImplementation(async (filter: any, update: any) => {
            let count = 0;
            mockSounds.forEach((s) => {
                if (filter.isDefault && s.isDefault) {
                    if (filter._id?.$ne && s._id === filter._id.$ne) return;
                    if (update.$set) Object.assign(s, update.$set);
                    count++;
                }
            });
            return { modifiedCount: count };
        }),
    };
    return { NotificationSound: NotificationSoundMock };
});

// Mock NotificationSoundMapping Model
vi.mock('../src/modules/notification-sounds/notification-sound-mapping.model', () => {
    const NotificationSoundMappingMock = {
        find: vi.fn().mockImplementation((filter: any = {}) => {
            let results = mockMappings.filter((m) => {
                if (filter.soundId && m.soundId !== filter.soundId) return false;
                if (filter.isEnabled !== undefined && m.isEnabled !== filter.isEnabled) return false;
                return true;
            });
            return createQueryMock(results);
        }),
        findOne: vi.fn().mockImplementation((filter: any = {}) => {
            const found = mockMappings.find((m) => {
                if (filter.notificationType && m.notificationType !== filter.notificationType) return false;
                return true;
            });
            return createQueryMock(found ? { ...found } : null);
        }),
        findOneAndUpdate: vi.fn().mockImplementation(async (filter: any, update: any, _opts: any) => {
            let existing = mockMappings.find((m) => m.notificationType === filter.notificationType);
            if (!existing) {
                existing = {
                    _id: `mapping_${Date.now()}`,
                    notificationType: filter.notificationType,
                    soundId: null,
                    isEnabled: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                mockMappings.push(existing);
            }
            if (update.$set) Object.assign(existing, update.$set);
            existing.updatedAt = new Date();
            return createQueryMock({ ...existing });
        }),
    };
    return { NotificationSoundMapping: NotificationSoundMappingMock };
});

// Mock AuditLogService
vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn().mockImplementation(async (entry: any) => {
            mockAuditLogs.push(entry);
            return entry;
        }),
    },
}));

describe('Notification Sound Management Backend', () => {
    const superAdminToken = generateAccessToken({
        userId: '507f1f77bcf86cd799439011',
        email: 'superadmin@worksphere.com',
        role: 'SUPER_ADMIN',
    });

    const companyAdminToken = generateAccessToken({
        userId: '507f1f77bcf86cd799439022',
        email: 'companyadmin@tenant.com',
        role: 'COMPANY_ADMIN',
        companyId: '507f1f77bcf86cd799439033',
    });

    const employeeToken = generateAccessToken({
        userId: '507f1f77bcf86cd799439044',
        email: 'employee@tenant.com',
        role: 'EMPLOYEE',
        companyId: '507f1f77bcf86cd799439033',
    });

    beforeEach(() => {
        mockSounds = [];
        mockMappings = [];
        mockAuditLogs = [];
        NotificationSoundService.invalidateCache();
    });

    // ─── 1. Authorization Tests ──────────────────────────────────────────────
    describe('Super Admin Authorization & Security', () => {
        it('should allow Super Admin to access sound library endpoints', async () => {
            const res = await request(app)
                .get('/api/superadmin/notification-sounds')
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should forbid Company Admin from accessing sound library endpoints (403)', async () => {
            const res = await request(app)
                .get('/api/superadmin/notification-sounds')
                .set('Authorization', `Bearer ${companyAdminToken}`);

            expect(res.status).toBe(403);
        });

        it('should forbid regular employees from accessing sound library endpoints (403)', async () => {
            const res = await request(app)
                .get('/api/superadmin/notification-sounds')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
        });

        it('should reject unauthenticated requests with 401', async () => {
            const res = await request(app).get('/api/superadmin/notification-sounds');
            expect(res.status).toBe(401);
        });
    });

    // ─── 2. Sound Library CRUD Tests ──────────────────────────────────────────
    describe('Sound Library CRUD & Validations', () => {
        it('should successfully upload an audio file and register a new sound', async () => {
            const fakeMp3Buffer = Buffer.from('FAKE_AUDIO_MP3_DATA');

            const res = await request(app)
                .post('/api/superadmin/notification-sounds')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .field('name', 'Meeting Bell')
                .field('description', 'Chime for incoming meeting requests')
                .field('durationMs', '1500')
                .attach('file', fakeMp3Buffer, { filename: 'meeting-bell.mp3', contentType: 'audio/mp3' });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('Meeting Bell');
            expect(res.body.data.soundId).toBe('meeting-bell');
            expect(res.body.data.fileUrl).toContain('https://cdn.worksphere.com');
            expect(res.body.data.isActive).toBe(true);

            // Audit log check
            expect(mockAuditLogs.some((l) => l.action === 'NOTIFICATION_SOUND_CREATED')).toBe(true);
        });

        it('should reject file upload with unsupported file extension', async () => {
            const fakeExeBuffer = Buffer.from('FAKE_EXE');

            const res = await request(app)
                .post('/api/superadmin/notification-sounds')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .field('name', 'Malicious File')
                .attach('file', fakeExeBuffer, { filename: 'virus.exe', contentType: 'application/x-msdownload' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Unsupported audio');
        });

        it('should update sound metadata and default status', async () => {
            mockSounds.push({
                _id: 'sound_1',
                soundId: 'meeting-bell',
                name: 'Meeting Bell',
                description: 'Old description',
                fileUrl: 'https://cdn.worksphere.com/bell.mp3',
                storageKey: 'worksphere/system/notification-sounds/bell.mp3',
                mimeType: 'audio/mp3',
                fileSize: 2048,
                durationMs: 1200,
                isActive: true,
                isDefault: false,
                deletedAt: null,
            });

            const res = await request(app)
                .patch('/api/superadmin/notification-sounds/meeting-bell')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    name: 'Meeting Bell Updated',
                    description: 'Refined bell sound',
                    isDefault: true,
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('Meeting Bell Updated');
            expect(res.body.data.isDefault).toBe(true);
        });

        it('should prevent deletion of sound if actively referenced by a notification mapping', async () => {
            mockSounds.push({
                _id: 'sound_1',
                soundId: 'meeting-bell',
                name: 'Meeting Bell',
                fileUrl: 'https://cdn.worksphere.com/bell.mp3',
                storageKey: 'key',
                mimeType: 'audio/mp3',
                fileSize: 1000,
                isActive: true,
                isDefault: false,
                deletedAt: null,
            });

            mockMappings.push({
                _id: 'map_1',
                notificationType: 'MEETING_REQUESTED',
                soundId: 'meeting-bell',
                isEnabled: true,
            });

            const res = await request(app)
                .delete('/api/superadmin/notification-sounds/meeting-bell')
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('currently assigned to active notification mapping');
        });

        it('should soft delete sound when not mapped to active events', async () => {
            mockSounds.push({
                _id: 'sound_unmapped',
                soundId: 'unused-chime',
                name: 'Unused Chime',
                fileUrl: 'https://cdn.worksphere.com/chime.mp3',
                storageKey: 'key',
                mimeType: 'audio/mp3',
                fileSize: 1000,
                isActive: true,
                isDefault: false,
                deletedAt: null,
            });

            const res = await request(app)
                .delete('/api/superadmin/notification-sounds/unused-chime')
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const deleted = mockSounds.find((s) => s.soundId === 'unused-chime');
            expect(deleted.deletedAt).not.toBeNull();
            expect(deleted.isActive).toBe(false);
        });
    });

    // ─── 3. Event-to-Sound Mapping Tests ───────────────────────────────────────
    describe('Event-to-Sound Mappings', () => {
        beforeEach(() => {
            mockSounds.push({
                _id: 'sound_default',
                soundId: 'default-bell',
                name: 'Default Bell',
                fileUrl: 'https://cdn.worksphere.com/default-bell.mp3',
                storageKey: 'default_key',
                mimeType: 'audio/mp3',
                fileSize: 1024,
                isActive: true,
                isDefault: true,
                deletedAt: null,
            });
            mockSounds.push({
                _id: 'sound_task',
                soundId: 'task-alert',
                name: 'Task Alert',
                fileUrl: 'https://cdn.worksphere.com/task-alert.mp3',
                storageKey: 'task_key',
                mimeType: 'audio/mp3',
                fileSize: 1024,
                isActive: true,
                isDefault: false,
                deletedAt: null,
            });
        });

        it('should retrieve all notification event mappings grouped with metadata', async () => {
            const res = await request(app)
                .get('/api/superadmin/notification-sounds/mappings')
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.some((m: any) => m.notificationType === 'TASK_CREATED')).toBe(true);
            expect(res.body.data.some((m: any) => m.notificationType === 'MEETING_REQUESTED')).toBe(true);
        });

        it('should update mapping for TASK_ASSIGNED to task-alert sound', async () => {
            const res = await request(app)
                .put('/api/superadmin/notification-sounds/mappings/TASK_ASSIGNED')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    soundId: 'task-alert',
                    isEnabled: true,
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.soundId).toBe('task-alert');
            expect(res.body.data.sound.name).toBe('Task Alert');
        });

        it('should allow disabling sound for a specific notification type', async () => {
            const res = await request(app)
                .put('/api/superadmin/notification-sounds/mappings/ATTENDANCE_REMINDER')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    soundId: null,
                    isEnabled: false,
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.isEnabled).toBe(false);

            // Audit log check
            expect(mockAuditLogs.some((l) => l.action === 'NOTIFICATION_SOUND_DISABLED')).toBe(true);
        });

        it('should reject mapping with invalid/unknown notification type', async () => {
            const res = await request(app)
                .put('/api/superadmin/notification-sounds/mappings/UNKNOWN_FAKE_EVENT')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    soundId: 'task-alert',
                    isEnabled: true,
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Invalid or unregistered notification type');
        });

        it('should reject mapping to a non-existent soundId', async () => {
            const res = await request(app)
                .put('/api/superadmin/notification-sounds/mappings/TASK_CREATED')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    soundId: 'non-existent-sound-id',
                    isEnabled: true,
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('does not exist');
        });
    });

    // ─── 4. Sound Resolution & Cache Tests ─────────────────────────────────────
    describe('Backend Sound Resolution & Caching', () => {
        beforeEach(() => {
            mockSounds.push({
                _id: 'sound_default',
                soundId: 'default-bell',
                name: 'Default Bell',
                fileUrl: 'https://cdn.worksphere.com/default-bell.mp3',
                isActive: true,
                isDefault: true,
                deletedAt: null,
            });
            mockSounds.push({
                _id: 'sound_meeting',
                soundId: 'meeting-bell',
                name: 'Meeting Bell',
                fileUrl: 'https://cdn.worksphere.com/meeting-bell.mp3',
                isActive: true,
                isDefault: false,
                deletedAt: null,
            });
            mockMappings.push({
                _id: 'map_1',
                notificationType: 'MEETING_REQUESTED',
                soundId: 'meeting-bell',
                isEnabled: true,
            });
            mockMappings.push({
                _id: 'map_2',
                notificationType: 'STICKY_NOTE_REMINDER',
                soundId: null,
                isEnabled: false,
            });
        });

        it('should resolve mapped sound for MEETING_REQUESTED', async () => {
            const resolved = await NotificationSoundService.resolveNotificationSound('MEETING_REQUESTED');
            expect(resolved.enabled).toBe(true);
            expect(resolved.soundId).toBe('meeting-bell');
            expect(resolved.url).toBe('https://cdn.worksphere.com/meeting-bell.mp3');
        });

        it('should fallback to default sound for unmapped event (e.g. TASK_COMPLETED)', async () => {
            const resolved = await NotificationSoundService.resolveNotificationSound('TASK_COMPLETED');
            expect(resolved.enabled).toBe(true);
            expect(resolved.soundId).toBe('default-bell');
            expect(resolved.url).toBe('https://cdn.worksphere.com/default-bell.mp3');
        });

        it('should return enabled: false when mapping has isEnabled: false', async () => {
            const resolved = await NotificationSoundService.resolveNotificationSound('STICKY_NOTE_REMINDER');
            expect(resolved.enabled).toBe(false);
        });

        it('should invalidate cache when mapping is updated and return new sound immediately', async () => {
            // First call warms cache
            const initial = await NotificationSoundService.resolveNotificationSound('TASK_ASSIGNED');
            expect(initial.soundId).toBe('default-bell');

            // Super Admin assigns meeting-bell to TASK_ASSIGNED
            await NotificationSoundService.updateMapping('TASK_ASSIGNED', {
                soundId: 'meeting-bell',
                isEnabled: true,
            });

            // Second resolution should immediately pick up meeting-bell without restart
            const updated = await NotificationSoundService.resolveNotificationSound('TASK_ASSIGNED');
            expect(updated.soundId).toBe('meeting-bell');
        });
    });

    // ─── 5. Test Sound Preview Endpoint ────────────────────────────────────────
    describe('Test Sound Preview API', () => {
        it('should return preview metadata for a valid sound', async () => {
            mockSounds.push({
                _id: 'sound_test',
                soundId: 'chime',
                name: 'Chime',
                fileUrl: 'https://cdn.worksphere.com/chime.mp3',
                durationMs: 800,
                isActive: true,
                deletedAt: null,
            });

            const res = await request(app)
                .post('/api/superadmin/notification-sounds/test')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ soundId: 'chime' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.soundId).toBe('chime');
            expect(res.body.data.url).toBe('https://cdn.worksphere.com/chime.mp3');
        });

        it('should return 404 for invalid test soundId', async () => {
            const res = await request(app)
                .post('/api/superadmin/notification-sounds/test')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ soundId: 'non-existent' });

            expect(res.status).toBe(404);
        });
    });

    // ─── 6. Fault Tolerance Tests ──────────────────────────────────────────────
    describe('Sound Resolution Fault Tolerance', () => {
        it('should return enabled: false gracefully if database error occurs', async () => {
            const spy = vi
                .spyOn(NotificationSoundService as any, 'getOrBuildCache')
                .mockRejectedValueOnce(new Error('DB connection drop'));

            const result = await NotificationSoundService.resolveNotificationSound('TASK_CREATED');
            expect(result).toEqual({ enabled: false });
            spy.mockRestore();
        });
    });
});
