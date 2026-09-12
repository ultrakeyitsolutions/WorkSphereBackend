import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { ChatService } from '../src/modules/chat/chat.service';
import { FileService } from '../src/modules/files/file.service';
import { CallService } from '../src/modules/calls/call.service';
import { PresenceService } from '../src/sockets/presence.service';
import { ProjectService } from '../src/modules/companyadmin/projects/project.service';
import { Conversation } from '../src/modules/chat/conversation.model';
import { ConversationParticipant } from '../src/modules/chat/participant.model';
import { Message } from '../src/modules/chat/message.model';
import { FileModel } from '../src/modules/files/file.model';
import { Call } from '../src/modules/calls/call.model';
import { Project } from '../src/modules/companyadmin/projects/project.model';
import { User } from '../src/modules/users/user.model';

// Mock Models
vi.mock('../src/modules/companyadmin/projects/project.model', () => {
    return {
        Project: {
            findOne: vi.fn(),
            findById: vi.fn(),
        },
        ProjectTeamMember: {
            find: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([]),
                }),
            }),
            exists: vi.fn(),
        },
        ProjectInCharge: {
            find: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([]),
                }),
            }),
            exists: vi.fn(),
        },
        ProjectMember: {
            find: vi.fn(),
            exists: vi.fn(),
        },
    };
});

vi.mock('../src/modules/users/user.model', () => {
    return {
        User: {
            findOne: vi.fn(),
            findById: vi.fn(),
        },
    };
});

vi.mock('../src/modules/chat/conversation.model', () => {
    return {
        Conversation: {
            findOne: vi.fn(),
            find: vi.fn(),
            findById: vi.fn(),
            create: vi.fn(),
        },
    };
});

vi.mock('../src/modules/chat/participant.model', () => {
    return {
        ConversationParticipant: {
            findOne: vi.fn(),
            find: vi.fn(),
            exists: vi.fn(),
            create: vi.fn(),
            updateOne: vi.fn(),
        },
    };
});

vi.mock('../src/modules/chat/message.model', () => {
    return {
        Message: {
            findOne: vi.fn(),
            find: vi.fn(),
            findById: vi.fn(),
            countDocuments: vi.fn(),
            updateMany: vi.fn(),
            create: vi.fn(),
        },
    };
});

vi.mock('../src/modules/files/file.model', () => {
    return {
        FileModel: {
            findOne: vi.fn(),
            findById: vi.fn(),
            create: vi.fn(),
        },
    };
});

vi.mock('../src/modules/calls/call.model', () => {
    return {
        Call: {
            findOne: vi.fn(),
            findById: vi.fn(),
            find: vi.fn(),
            create: vi.fn(),
        },
    };
});

