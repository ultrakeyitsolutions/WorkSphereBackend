import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { MeetingStatus, ParticipantRole, ParticipantResponseStatus, RescheduleStatus } from '../src/modules/meetings/meeting.types';
import { MeetingSchedulerJob } from '../src/modules/meetings/meeting-scheduler.job';

// ─── Test IDs ─────────────────────────────────────────────────────────────────
const COMPANY_ID = '64e0a1b2c3d4e5f6a7b8c9d0';
const ORGANIZER_ID = '64d0a1b2c3d4e5f6a7b8c9d1';
const PARTICIPANT_ID_1 = '64d0a1b2c3d4e5f6a7b8c9d2';
const PARTICIPANT_ID_2 = '64d0a1b2c3d4e5f6a7b8c9d3';
const CROSS_COMPANY_USER_ID = '64d0a1b2c3d4e5f6a7b8c999';
const OTHER_COMPANY_ID = '64e0a1b2c3d4e5f6a7b8c999';
const PROJECT_ID = '64d0a1b2c3d4e5f6a7b8c9aa';
const TASK_ID = '64d0a1b2c3d4e5f6a7b8c9bb';
const MEETING_OBJECT_ID = '64f1a2b3c4d5e6f7a8b9c0d1';

// ─── Hoisted Mocks ────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
    userFindById: vi.fn(),
    userFind: vi.fn(),
    companyFindById: vi.fn(),
    projectFindOne: vi.fn(),
    taskFindOne: vi.fn(),
    meetingFind: vi.fn(),
    meetingFindOne: vi.fn(),
    meetingCreate: vi.fn(),
    meetingUpdateOne: vi.fn(),
    meetingCountDocuments: vi.fn(),
    participantFind: vi.fn(),
    participantFindOne: vi.fn(),
    participantInsertMany: vi.fn(),
    participantUpdateMany: vi.fn(),
    historyFind: vi.fn(),
    historyFindOne: vi.fn(),
    historyCreate: vi.fn(),
    historyUpdateMany: vi.fn(),
    calendarEventFind: vi.fn(),
    currentUserId: '64d0a1b2c3d4e5f6a7b8c9d1',
    currentUserRole: 'MEMBER',
    currentUserCompanyId: '64e0a1b2c3d4e5f6a7b8c9d0',
}));

// Mock tokens
vi.mock('../src/utils/tokens', () => ({
    verifyAccessToken: vi.fn(() => ({
        userId: mocks.currentUserId,
        email: 'organizer@worksphere.com',
        role: mocks.currentUserRole,
        companyId: mocks.currentUserCompanyId,
    })),
    generateAccessToken: vi.fn(() => 'mocked-jwt-token'),
    generateRefreshToken: vi.fn(() => 'mocked-refresh-token'),
}));

// Mock auth middleware
vi.mock('../src/middleware/auth.middleware', () => ({
    authenticate: (req: any, _res: any, next: any) => {
        req.user = {
            userId: mocks.currentUserId,
            email: 'organizer@worksphere.com',
            companyId: mocks.currentUserCompanyId,
            role: mocks.currentUserRole,
        };
        req.currentUser = {
            userId: mocks.currentUserId,
            email: 'organizer@worksphere.com',
            companyId: mocks.currentUserCompanyId,
            role: mocks.currentUserRole,
        };
        next();
    },
    default: (req: any, _res: any, next: any) => {
        req.user = {
            userId: mocks.currentUserId,
            email: 'organizer@worksphere.com',
            companyId: mocks.currentUserCompanyId,
            role: mocks.currentUserRole,
        };
        req.currentUser = {
            userId: mocks.currentUserId,
            email: 'organizer@worksphere.com',
            companyId: mocks.currentUserCompanyId,
            role: mocks.currentUserRole,
        };
        next();
    },
}));

// Mock Users
vi.mock('../src/modules/users/user.model', () => ({
    User: {
        findById: mocks.userFindById,
        find: mocks.userFind,
    },
}));

// Mock Company
vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: mocks.companyFindById,
    },
}));

// Mock Project
vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: {
        findOne: mocks.projectFindOne,
    },
}));

// Mock Task
vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        findOne: mocks.taskFindOne,
    },
}));

// Mock CalendarEvent
vi.mock('../src/modules/calendar/calendar-event.model', () => ({
    CalendarEvent: {
        find: mocks.calendarEventFind,
    },
}));

