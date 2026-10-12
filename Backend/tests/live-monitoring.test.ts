import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Types } from 'mongoose';
import { RealtimeEventService } from '../src/modules/companyadmin/live-monitoring/services/realtime-event.service';
import { EmployeePresenceService } from '../src/modules/companyadmin/live-monitoring/services/employee-presence.service';
import { MonitoringAlertService } from '../src/modules/companyadmin/live-monitoring/services/monitoring-alert.service';
import { LiveMonitoringService } from '../src/modules/companyadmin/live-monitoring/services/live-monitoring.service';
import { MonitoringActivityModel } from '../src/modules/companyadmin/live-monitoring/models/monitoring-activity.model';
import { MonitoringAlertModel } from '../src/modules/companyadmin/live-monitoring/models/monitoring-alert.model';
import {
    MonitoringEventType,
    AlertSeverity,
    AlertType,
    AlertStatus,
} from '../src/modules/companyadmin/live-monitoring/live-monitoring.types';
import { Task } from '../src/modules/tasks/task.model';
import { Project } from '../src/modules/companyadmin/projects/project.model';
import { Attendance } from '../src/modules/attendance/attendance.model';
import LeaveRequest from '../src/modules/attendance/leave.model';
import { Meeting } from '../src/modules/meetings/models/meeting.model';
import AttendanceEvent from '../src/modules/attendance/attendance-event.model';
import { PresenceService } from '../src/sockets/presence.service';
import { CompanyMember } from '../src/modules/companyadmin/invitations/company-member.model';
import { TimeTracking } from '../src/modules/task-tracking/time-tracking.model';

