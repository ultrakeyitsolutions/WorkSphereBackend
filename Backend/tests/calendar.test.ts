import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { encrypt } from '../src/utils/encryption';

const mockEventsInsert = vi.fn();
const mockEventsGet = vi.fn();
const mockOAuth2GetToken = vi.fn();
const mockUserInfoGet = vi.fn();

vi.mock('googleapis', () => {
    class MockOAuth2 {
        setCredentials = vi.fn();
        on = vi.fn();
        getToken = mockOAuth2GetToken;
    }
    return {
        google: {
            auth: {
                OAuth2: MockOAuth2,
            },
            calendar: vi.fn().mockImplementation(() => ({
                events: {
                    insert: mockEventsInsert,
                    get: mockEventsGet,
                },
            })),
            oauth2: vi.fn().mockImplementation(() => ({
                userinfo: {
                    get: mockUserInfoGet,
                },
            })),
        },
    };
});


// ─── Constants ────────────────────────────────────────────────────────────────
const COMPANY_ID = '64e0a1b2c3d4e5f6a7b8c9d0';
const USER_ID = '64d0a1b2c3d4e5f6a7b8c9d1';
const PARTICIPANT_ID_1 = '64d0a1b2c3d4e5f6a7b8c9d2';
const CROSS_TENANT_USER_ID = '64d0a1b2c3d4e5f6a7b8c999';
const EVENT_ID = '64f1a2b3c4d5e6f7a8b9c0d1';

// ─── Hoisted Mocks ────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
    calendarEventFind: vi.fn(),
    calendarEventFindOne: vi.fn(),
    calendarEventCreate: vi.fn(),
    calendarEventDeleteOne: vi.fn(),
    calendarEventCountDocuments: vi.fn(),
    calendarOAuthFind: vi.fn(),
    calendarOAuthFindOne: vi.fn(),
    calendarOAuthFindOneAndUpdate: vi.fn(),
    companyCalendarConfigFindOne: vi.fn(),
    companyCalendarConfigFindOneAndUpdate: vi.fn(),
    userFindById: vi.fn(),
    userFind: vi.fn(),
    companyMemberFind: vi.fn(),
    companyMemberFindOne: vi.fn(),
    projectFindOne: vi.fn(),
    taskFindOne: vi.fn(),
    entitlementHasFeature: vi.fn(),
    entitlementGetQuickMeetingLimits: vi.fn(),
    currentUserRole: 'COMPANY_ADMIN',
    currentUserId: '64d0a1b2c3d4e5f6a7b8c9d1',
}));

vi.mock('../src/modules/calendar/calendar-event.model', () => ({
    CalendarEvent: {
        find: mocks.calendarEventFind,
        findOne: mocks.calendarEventFindOne,
        create: mocks.calendarEventCreate,
        deleteOne: mocks.calendarEventDeleteOne,
        countDocuments: mocks.calendarEventCountDocuments,
    },
    default: {
        find: mocks.calendarEventFind,
        findOne: mocks.calendarEventFindOne,
        create: mocks.calendarEventCreate,
        deleteOne: mocks.calendarEventDeleteOne,
        countDocuments: mocks.calendarEventCountDocuments,
    },
}));

vi.mock('../src/services/entitlement.service', () => ({
    EntitlementService: {
        hasFeature: mocks.entitlementHasFeature,
        getQuickMeetingLimits: mocks.entitlementGetQuickMeetingLimits,
        getLimit: vi.fn(),
        isUnlimited: vi.fn(),
        checkLimit: vi.fn(),
    },
}));

vi.mock('../src/modules/calendar/calendar-oauth.model', () => ({
    CalendarOAuth: {
        find: mocks.calendarOAuthFind,
        findOne: mocks.calendarOAuthFindOne,
        findOneAndUpdate: mocks.calendarOAuthFindOneAndUpdate,
    },
    default: {
        find: mocks.calendarOAuthFind,
        findOne: mocks.calendarOAuthFindOne,
        findOneAndUpdate: mocks.calendarOAuthFindOneAndUpdate,
    },
}));

vi.mock('../src/modules/calendar/company-calendar-config.model', () => ({
    CompanyCalendarConfig: {
        findOne: mocks.companyCalendarConfigFindOne,
        findOneAndUpdate: mocks.companyCalendarConfigFindOneAndUpdate,
    },
    default: {
        findOne: mocks.companyCalendarConfigFindOne,
        findOneAndUpdate: mocks.companyCalendarConfigFindOneAndUpdate,
    },
}));

vi.mock('../src/modules/users/user.model', () => ({
    User: {
        findById: mocks.userFindById,
        find: mocks.userFind,
    },
    default: {
        findById: mocks.userFindById,
        find: mocks.userFind,
    },
}));

