import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

const mocks = vi.hoisted(() => ({
    taskFindOne: vi.fn(),
    taskUpdateOne: vi.fn(),
    attachmentFindOne: vi.fn(),
    attachmentFind: vi.fn(),
    attachmentCreate: vi.fn(),
    attachmentFindById: vi.fn(),
    attachmentDeleteOne: vi.fn(),
    userFindById: vi.fn(),
    companyFindById: vi.fn(),
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        findOne: mocks.taskFindOne,
        updateOne: mocks.taskUpdateOne
    }
}));

vi.mock('../src/modules/task-attachments/task-attachment.model', () => {
    const TaskAttachmentMock: any = function (data: any) {
        Object.assign(this, data);
        this._id = '65f000000000000000000485';
        this.save = vi.fn().mockResolvedValue(this);
    };
    TaskAttachmentMock.find = mocks.attachmentFind;
    TaskAttachmentMock.findOne = mocks.attachmentFindOne;
    TaskAttachmentMock.findById = mocks.attachmentFindById;
    TaskAttachmentMock.deleteOne = mocks.attachmentDeleteOne;
    return {
        TaskAttachment: TaskAttachmentMock,
        AttachmentType: {
            IMAGE: 'IMAGE',
            DOCUMENT: 'DOCUMENT',
            VIDEO: 'VIDEO',
            AUDIO: 'AUDIO',
            VOICE_NOTE: 'VOICE_NOTE',
            OTHER: 'OTHER'
        }
    };
});

vi.mock('../src/modules/users/user.model', () => ({
    User: {
        findById: mocks.userFindById
    }
}));

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: mocks.companyFindById
    }
}));

vi.mock('../src/utils/tokens', () => ({
    verifyAccessToken: vi.fn().mockImplementation((token: string) => {
        if (token === 'admin-token') {
            return {
                userId: '65f000000000000000000001',
                email: 'admin@company.com',
                role: 'COMPANY_ADMIN',
                companyId: '65f000000000000000000028'
            };
        }
        return {
            userId: '65f000000000000000000210',
            email: 'member@company.com',
            role: 'EMPLOYEE',
            companyId: '65f000000000000000000028'
        };
    })
}));

