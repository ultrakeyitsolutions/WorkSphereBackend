import { Types } from 'mongoose';
import { Conversation } from './conversation.model';
import { ConversationParticipant } from './participant.model';
import { Message } from './message.model';
import { Project, ProjectTeamMember, ProjectInCharge } from '../companyadmin/projects/project.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { User } from '../users/user.model';
import { PresenceService } from '../../sockets/presence.service';
import { StorageConfigurationService } from '../super-admin/storage/storage-config.service';

export class ChatService {
    /**
     * Check if a user is an active participant in a conversation.
     */
    static async isParticipant(conversationId: string, userId: string): Promise<boolean> {
        if (!Types.ObjectId.isValid(conversationId) || !Types.ObjectId.isValid(userId)) {
            return false;
        }
        const exists = await ConversationParticipant.exists({
            conversationId: new Types.ObjectId(conversationId),
            userId: new Types.ObjectId(userId),
        });
        return !!exists;
    }

    /**
     * Retrieve members of a project with company isolation and access verification.
     */
    static async getProjectMembers(projectId: string, companyId: string, currentUserId: string) {
        if (!Types.ObjectId.isValid(projectId)) {
            throw new Error('INVALID_PROJECT_ID');
        }

        const project = await Project.findOne({
            _id: projectId,
            companyId,
            deletedAt: null,
            isArchived: false,
        }).lean();

        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

        // Verify current user has access to this project
        const canAccess = await ProjectService.canAccessProject(companyId, currentUserId, projectId);
        if (!canAccess) {
            throw new Error('FORBIDDEN_PROJECT_ACCESS');
        }

        const [teamMembers, inCharges] = await Promise.all([
            ProjectTeamMember.find({ projectId }).populate('userId', 'name email avatar status isActive').lean(),
            ProjectInCharge.find({ projectId }).populate('userId', 'name email avatar status isActive').lean(),
        ]);

        const members: any[] = [];
        const seen = new Set<string>();

        const push = (user: any, role: string) => {
            if (!user || !user._id) return;
            const uid = user._id.toString();
            if (seen.has(uid)) return;
            seen.add(uid);
            members.push({
                _id: uid,
                id: uid,
                name: user.name || '',
                email: user.email || '',
                avatar: user.avatar || null,
                role,
                isActive: user.isActive ?? true,
                onlineStatus: PresenceService.isUserOnline(uid) ? 'ONLINE' : 'OFFLINE',
            });
        };

        for (const ic of inCharges) push((ic as any).userId, 'Manager');
        for (const tm of teamMembers) push((tm as any).userId, 'Member');

        // Include project creator if not already seen
        if (project.createdById) {
            const creatorUser = await User.findById(project.createdById).select('name email avatar status isActive').lean();
            if (creatorUser) push(creatorUser, 'Owner');
        }

        return members;
    }

    /**
     * Create or retrieve an existing private conversation between two users in a project.
     */
    static async getOrCreateConversation(
        projectId: string,
        participantId: string,
        authUser: { userId: string; companyId: string; role: string }
    ) {
        if (!Types.ObjectId.isValid(projectId) || !Types.ObjectId.isValid(participantId)) {
            throw new Error('INVALID_INPUT_IDS');
        }

        if (authUser.userId === participantId) {
            throw new Error('CANNOT_CHAT_WITH_SELF');
        }

        // 1. Verify project exists in user's company
        const project = await Project.findOne({
            _id: projectId,
            companyId: authUser.companyId,
            deletedAt: null,
            isArchived: false,
        });
        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

        // 2. Verify authenticated user has access to project
        const authUserCanAccess = await ProjectService.canAccessProject(
            authUser.companyId,
            authUser.userId,
            projectId
        );
        if (!authUserCanAccess) {
            throw new Error('FORBIDDEN_PROJECT_ACCESS');
        }

        // 3. Verify participant belongs to the same company and is active
        const targetUser = await User.findOne({
            _id: participantId,
            companyId: authUser.companyId,
            isActive: true,
        });
        if (!targetUser) {
            throw new Error('PARTICIPANT_NOT_FOUND');
        }

        // 4. Verify participant has access to the project
        const participantCanAccess = await ProjectService.canAccessProject(
            authUser.companyId,
            participantId,
            projectId
        );
        if (!participantCanAccess) {
            throw new Error('PARTICIPANT_NO_PROJECT_ACCESS');
        }

        // 5. Check for existing private conversation
        const existingConversations = await Conversation.find({
            companyId: authUser.companyId,
            projectId,
            type: 'PRIVATE',
        }).select('_id').lean();

        if (existingConversations.length > 0) {
            const convoIds = existingConversations.map((c) => c._id);

            const userAParticipants = await ConversationParticipant.find({
                conversationId: { $in: convoIds },
                userId: authUser.userId,
            }).select('conversationId').lean();

            const userAConvoIds = userAParticipants.map((p) => p.conversationId);

            const shared = await ConversationParticipant.findOne({
                conversationId: { $in: userAConvoIds },
                userId: participantId,
            }).lean();

            if (shared) {
                return this.formatConversation(shared.conversationId.toString(), authUser.userId);
            }
        }

        // 6. Create new private conversation
        const conversation = await Conversation.create({
            companyId: new Types.ObjectId(authUser.companyId),
            projectId: new Types.ObjectId(projectId),
            type: 'PRIVATE',
            lastMessageAt: new Date(),
        });

        // Add both participants
        await ConversationParticipant.create([
            {
                conversationId: conversation._id,
                userId: new Types.ObjectId(authUser.userId),
                joinedAt: new Date(),
                lastReadAt: new Date(),
            },
            {
                conversationId: conversation._id,
                userId: new Types.ObjectId(participantId),
                joinedAt: new Date(),
                lastReadAt: new Date(),
            },
        ]);

        return this.formatConversation(conversation._id.toString(), authUser.userId);
    }

