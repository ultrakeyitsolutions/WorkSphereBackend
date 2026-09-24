import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { StickyNoteColor, StickyNotePriority, StickyNoteStatus } from '../src/modules/sticky-notes/sticky-note.constants';
import { StickyNoteReminderService } from '../src/modules/sticky-notes/sticky-note-reminder.service';

// ─── Test User and Entity IDs ──────────────────────────────────────────────────
const USER_A_ID = '64d0a1b2c3d4e5f6a7b8c9d1';
const USER_B_ID = '64d0a1b2c3d4e5f6a7b8c9d2';
const COMPANY_ID = '64e0a1b2c3d4e5f6a7b8c9d0';
const PROJECT_ID = '64d0a1b2c3d4e5f6a7b8c9aa';
const TASK_ID = '64d0a1b2c3d4e5f6a7b8c9bb';

// ─── In-Memory Mock Store ──────────────────────────────────────────────────────
interface MockNote {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    title: string;
    content: string;
    color: StickyNoteColor;
    priority: StickyNotePriority;
    tags: string[];
    isPinned: boolean;
    status: StickyNoteStatus;
    checklist: any[];
    projectId: Types.ObjectId | null;
    taskId: Types.ObjectId | null;
    convertedTaskId: Types.ObjectId | null;
    reminderAt: Date | null;
    reminderSentAt: Date | null;
    archivedAt: Date | null;
    completedAt: Date | null;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    save?: any;
}

let mockNotesStore: MockNote[] = [];
let currentAuthUserId = USER_A_ID;

// ─── Hoisted Mocks ────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
    auditLog: vi.fn().mockResolvedValue(true),
    notificationPublish: vi.fn().mockResolvedValue([]),
    taskServiceCreateTask: vi.fn().mockResolvedValue({
        id: '64d0a1b2c3d4e5f6a7b8c9cc',
        title: 'Task from Note',
        projectId: '64d0a1b2c3d4e5f6a7b8c9aa',
    }),
    userFindById: vi.fn(),
    projectFindOne: vi.fn(),
    taskFindOne: vi.fn(),
    canAccessProject: vi.fn().mockResolvedValue(true),
}));

// Mock Auth Middleware
vi.mock('../src/middleware/auth.middleware', () => ({
    authenticate: (req: any, _res: any, next: any) => {
        req.user = {
            userId: currentAuthUserId,
            email: currentAuthUserId === USER_A_ID ? 'usera@worksphere.com' : 'userb@worksphere.com',
            companyId: COMPANY_ID,
            role: 'MEMBER',
        };
        req.currentUser = {
            userId: currentAuthUserId,
            email: currentAuthUserId === USER_A_ID ? 'usera@worksphere.com' : 'userb@worksphere.com',
            companyId: COMPANY_ID,
            role: 'MEMBER',
        };
        next();
    },
}));

// Mock AuditLogService
vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: mocks.auditLog,
    },
}));

// Mock NotificationService
vi.mock('../src/modules/notifications/notification.service', () => ({
    NotificationService: class {
        publish = mocks.notificationPublish;
    },
}));

// Mock TaskService
vi.mock('../src/modules/tasks/task.service', () => ({
    TaskService: {
        createTask: mocks.taskServiceCreateTask,
    },
}));

// Mock ProjectService
vi.mock('../src/modules/companyadmin/projects/project.service', () => ({
    ProjectService: {
        canAccessProject: mocks.canAccessProject,
    },
}));

// Mock Project Model
vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: {
        findOne: vi.fn().mockImplementation(() => ({
            lean: vi.fn().mockResolvedValue({
                _id: new Types.ObjectId(PROJECT_ID),
                name: 'Test Project',
                companyId: new Types.ObjectId(COMPANY_ID),
                isArchived: false,
                deletedAt: null,
            }),
        })),
    },
}));