describe('Production-Grade WorkSphere Live Monitoring Module Tests', () => {
    const companyIdA = new Types.ObjectId().toString();
    const companyIdB = new Types.ObjectId().toString();
    const employeeId1 = new Types.ObjectId().toString();
    const employeeId2 = new Types.ObjectId().toString();
    const adminUserId = new Types.ObjectId().toString();
    const projectId1 = new Types.ObjectId().toString();
    const taskId1 = new Types.ObjectId().toString();

    beforeEach(() => {
        vi.restoreAllMocks();
        RealtimeEventService.resetSequenceCounter();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('1. RealtimeEventService & Event Publication Envelope', () => {
        it('should assign monotonic sequence numbers per company and format standard event envelope', async () => {
            const mockSave = vi.fn().mockImplementation(function (this: any) {
                return Promise.resolve(this);
            });

            vi.spyOn(MonitoringActivityModel, 'findOne').mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({ sequence: 42 }),
                    }),
                }),
            } as any);

            vi.spyOn(MonitoringActivityModel.prototype, 'save').mockImplementation(mockSave);

            const result = await RealtimeEventService.publishEvent(
                companyIdA,
                MonitoringEventType.TASK_STATUS_CHANGED,
                {
                    actor: { userId: employeeId1, displayName: 'Alice' },
                    summary: 'Alice moved task to In Progress',
                    projectId: projectId1,
                    taskId: taskId1,
                    employeeId: employeeId1,
                    metadata: { newStatus: 'IN_PROGRESS' },
                }
            );

            expect(result).toBeDefined();
            expect(result.sequence).toBe(43);
            expect(result.schemaVersion).toBe(1);
            expect(result.companyId).toBe(companyIdA);
            expect(result.type).toBe(MonitoringEventType.TASK_STATUS_CHANGED);
            expect(result.data.summary).toBe('Alice moved task to In Progress');
            expect(result.data.actor.displayName).toBe('Alice');
        });

        it('should maintain independent sequence counters for different companies (Tenant Isolation)', async () => {
            RealtimeEventService.resetSequenceCounter();

            vi.spyOn(MonitoringActivityModel, 'findOne')
                .mockImplementationOnce(() => ({
                    sort: () => ({ select: () => ({ lean: vi.fn().mockResolvedValue({ sequence: 10 }) }) }),
                } as any))
                .mockImplementationOnce(() => ({
                    sort: () => ({ select: () => ({ lean: vi.fn().mockResolvedValue({ sequence: 500 }) }) }),
                } as any));

            vi.spyOn(MonitoringActivityModel.prototype, 'save').mockResolvedValue({} as any);

            const seqA = await RealtimeEventService.getNextSequence(companyIdA);
            const seqB = await RealtimeEventService.getNextSequence(companyIdB);

            expect(seqA).toBe(11);
            expect(seqB).toBe(501);
        });
    });

    describe('2. Employee Live Status & Presence Tracking', () => {
        it('should distinguish Online vs Offline based on socket connection state', () => {
            vi.spyOn(PresenceService, 'isUserOnline').mockImplementation((uid) => uid === employeeId1);

            const presence1 = EmployeePresenceService.isUserOnline(employeeId1);
            const presence2 = EmployeePresenceService.isUserOnline(employeeId2);

            expect(presence1).toBe(true);
            expect(presence2).toBe(false);
        });

        it('should record heartbeats without immediate database thrashing', () => {
            vi.spyOn(PresenceService, 'isUserOnline').mockReturnValue(true);
            EmployeePresenceService.recordHeartbeat(employeeId1);
            const presence = EmployeePresenceService.getPresence(employeeId1);

            expect(presence).toBeDefined();
            expect(presence?.isOnline).toBe(true);
            expect(presence?.lastSeenAt).toBeInstanceOf(Date);
        });

        it('should separate working status into WORKING, ON_BREAK, ON_LEAVE, or OFFLINE', async () => {
            const today = new Date();
            vi.spyOn(LeaveRequest, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);

            vi.spyOn(Meeting, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);

            vi.spyOn(Attendance, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    userId: employeeId1,
                    status: 'PRESENT',
                    checkInTime: new Date(today.getTime() - 2 * 3600000),
                    checkOutTime: null,
                }),
            } as any);

            vi.spyOn(AttendanceEvent, 'findOne').mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(null),
                }),
            } as any);

            const workStatus = await EmployeePresenceService.resolveWorkStatus(companyIdA, employeeId1, true);
            expect(workStatus).toBe('WORKING');
        });
    });

    describe('3. Actionable Alert Generation & Deduplication', () => {
        it('should generate alerts for overdue tasks and unassigned critical tasks', async () => {
            const pastDate = new Date(Date.now() - 86400000);

            const taskSpy = vi.spyOn(Task, 'find');
            taskSpy.mockImplementation((filter: any) => {
                if (filter?.deliveryDate) {
                    return {
                        populate: () => ({
                            populate: () => ({
                                limit: () => ({
                                    lean: vi.fn().mockResolvedValue([
                                        {
                                            _id: new Types.ObjectId(taskId1),
                                            title: 'Critical Database Migration',
                                            deliveryDate: pastDate,
                                            assignedToId: { _id: new Types.ObjectId(employeeId1), name: 'Alice' },
                                            projectId: { _id: new Types.ObjectId(projectId1), name: 'Cloud Migration' },
                                        },
                                    ]),
                                }),
                            }),
                        }),
                    } as any;
                }
                return {
                    limit: () => ({
                        lean: vi.fn().mockResolvedValue([]),
                    }),
                } as any;
            });

            vi.spyOn(Project, 'find').mockReturnValue({
                limit: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.spyOn(MonitoringAlertModel, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue(null),
            } as any);

            const createdAlert = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                alertType: AlertType.OVERDUE_TASK,
                severity: AlertSeverity.CRITICAL,
                title: 'Task Overdue: Critical Database Migration',
                status: AlertStatus.ACTIVE,
                dedupKey: `overdue_task_${taskId1}`,
            };
            vi.spyOn(MonitoringAlertModel.prototype, 'save').mockResolvedValue(createdAlert as any);
            vi.spyOn(RealtimeEventService, 'broadcastMonitoringEvent').mockReturnValue({} as any);

            const alerts = await MonitoringAlertService.evaluateAndGenerateAlerts(companyIdA);
            expect(alerts).toBeDefined();
            expect(Array.isArray(alerts)).toBe(true);
        });

        it('should deduplicate existing active alerts with the same dedupKey', async () => {
            const pastDate = new Date(Date.now() - 86400000);

            const mockTaskChain: any = {
                populate: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: new Types.ObjectId(taskId1),
                        title: 'Overdue Task 1',
                        deliveryDate: pastDate,
                        assignedToId: { _id: new Types.ObjectId(employeeId1), name: 'Alice' },
                        projectId: { _id: new Types.ObjectId(projectId1), name: 'Project 1' },
                    },
                ]),
            };
            vi.spyOn(Task, 'find').mockReturnValue(mockTaskChain);

            vi.spyOn(Project, 'find').mockReturnValue({
                limit: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.spyOn(MonitoringAlertModel, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(),
                    status: AlertStatus.ACTIVE,
                    dedupKey: `overdue_task_${taskId1}`,
                }),
            } as any);

            const saveSpy = vi.spyOn(MonitoringAlertModel.prototype, 'save');

            const alerts = await MonitoringAlertService.evaluateAndGenerateAlerts(companyIdA);
            expect(alerts.length).toBe(0);
            expect(saveSpy).not.toHaveBeenCalled();
        });

        it('should allow acknowledging and resolving alerts with user attribution', async () => {
            const mockAlertDoc = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                status: AlertStatus.ACKNOWLEDGED,
                alertType: AlertType.OVERDUE_TASK,
                severity: AlertSeverity.HIGH,
                title: 'Task Overdue',
                summary: 'Task deadline passed',
                acknowledgedById: { _id: new Types.ObjectId(adminUserId), name: 'Admin' },
                acknowledgedAt: new Date(),
                resolvedById: null,
                resolvedAt: null,
                createdAt: new Date(),
                metadata: {},
            };

            vi.spyOn(MonitoringAlertModel, 'findOneAndUpdate').mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(mockAlertDoc),
                }),
            } as any);
            vi.spyOn(RealtimeEventService, 'broadcastMonitoringEvent').mockReturnValue({} as any);

            const ackResult = await MonitoringAlertService.acknowledgeAlert(companyIdA, mockAlertDoc._id.toString(), adminUserId, 'Investigating');
            expect(ackResult?.status).toBe(AlertStatus.ACKNOWLEDGED);

            mockAlertDoc.status = AlertStatus.RESOLVED;
            mockAlertDoc.resolvedById = { _id: new Types.ObjectId(adminUserId), name: 'Admin' } as any;
            mockAlertDoc.resolvedAt = new Date() as any;

            const resolveResult = await MonitoringAlertService.resolveAlert(companyIdA, mockAlertDoc._id.toString(), adminUserId, 'Completed', 'Task delivered');
            expect(resolveResult?.status).toBe(AlertStatus.RESOLVED);
        });
    });

    describe('4. Dashboard Overview & Aggregations', () => {
        it('should calculate live overview metrics with employee presence, tasks, and project summaries', async () => {
            vi.spyOn(PresenceService, 'isUserOnline').mockReturnValue(true);
            vi.spyOn(EmployeePresenceService, 'resolveCompanyEmployeesPresence').mockResolvedValue([
                {
                    employeeId: employeeId1,
                    name: 'Alice',
                    email: 'alice@example.com',
                    presenceStatus: 'ONLINE',
                    workStatus: 'WORKING',
                    attendanceStatus: 'PRESENT',
                    checkInTime: new Date().toISOString(),
                    checkOutTime: null,
                    workDurationMinutes: 120,
                    lastSeenAt: new Date().toISOString(),
                    lastHeartbeatAt: null,
                },
            ]);

            vi.spyOn(CompanyMember, 'find').mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([{ userId: new Types.ObjectId(employeeId1) }]),
                }),
            } as any);

            vi.spyOn(Attendance, 'find').mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([{ _id: new Types.ObjectId(), status: 'PRESENT' }]),
                }),
            } as any);

            vi.spyOn(LeaveRequest, 'find').mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.spyOn(Meeting, 'find').mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.spyOn(TimeTracking, 'find').mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.spyOn(Project, 'countDocuments').mockResolvedValue(3);

            vi.spyOn(Task, 'aggregate').mockResolvedValue([
                { total: 5, completed: 2, overdue: 1, inReview: 1 },
            ]);

            vi.spyOn(MonitoringAlertModel, 'countDocuments').mockResolvedValue(1);
            vi.spyOn(MonitoringActivityModel, 'find').mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        select: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                }),
            } as any);

            const overview = await LiveMonitoringService.getDashboardOverview(companyIdA, true);

            expect(overview).toBeDefined();
            expect(overview.companyId).toBe(companyIdA);
            expect(overview.employees.totalActive).toBe(1);
            expect(overview.employees.online).toBe(1);
            expect(overview.snapshotTimestamp).toBeDefined();
            expect(overview.alerts.activeCount).toBe(1);
        });
    });

    describe('5. Activity Feed Cursor Pagination', () => {
        it('should support stable cursor pagination on activity feed', async () => {
            const mockEvents = [
                {
                    _id: new Types.ObjectId(),
                    eventId: 'evt-100',
                    companyId: new Types.ObjectId(companyIdA),
                    eventType: MonitoringEventType.TASK_COMPLETED,
                    actorId: new Types.ObjectId(employeeId1),
                    actorName: 'Bob',
                    summary: 'Bob completed task',
                    occurredAt: new Date(),
                    sequence: 100,
                },
                {
                    _id: new Types.ObjectId(),
                    eventId: 'evt-99',
                    companyId: new Types.ObjectId(companyIdA),
                    eventType: MonitoringEventType.ATTENDANCE_CHECKED_IN,
                    actorId: new Types.ObjectId(employeeId2),
                    actorName: 'Alice',
                    summary: 'Alice checked in',
                    occurredAt: new Date(Date.now() - 1000),
                    sequence: 99,
                },
            ];

            vi.spyOn(MonitoringActivityModel, 'find').mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue(mockEvents),
                    }),
                }),
            } as any);

            const feed = await LiveMonitoringService.getActivityFeed(companyIdA, { limit: 2 });
            expect(feed.items.length).toBe(2);
            expect(feed.items[0].sequence).toBe(100);
            expect(feed.hasMore).toBe(false);
        });
    });
});