    /**
     * Get all conversations for an authenticated user with other participant info, unread count & presence.
     */
    static async getUserConversations(
        authUser: { userId: string; companyId: string },
        projectId?: string
    ) {
        const participantRecords = await ConversationParticipant.find({
            userId: authUser.userId,
        }).select('conversationId lastReadAt').lean();

        if (participantRecords.length === 0) {
            return [];
        }

        const convoMap = new Map<string, Date>();
        participantRecords.forEach((p) => {
            convoMap.set(p.conversationId.toString(), p.lastReadAt);
        });

        const query: any = {
            _id: { $in: Array.from(convoMap.keys()).map((id) => new Types.ObjectId(id)) },
            companyId: authUser.companyId,
        };
        if (projectId && Types.ObjectId.isValid(projectId)) {
            query.projectId = new Types.ObjectId(projectId);
        }

        const conversations = await Conversation.find(query)
            .populate('projectId', 'name status type')
            .populate({
                path: 'lastMessage',
                populate: { path: 'fileId' },
            })
            .sort({ lastMessageAt: -1 })
            .lean();

        const formattedList = await Promise.all(
            conversations.map(async (conv) => {
                const convIdStr = conv._id.toString();
                const lastReadAt = convoMap.get(convIdStr) || new Date(0);

                // Find other participant
                const otherParticipantDoc = await ConversationParticipant.findOne({
                    conversationId: conv._id,
                    userId: { $ne: new Types.ObjectId(authUser.userId) },
                })
                    .populate('userId', 'name email avatar status isActive')
                    .lean();

                const otherUser = (otherParticipantDoc as any)?.userId;
                const otherUserId = otherUser?._id?.toString() || '';

                // Count unread messages
                const unreadCount = await Message.countDocuments({
                    conversationId: conv._id,
                    senderId: { $ne: new Types.ObjectId(authUser.userId) },
                    createdAt: { $gt: lastReadAt },
                    deletedAt: null,
                });

                return {
                    conversationId: conv._id,
                    project: conv.projectId,
                    otherParticipant: otherUser
                        ? {
                              _id: otherUserId,
                              name: otherUser.name,
                              email: otherUser.email,
                              avatar: otherUser.avatar,
                              isActive: otherUser.isActive,
                          }
                        : null,
                    lastMessage: conv.lastMessage,
                    lastMessageAt: conv.lastMessageAt,
                    unreadCount,
                    onlineStatus: PresenceService.isUserOnline(otherUserId) ? 'ONLINE' : 'OFFLINE',
                };
            })
        );

        return formattedList;
    }