// Mock Task Model
vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        findOne: vi.fn().mockImplementation(() => ({
            lean: vi.fn().mockResolvedValue({
                _id: new Types.ObjectId(TASK_ID),
                title: 'Existing Task',
                taskNumber: '001',
                projectId: new Types.ObjectId(PROJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                isArchived: false,
                deletedAt: null,
            }),
        })),
    },
}));

// Mock User Model
vi.mock('../src/modules/users/user.model', () => ({
    User: {
        findById: vi.fn().mockImplementation((id: any) => ({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(id),
                    companyId: new Types.ObjectId(COMPANY_ID),
                    name: 'Test User',
                    email: 'test@worksphere.com',
                }),
            }),
        })),
    },
}));

// Mock StickyNote Mongoose Model
vi.mock('../src/modules/sticky-notes/sticky-note.model', () => {
    class MockStickyNoteDoc {
        _id: Types.ObjectId;
        userId: Types.ObjectId;
        title: string;
        content: string;
        color: StickyNoteColor;
        priority: StickyNotePriority;
        tags: string[];
        isPinned: boolean;
        status: StickyNoteStatus;
        checklist: any[];
        projectId: Types.ObjectId | null;
        taskId: Types.ObjectId | null;
        convertedTaskId: Types.ObjectId | null;
        reminderAt: Date | null;
        reminderSentAt: Date | null;
        archivedAt: Date | null;
        completedAt: Date | null;
        deletedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;

        constructor(data: any) {
            this._id = data._id || new Types.ObjectId();
            this.userId = data.userId ? new Types.ObjectId(data.userId) : new Types.ObjectId();
            this.title = data.title || '';
            this.content = data.content;
            this.color = data.color || StickyNoteColor.YELLOW;
            this.priority = data.priority || StickyNotePriority.MEDIUM;
            this.tags = data.tags || [];
            this.isPinned = Boolean(data.isPinned);
            this.status = data.status || StickyNoteStatus.ACTIVE;
            this.checklist = data.checklist || [];
            this.projectId = data.projectId ? new Types.ObjectId(data.projectId) : null;
            this.taskId = data.taskId ? new Types.ObjectId(data.taskId) : null;
            this.convertedTaskId = data.convertedTaskId ? new Types.ObjectId(data.convertedTaskId) : null;
            this.reminderAt = data.reminderAt ? new Date(data.reminderAt) : null;
            this.reminderSentAt = data.reminderSentAt ? new Date(data.reminderSentAt) : null;
            this.archivedAt = data.archivedAt ? new Date(data.archivedAt) : null;
            this.completedAt = data.completedAt ? new Date(data.completedAt) : null;
            this.deletedAt = data.deletedAt ? new Date(data.deletedAt) : null;
            this.createdAt = new Date();
            this.updatedAt = new Date();
        }

        async save() {
            const index = mockNotesStore.findIndex((n) => n._id.toString() === this._id.toString());
            const plain = {
                _id: this._id,
                userId: this.userId,
                title: this.title,
                content: this.content,
                color: this.color,
                priority: this.priority,
                tags: this.tags,
                isPinned: this.isPinned,
                status: this.status,
                checklist: this.checklist,
                projectId: this.projectId,
                taskId: this.taskId,
                convertedTaskId: this.convertedTaskId,
                reminderAt: this.reminderAt,
                reminderSentAt: this.reminderSentAt,
                archivedAt: this.archivedAt,
                completedAt: this.completedAt,
                deletedAt: this.deletedAt,
                createdAt: this.createdAt,
                updatedAt: new Date(),
                save: async () => this.save(),
            };
            if (index >= 0) {
                mockNotesStore[index] = plain;
            } else {
                mockNotesStore.push(plain);
            }
            return this;
        }
    }

    const StickyNoteMock: any = MockStickyNoteDoc;

    function matchQuery(note: MockNote, query: any): boolean {
        for (const key of Object.keys(query)) {
            if (key === '$or') {
                const subConditions = query.$or;
                const matchesAny = subConditions.some((cond: any) => {
                    return Object.keys(cond).some((k) => {
                        const regex = cond[k];
                        if (k === 'title') return regex.test(note.title);
                        if (k === 'content') return regex.test(note.content);
                        if (k === 'tags') return note.tags.some((t) => regex.test(t));
                        return false;
                    });
                });
                if (!matchesAny) return false;
                continue;
            }

            const val = query[key];
            if (key === 'userId') {
                if (note.userId.toString() !== val.toString()) return false;
            } else if (key === 'deletedAt') {
                if (val === null && note.deletedAt !== null) return false;
                if (val && typeof val === 'object' && '$ne' in val) {
                    if (val.$ne === null && note.deletedAt === null) return false;
                }
            } else if (key === 'status') {
                if (note.status !== val) return false;
            } else if (key === 'priority') {
                if (note.priority !== val) return false;
            } else if (key === 'color') {
                if (note.color !== val) return false;
            } else if (key === 'isPinned') {
                if (note.isPinned !== val) return false;
            } else if (key === 'tags') {
                if (!note.tags.includes(val)) return false;
            } else if (key === 'projectId') {
                if (!note.projectId || note.projectId.toString() !== val.toString()) return false;
            } else if (key === 'taskId') {
                if (!note.taskId || note.taskId.toString() !== val.toString()) return false;
            } else if (key === 'reminderAt') {
                if (typeof val === 'object') {
                    if (val.$gte && (!note.reminderAt || note.reminderAt < val.$gte)) return false;
                    if (val.$lte && (!note.reminderAt || note.reminderAt > val.$lte)) return false;
                    if (val.$ne === null && !note.reminderAt) return false;
                }
            } else if (key === 'reminderSentAt') {
                if (val === null && note.reminderSentAt !== null) return false;
            }
        }
        return true;
    }

    StickyNoteMock.find = vi.fn().mockImplementation((query: any) => {
        let results = mockNotesStore.filter((n) => matchQuery(n, query));
        return {
            sort: vi.fn().mockImplementation((sortObj: any) => {
                results = [...results].sort((a, b) => {
                    if (sortObj.isPinned) {
                        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                    }
                    if (sortObj.reminderAt) {
                        const aTime = a.reminderAt ? a.reminderAt.getTime() : 0;
                        const bTime = b.reminderAt ? b.reminderAt.getTime() : 0;
                        return sortObj.reminderAt === 1 ? aTime - bTime : bTime - aTime;
                    }
                    if (sortObj.updatedAt) {
                        const aTime = a.updatedAt.getTime();
                        const bTime = b.updatedAt.getTime();
                        return sortObj.updatedAt === 1 ? aTime - bTime : bTime - aTime;
                    }
                    return 0;
                });
                return {
                    skip: vi.fn().mockImplementation((skipNum: number) => ({
                        limit: vi.fn().mockImplementation((limitNum: number) => ({
                            populate: vi.fn().mockReturnThis(),
                            lean: vi.fn().mockResolvedValue(results.slice(skipNum, skipNum + limitNum)),
                        })),
                    })),
                    limit: vi.fn().mockImplementation((limitNum: number) => ({
                        populate: vi.fn().mockReturnThis(),
                        lean: vi.fn().mockResolvedValue(results.slice(0, limitNum)),
                    })),
                };
            }),
            limit: vi.fn().mockImplementation((limitNum: number) => ({
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue(results.slice(0, limitNum)),
            })),
            skip: vi.fn().mockImplementation((skipNum: number) => ({
                limit: vi.fn().mockImplementation((limitNum: number) => ({
                    populate: vi.fn().mockReturnThis(),
                    lean: vi.fn().mockResolvedValue(results.slice(skipNum, skipNum + limitNum)),
                })),
            })),
            populate: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue(results),
        };
    });

    StickyNoteMock.countDocuments = vi.fn().mockImplementation((query: any) => {
        const results = mockNotesStore.filter((n) => matchQuery(n, query));
        return Promise.resolve(results.length);
    });

    StickyNoteMock.findById = vi.fn().mockImplementation((id: any) => {
        const note = mockNotesStore.find((n) => n._id.toString() === id.toString());
        return {
            populate: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue(note || null),
        };
    });

    StickyNoteMock.findOne = vi.fn().mockImplementation((query: any) => {
        const note = mockNotesStore.find((n) => {
            if (query._id && n._id.toString() !== query._id.toString()) return false;
            return matchQuery(n, query);
        });

        return {
            populate: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue(note || null),
            then: (resolve: any) => {
                if (!note) return resolve(null);
                // Return an object that has save()
                const doc = {
                    ...note,
                    save: async function () {
                        const idx = mockNotesStore.findIndex((x) => x._id.toString() === note._id.toString());
                        if (idx >= 0) {
                            mockNotesStore[idx] = { ...mockNotesStore[idx], ...this, updatedAt: new Date() };
                        }
                        return this;
                    },
                };
                return resolve(doc);
            },
        };
    });

    StickyNoteMock.findOneAndUpdate = vi.fn().mockImplementation((query: any, update: any) => {
        const note = mockNotesStore.find((n) => {
            if (query._id && n._id.toString() !== query._id.toString()) return false;
            return matchQuery(n, query);
        });

        if (note && update.$set) {
            Object.assign(note, update.$set);
            note.updatedAt = new Date();
        }

        return {
            populate: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue(note || null),
            then: (resolve: any) => resolve(note || null),
        };
    });

    StickyNoteMock.findOneAndDelete = vi.fn().mockImplementation((query: any) => {
        const index = mockNotesStore.findIndex((n) => {
            if (query._id && n._id.toString() !== query._id.toString()) return false;
            return matchQuery(n, query);
        });

        if (index >= 0) {
            const [deleted] = mockNotesStore.splice(index, 1);
            return Promise.resolve(deleted);
        }
        return Promise.resolve(null);
    });

    return { StickyNote: StickyNoteMock };
});