// Mock AuditLog
vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn().mockResolvedValue(true),
    },
}));

// Mock Meeting Models
vi.mock('../src/modules/meetings/models/meeting.model', () => ({
    Meeting: {
        find: mocks.meetingFind,
        findOne: mocks.meetingFindOne,
        create: mocks.meetingCreate,
        updateOne: mocks.meetingUpdateOne,
        countDocuments: mocks.meetingCountDocuments,
    },
}));

vi.mock('../src/modules/meetings/models/meeting-participant.model', () => ({
    MeetingParticipant: {
        find: mocks.participantFind,
        findOne: mocks.participantFindOne,
        insertMany: mocks.participantInsertMany,
        updateMany: mocks.participantUpdateMany,
    },
}));

vi.mock('../src/modules/meetings/models/meeting-schedule-history.model', () => ({
    MeetingScheduleHistory: {
        find: mocks.historyFind,
        findOne: mocks.historyFindOne,
        create: mocks.historyCreate,
        updateMany: mocks.historyUpdateMany,
    },
}));

describe('Quick Meeting System Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mocks.currentUserId = ORGANIZER_ID;
        mocks.currentUserRole = 'MEMBER';
        mocks.currentUserCompanyId = COMPANY_ID;

        // Default User lookup mock
        mocks.userFindById.mockImplementation((id: string) => {
            const idStr = id.toString();
            return {
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        _id: new Types.ObjectId(idStr),
                        name: 'Test User',
                        email: `${idStr}@test.com`,
                        companyId: new Types.ObjectId(COMPANY_ID),
                        isActive: true,
                        status: 'ACTIVE',
                        role: { name: 'MEMBER' },
                    }),
                }),
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(idStr),
                    name: 'Test User',
                    email: `${idStr}@test.com`,
                    companyId: new Types.ObjectId(COMPANY_ID),
                    isActive: true,
                    status: 'ACTIVE',
                    role: { name: 'MEMBER' },
                }),
            };
        });

        mocks.companyFindById.mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: new Types.ObjectId(COMPANY_ID),
                name: 'Acme Corp',
                status: 'ACTIVE',
                isActive: true,
            }),
        });

        mocks.userFind.mockReturnValue({
            lean: vi.fn().mockResolvedValue([
                {
                    _id: new Types.ObjectId(PARTICIPANT_ID_1),
                    name: 'Participant 1',
                    email: 'p1@test.com',
                    companyId: new Types.ObjectId(COMPANY_ID),
                    isActive: true,
                    status: 'ACTIVE',
                },
            ]),
        });

        mocks.projectFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: new Types.ObjectId(PROJECT_ID),
                name: 'WorkSphere Core',
                companyId: new Types.ObjectId(COMPANY_ID),
            }),
        });

        mocks.taskFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: new Types.ObjectId(TASK_ID),
                title: 'Build Quick Meetings Backend',
                projectId: new Types.ObjectId(PROJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
            }),
        });

        mocks.calendarEventFind.mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
        });

        mocks.meetingFind.mockReturnValue({
            populate: vi.fn().mockReturnThis(),
            sort: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([]),
        });

        mocks.participantFind.mockReturnValue({
            populate: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([]),
        });
    });

    // ─── 1. Meeting Request Creation & Validation ─────────────────────────────
    describe('POST /api/meetings/requests', () => {
        it('should successfully create a quick meeting request with valid participants', async () => {
            const startAt = new Date(Date.now() + 3600 * 1000).toISOString();

            mocks.meetingCreate.mockResolvedValue({
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                meetingId: 'ws-meet-12345',
                companyId: new Types.ObjectId(COMPANY_ID),
                organizerId: new Types.ObjectId(ORGANIZER_ID),
                title: 'Sync on Quick Meetings API',
                agenda: 'Discuss implementation details and edge cases',
                scheduledStartAt: new Date(startAt),
                scheduledEndAt: new Date(new Date(startAt).getTime() + 30 * 60 * 1000),
                durationMinutes: 30,
                status: MeetingStatus.PENDING,
            });

            mocks.participantInsertMany.mockResolvedValue([]);

            const res = await request(app)
                .post('/api/meetings/requests')
                .set('Authorization', 'Bearer valid_token')
                .send({
                    title: 'Sync on Quick Meetings API',
                    agenda: 'Discuss implementation details and edge cases',
                    participantIds: [PARTICIPANT_ID_1],
                    preferredStartAt: startAt,
                    durationMinutes: 30,
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.meeting).toBeDefined();
            expect(mocks.meetingCreate).toHaveBeenCalled();
            expect(mocks.participantInsertMany).toHaveBeenCalled();
        });

        it('should reject request when participants are missing', async () => {
            const res = await request(app)
                .post('/api/meetings/requests')
                .set('Authorization', 'Bearer valid_token')
                .send({
                    title: 'Sync',
                    agenda: 'Discuss',
                    participantIds: [],
                    preferredStartAt: new Date().toISOString(),
                });

            expect(res.status).toBe(422);
            expect(res.body.success).toBe(false);
        });

        it('should reject cross-company meeting creation with 403 CROSS_COMPANY_MEETING_NOT_ALLOWED', async () => {
            mocks.userFind.mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: new Types.ObjectId(CROSS_COMPANY_USER_ID),
                        name: 'Cross Company User',
                        email: 'external@othercorp.com',
                        companyId: new Types.ObjectId(OTHER_COMPANY_ID),
                        isActive: true,
                        status: 'ACTIVE',
                    },
                ]),
            });

            const res = await request(app)
                .post('/api/meetings/requests')
                .set('Authorization', 'Bearer valid_token')
                .send({
                    title: 'Cross Tenant Sync',
                    agenda: 'Attempt cross tenant request',
                    participantIds: [CROSS_COMPANY_USER_ID],
                    preferredStartAt: new Date().toISOString(),
                    durationMinutes: 30,
                });

            expect(res.status).toBe(403);
            expect(res.body.message).toContain('CROSS_COMPANY_MEETING_NOT_ALLOWED');
        });
    });

    // ─── 2. Multi-Participant Acceptance Flow ──────────────────────────────────
    describe('POST /api/meetings/:meetingId/accept', () => {
        it('should update participant response and confirm meeting when all required participants accept', async () => {
            const mockMeetingDoc = {
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                title: 'Sprint Kickoff',
                status: MeetingStatus.PENDING,
                scheduledStartAt: new Date(),
                save: vi.fn().mockResolvedValue(true),
            };

            const mockParticipantDoc = {
                _id: new Types.ObjectId(),
                meetingId: new Types.ObjectId(MEETING_OBJECT_ID),
                userId: new Types.ObjectId(PARTICIPANT_ID_1),
                companyId: new Types.ObjectId(COMPANY_ID),
                role: ParticipantRole.REQUIRED,
                responseStatus: ParticipantResponseStatus.PENDING,
                save: vi.fn().mockResolvedValue(true),
            };

            mocks.currentUserId = PARTICIPANT_ID_1;
            mocks.meetingFindOne.mockResolvedValue(mockMeetingDoc);
            mocks.participantFindOne.mockResolvedValue(mockParticipantDoc);

            // All participants check: organizer (ACCEPTED) + participant (now ACCEPTED)
            mocks.participantFind.mockResolvedValue([
                {
                    userId: new Types.ObjectId(ORGANIZER_ID),
                    role: ParticipantRole.ORGANIZER,
                    responseStatus: ParticipantResponseStatus.ACCEPTED,
                },
                mockParticipantDoc,
            ]);

            const res = await request(app)
                .post(`/api/meetings/${MEETING_OBJECT_ID}/accept`)
                .set('Authorization', 'Bearer valid_token')
                .send({ note: 'Accepted, see you there!' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockParticipantDoc.responseStatus).toBe(ParticipantResponseStatus.ACCEPTED);
            expect(mockMeetingDoc.status).toBe(MeetingStatus.ACCEPTED);
            expect(mockMeetingDoc.save).toHaveBeenCalled();
        });

        it('should remain PENDING if there are other required participants who have not accepted', async () => {
            const mockMeetingDoc = {
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                title: 'Multi-party Sync',
                status: MeetingStatus.PENDING,
                save: vi.fn().mockResolvedValue(true),
            };

            const mockParticipantDoc1 = {
                _id: new Types.ObjectId(),
                meetingId: new Types.ObjectId(MEETING_OBJECT_ID),
                userId: new Types.ObjectId(PARTICIPANT_ID_1),
                role: ParticipantRole.REQUIRED,
                responseStatus: ParticipantResponseStatus.PENDING,
                save: vi.fn().mockResolvedValue(true),
            };

            mocks.currentUserId = PARTICIPANT_ID_1;
            mocks.meetingFindOne.mockResolvedValue(mockMeetingDoc);
            mocks.participantFindOne.mockResolvedValue(mockParticipantDoc1);

            mocks.participantFind.mockResolvedValue([
                mockParticipantDoc1,
                {
                    userId: new Types.ObjectId(PARTICIPANT_ID_2),
                    role: ParticipantRole.REQUIRED,
                    responseStatus: ParticipantResponseStatus.PENDING,
                },
            ]);

            const res = await request(app)
                .post(`/api/meetings/${MEETING_OBJECT_ID}/accept`)
                .set('Authorization', 'Bearer valid_token')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.data.allRequiredAccepted).toBe(false);
            expect(mockMeetingDoc.status).toBe(MeetingStatus.PENDING);
        });

        it('should handle duplicate acceptance safely and idempotently', async () => {
            const mockMeetingDoc = {
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                status: MeetingStatus.ACCEPTED,
            };

            const mockParticipantDoc = {
                _id: new Types.ObjectId(),
                meetingId: new Types.ObjectId(MEETING_OBJECT_ID),
                userId: new Types.ObjectId(PARTICIPANT_ID_1),
                role: ParticipantRole.REQUIRED,
                responseStatus: ParticipantResponseStatus.ACCEPTED,
                save: vi.fn(),
            };

            mocks.currentUserId = PARTICIPANT_ID_1;
            mocks.meetingFindOne.mockResolvedValue(mockMeetingDoc);
            mocks.participantFindOne.mockResolvedValue(mockParticipantDoc);

            const res = await request(app)
                .post(`/api/meetings/${MEETING_OBJECT_ID}/accept`)
                .set('Authorization', 'Bearer valid_token')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.data.alreadyAccepted).toBe(true);
            expect(mockParticipantDoc.save).not.toHaveBeenCalled();
        });
    });

    // ─── 3. Rejection Flow ─────────────────────────────────────────────────────
    describe('POST /api/meetings/:meetingId/reject', () => {
        it('should record decline reason and update meeting status to REJECTED', async () => {
            const mockMeetingDoc: any = {
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                title: 'Review Meeting',
                status: MeetingStatus.PENDING,
                rejectionReason: undefined,
                save: vi.fn().mockResolvedValue(true),
            };

            const mockParticipantDoc = {
                _id: new Types.ObjectId(),
                meetingId: new Types.ObjectId(MEETING_OBJECT_ID),
                userId: new Types.ObjectId(PARTICIPANT_ID_1),
                role: ParticipantRole.REQUIRED,
                responseStatus: ParticipantResponseStatus.PENDING,
                save: vi.fn().mockResolvedValue(true),
            };

            mocks.currentUserId = PARTICIPANT_ID_1;
            mocks.meetingFindOne.mockResolvedValue(mockMeetingDoc);
            mocks.participantFindOne.mockResolvedValue(mockParticipantDoc);
            mocks.participantFind.mockResolvedValue([mockParticipantDoc]);

            const res = await request(app)
                .post(`/api/meetings/${MEETING_OBJECT_ID}/reject`)
                .set('Authorization', 'Bearer valid_token')
                .send({ reason: 'I have an unavoidable conflict at this hour.' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockParticipantDoc.responseStatus).toBe(ParticipantResponseStatus.DECLINED);
            expect(mockMeetingDoc.status).toBe(MeetingStatus.REJECTED);
            expect(mockMeetingDoc.rejectionReason).toBe('I have an unavoidable conflict at this hour.');
        });
    });

    // ─── 4. Reschedule Request and Approval Flow ───────────────────────────────
    describe('Reschedule Workflow', () => {
        it('should allow participant to request reschedule and create history proposal', async () => {
            const newProposedDate = new Date(Date.now() + 7200 * 1000).toISOString();

            const mockMeetingDoc = {
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                title: 'Architecture Review',
                scheduledStartAt: new Date(),
                scheduledEndAt: new Date(Date.now() + 1800 * 1000),
                durationMinutes: 30,
                status: MeetingStatus.PENDING,
                save: vi.fn().mockResolvedValue(true),
            };

            const mockParticipantDoc = {
                _id: new Types.ObjectId(),
                meetingId: new Types.ObjectId(MEETING_OBJECT_ID),
                userId: new Types.ObjectId(PARTICIPANT_ID_1),
                save: vi.fn().mockResolvedValue(true),
            };

            mocks.currentUserId = PARTICIPANT_ID_1;
            mocks.meetingFindOne.mockResolvedValue(mockMeetingDoc);
            mocks.participantFindOne.mockResolvedValue(mockParticipantDoc);
            mocks.participantFind.mockResolvedValue([mockParticipantDoc]);
            mocks.historyCreate.mockResolvedValue({
                _id: new Types.ObjectId(),
                meetingId: new Types.ObjectId(MEETING_OBJECT_ID),
                proposedStartAt: new Date(newProposedDate),
                status: RescheduleStatus.PENDING,
            });

            const res = await request(app)
                .post(`/api/meetings/${MEETING_OBJECT_ID}/reschedule-request`)
                .set('Authorization', 'Bearer valid_token')
                .send({
                    proposedStartAt: newProposedDate,
                    durationMinutes: 30,
                    reason: 'Previous meeting ran over time',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockMeetingDoc.status).toBe(MeetingStatus.RESCHEDULE_REQUESTED);
            expect(mocks.historyCreate).toHaveBeenCalled();
        });

        it('should allow accepting reschedule and updating meeting schedule and participants', async () => {
            const proposedStart = new Date(Date.now() + 8000 * 1000);
            const proposedEnd = new Date(proposedStart.getTime() + 45 * 60 * 1000);

            const mockMeetingDoc = {
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                title: 'Design Sync',
                status: MeetingStatus.RESCHEDULE_REQUESTED,
                save: vi.fn().mockResolvedValue(true),
            };

            const mockHistoryDoc = {
                _id: new Types.ObjectId(),
                proposedStartAt: proposedStart,
                proposedEndAt: proposedEnd,
                durationMinutes: 45,
                requestedBy: new Types.ObjectId(PARTICIPANT_ID_1),
                status: RescheduleStatus.PENDING,
                save: vi.fn().mockResolvedValue(true),
            };

            mocks.currentUserId = ORGANIZER_ID;
            mocks.meetingFindOne.mockResolvedValue(mockMeetingDoc);
            mocks.historyFindOne.mockReturnValue({
                sort: vi.fn().mockResolvedValue(mockHistoryDoc),
            });
            mocks.participantFind.mockResolvedValue([]);
            mocks.participantUpdateMany.mockResolvedValue({ modifiedCount: 2 });

            const res = await request(app)
                .post(`/api/meetings/${MEETING_OBJECT_ID}/reschedule/accept`)
                .set('Authorization', 'Bearer valid_token')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockMeetingDoc.status).toBe(MeetingStatus.ACCEPTED);
            expect(mockHistoryDoc.status).toBe(RescheduleStatus.ACCEPTED);
            expect(mocks.participantUpdateMany).toHaveBeenCalled();
        });
    });

    // ─── 5. Immediate Join & Window Validation ─────────────────────────────────
    describe('POST /api/meetings/:meetingId/join', () => {
        it('should allow join within allowed window (-15 min before start to end)', async () => {
            const now = Date.now();
            const startAt = new Date(now + 10 * 60 * 1000); // 10 mins in future (within 15m window)
            const endAt = new Date(now + 40 * 60 * 1000);

            const mockMeetingDoc = {
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                meetingId: 'ws-meet-123',
                companyId: new Types.ObjectId(COMPANY_ID),
                title: 'Live Quick Sync',
                meetingLink: 'https://meet.worksphere.io/ws-meet-123',
                scheduledStartAt: startAt,
                scheduledEndAt: endAt,
                status: MeetingStatus.ACCEPTED,
                save: vi.fn().mockResolvedValue(true),
            };

            const mockParticipantDoc = {
                _id: new Types.ObjectId(),
                userId: new Types.ObjectId(ORGANIZER_ID),
                joinedAt: null,
                save: vi.fn().mockResolvedValue(true),
            };

            mocks.meetingFindOne.mockResolvedValue(mockMeetingDoc);
            mocks.participantFindOne.mockResolvedValue(mockParticipantDoc);

            const res = await request(app)
                .post(`/api/meetings/${MEETING_OBJECT_ID}/join`)
                .set('Authorization', 'Bearer valid_token')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.meetingLink).toBe('https://meet.worksphere.io/ws-meet-123');
            expect(mockMeetingDoc.status).toBe(MeetingStatus.IN_PROGRESS);
            expect(mockParticipantDoc.joinedAt).toBeDefined();
        });

        it('should reject join if attempted too early (> 15 mins before start)', async () => {
            const now = Date.now();
            const startAt = new Date(now + 60 * 60 * 1000); // 1 hour in future
            const endAt = new Date(now + 90 * 60 * 1000);

            const mockMeetingDoc = {
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                scheduledStartAt: startAt,
                scheduledEndAt: endAt,
                status: MeetingStatus.ACCEPTED,
            };

            mocks.meetingFindOne.mockResolvedValue(mockMeetingDoc);
            mocks.participantFindOne.mockResolvedValue({ _id: new Types.ObjectId() });

            const res = await request(app)
                .post(`/api/meetings/${MEETING_OBJECT_ID}/join`)
                .set('Authorization', 'Bearer valid_token')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Too early to join');
        });
    });

    // ─── 6. Cancellation & Authorization ──────────────────────────────────────
    describe('POST /api/meetings/:meetingId/cancel', () => {
        it('should allow organizer to cancel the meeting', async () => {
            const mockMeetingDoc = {
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                organizerId: new Types.ObjectId(ORGANIZER_ID),
                title: 'Cancel Test',
                status: MeetingStatus.ACCEPTED,
                save: vi.fn().mockResolvedValue(true),
            };

            mocks.meetingFindOne.mockResolvedValue(mockMeetingDoc);
            mocks.participantFind.mockResolvedValue([]);

            const res = await request(app)
                .post(`/api/meetings/${MEETING_OBJECT_ID}/cancel`)
                .set('Authorization', 'Bearer valid_token')
                .send({ reason: 'Client requested reschedule to next week' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockMeetingDoc.status).toBe(MeetingStatus.CANCELLED);
        });

        it('should disallow regular participant who is not organizer/admin from cancelling', async () => {
            const mockMeetingDoc = {
                _id: new Types.ObjectId(MEETING_OBJECT_ID),
                companyId: new Types.ObjectId(COMPANY_ID),
                organizerId: new Types.ObjectId(ORGANIZER_ID),
                status: MeetingStatus.ACCEPTED,
            };

            mocks.currentUserId = PARTICIPANT_ID_1;
            mocks.currentUserRole = 'MEMBER';
            mocks.meetingFindOne.mockResolvedValue(mockMeetingDoc);

            const res = await request(app)
                .post(`/api/meetings/${MEETING_OBJECT_ID}/cancel`)
                .set('Authorization', 'Bearer valid_token')
                .send({ reason: 'I want to cancel' });

            expect(res.status).toBe(403);
            expect(res.body.message).toContain('Only the organizer or an administrator');
        });
    });

    // ─── 7. Availability & Queries ─────────────────────────────────────────────
    describe('GET /api/meetings/availability', () => {
        it('should return available 30-min slots for a user on a given date', async () => {
            const res = await request(app)
                .get('/api/meetings/availability')
                .query({ date: '2026-09-25', durationMinutes: 30 })
                .set('Authorization', 'Bearer valid_token');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.slots).toBeDefined();
            expect(res.body.data.freeSlots).toBeDefined();
        });
    });

    // ─── 8. Reminder Scheduler Job ────────────────────────────────────────────
    describe('MeetingSchedulerJob', () => {
        it('should process 15-minute reminders idempotently', async () => {
            const now = Date.now();
            const startAt = new Date(now + 12 * 60 * 1000); // 12 minutes ahead

            mocks.meetingFind.mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: new Types.ObjectId(MEETING_OBJECT_ID),
                        companyId: new Types.ObjectId(COMPANY_ID),
                        organizerId: new Types.ObjectId(ORGANIZER_ID),
                        title: 'Reminder Target Meeting',
                        scheduledStartAt: startAt,
                        status: MeetingStatus.ACCEPTED,
                        reminded15Min: false,
                        reminded5Min: false,
                    },
                ]),
            });

            mocks.meetingUpdateOne.mockResolvedValue({ modifiedCount: 1 });
            mocks.participantFind.mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    { userId: new Types.ObjectId(ORGANIZER_ID) },
                    { userId: new Types.ObjectId(PARTICIPANT_ID_1) },
                ]),
            });

            await MeetingSchedulerJob.processReminders();

            expect(mocks.meetingUpdateOne).toHaveBeenCalledWith(
                { _id: expect.anything() },
                { $set: { reminded15Min: true } }
            );
        });
    });
});