    /**
     * Get paginated messages for a conversation.
     */
    static async getMessages(
        conversationId: string,
        authUser: { userId: string; companyId: string },
        limit = 50,
        cursor?: string
    ) {
        if (!Types.ObjectId.isValid(conversationId)) {
            throw new Error('INVALID_CONVERSATION_ID');
        }

        // Verify conversation belongs to user's company
        const conversation = await Conversation.findOne({
            _id: conversationId,
            companyId: authUser.companyId,
        });
        if (!conversation) {
            throw new Error('CONVERSATION_NOT_FOUND');
        }

        // Verify user is a participant
        const isParticipant = await ConversationParticipant.exists({
            conversationId,
            userId: authUser.userId,
        });
        if (!isParticipant) {
            throw new Error('FORBIDDEN_CONVERSATION_ACCESS');
        }

        const query: any = {
            conversationId: new Types.ObjectId(conversationId),
        };

        if (cursor) {
            // Cursor based on ISO date or message ID
            if (cursor.includes('-') || cursor.includes('T')) {
                query.createdAt = { $lt: new Date(cursor) };
            } else if (Types.ObjectId.isValid(cursor)) {
                const cursorMsg = await Message.findById(cursor).select('createdAt');
                if (cursorMsg) {
                    query.createdAt = { $lt: cursorMsg.createdAt };
                }
            }
        }

        const messages = await Message.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('senderId', 'name email avatar')
            .populate('fileId')
            .lean();

        // Update read receipt and participant's lastReadAt
        await Promise.all([
            ConversationParticipant.updateOne(
                { conversationId, userId: authUser.userId },
                { $set: { lastReadAt: new Date() } }
            ),
            Message.updateMany(
                {
                    conversationId,
                    senderId: { $ne: new Types.ObjectId(authUser.userId) },
                    readAt: null,
                },
                {
                    $set: { readAt: new Date(), deliveredAt: new Date() },
                }
            ),
        ]);

        const hasMore = messages.length === limit;
        const lastMsg: any = messages.length > 0 ? messages[messages.length - 1] : null;
        const nextCursor = hasMore && lastMsg && lastMsg.createdAt ? new Date(lastMsg.createdAt).toISOString() : null;

        // Sign media URLs for attached images, screen recordings, voice notes, and documents
        const formattedMessages = await Promise.all(
            messages.map(async (msg: any) => {
                if (msg.fileId && (msg.fileId.storageKey || msg.fileId.storageUrl)) {
                    const secureUrl = await StorageConfigurationService.signUrl(
                        msg.fileId.storageKey || msg.fileId.storageUrl
                    );
                    return {
                        ...msg,
                        fileId: {
                            ...msg.fileId,
                            storageUrl: secureUrl,
                        },
                    };
                }
                return msg;
            })
        );

        return {
            messages: formattedMessages.reverse(), // return in chronological order
            nextCursor,
        };
    }

    /**
     * Soft-delete a message.
     */
    static async deleteMessage(
        messageId: string,
        authUser: { userId: string; companyId: string }
    ) {
        if (!Types.ObjectId.isValid(messageId)) {
            throw new Error('INVALID_MESSAGE_ID');
        }

        const message = await Message.findById(messageId);
        if (!message || message.deletedAt) {
            throw new Error('MESSAGE_NOT_FOUND');
        }

        if (message.senderId.toString() !== authUser.userId) {
            throw new Error('FORBIDDEN_MESSAGE_DELETE');
        }

        // Verify conversation belongs to company
        const conversation = await Conversation.findOne({
            _id: message.conversationId,
            companyId: authUser.companyId,
        });
        if (!conversation) {
            throw new Error('FORBIDDEN_CONVERSATION_ACCESS');
        }

        message.deletedAt = new Date();
        await message.save();

        return message;
    }

    /**
     * Format conversation object with project, other participant, and unread info.
     */
    private static async formatConversation(conversationId: string, authUserId: string) {
        const conv = await Conversation.findById(conversationId)
            .populate('projectId', 'name status type')
            .populate('lastMessage')
            .lean();

        if (!conv) return null;

        const otherParticipantDoc = await ConversationParticipant.findOne({
            conversationId: conv._id,
            userId: { $ne: new Types.ObjectId(authUserId) },
        })
            .populate('userId', 'name email avatar status isActive')
            .lean();

        const otherUser = (otherParticipantDoc as any)?.userId;
        const otherUserId = otherUser?._id?.toString() || '';

        const myParticipant = await ConversationParticipant.findOne({
            conversationId: conv._id,
            userId: authUserId,
        }).lean();

        const unreadCount = await Message.countDocuments({
            conversationId: conv._id,
            senderId: { $ne: new Types.ObjectId(authUserId) },
            createdAt: { $gt: myParticipant?.lastReadAt || new Date(0) },
            deletedAt: null,
        });

        return {
            conversationId: conv._id,
            project: conv.projectId,
            otherParticipant: otherUser
                ? {
                      _id: otherUserId,
                      name: otherUser.name,
                      email: otherUser.email,
                      avatar: otherUser.avatar,
                      isActive: otherUser.isActive,
                  }
                : null,
            lastMessage: conv.lastMessage,
            lastMessageAt: conv.lastMessageAt,
            unreadCount,
            onlineStatus: PresenceService.isUserOnline(otherUserId) ? 'ONLINE' : 'OFFLINE',
        };
    }
}
export { ConversationParticipant };
export default ChatService;