// ─── Tests Suite ──────────────────────────────────────────────────────────────

describe('Personal Sticky Notes Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNotesStore = [];
        currentAuthUserId = USER_A_ID;
    });

    // ── 1. Ownership & Privacy ────────────────────────────────────────────────
    describe('1. Ownership & Privacy Enforcements', () => {
        it('User A creates note; userId is automatically derived from token and ignores client payload', async () => {
            const res = await request(app)
                .post('/api/sticky-notes')
                .send({
                    userId: USER_B_ID, // Attempt to forge owner
                    title: 'Private Idea',
                    content: 'This is my personal note content.',
                    color: StickyNoteColor.BLUE,
                    priority: StickyNotePriority.HIGH,
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.title).toBe('Private Idea');
            // Owner is strictly USER_A_ID
            expect(res.body.data.userId).toBe(USER_A_ID);
        });

        it('User A can access their own note by ID', async () => {
            const createRes = await request(app)
                .post('/api/sticky-notes')
                .send({
                    title: 'User A Secret',
                    content: 'Secret content',
                });

            const noteId = createRes.body.data.id;

            const getRes = await request(app).get(`/api/sticky-notes/${noteId}`);
            expect(getRes.status).toBe(200);
            expect(getRes.body.success).toBe(true);
            expect(getRes.body.data.id).toBe(noteId);
            expect(getRes.body.data.title).toBe('User A Secret');
        });

        it('User B cannot access User A note and receives 404 NOT_FOUND', async () => {
            // User A creates note
            currentAuthUserId = USER_A_ID;
            const createRes = await request(app)
                .post('/api/sticky-notes')
                .send({
                    title: 'User A Confidential Note',
                    content: 'Confidential text',
                });
            const noteId = createRes.body.data.id;

            // Switch to User B
            currentAuthUserId = USER_B_ID;
            const getRes = await request(app).get(`/api/sticky-notes/${noteId}`);
            expect(getRes.status).toBe(404);
            expect(getRes.body.success).toBe(false);
            expect(getRes.body.message).toContain('Sticky note not found');
        });

        it('User B cannot update, pin, complete, archive, or delete User A note (all return 404)', async () => {
            currentAuthUserId = USER_A_ID;
            const createRes = await request(app)
                .post('/api/sticky-notes')
                .send({
                    title: 'Target Note',
                    content: 'Original content',
                });
            const noteId = createRes.body.data.id;

            // Switch to User B
            currentAuthUserId = USER_B_ID;

            const patchRes = await request(app).patch(`/api/sticky-notes/${noteId}`).send({ title: 'Hacked' });
            expect(patchRes.status).toBe(404);

            const pinRes = await request(app).patch(`/api/sticky-notes/${noteId}/pin`).send({ isPinned: true });
            expect(pinRes.status).toBe(404);

            const completeRes = await request(app).patch(`/api/sticky-notes/${noteId}/complete`).send({ completed: true });
            expect(completeRes.status).toBe(404);

            const archiveRes = await request(app).patch(`/api/sticky-notes/${noteId}/archive`);
            expect(archiveRes.status).toBe(404);

            const deleteRes = await request(app).delete(`/api/sticky-notes/${noteId}`);
            expect(deleteRes.status).toBe(404);

            const permDeleteRes = await request(app).delete(`/api/sticky-notes/${noteId}/permanent`);
            expect(permDeleteRes.status).toBe(404);
        });

        it('User B note list does not reveal User A notes', async () => {
            currentAuthUserId = USER_A_ID;
            await request(app).post('/api/sticky-notes').send({ content: 'Note of User A' });

            currentAuthUserId = USER_B_ID;
            await request(app).post('/api/sticky-notes').send({ content: 'Note of User B' });

            const listRes = await request(app).get('/api/sticky-notes');
            expect(listRes.status).toBe(200);
            expect(listRes.body.data.data.length).toBe(1);
            expect(listRes.body.data.data[0].content).toBe('Note of User B');
        });
    });

    // ── 2. Full CRUD Operations & Status Transitions ──────────────────────────
    describe('2. Full CRUD & Status Lifecycle', () => {
        it('Create note with checklist, tags, priority, color, reminderAt', async () => {
            const reminderDate = new Date(Date.now() + 86400000).toISOString();
            const res = await request(app)
                .post('/api/sticky-notes')
                .send({
                    title: 'Deployment Checklist',
                    content: 'Verify services before launch',
                    color: StickyNoteColor.PURPLE,
                    priority: StickyNotePriority.URGENT,
                    tags: ['release', 'backend'],
                    isPinned: true,
                    checklist: [
                        { text: 'Run unit tests', completed: true },
                        { text: 'Check migrations', completed: false },
                    ],
                    reminderAt: reminderDate,
                });

            expect(res.status).toBe(201);
            expect(res.body.data.title).toBe('Deployment Checklist');
            expect(res.body.data.color).toBe('PURPLE');
            expect(res.body.data.priority).toBe('URGENT');
            expect(res.body.data.isPinned).toBe(true);
            expect(res.body.data.tags).toEqual(['release', 'backend']);
            expect(res.body.data.checklist.length).toBe(2);
            expect(res.body.data.checklist[0].completed).toBe(true);
            expect(res.body.data.checklist[1].completed).toBe(false);
        });

        it('Update note content and checklist', async () => {
            const createRes = await request(app).post('/api/sticky-notes').send({
                title: 'Draft',
                content: 'Initial text',
            });
            const noteId = createRes.body.data.id;

            const updateRes = await request(app)
                .patch(`/api/sticky-notes/${noteId}`)
                .send({
                    title: 'Updated Title',
                    content: 'Updated content text',
                    color: StickyNoteColor.GREEN,
                    checklist: [{ text: 'New item', completed: true }],
                });

            expect(updateRes.status).toBe(200);
            expect(updateRes.body.data.title).toBe('Updated Title');
            expect(updateRes.body.data.content).toBe('Updated content text');
            expect(updateRes.body.data.color).toBe('GREEN');
            expect(updateRes.body.data.checklist.length).toBe(1);
            expect(updateRes.body.data.checklist[0].text).toBe('New item');
        });

        it('Pin and unpin note via dedicated endpoint', async () => {
            const createRes = await request(app).post('/api/sticky-notes').send({ content: 'Pin test' });
            const noteId = createRes.body.data.id;

            const pinRes = await request(app).patch(`/api/sticky-notes/${noteId}/pin`).send({ isPinned: true });
            expect(pinRes.status).toBe(200);
            expect(pinRes.body.data.isPinned).toBe(true);

            const unpinRes = await request(app).patch(`/api/sticky-notes/${noteId}/pin`).send({ isPinned: false });
            expect(unpinRes.status).toBe(200);
            expect(unpinRes.body.data.isPinned).toBe(false);
        });

        it('Complete and reopen note', async () => {
            const createRes = await request(app).post('/api/sticky-notes').send({ content: 'Complete test' });
            const noteId = createRes.body.data.id;

            const compRes = await request(app).patch(`/api/sticky-notes/${noteId}/complete`).send({ completed: true });
            expect(compRes.status).toBe(200);
            expect(compRes.body.data.status).toBe('COMPLETED');
            expect(compRes.body.data.completedAt).not.toBeNull();

            const reopenRes = await request(app).patch(`/api/sticky-notes/${noteId}/complete`).send({ completed: false });
            expect(reopenRes.status).toBe(200);
            expect(reopenRes.body.data.status).toBe('ACTIVE');
            expect(reopenRes.body.data.completedAt).toBeNull();
        });

        it('Archive and restore note', async () => {
            const createRes = await request(app).post('/api/sticky-notes').send({ content: 'Archive test' });
            const noteId = createRes.body.data.id;

            const arcRes = await request(app).patch(`/api/sticky-notes/${noteId}/archive`);
            expect(arcRes.status).toBe(200);
            expect(arcRes.body.data.status).toBe('ARCHIVED');
            expect(arcRes.body.data.archivedAt).not.toBeNull();

            const restoreRes = await request(app).patch(`/api/sticky-notes/${noteId}/restore`);
            expect(restoreRes.status).toBe(200);
            expect(restoreRes.body.data.status).toBe('ACTIVE');
            expect(restoreRes.body.data.archivedAt).toBeNull();
        });

        it('Soft delete, view in trash, restore from trash, permanent delete', async () => {
            const createRes = await request(app).post('/api/sticky-notes').send({ content: 'Trash cycle test' });
            const noteId = createRes.body.data.id;

            // 1. Soft delete
            const delRes = await request(app).delete(`/api/sticky-notes/${noteId}`);
            expect(delRes.status).toBe(200);
            expect(delRes.body.success).toBe(true);

            // 2. Normal listing should not include it
            const listRes = await request(app).get('/api/sticky-notes');
            expect(listRes.body.data.data.length).toBe(0);

            // 3. Trash listing should include it
            const trashRes = await request(app).get('/api/sticky-notes/trash');
            expect(trashRes.status).toBe(200);
            expect(trashRes.body.data.data.length).toBe(1);
            expect(trashRes.body.data.data[0].id).toBe(noteId);

            // 4. Restore from trash
            const restoreRes = await request(app).patch(`/api/sticky-notes/${noteId}/restore-from-trash`);
            expect(restoreRes.status).toBe(200);
            expect(restoreRes.body.data.deletedAt).toBeNull();

            // 5. Permanent delete
            const permRes = await request(app).delete(`/api/sticky-notes/${noteId}/permanent`);
            expect(permRes.status).toBe(200);

            // 6. Check totally gone
            const checkRes = await request(app).get(`/api/sticky-notes/${noteId}`);
            expect(checkRes.status).toBe(404);
        });
    });

    // ── 3. Search, Filter, Sort & Statistics ──────────────────────────────────
    describe('3. Search, Filtering, Sorting & Statistics', () => {
        beforeEach(async () => {
            await request(app).post('/api/sticky-notes').send({
                title: 'Alpha API Task',
                content: 'Need to review GraphQL query',
                tags: ['backend', 'graphql'],
                priority: StickyNotePriority.HIGH,
                color: StickyNoteColor.BLUE,
                isPinned: true,
            });

            await request(app).post('/api/sticky-notes').send({
                title: 'Beta UI Fix',
                content: 'Fix modal alignment bug',
                tags: ['frontend', 'css'],
                priority: StickyNotePriority.LOW,
                color: StickyNoteColor.YELLOW,
                isPinned: false,
            });
        });

        it('Search matches title, content, or tags', async () => {
            const searchRes = await request(app).get('/api/sticky-notes?search=GraphQL');
            expect(searchRes.status).toBe(200);
            expect(searchRes.body.data.data.length).toBe(1);
            expect(searchRes.body.data.data[0].title).toBe('Alpha API Task');

            const tagSearchRes = await request(app).get('/api/sticky-notes?search=frontend');
            expect(tagSearchRes.status).toBe(200);
            expect(tagSearchRes.body.data.data.length).toBe(1);
            expect(tagSearchRes.body.data.data[0].title).toBe('Beta UI Fix');
        });

        it('Filter by priority, color, isPinned, tag', async () => {
            const priorityRes = await request(app).get('/api/sticky-notes?priority=HIGH');
            expect(priorityRes.body.data.data.length).toBe(1);
            expect(priorityRes.body.data.data[0].title).toBe('Alpha API Task');

            const colorRes = await request(app).get('/api/sticky-notes?color=YELLOW');
            expect(colorRes.body.data.data.length).toBe(1);
            expect(colorRes.body.data.data[0].title).toBe('Beta UI Fix');

            const pinnedRes = await request(app).get('/api/sticky-notes?isPinned=true');
            expect(pinnedRes.body.data.data.length).toBe(1);
            expect(pinnedRes.body.data.data[0].isPinned).toBe(true);

            const tagRes = await request(app).get('/api/sticky-notes?tag=backend');
            expect(tagRes.body.data.data.length).toBe(1);
            expect(tagRes.body.data.data[0].title).toBe('Alpha API Task');
        });

        it('Get user statistics', async () => {
            const statsRes = await request(app).get('/api/sticky-notes/statistics');
            expect(statsRes.status).toBe(200);
            expect(statsRes.body.data.total).toBe(2);
            expect(statsRes.body.data.active).toBe(2);
            expect(statsRes.body.data.pinned).toBe(1);
        });
    });

    // ── 4. Convert Note to Task Integration ───────────────────────────────────
    describe('4. Convert Note to Task', () => {
        it('Converts sticky note to task using TaskService and sets convertedTaskId', async () => {
            const createRes = await request(app).post('/api/sticky-notes').send({
                title: 'Convertible Note',
                content: 'Task instructions text',
                projectId: PROJECT_ID,
                priority: StickyNotePriority.HIGH,
                checklist: [{ text: 'Sub-item 1', completed: false }],
            });
            const noteId = createRes.body.data.id;

            const convertRes = await request(app)
                .post(`/api/sticky-notes/${noteId}/convert-to-task`)
                .send({
                    title: 'New Official Task',
                });

            expect(convertRes.status).toBe(201);
            expect(convertRes.body.success).toBe(true);
            expect(convertRes.body.data.note.convertedTaskId).toBe('64d0a1b2c3d4e5f6a7b8c9cc');
            expect(mocks.taskServiceCreateTask).toHaveBeenCalledTimes(1);
        });

        it('Prevents duplicate conversion of an already converted note', async () => {
            const createRes = await request(app).post('/api/sticky-notes').send({
                title: 'Convertible Note',
                content: 'Task instructions',
                projectId: PROJECT_ID,
            });
            const noteId = createRes.body.data.id;

            // First conversion succeeds
            await request(app).post(`/api/sticky-notes/${noteId}/convert-to-task`).send({});

            // Second conversion fails with 409 Conflict
            const secondRes = await request(app).post(`/api/sticky-notes/${noteId}/convert-to-task`).send({});
            expect(secondRes.status).toBe(409);
            expect(secondRes.body.message).toContain('already been converted');
        });
    });

    // ── 5. Reminders & Background Processor ───────────────────────────────────
    describe('5. Reminders & Background Job Processing', () => {
        it('Retrieves upcoming reminders via /reminders/upcoming', async () => {
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            await request(app).post('/api/sticky-notes').send({
                title: 'Upcoming Reminder Note',
                content: 'Remember to call client',
                reminderAt: futureDate,
            });

            const remindersRes = await request(app).get('/api/sticky-notes/reminders/upcoming?timeframe=today');
            expect(remindersRes.status).toBe(200);
            expect(remindersRes.body.data.data.length).toBe(1);
            expect(remindersRes.body.data.data[0].title).toBe('Upcoming Reminder Note');
        });

        it('Background processor delivers due reminders and prevents duplicates (idempotency)', async () => {
            const pastDate = new Date(Date.now() - 60000).toISOString();
            const createRes = await request(app).post('/api/sticky-notes').send({
                title: 'Due Reminder Note',
                content: 'Urgent reminder',
                reminderAt: pastDate,
            });
            const noteId = createRes.body.data.id;

            // First tick: should process 1 reminder
            const processedCount = await StickyNoteReminderService.processDueReminders();
            expect(processedCount).toBe(1);
            expect(mocks.notificationPublish).toHaveBeenCalledTimes(1);

            // Check that note now has reminderSentAt set
            const noteDoc = mockNotesStore.find((n) => n._id.toString() === noteId);
            expect(noteDoc?.reminderSentAt).not.toBeNull();

            // Second tick: should process 0 reminders (already sent)
            const secondTickCount = await StickyNoteReminderService.processDueReminders();
            expect(secondTickCount).toBe(0);
            expect(mocks.notificationPublish).toHaveBeenCalledTimes(1); // No new publish
        });

        it('Updating reminderAt resets reminderSentAt to allow re-triggering', async () => {
            const pastDate = new Date(Date.now() - 60000).toISOString();
            const createRes = await request(app).post('/api/sticky-notes').send({
                title: 'Rescheduled Note',
                content: 'Text',
                reminderAt: pastDate,
            });
            const noteId = createRes.body.data.id;

            // Process first reminder
            await StickyNoteReminderService.processDueReminders();
            let noteDoc = mockNotesStore.find((n) => n._id.toString() === noteId);
            expect(noteDoc?.reminderSentAt).not.toBeNull();

            // User reschedules reminder to new past date
            const newPastDate = new Date(Date.now() - 30000).toISOString();
            await request(app).patch(`/api/sticky-notes/${noteId}`).send({ reminderAt: newPastDate });

            noteDoc = mockNotesStore.find((n) => n._id.toString() === noteId);
            expect(noteDoc?.reminderSentAt).toBeNull();

            // Process again -> should deliver new reminder
            const countAfterReschedule = await StickyNoteReminderService.processDueReminders();
            expect(countAfterReschedule).toBe(1);
        });
    });
});