vi.mock('../src/modules/companyadmin/invitations/company-member.model', () => ({
    CompanyMember: {
        find: mocks.companyMemberFind,
        findOne: mocks.companyMemberFindOne,
    },
    default: {
        find: mocks.companyMemberFind,
        findOne: mocks.companyMemberFindOne,
    },
}));

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: {
        findOne: mocks.projectFindOne,
    },
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        findOne: mocks.taskFindOne,
    },
}));

vi.mock('../src/middleware/auth.middleware', () => ({
    authenticate: (req: any, _res: any, next: any) => {
        req.user = {
            userId: mocks.currentUserId,
            email: 'admin@worksphere.com',
            companyId: COMPANY_ID,
            role: mocks.currentUserRole,
        };
        next();
    },
    default: (req: any, _res: any, next: any) => {
        req.user = {
            userId: mocks.currentUserId,
            email: 'admin@worksphere.com',
            companyId: COMPANY_ID,
            role: mocks.currentUserRole,
        };
        next();
    },
}));

describe('Calendar & Meeting Invitation API', () => {
    const futureStart = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 25 * 3600 * 1000).toISOString();

    const mockEventDoc = {
        _id: new Types.ObjectId(EVENT_ID),
        companyId: new Types.ObjectId(COMPANY_ID),
        title: 'Product Architecture & Roadmap Sync',
        description: 'Quarterly review of frontend component architecture and delivery milestones.',
        startTime: new Date(futureStart),
        endTime: new Date(futureEnd),
        allDay: false,
        timeZone: 'Asia/Kolkata',
        organizer: {
            userId: new Types.ObjectId(USER_ID),
            name: 'Manohar',
            email: 'manohar@worksphere.com',
            avatar: null,
        },
        coOrganizers: [],
        participants: [
            {
                userId: new Types.ObjectId(USER_ID),
                name: 'Manohar',
                email: 'manohar@worksphere.com',
                avatar: null,
                role: 'Admin',
                designation: 'Organizer',
                status: 'organizer',
                isCoOrganizer: false,
                respondedAt: new Date(),
            },
            {
                userId: new Types.ObjectId(PARTICIPANT_ID_1),
                name: 'Raju Sharma',
                email: 'raju@worksphere.com',
                avatar: null,
                role: 'Lead Engineer',
                designation: 'Staff',
                status: 'pending',
                isCoOrganizer: false,
            },
        ],
        meetingType: 'video',
        provider: 'google_meet',
        meetingUrl: 'https://meet.google.com/qpa-nxkm-rvw',
        externalEventId: 'gcal_9283748234',
        agenda: ['Architecture Review'],
        reminderMinutes: 15,
        recurrence: 'none',
        color: '#F97316',
        createdAt: new Date(),
        updatedAt: new Date(),
        save: vi.fn().mockResolvedValue(true),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUserRole = 'COMPANY_ADMIN';
        mocks.currentUserId = USER_ID;

        // Default chainable mocks
        mocks.userFindById.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(USER_ID),
                    name: 'Manohar',
                    email: 'manohar@worksphere.com',
                    role: { name: 'Admin' },
                }),
            }),
        });

        const mockEncryptedToken = encrypt('mock_access_token_123');
        mocks.companyCalendarConfigFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue(null),
        });
        mocks.companyCalendarConfigFindOneAndUpdate.mockResolvedValue({});
        mocks.calendarOAuthFindOne.mockResolvedValue({
            companyId: new Types.ObjectId(COMPANY_ID),
            userId: new Types.ObjectId(USER_ID),
            provider: 'google',
            isConnected: true,
            accessTokenEncrypted: mockEncryptedToken,
            refreshTokenEncrypted: mockEncryptedToken,
            accountEmail: 'organizer@worksphere.com',
        });

        mockEventsGet.mockResolvedValue({
            data: {
                id: 'google_cal_event_123',
                conferenceData: {
                    conferenceId: 'genuine-meet-conference-id',
                    createRequest: { status: { statusCode: 'success' } },
                    entryPoints: [
                        {
                            entryPointType: 'video',
                            uri: 'https://meet.google.com/qpa-nxkm-rvw',
                        },
                    ],
                },
            },
        });

        mockEventsInsert.mockResolvedValue({
            data: {
                id: 'google_cal_event_123',
                conferenceData: {
                    conferenceId: 'genuine-meet-conference-id',
                    entryPoints: [
                        {
                            entryPointType: 'video',
                            uri: 'https://meet.google.com/qpa-nxkm-rvw',
                        },
                    ],
                },
            },
        });
        mocks.calendarEventCountDocuments.mockResolvedValue(0);
        mocks.entitlementHasFeature.mockResolvedValue(true);
        mocks.entitlementGetQuickMeetingLimits.mockResolvedValue({
            enabled: true,
            monthlyLimit: 7,
            isUnlimited: false,
            billingCycle: 'MONTHLY',
            planName: 'Pro Monthly',
        });
    });

    // ── 2.1 GET /api/v1/company/calendar/events ─────────────────────────────
    describe('GET /api/v1/company/calendar/events', () => {
        it('should retrieve calendar events successfully with filters', async () => {
            mocks.calendarEventFind.mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([mockEventDoc]),
                }),
            });

            const res = await request(app)
                .get('/api/v1/company/calendar/events')
                .query({
                    startDate: '2026-09-01T00:00:00.000Z',
                    endDate: '2026-09-30T23:59:59.999Z',
                    provider: 'google_meet',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Calendar events retrieved successfully');
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBe(1);
            expect(res.body.data[0].id).toBe(EVENT_ID);
            expect(res.body.data[0].organizer.name).toBe('Manohar');
            expect(res.body.data[0].participants.length).toBe(2);
        });
    });

    // ── 2.2 POST /api/v1/company/calendar/events ────────────────────────────
    describe('POST /api/v1/company/calendar/events', () => {
        it('should create an event successfully and return 201', async () => {
            mocks.companyMemberFind.mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([
                    {
                        userId: new Types.ObjectId(PARTICIPANT_ID_1),
                        roleId: { name: 'Lead Engineer' },
                        designationId: { name: 'Staff' },
                    },
                ]),
            });

            mocks.userFind.mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: new Types.ObjectId(PARTICIPANT_ID_1),
                        name: 'Raju Sharma',
                        email: 'raju@worksphere.com',
                    },
                ]),
            });

            mocks.calendarEventCreate.mockResolvedValue(mockEventDoc);

            const res = await request(app)
                .post('/api/v1/company/calendar/events')
                .send({
                    title: 'Client Review & Demo',
                    description: 'Sprint walkthrough',
                    startTime: futureStart,
                    endTime: futureEnd,
                    participantIds: [PARTICIPANT_ID_1],
                    meetingType: 'video',
                    provider: 'google_meet',
                    agenda: ['Demo sprint 14 features'],
                    reminderMinutes: 15,
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Calendar event created successfully');
            expect(res.body.data.id).toBe(EVENT_ID);
            expect(res.body.data.meetingUrl).toContain('meet.google.com');
        });

        it('should reject past start time with CANNOT_SCHEDULE_IN_PAST', async () => {
            const pastStart = new Date(Date.now() - 3600 * 1000).toISOString();
            const pastEnd = new Date(Date.now() + 1800 * 1000).toISOString();

            const res = await request(app)
                .post('/api/v1/company/calendar/events')
                .send({
                    title: 'Past Event',
                    startTime: pastStart,
                    endTime: pastEnd,
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('CANNOT_SCHEDULE_IN_PAST');
            expect(res.body.details).toBe('Event start time cannot be in the past.');
        });

        it('should reject when endTime is before startTime', async () => {
            const start = futureEnd;
            const end = futureStart;

            const res = await request(app)
                .post('/api/v1/company/calendar/events')
                .send({
                    title: 'Invalid Time Range',
                    startTime: start,
                    endTime: end,
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('INVALID_TIME_RANGE');
        });

        it('should reject cross-tenant participant invitations with 403', async () => {
            mocks.companyMemberFind.mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([]),
            });
            mocks.userFind.mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([]),
            });

            const res = await request(app)
                .post('/api/v1/company/calendar/events')
                .send({
                    title: 'Cross Tenant Attempt',
                    startTime: futureStart,
                    endTime: futureEnd,
                    participantIds: [CROSS_TENANT_USER_ID],
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('CROSS_TENANT_INVITATION_FORBIDDEN');
        });
    });

    // ── 2.3 PUT /api/v1/company/calendar/events/:id ─────────────────────────
    describe('PUT /api/v1/company/calendar/events/:id', () => {
        it('should update event successfully', async () => {
            mocks.calendarEventFindOne.mockResolvedValue({
                ...mockEventDoc,
                save: vi.fn().mockResolvedValue(true),
            });

            const res = await request(app)
                .put(`/api/v1/company/calendar/events/${EVENT_ID}`)
                .send({
                    title: 'Updated Event Title',
                    agenda: ['New agenda item'],
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Calendar event updated successfully');
        });

        it('should forbid unauthorized non-organizer and non-admin from updating', async () => {
            mocks.currentUserRole = 'MEMBER';
            mocks.currentUserId = '64d0a1b2c3d4e5f6a7b8c999'; // different user

            mocks.calendarEventFindOne.mockResolvedValue({
                ...mockEventDoc,
                organizer: {
                    userId: new Types.ObjectId(USER_ID),
                    name: 'Other Organizer',
                    email: 'other@worksphere.com',
                },
            });

            const res = await request(app)
                .put(`/api/v1/company/calendar/events/${EVENT_ID}`)
                .send({
                    title: 'Hacked Title',
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
        });
    });

    // ── 2.4 PATCH /api/v1/company/calendar/events/:id/reschedule ────────────
    describe('PATCH /api/v1/company/calendar/events/:id/reschedule', () => {
        it('should reschedule event successfully', async () => {
            const newStart = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
            const newEnd = new Date(Date.now() + 49 * 3600 * 1000).toISOString();

            mocks.calendarEventFindOne.mockResolvedValue({
                ...mockEventDoc,
                save: vi.fn().mockResolvedValue(true),
            });

            const res = await request(app)
                .patch(`/api/v1/company/calendar/events/${EVENT_ID}/reschedule`)
                .send({
                    startTime: newStart,
                    endTime: newEnd,
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Event rescheduled successfully');
            expect(res.body.data.id).toBe(EVENT_ID);
        });

        it('should reject rescheduling into the past', async () => {
            const pastStart = new Date(Date.now() - 3600 * 1000).toISOString();
            const pastEnd = new Date(Date.now() + 1800 * 1000).toISOString();

            mocks.calendarEventFindOne.mockResolvedValue({
                ...mockEventDoc,
                save: vi.fn().mockResolvedValue(true),
            });

            const res = await request(app)
                .patch(`/api/v1/company/calendar/events/${EVENT_ID}/reschedule`)
                .send({
                    startTime: pastStart,
                    endTime: pastEnd,
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('CANNOT_SCHEDULE_IN_PAST');
        });
    });

    // ── 2.5 PATCH /api/v1/company/calendar/events/:id/rsvp ──────────────────
    describe('PATCH /api/v1/company/calendar/events/:id/rsvp', () => {
        it('should record rsvp response for invited participant', async () => {
            mocks.currentUserId = PARTICIPANT_ID_1;

            const participantEntry = {
                userId: new Types.ObjectId(PARTICIPANT_ID_1),
                name: 'Raju Sharma',
                email: 'raju@worksphere.com',
                status: 'pending',
                respondedAt: null,
            };

            mocks.calendarEventFindOne.mockResolvedValue({
                ...mockEventDoc,
                participants: [mockEventDoc.participants[0], participantEntry],
                save: vi.fn().mockResolvedValue(true),
            });

            const res = await request(app)
                .patch(`/api/v1/company/calendar/events/${EVENT_ID}/rsvp`)
                .send({
                    status: 'accepted',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('accepted');
            expect(res.body.data.userId).toBe(PARTICIPANT_ID_1);
            expect(res.body.data.respondedAt).toBeDefined();
        });
    });

    // ── 2.6 DELETE /api/v1/company/calendar/events/:id ──────────────────────
    describe('DELETE /api/v1/company/calendar/events/:id', () => {
        it('should cancel event successfully', async () => {
            mocks.calendarEventFindOne.mockResolvedValue(mockEventDoc);
            mocks.calendarEventDeleteOne.mockResolvedValue({ deletedCount: 1 });

            const res = await request(app)
                .delete(`/api/v1/company/calendar/events/${EVENT_ID}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Calendar event cancelled successfully');
        });
    });

    // ── 2.7 POST /api/v1/company/calendar/quick-meeting ─────────────────────
    describe('POST /api/v1/company/calendar/quick-meeting', () => {
        it('should generate quick meeting room instantly with genuine provider URL', async () => {
            mocks.calendarEventCreate.mockResolvedValue({
                ...mockEventDoc,
                title: 'Instant Sync with Manohar',
                meetingUrl: 'https://meet.google.com/qpa-nxkm-rvw',
            });

            const res = await request(app)
                .post('/api/v1/company/calendar/quick-meeting')
                .send({
                    title: 'Instant Sync with Manohar',
                    provider: 'google_meet',
                    durationMinutes: 30,
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Quick meeting room created');
            expect(res.body.data.meetingUrl).toBe('https://meet.google.com/qpa-nxkm-rvw');
            expect(res.body.data.provider).toBe('google_meet');
            expect(mockEventsInsert).toHaveBeenCalled();
        });

        it('should reject quick meeting when Google OAuth is not connected without returning dummy URL', async () => {
            mocks.calendarOAuthFindOne.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/v1/company/calendar/quick-meeting')
                .send({
                    title: 'Instant Sync Disconnected',
                    provider: 'google_meet',
                    durationMinutes: 30,
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Google Calendar & Meet is not connected');
        });

        it('should reject quick meeting when Google Calendar API fails to create conference', async () => {
            mockEventsInsert.mockRejectedValueOnce(new Error('Rate limit exceeded or conference permission denied'));

            const res = await request(app)
                .post('/api/v1/company/calendar/quick-meeting')
                .send({
                    title: 'Instant Sync Failing API',
                    provider: 'google_meet',
                    durationMinutes: 30,
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Failed to create Google Meet conference');
        });

        it('should poll and resolve pending conference status to genuine URL', async () => {
            // First call (insert) returns pending
            mockEventsInsert.mockResolvedValueOnce({
                data: {
                    id: 'pending_event_99',
                    conferenceData: {
                        createRequest: {
                            status: { statusCode: 'pending' },
                        },
                    },
                },
            });

            // Polling call (get) returns success with genuine URL
            mockEventsGet.mockResolvedValueOnce({
                data: {
                    id: 'pending_event_99',
                    conferenceData: {
                        createRequest: {
                            status: { statusCode: 'success' },
                        },
                        conferenceId: 'pol-ledr-oom',
                        entryPoints: [
                            {
                                entryPointType: 'video',
                                uri: 'https://meet.google.com/pol-ledr-oom',
                            },
                        ],
                    },
                },
            });

            mocks.calendarEventCreate.mockResolvedValue({
                ...mockEventDoc,
                title: 'Pending Sync',
                meetingUrl: 'https://meet.google.com/pol-ledr-oom',
            });

            const res = await request(app)
                .post('/api/v1/company/calendar/quick-meeting')
                .send({
                    title: 'Pending Sync',
                    provider: 'google_meet',
                    durationMinutes: 30,
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.meetingUrl).toBe('https://meet.google.com/pol-ledr-oom');
            expect(mockEventsGet).toHaveBeenCalled();
        });

        it('should reject quick meeting when Google conference creation status is failure', async () => {
            mockEventsInsert.mockResolvedValueOnce({
                data: {
                    id: 'failed_event_99',
                    conferenceData: {
                        createRequest: {
                            status: {
                                statusCode: 'failure',
                                error: { code: 'PERMISSION_DENIED' },
                            },
                        },
                    },
                },
            });

            const res = await request(app)
                .post('/api/v1/company/calendar/quick-meeting')
                .send({
                    title: 'Failing Conference',
                    provider: 'google_meet',
                    durationMinutes: 30,
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Google Meet conference creation failed');
        });

        it('should repair legacy invalid meeting record on POST /events/:id/conference', async () => {
            const legacyEventDoc = {
                ...mockEventDoc,
                meetingUrl: 'https://meet.google.com/dmi-raco-qhj', // Legacy fake URL
                externalEventId: 'dmi-raco-qhj', // Fake ID matching meet code
                save: vi.fn().mockResolvedValue(true),
            };

            mocks.calendarEventFindOne.mockResolvedValue(legacyEventDoc);

            const res = await request(app)
                .post('/api/v1/company/calendar/events/' + EVENT_ID + '/conference');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.meetingUrl).toBe('https://meet.google.com/qpa-nxkm-rvw');
            expect(legacyEventDoc.save).toHaveBeenCalled();
        });

        it('should handle concurrent quick meeting creation requests safely', async () => {
            mocks.calendarEventCreate.mockImplementation(async (doc: any) => ({
                ...mockEventDoc,
                ...doc,
                _id: new Types.ObjectId(),
            }));

            const [res1, res2] = await Promise.all([
                request(app)
                    .post('/api/v1/company/calendar/quick-meeting')
                    .send({
                        title: 'Concurrent Meeting 1',
                        provider: 'google_meet',
                        durationMinutes: 15,
                    }),
                request(app)
                    .post('/api/v1/company/calendar/quick-meeting')
                    .send({
                        title: 'Concurrent Meeting 2',
                        provider: 'google_meet',
                        durationMinutes: 30,
                    }),
            ]);

            expect(res1.status).toBe(201);
            expect(res2.status).toBe(201);
            expect(res1.body.data.meetingUrl).toBeDefined();
            expect(res2.body.data.meetingUrl).toBeDefined();
        });
    });

    // ── 2.8 OAuth Status & Connect Endpoints ─────────────────────────────────
    describe('OAuth Endpoints', () => {
        it('should return integration status via GET /oauth/status', async () => {
            mocks.calendarOAuthFind.mockResolvedValue([
                {
                    provider: 'google',
                    isConnected: true,
                    accountEmail: 'organizer@worksphere.com',
                    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
                },
                {
                    provider: 'microsoft',
                    isConnected: false,
                    accountEmail: null,
                },
            ]);

            const res = await request(app).get('/api/v1/company/calendar/oauth/status');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.googleConnected).toBe(true);
            expect(res.body.data.googleEmail).toBe('organizer@worksphere.com');
            expect(res.body.data.msConnected).toBe(false);
        });

        it('should connect oauth provider via POST /oauth/:provider/connect', async () => {
            mocks.calendarOAuthFindOneAndUpdate.mockResolvedValue({
                provider: 'google',
                isConnected: true,
                accountEmail: 'admin@worksphere.com',
            });

            const uniqueCode = 'fresh_auth_code_' + Date.now();
            const res = await request(app)
                .post('/api/v1/company/calendar/oauth/google/connect')
                .send({
                    code: uniqueCode,
                    redirectUri: 'https://app.worksphere.com/oauth/callback',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Integration connected successfully');
            expect(res.body.data.isConnected).toBe(true);
        });

        it('should reject duplicate code exchange on POST /oauth/:provider/connect', async () => {
            const reusableCode = 'reused_code_' + Date.now();
            mocks.calendarOAuthFindOneAndUpdate.mockResolvedValue({
                provider: 'google',
                isConnected: true,
                accountEmail: 'admin@worksphere.com',
            });

            // First submission succeeds
            const firstRes = await request(app)
                .post('/api/v1/company/calendar/oauth/google/connect')
                .send({
                    code: reusableCode,
                    redirectUri: 'https://app.worksphere.com/oauth/callback',
                });
            expect(firstRes.status).toBe(200);

            // Second submission of the same code must be rejected
            const secondRes = await request(app)
                .post('/api/v1/company/calendar/oauth/google/connect')
                .send({
                    code: reusableCode,
                    redirectUri: 'https://app.worksphere.com/oauth/callback',
                });
            expect(secondRes.status).toBe(400);
            expect(secondRes.body.success).toBe(false);
            expect(secondRes.body.message).toContain('OAuth authorization code has already been exchanged');
        });

        it('should reject OAuth connect when code or redirectUri is missing', async () => {
            const res = await request(app)
                .post('/api/v1/company/calendar/oauth/google/connect')
                .send({
                    // Missing code and redirectUri
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('Validation Error');
        });

        it('should disconnect oauth provider via DELETE /oauth/:provider/disconnect', async () => {
            mocks.calendarOAuthFindOneAndUpdate.mockResolvedValue({
                provider: 'google',
                isConnected: false,
            });

            const res = await request(app)
                .delete('/api/v1/company/calendar/oauth/google/disconnect');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Integration disconnected successfully');
        });

        it('should get company oauth configuration via GET /oauth/:provider/config', async () => {
            mocks.companyCalendarConfigFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    clientId: 'company-specific-client-id.apps.googleusercontent.com',
                    clientSecretEncrypted: encrypt('company-specific-secret'),
                    redirectUri: 'https://company.worksphere.com/oauth/callback',
                }),
            });

            const res = await request(app).get('/api/v1/company/calendar/oauth/google/config');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.clientId).toBe('company-specific-client-id.apps.googleusercontent.com');
            expect(res.body.data.isConfigured).toBe(true);
            expect(res.body.data.hasClientSecret).toBe(true);
            expect(res.body.data.clientSecret).toBeUndefined();
        });

        it('should save company oauth credentials via POST /oauth/:provider/config', async () => {
            const res = await request(app)
                .post('/api/v1/company/calendar/oauth/google/config')
                .send({
                    clientId: 'new-client-id.apps.googleusercontent.com',
                    clientSecret: 'new-client-secret-xyz',
                    redirectUri: 'https://company.worksphere.com/oauth/callback',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.clientId).toBe('new-client-id.apps.googleusercontent.com');
            expect(mocks.companyCalendarConfigFindOneAndUpdate).toHaveBeenCalled();
        });

        it('should accept clientId and clientSecret when connecting oauth', async () => {
            mocks.calendarOAuthFindOneAndUpdate.mockResolvedValue({
                provider: 'google',
                isConnected: true,
                accountEmail: 'admin@worksphere.com',
            });

            const res = await request(app)
                .post('/api/v1/company/calendar/oauth/google/connect')
                .send({
                    code: 'auth_code_with_creds_' + Date.now(),
                    redirectUri: 'https://company.worksphere.com/oauth/callback',
                    clientId: 'inline-client-id.apps.googleusercontent.com',
                    clientSecret: 'inline-client-secret-abc',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mocks.companyCalendarConfigFindOneAndUpdate).toHaveBeenCalled();
        });
    });

    // ── 2.9 Calendar Entitlements & Plan Limits ──────────────────────────────
    describe('Calendar Entitlements & Plan Limits (GET /api/v1/company/calendar/entitlements)', () => {
        it('should return provider entitlements and monthly quick meeting usage for Monthly plan', async () => {
            mocks.calendarEventCountDocuments.mockResolvedValue(3);
            mocks.entitlementHasFeature.mockImplementation(async (_companyId, featureKey) => {
                return featureKey === 'GOOGLE_MEET'; // Only Google Meet enabled, Teams disabled
            });
            mocks.entitlementGetQuickMeetingLimits.mockResolvedValue({
                enabled: true,
                monthlyLimit: 7,
                isUnlimited: false,
                billingCycle: 'MONTHLY',
                planName: 'Starter Monthly',
            });

            const res = await request(app).get('/api/v1/company/calendar/entitlements');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.providers.google_meet.enabled).toBe(true);
            expect(res.body.data.providers.ms_teams.enabled).toBe(false);
            expect(res.body.data.quickMeetings.monthlyLimit).toBe(7);
            expect(res.body.data.quickMeetings.usedThisMonth).toBe(3);
            expect(res.body.data.quickMeetings.remainingThisMonth).toBe(4);
            expect(res.body.data.quickMeetings.isUnlimited).toBe(false);
            expect(res.body.data.quickMeetings.billingCycle).toBe('MONTHLY');
        });

        it('should return 60 limit for Semi-Annual plan', async () => {
            mocks.calendarEventCountDocuments.mockResolvedValue(10);
            mocks.entitlementGetQuickMeetingLimits.mockResolvedValue({
                enabled: true,
                monthlyLimit: 60,
                isUnlimited: false,
                billingCycle: 'SEMI_ANNUAL',
                planName: 'Growth Semi-Annual',
            });

            const res = await request(app).get('/api/v1/company/calendar/entitlements');

            expect(res.status).toBe(200);
            expect(res.body.data.quickMeetings.monthlyLimit).toBe(60);
            expect(res.body.data.quickMeetings.usedThisMonth).toBe(10);
            expect(res.body.data.quickMeetings.remainingThisMonth).toBe(50);
            expect(res.body.data.quickMeetings.billingCycle).toBe('SEMI_ANNUAL');
        });

        it('should return unlimited (-1) for Yearly plan', async () => {
            mocks.calendarEventCountDocuments.mockResolvedValue(85);
            mocks.entitlementGetQuickMeetingLimits.mockResolvedValue({
                enabled: true,
                monthlyLimit: -1,
                isUnlimited: true,
                billingCycle: 'YEARLY',
                planName: 'Enterprise Annual',
            });

            const res = await request(app).get('/api/v1/company/calendar/entitlements');

            expect(res.status).toBe(200);
            expect(res.body.data.quickMeetings.isUnlimited).toBe(true);
            expect(res.body.data.quickMeetings.monthlyLimit).toBe(-1);
            expect(res.body.data.quickMeetings.remainingThisMonth).toBe(-1);
            expect(res.body.data.quickMeetings.usedThisMonth).toBe(85);
        });
    });

    // ── 2.10 Provider Feature Gating ─────────────────────────────────────────
    describe('Provider Feature Gating in Events', () => {
        it('should reject scheduling event with google_meet if GOOGLE_MEET is not enabled in plan', async () => {
            mocks.entitlementHasFeature.mockResolvedValue(false); // No entitlement

            const res = await request(app)
                .post('/api/v1/company/calendar/events')
                .send({
                    title: 'Google Meet Without Plan',
                    startTime: futureStart,
                    endTime: futureEnd,
                    provider: 'google_meet',
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('FEATURE_NOT_INCLUDED_IN_PLAN');
            expect(res.body.details).toContain('Google Meet');
        });

        it('should reject scheduling event with ms_teams if MS_TEAMS is not enabled in plan', async () => {
            mocks.entitlementHasFeature.mockImplementation(async (_companyId, featureKey) => {
                return featureKey === 'GOOGLE_MEET'; // Teams is disabled
            });

            const res = await request(app)
                .post('/api/v1/company/calendar/events')
                .send({
                    title: 'Teams Meeting Without Plan',
                    startTime: futureStart,
                    endTime: futureEnd,
                    provider: 'ms_teams',
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('FEATURE_NOT_INCLUDED_IN_PLAN');
            expect(res.body.details).toContain('Microsoft Teams');
        });
    });

    // ── 2.11 Quick Meeting Quota & Provider Gating ───────────────────────────
    describe('Quick Meeting Quota & Provider Gating', () => {
        it('should reject quick meeting if monthly quota (7) is exhausted', async () => {
            mocks.calendarEventCountDocuments.mockResolvedValue(7);
            mocks.entitlementGetQuickMeetingLimits.mockResolvedValue({
                enabled: true,
                monthlyLimit: 7,
                isUnlimited: false,
                billingCycle: 'MONTHLY',
                planName: 'Starter Monthly',
            });

            const res = await request(app)
                .post('/api/v1/company/calendar/quick-meeting')
                .send({
                    title: '8th Quick Meeting Attempt',
                    provider: 'google_meet',
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('QUICK_MEETING_LIMIT_REACHED');
            expect(res.body.details).toContain('monthly limit of 7');
        });

        it('should reject quick meeting if provider is not included in company plan', async () => {
            mocks.entitlementHasFeature.mockResolvedValue(false);

            const res = await request(app)
                .post('/api/v1/company/calendar/quick-meeting')
                .send({
                    title: 'Instant Sync',
                    provider: 'google_meet',
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('FEATURE_NOT_INCLUDED_IN_PLAN');
        });

        it('should permit unlimited quick meetings on Yearly plan', async () => {
            mocks.calendarEventCountDocuments.mockResolvedValue(100);
            mocks.entitlementGetQuickMeetingLimits.mockResolvedValue({
                enabled: true,
                monthlyLimit: -1,
                isUnlimited: true,
                billingCycle: 'YEARLY',
                planName: 'Enterprise Annual',
            });
            mocks.calendarEventCreate.mockResolvedValue({
                ...mockEventDoc,
                isQuickMeeting: true,
            });

            const res = await request(app)
                .post('/api/v1/company/calendar/quick-meeting')
                .send({
                    title: '101st Quick Meeting',
                    provider: 'google_meet',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Quick meeting room created');
        });

        it('should create quick meeting with multiple invited participants initializing statuses to pending', async () => {
            mocks.entitlementGetQuickMeetingLimits.mockResolvedValue({
                enabled: true,
                monthlyLimit: 100,
                isUnlimited: true,
                billingCycle: 'YEARLY',
                planName: 'Enterprise Annual',
            });

            mocks.userFind.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([
                        { _id: new Types.ObjectId(PARTICIPANT_ID_1), name: 'Raju Sharma', email: 'raju@worksphere.com' },
                        { _id: new Types.ObjectId('64d0a1b2c3d4e5f6a7b8c9d3'), name: 'Jane Smith', email: 'jane@worksphere.com' },
                        { _id: new Types.ObjectId('64d0a1b2c3d4e5f6a7b8c9d4'), name: 'Bob Wilson', email: 'bob@worksphere.com' },
                    ]),
                }),
            });

            let createdPayload: any;
            mocks.calendarEventCreate.mockImplementation(async (payload) => {
                createdPayload = payload;
                return {
                    ...mockEventDoc,
                    ...payload,
                    _id: new Types.ObjectId(),
                };
            });

            const res = await request(app)
                .post('/api/v1/company/calendar/quick-meeting')
                .send({
                    title: 'Multi-Participant Quick Sync',
                    provider: 'google_meet',
                    participantIds: [
                        PARTICIPANT_ID_1,
                        '64d0a1b2c3d4e5f6a7b8c9d3',
                        '64d0a1b2c3d4e5f6a7b8c9d4',
                    ],
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(createdPayload).toBeDefined();

            // Verify organizer has 'organizer' status
            expect(createdPayload.participants[0].status).toBe('organizer');

            // Verify all invitees have 'pending' status (not 'invited')
            expect(createdPayload.participants[1].status).toBe('pending');
            expect(createdPayload.participants[2].status).toBe('pending');
            expect(createdPayload.participants[3].status).toBe('pending');
        });

        it('should handle Mongoose validation error on quick meeting persistence with HTTP 400', async () => {
            mocks.entitlementGetQuickMeetingLimits.mockResolvedValue({
                enabled: true,
                monthlyLimit: 100,
                isUnlimited: true,
                billingCycle: 'YEARLY',
                planName: 'Enterprise Annual',
            });

            const validationErr: any = new Error("Validation Error: participants.1.status: 'invalid' is not a valid enum value for path 'status'");
            validationErr.name = 'ValidationError';
            validationErr.errors = {
                'participants.1.status': { message: "'invalid' is not a valid enum value for path 'status'" },
            };
            mocks.calendarEventCreate.mockRejectedValue(validationErr);

            const res = await request(app)
                .post('/api/v1/company/calendar/quick-meeting')
                .send({
                    title: 'Failing Meeting',
                    provider: 'google_meet',
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Calendar event validation failed');
        });
    });
});