describe('Chat, Global File Security & Calling System', () => {
    const mockCompanyId = new Types.ObjectId().toString();
    const mockProjectId = new Types.ObjectId().toString();
    const userA = new Types.ObjectId().toString();
    const userB = new Types.ObjectId().toString();
    const userC = new Types.ObjectId().toString();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('1. Project Members & Presence', () => {
        it('Allows authorized project members to be retrieved with online status', async () => {
            vi.spyOn(ProjectService, 'canAccessProject').mockResolvedValue(true);

            (Project.findOne as any).mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: mockProjectId,
                    companyId: mockCompanyId,
                    name: 'Alpha Project',
                    createdById: userA,
                }),
            });

            (User.findById as any).mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        _id: new Types.ObjectId(userA),
                        name: 'Alice Owner',
                        email: 'alice@example.com',
                        isActive: true,
                    }),
                }),
            });

            // Mark userA online in PresenceService
            PresenceService.addConnection(userA, 'socket_1');

            const members = await ChatService.getProjectMembers(mockProjectId, mockCompanyId, userA);
            expect(members.length).toBeGreaterThanOrEqual(1);
            expect(members[0].id).toBe(userA);
            expect(members[0].onlineStatus).toBe('ONLINE');

            // Cleanup
            PresenceService.removeConnection('socket_1');
        });

        it('Rejects project member retrieval if user has no access to project', async () => {
            (Project.findOne as any).mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: mockProjectId,
                    companyId: mockCompanyId,
                }),
            });

            vi.spyOn(ProjectService, 'canAccessProject').mockResolvedValue(false);

            await expect(
                ChatService.getProjectMembers(mockProjectId, mockCompanyId, userC)
            ).rejects.toThrow('FORBIDDEN_PROJECT_ACCESS');
        });
    });

    describe('2. Conversation Creation & Access Control', () => {
        it('Prevents starting a conversation with oneself', async () => {
            await expect(
                ChatService.getOrCreateConversation(mockProjectId, userA, {
                    userId: userA,
                    companyId: mockCompanyId,
                    role: 'EMPLOYEE',
                })
            ).rejects.toThrow('CANNOT_CHAT_WITH_SELF');
        });

        it('Creates conversation between two authorized members of the same project', async () => {
            (Project.findOne as any).mockResolvedValue({ _id: mockProjectId, companyId: mockCompanyId });
            vi.spyOn(ProjectService, 'canAccessProject').mockResolvedValue(true);
            (User.findOne as any).mockResolvedValue({ _id: userB, companyId: mockCompanyId, isActive: true });

            // No existing conversations
            (Conversation.find as any).mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([]),
                }),
            });

            const mockConvId = new Types.ObjectId();
            (Conversation.create as any).mockResolvedValue({
                _id: mockConvId,
                companyId: mockCompanyId,
                projectId: mockProjectId,
                type: 'PRIVATE',
            });

            (ConversationParticipant.create as any).mockResolvedValue([]);

            (Conversation.findById as any).mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            _id: mockConvId,
                            projectId: { name: 'Alpha Project' },
                            lastMessage: null,
                            lastMessageAt: new Date(),
                        }),
                    }),
                }),
            });

            (ConversationParticipant.findOne as any).mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        userId: { _id: userB, name: 'Bob', email: 'bob@example.com' },
                    }),
                }),
                lean: vi.fn().mockResolvedValue({ lastReadAt: new Date() }),
            });

            (Message.countDocuments as any).mockResolvedValue(0);

            const result = await ChatService.getOrCreateConversation(mockProjectId, userB, {
                userId: userA,
                companyId: mockCompanyId,
                role: 'EMPLOYEE',
            });

            expect(result).toBeDefined();
            expect(Conversation.create).toHaveBeenCalledTimes(1);
            expect(ConversationParticipant.create).toHaveBeenCalledTimes(1);
        });
    });

    describe('3. File Privacy & Cross-User Security', () => {
        it('CRITICAL PRIVACY: Employee C cannot access private chat attachment of Employee A & B', async () => {
            const mockFileId = new Types.ObjectId().toString();
            const mockConversationId = new Types.ObjectId().toString();

            (FileModel.findOne as any).mockResolvedValue({
                _id: mockFileId,
                companyId: new Types.ObjectId(mockCompanyId),
                uploadedBy: new Types.ObjectId(userA),
                contextType: 'CHAT',
                contextId: mockConversationId,
                deletedAt: null,
            });

            // Employee C is NOT a participant of this conversation
            (ConversationParticipant.exists as any).mockResolvedValue(false);

            await expect(
                FileService.getAuthorizedFile(mockFileId, {
                    userId: userC,
                    companyId: mockCompanyId,
                    role: 'EMPLOYEE',
                })
            ).rejects.toThrow('FORBIDDEN_CONVERSATION');
        });

        it('Employee A (authorized participant) can access their conversation attachment', async () => {
            const mockFileId = new Types.ObjectId().toString();
            const mockConversationId = new Types.ObjectId().toString();

            const mockFile = {
                _id: mockFileId,
                companyId: new Types.ObjectId(mockCompanyId),
                uploadedBy: new Types.ObjectId(userA),
                contextType: 'CHAT',
                contextId: mockConversationId,
                deletedAt: null,
            };
            (FileModel.findOne as any).mockResolvedValue(mockFile);

            // Employee A is a participant
            (ConversationParticipant.exists as any).mockResolvedValue(true);

            const file = await FileService.getAuthorizedFile(mockFileId, {
                userId: userA,
                companyId: mockCompanyId,
                role: 'EMPLOYEE',
            });

            expect(file).toBeDefined();
            expect(file._id).toBe(mockFileId);
        });
    });

    describe('4. Audio & Video Calling', () => {
        it('Initiates a call and sets status to RINGING if receiver is online', async () => {
            const mockConvId = new Types.ObjectId().toString();

            (Conversation.findOne as any).mockResolvedValue({
                _id: mockConvId,
                companyId: mockCompanyId,
                projectId: mockProjectId,
            });

            (ConversationParticipant.exists as any).mockResolvedValue(true);
            vi.spyOn(ProjectService, 'canAccessProject').mockResolvedValue(true);

            (ConversationParticipant.findOne as any).mockReturnValue({
                lean: vi.fn().mockResolvedValue({ userId: new Types.ObjectId(userB) }),
            });

            // User B is online
            PresenceService.addConnection(userB, 'socket_b_1');

            const mockCallId = new Types.ObjectId();
            (Call.create as any).mockResolvedValue({
                _id: mockCallId,
                status: 'RINGING',
            });

            (Call.findById as any).mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockResolvedValue({
                        _id: mockCallId,
                        callerId: { _id: userA, name: 'Alice' },
                        receiverId: { _id: userB, name: 'Bob' },
                        type: 'VIDEO',
                        status: 'RINGING',
                    }),
                }),
            });

            const call = await CallService.initiateCall(mockConvId, 'VIDEO', {
                userId: userA,
                companyId: mockCompanyId,
            });

            expect(call).toBeDefined();
            expect(call.status).toBe('RINGING');
            expect(Call.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'RINGING',
                    type: 'VIDEO',
                })
            );

            // Cleanup
            PresenceService.removeConnection('socket_b_1');
        });
    });
});
