import { Server, Socket } from 'socket.io';
import { Types } from 'mongoose';
import { Conversation } from './conversation.model';
import { ConversationParticipant } from './participant.model';
import { Message } from './message.model';
import { FileModel } from '../files/file.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { PresenceService } from '../../sockets/presence.service';

export const registerChatHandlers = (io: Server, socket: Socket): void => {
    const user = socket.data.user;
    if (!user) return;

    /**
     * Join conversation room after strictly verifying company, project, and participant access.
     */
    socket.on('join_conversation', async (data: { conversationId: string }, callback?: (response: any) => void) => {
        try {
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
     * Send real-time message (TEXT, IMAGE, DOCUMENT, AUDIO, VIDEO).
     */
    socket.on(
        'send_message',
        async (
            data: {
                conversationId: string;
                messageType: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO';
                text?: string;
                fileId?: string;
            },
            callback?: (response: any) => void
        ) => {
            try {
                const { conversationId, messageType, text, fileId } = data;

                if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
                    if (callback) callback({ success: false, message: 'Invalid conversationId' });
                    return;
                }

                // Verify conversation and company
                const conversation = await Conversation.findOne({
                    _id: conversationId,
                    companyId: user.companyId,
                });
                if (!conversation) {
                    if (callback) callback({ success: false, message: 'Conversation not found' });
                    return;
                }

                // Verify participant
                const isParticipant = await ConversationParticipant.exists({
                    conversationId,
                    userId: user.userId,
                });
                if (!isParticipant) {
                    if (callback) callback({ success: false, message: 'Not a participant' });
                    return;
                }

                // Verify project access
                const canAccess = await ProjectService.canAccessProject(
                    user.companyId,
                    user.userId,
                    conversation.projectId.toString()
                );
                if (!canAccess) {
                    if (callback) callback({ success: false, message: 'Project access denied' });
                    return;
                }

                // Validate file if attachment message
                let fileDoc: any = null;
                if (fileId) {
                    if (!Types.ObjectId.isValid(fileId)) {
                        if (callback) callback({ success: false, message: 'Invalid fileId' });
                        return;
                    }

                    fileDoc = await FileModel.findOne({
                        _id: fileId,
                        companyId: user.companyId,
                        deletedAt: null,
                    });
                    if (!fileDoc) {
                        if (callback) callback({ success: false, message: 'Attached file not found' });
                        return;
                    }

                    // Link file to conversation
                    fileDoc.contextType = 'MESSAGE';
                    fileDoc.contextId = conversation._id;
                    await fileDoc.save();
                }

                // Check recipient presence for immediate delivery receipt
                const otherParticipant = await ConversationParticipant.findOne({
                    conversationId,
                    userId: { $ne: new Types.ObjectId(user.userId) },
                }).lean();

                const otherUserId = otherParticipant?.userId?.toString();
                const isRecipientOnline = otherUserId ? PresenceService.isUserOnline(otherUserId) : false;
                const deliveredAt = isRecipientOnline ? new Date() : null;

                // Create message in MongoDB
                const message = await Message.create({
                    conversationId: new Types.ObjectId(conversationId),
                    senderId: new Types.ObjectId(user.userId),
                    messageType: messageType || 'TEXT',
                    text: text || null,
                    fileId: fileDoc ? fileDoc._id : null,
                    deliveredAt,
                });

                // Update conversation's last message
                conversation.lastMessage = message._id as any;
                conversation.lastMessageAt = message.createdAt || new Date();
                await conversation.save();

                // Populate message for broadcast
                const populatedMessage = await Message.findById(message._id)
                    .populate('senderId', 'name email avatar')
                    .populate('fileId')
                    .lean();

                if (!populatedMessage) {
                    throw new Error('Failed to retrieve created message');
                }

                // Emit new_message to conversation room AND recipient's personal room
                // Socket.IO automatically de-duplicates sockets present in multiple target rooms
                const broadcastTarget = otherUserId
                    ? io.to(`conversation:${conversationId}`).to(`user:${otherUserId}`)
                    : io.to(`conversation:${conversationId}`);

                broadcastTarget.emit('new_message', {
                    message: populatedMessage,
                });

                // Also emit notification & unread count to recipient's personal room
                if (otherUserId) {
                    const recipientLastRead = otherParticipant?.lastReadAt || new Date(0);
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

                    // Emit real-time notification alert to recipient's personal room
                    io.to(`user:${otherUserId}`).emit('chat_notification', {
                        type: 'NEW_CHAT_MESSAGE',
                        title: (populatedMessage as any)?.senderId?.name || 'New Message',
                        message: populatedMessage.text || (populatedMessage.fileId ? `Sent an attachment (${populatedMessage.messageType})` : 'New message'),
                        conversationId,
                        projectId: conversation.projectId,
                        sender: (populatedMessage as any)?.senderId,
                        unreadCount,
                        createdAt: populatedMessage.createdAt,
                    });
                }

                if (callback) callback({ success: true, message: populatedMessage });
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
