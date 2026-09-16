import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { app } from '../src/app';

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

        mocks.calendarOAuthFind.mockResolvedValue([]);
        mocks.calendarOAuthFindOne.mockResolvedValue(null);
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
        it('should generate quick meeting room instantly', async () => {
            mocks.calendarEventCreate.mockResolvedValue({
                ...mockEventDoc,
                title: 'Instant Sync with Manohar',
                meetingUrl: 'https://meet.google.com/xyz-uvwx-rst',
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
            expect(res.body.data.meetingUrl).toBeDefined();
            expect(res.body.data.provider).toBe('google_meet');
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

            const res = await request(app)
                .post('/api/v1/company/calendar/oauth/google/connect')
                .send({
                    code: '4/0AeanS0...',
                    redirectUri: 'https://app.worksphere.com/oauth/callback',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Integration connected successfully');
            expect(res.body.data.isConnected).toBe(true);
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
    });
});