describe('Task Attachments & Voice Notes API', () => {
    const TASK_ID = '65f000000000000000001411';
    const ATTACHMENT_ID = '65f000000000000000000485';

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.companyFindById.mockResolvedValue({
            _id: '65f000000000000000000028',
            isActive: true,
            status: 'ACTIVE'
        });

        mocks.userFindById.mockReturnValue({
            populate: vi.fn().mockResolvedValue({
                _id: '65f000000000000000000210',
                name: 'P Kanka Raju',
                email: 'kanakaraju.pilli@ultrakeyit.com',
                isActive: true,
                companyId: '65f000000000000000000028'
            })
        });

        mocks.taskFindOne.mockResolvedValue({
            _id: TASK_ID,
            projectId: '65f000000000000000000099',
            companyId: '65f000000000000000000028',
            itemNumber: 14116,
            taskNumber: '14116'
        });

        mocks.taskUpdateOne.mockResolvedValue({ acknowledged: true });
        mocks.attachmentDeleteOne.mockResolvedValue({ acknowledged: true, deletedCount: 1 });
    });

    it('Member can add a voice note attachment via POST /api/v1/company/tasks/:taskId/attachments', async () => {
        const fakeCreatedAttachment = {
            _id: ATTACHMENT_ID,
            taskId: { _id: TASK_ID, title: 'Test Task' },
            fileName: 'voice-note-2026-09-10T09-20-31-691Z.webm',
            filePath: '/uploads/tasks/14116/voice-note-2026-09-10T09-20-31-691Z.webm',
            fileType: 'voice-note',
            fileSize: 71780,
            contentType: 'audio/webm',
            type: 'VOICE_NOTE',
            uploadedById: '65f000000000000000000210',
            uploadedBy: {
                _id: '65f000000000000000000210',
                name: 'P Kanka Raju',
                email: 'kanakaraju.pilli@ultrakeyit.com',
                avatar: null,
                role: 'EMPLOYEE'
            },
            uploadedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            isInherited: false,
            sourceTaskId: TASK_ID,
            toObject: function () { return this; }
        };

        mocks.attachmentFindById.mockReturnValue({
            populate: vi.fn().mockReturnThis(),
            exec: vi.fn().mockResolvedValue(fakeCreatedAttachment)
        });

        const res = await request(app)
            .post(`/api/v1/company/tasks/${TASK_ID}/attachments`)
            .set('Authorization', 'Bearer member-token')
            .send({
                fileName: 'voice-note-2026-09-10T09-20-31-691Z.webm',
                filePath: '/uploads/tasks/14116/voice-note-2026-09-10T09-20-31-691Z.webm',
                fileType: 'voice-note',
                contentType: 'audio/webm',
                fileSize: 71780
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.fileType).toBe('voice-note');
        expect(res.body.data.fileName).toBe('voice-note-2026-09-10T09-20-31-691Z.webm');
        expect(res.body.data.uploadedBy.fullName).toBe('P Kanka Raju');
    });

    it('Member can add a voice note via /api/v1/member/tasks/:taskId/attachments/voice-note alias', async () => {
        const fakeCreatedAttachment = {
            _id: ATTACHMENT_ID,
            taskId: { _id: TASK_ID },
            fileName: 'voice-note-test.webm',
            filePath: '/uploads/tasks/14116/voice-note-test.webm',
            fileType: 'voice-note',
            fileSize: 50000,
            contentType: 'audio/webm',
            type: 'VOICE_NOTE',
            uploadedById: '65f000000000000000000210',
            uploadedBy: {
                _id: '65f000000000000000000210',
                name: 'P Kanka Raju',
                email: 'kanakaraju.pilli@ultrakeyit.com'
            },
            uploadedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            toObject: function () { return this; }
        };

        mocks.attachmentFindById.mockReturnValue({
            populate: vi.fn().mockReturnThis(),
            exec: vi.fn().mockResolvedValue(fakeCreatedAttachment)
        });

        const res = await request(app)
            .post(`/api/v1/member/tasks/${TASK_ID}/attachments/voice-note`)
            .set('Authorization', 'Bearer member-token')
            .send({
                fileName: 'voice-note-test.webm',
                filePath: '/uploads/tasks/14116/voice-note-test.webm',
                fileType: 'voice-note',
                contentType: 'audio/webm',
                fileSize: 50000
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.fileType).toBe('voice-note');
    });

    it('Member can delete voice note attachment via DELETE /api/v1/company/tasks/:taskId/attachments/:attachmentId', async () => {
        mocks.attachmentFindOne.mockResolvedValue({
            _id: ATTACHMENT_ID,
            taskId: TASK_ID,
            fileName: 'voice-note-2026-09-10T09-20-31-691Z.webm',
            companyId: '65f000000000000000000028',
            uploadedBy: '65f000000000000000000210'
        });

        const res = await request(app)
            .delete(`/api/v1/company/tasks/${TASK_ID}/attachments/${ATTACHMENT_ID}`)
            .set('Authorization', 'Bearer member-token');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Attachment deleted successfully');
    });

    it('Company Admin can delete voice note attachment via DELETE /api/v1/company/task-attachments/:attachmentId', async () => {
        mocks.attachmentFindOne.mockResolvedValue({
            _id: ATTACHMENT_ID,
            taskId: TASK_ID,
            fileName: 'voice-note-2026-09-10T09-20-31-691Z.webm',
            companyId: '65f000000000000000000028',
            uploadedBy: '65f000000000000000000210'
        });

        const res = await request(app)
            .delete(`/api/v1/company/task-attachments/${ATTACHMENT_ID}`)
            .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Attachment deleted successfully');
    });
});
