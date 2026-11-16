import { Server, Socket } from 'socket.io';
import { Types } from 'mongoose';
import { Conversation } from './conversation.model';
import { ConversationParticipant } from './participant.model';
import { Message } from './message.model';
import { FileModel } from '../files/file.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { PresenceService } from '../../sockets/presence.service';
import { NotificationEventBus } from '../notifications/notification.event-bus';
import { StorageConfigurationService } from '../super-admin/storage/storage-config.service';
import { FeatureAccessService } from '../companyadmin/settings/feature-access.service';
import { ChatService } from './chat.service';

export const registerChatHandlers = (io: Server, socket: Socket): void => {
    const user = socket.data.user;
    if (!user) return;

    /**
     * Join conversation room after strictly verifying company, project, and participant access.
     */
    socket.on('join_conversation', async (data: { conversationId: string }, callback?: (response: any) => void) => {
        try {
            const chatAccess = await FeatureAccessService.checkAccess(user.companyId, 'enableChat');
            if (!chatAccess.allowed) {
                if (callback) callback({ success: false, message: chatAccess.message || 'Chat is disabled for your organization' });
                return;
            }

            const { conversationId } = data;
            if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
                if (callback) callback({ success: false, message: 'Invalid conversationId' });
                return;
            }

            const conversation = await Conversation.findOne({
                _id: conversationId,
                companyId: user.companyId,
            });
            if (!conversation) {
                if (callback) callback({ success: false, message: 'Conversation not found' });
                return;
            }

            const isParticipant = await ConversationParticipant.exists({
                conversationId,
                userId: user.userId,
            });
            if (!isParticipant) {
                if (callback) callback({ success: false, message: 'Not a participant in this conversation' });
                return;
            }

            const canAccess = await ProjectService.canAccessProject(
                user.companyId,
                user.userId,
                conversation.projectId.toString()
            );
            if (!canAccess) {
                if (callback) callback({ success: false, message: 'Access to project denied' });
                return;
            }

            socket.join(`conversation:${conversationId}`);
            if (callback) callback({ success: true, conversationId });
        } catch (error: any) {
            if (callback) callback({ success: false, message: error.message || 'Failed to join conversation' });
        }
    });

    /**
     * Send real-time message (TEXT, IMAGE, DOCUMENT, AUDIO, VIDEO) with idempotency and optimistic reconciliation.
     */
    socket.on(
        'send_message',
        async (
            data: {
                conversationId: string;
                messageType: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO';
                clientMessageId?: string;
                text?: string;
                fileId?: string;
                audioMetadata?: {
                    duration?: number;
                    mimeType?: string;
                    fileSize?: number;
                    waveformData?: number[];
                };
                videoMetadata?: {
                    duration?: number;
                    width?: number;
                    height?: number;
                    thumbnailUrl?: string | null;
                    mimeType?: string;
                    fileSize?: number;
                    codec?: string | null;
                };
            },
            callback?: (response: any) => void
        ) => {
            try {
                const { conversationId, messageType, clientMessageId, text, fileId, audioMetadata, videoMetadata } = data;

                const chatAccess = await FeatureAccessService.checkAccess(user.companyId, 'enableChat');
                if (!chatAccess.allowed) {
                    if (callback) callback({ success: false, message: chatAccess.message || 'Chat is disabled for your organization' });
                    return;
                }

                if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
                    if (callback) callback({ success: false, message: 'Invalid conversationId' });
                    return;
                }

                // Delegate to ChatService with idempotency checking
                const result = await ChatService.createMessage({
                    conversationId,
                    senderId: user.userId,
                    companyId: user.companyId,
                    messageType,
                    clientMessageId,
                    text,
                    fileId,
                    audioMetadata,
                    videoMetadata,
                });

                const populatedMessage = result.message;
                const otherUserId = result.otherUserId;

                // Broadcast to conversation room EXCLUDING sender socket (to prevent duplicate message rendering on sender UI)
                // Sender UI receives the server-confirmed message in the acknowledgment callback below
                if (!result.isDuplicate) {
                    socket.to(`conversation:${conversationId}`).emit('new_message', {
                        message: populatedMessage,
                    });

                    // Emit to other devices of current user so sender's other tabs/devices sync
                    socket.to(`user:${user.userId}`).emit('new_message', {
                        message: populatedMessage,
                    });

                    // If other participant is not currently in conversation room, broadcast to their user room
                    if (otherUserId) {
                        socket.to(`user:${otherUserId}`).emit('new_message', {
                            message: populatedMessage,
                        });

                        // Calculate recipient unread count
                        const recipientLastRead = (result.otherParticipant as any)?.lastReadAt || new Date(0);
                        const unreadCount = await Message.countDocuments({
                            conversationId,
                            senderId: { $ne: new Types.ObjectId(otherUserId) },
                            createdAt: { $gt: recipientLastRead },
                            deletedAt: null,
                        });

                        io.to(`user:${otherUserId}`).emit('unread_count_update', {
                            conversationId,
                            unreadCount,
                        });

                        // Dispatch fire-and-forget notification to central Notification Service
                        const senderName = (populatedMessage.senderId as any)?.name || 'Someone';
                        const msgPreview = text
                            ? (text.length > 50 ? text.substring(0, 47) + '...' : text)
                            : `${messageType || 'File'} attachment`;

                        NotificationEventBus.getInstance().publish({
                            type: 'CHAT_MESSAGE',
                            companyId: user.companyId,
                            actorId: user.userId,
                            entityId: conversationId,
                            entityType: 'CONVERSATION',
                            conversationId,
                            recipientIds: otherUserId ? [otherUserId] : undefined,
                            metadata: {
                                actorName: senderName,
                                messagePreview: msgPreview,
                                conversationId,
                            },
                        });

                        // Emit real-time notification alert to recipient's personal room
                        io.to(`user:${otherUserId}`).emit('chat_notification', {
                            type: 'NEW_CHAT_MESSAGE',
                            title: (populatedMessage as any)?.senderId?.name || 'New Message',
                            message: populatedMessage.text || (populatedMessage.fileId ? `Sent an attachment (${populatedMessage.messageType})` : 'New message'),
                            conversationId,
                            projectId: result.conversation?.projectId,
                            sender: (populatedMessage as any)?.senderId,
                            unreadCount,
                            createdAt: populatedMessage.createdAt,
                        });
                    }
                }

                // Return acknowledgement with confirmed server message and original clientMessageId
                if (callback) {
                    callback({
                        success: true,
                        message: populatedMessage,
                        clientMessageId: populatedMessage.clientMessageId || clientMessageId,
                        isDuplicate: result.isDuplicate,
                    });
                }
            } catch (error: any) {
                console.error('[ChatSocket] Error in send_message:', error);
                if (callback) callback({ success: false, message: error.message || 'Failed to send message' });
            }
        }
    );

    /**
     * Typing indicators
     */
    socket.on('typing_start', async (data: { conversationId: string }) => {
        try {
            const isChatEnabled = await FeatureAccessService.canAccess(user.companyId, 'enableChat');
            if (!isChatEnabled) return;

            const { conversationId } = data;
            if (!conversationId) return;

            const isParticipant = await ConversationParticipant.exists({
                conversationId,
                userId: user.userId,
            });
            if (isParticipant) {
                socket.to(`conversation:${conversationId}`).emit('user_typing', {
                    conversationId,
                    userId: user.userId,
                    isTyping: true,
                });
            }
        } catch {}
    });

    socket.on('typing_stop', async (data: { conversationId: string }) => {
        try {
            const isChatEnabled = await FeatureAccessService.canAccess(user.companyId, 'enableChat');
            if (!isChatEnabled) return;

            const { conversationId } = data;
            if (!conversationId) return;

            const isParticipant = await ConversationParticipant.exists({
                conversationId,
                userId: user.userId,
            });
            if (isParticipant) {
                socket.to(`conversation:${conversationId}`).emit('user_typing', {
                    conversationId,
                    userId: user.userId,
                    isTyping: false,
                });
            }
        } catch {}
    });

    /**
     * Message delivered receipt
     */
    socket.on('message_delivered', async (data: { messageId: string; conversationId: string }) => {
        try {
            const isChatEnabled = await FeatureAccessService.canAccess(user.companyId, 'enableChat');
            if (!isChatEnabled) return;

            const { messageId, conversationId } = data;
            if (!messageId || !Types.ObjectId.isValid(messageId)) return;

            const message = await Message.findById(messageId);
            if (message && !message.deliveredAt) {
                message.deliveredAt = new Date();
                await message.save();

                io.to(`conversation:${conversationId}`).emit('message_delivered', {
                    messageId,
                    conversationId,
                    deliveredAt: message.deliveredAt,
                });
            }
        } catch (error) {
            console.error('[ChatSocket] Error in message_delivered:', error);
        }
    });

    /**
     * Message read receipt
     */
    socket.on('message_read', async (data: { conversationId: string }) => {
        try {
            const isChatEnabled = await FeatureAccessService.canAccess(user.companyId, 'enableChat');
            if (!isChatEnabled) return;

            const { conversationId } = data;
            if (!conversationId || !Types.ObjectId.isValid(conversationId)) return;

            const now = new Date();

            await Promise.all([
                ConversationParticipant.updateOne(
                    { conversationId, userId: user.userId },
                    { $set: { lastReadAt: now } }
                ),
                Message.updateMany(
                    {
                        conversationId,
                        senderId: { $ne: new Types.ObjectId(user.userId) },
                        readAt: null,
                    },
                    {
                        $set: { readAt: now, deliveredAt: now },
                    }
                ),
            ]);

            io.to(`conversation:${conversationId}`).emit('message_read', {
                conversationId,
                readBy: user.userId,
                readAt: now,
            });

            // Reset unread count for reader
            io.to(`user:${user.userId}`).emit('unread_count_update', {
                conversationId,
                unreadCount: 0,
            });
        } catch (error) {
            console.error('[ChatSocket] Error in message_read:', error);
        }
    });

    /**
     * Reconnection sync: client requests messages missed since a given timestamp
     */
    socket.on('sync_messages', async (data: { conversationId: string; since: string }, callback?: (res: any) => void) => {
        try {
            const { conversationId, since } = data;
            if (!conversationId || !since) {
                if (callback) callback({ success: false, message: 'Missing parameters' });
                return;
            }

            const isParticipant = await ConversationParticipant.exists({
                conversationId,
                userId: user.userId,
            });
            if (!isParticipant) {
                if (callback) callback({ success: false, message: 'Unauthorized' });
                return;
            }

            const sinceDate = new Date(since);
            const missedMessages = await Message.find({
                conversationId,
                createdAt: { $gt: sinceDate },
            })
                .sort({ createdAt: 1 })
                .populate('senderId', 'name email avatar')
                .populate('fileId')
                .lean();

            // Mark any unread messages sent to this user as delivered
            await Message.updateMany(
                {
                    conversationId,
                    senderId: { $ne: new Types.ObjectId(user.userId) },
                    deliveredAt: null,
                },
                { $set: { deliveredAt: new Date() } }
            );

            if (callback) callback({ success: true, messages: missedMessages });
        } catch (error: any) {
            if (callback) callback({ success: false, message: error.message });
        }
    });
};
