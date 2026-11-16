import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { ChatService } from './chat.service';
import { sendSuccess, sendError } from '../../utils/response';
import { getSocketServer } from '../../sockets/socket-server';

export class ChatController {
    /**
     * GET /api/projects/:projectId/members
     */
    static async getProjectMembers(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            if (!companyId || !userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const members = await ChatService.getProjectMembers(
                req.params.projectId as string,
                companyId,
                userId
            );

            return sendSuccess(res, 'Project members retrieved successfully', members);
        } catch (error: any) {
            if (error.message === 'PROJECT_NOT_FOUND' || error.message === 'INVALID_PROJECT_ID') {
                return sendError(res, 'Project not found', 404);
            }
            if (error.message === 'FORBIDDEN_PROJECT_ACCESS') {
                return sendError(res, 'You do not have access to this project', 403);
            }
            return sendError(res, error.message || 'Failed to retrieve project members', 500);
        }
    }

    /**
     * POST /api/conversations
     */
    static async createConversation(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;
            const role = req.user?.role || '';

            if (!companyId || !userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const { projectId, participantId } = req.body;

            const conversation = await ChatService.getOrCreateConversation(
                projectId,
                participantId,
                { userId, companyId, role }
            );

            return sendSuccess(res, 'Conversation retrieved/created successfully', conversation, 201);
        } catch (error: any) {
            if (error.message === 'CANNOT_CHAT_WITH_SELF') {
                return sendError(res, 'Cannot start a private conversation with yourself', 400);
            }
            if (error.message === 'PROJECT_NOT_FOUND' || error.message === 'PARTICIPANT_NOT_FOUND') {
                return sendError(res, 'Project or participant not found', 404);
            }
            if (
                error.message === 'FORBIDDEN_PROJECT_ACCESS' ||
                error.message === 'PARTICIPANT_NO_PROJECT_ACCESS'
            ) {
                return sendError(res, 'You or the participant do not have access to this project', 403);
            }
            return sendError(res, error.message || 'Failed to create conversation', 500);
        }
    }

    /**
     * GET /api/conversations
     */
    static async getConversations(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;

            if (!companyId || !userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const projectId = req.query.projectId as string | undefined;
            const conversations = await ChatService.getUserConversations(
                { userId, companyId },
                projectId
            );

            return sendSuccess(res, 'Conversations retrieved successfully', conversations);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve conversations', 500);
        }
    }

    /**
     * GET /api/conversations/:conversationId/messages
     */
    static async getMessages(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;

            if (!companyId || !userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const limit = parseInt(req.query.limit as string, 10) || 50;
            const cursor = req.query.cursor as string | undefined;

            const result = await ChatService.getMessages(
                req.params.conversationId as string,
                { userId, companyId },
                limit,
                cursor
            );

            return sendSuccess(res, 'Messages retrieved successfully', result);
        } catch (error: any) {
            if (error.message === 'CONVERSATION_NOT_FOUND' || error.message === 'INVALID_CONVERSATION_ID') {
                return sendError(res, 'Conversation not found', 404);
            }
            if (error.message === 'FORBIDDEN_CONVERSATION_ACCESS') {
                return sendError(res, 'You are not a participant in this conversation', 403);
            }
            return sendError(res, error.message || 'Failed to retrieve messages', 500);
        }
    }

    /**
     * POST /api/conversations/:conversationId/messages
     */
    static async sendMessage(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;

            if (!companyId || !userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const conversationId = req.params.conversationId as string;
            const { messageType, clientMessageId, text, fileId, audioMetadata, videoMetadata } = req.body;

            const result = await ChatService.createMessage({
                conversationId,
                senderId: userId,
                companyId,
                messageType,
                clientMessageId,
                text,
                fileId,
                audioMetadata,
                videoMetadata,
            });

            // If not duplicate, broadcast over Socket.IO to other participants
            if (!result.isDuplicate) {
                const io = getSocketServer();
                if (io) {
                    const broadcastTarget = result.otherUserId
                        ? io.to(`conversation:${conversationId}`).to(`user:${result.otherUserId}`)
                        : io.to(`conversation:${conversationId}`);

                    broadcastTarget.emit('new_message', {
                        message: result.message,
                    });

                    if (result.otherUserId) {
                        io.to(`user:${result.otherUserId}`).emit('chat_notification', {
                            type: 'NEW_CHAT_MESSAGE',
                            title: (result.message as any)?.senderId?.name || 'New Message',
                            message: result.message.text || (result.message.fileId ? `Sent an attachment (${result.message.messageType})` : 'New message'),
                            conversationId,
                            sender: (result.message as any)?.senderId,
                            createdAt: result.message.createdAt,
                        });
                    }
                }
            }

            return sendSuccess(res, 'Message sent successfully', result.message, result.isDuplicate ? 200 : 201);
        } catch (error: any) {
            if (error.message === 'CONVERSATION_NOT_FOUND' || error.message === 'INVALID_CONVERSATION_ID') {
                return sendError(res, 'Conversation not found', 404);
            }
            if (error.message === 'FORBIDDEN_CONVERSATION_ACCESS') {
                return sendError(res, 'You are not a participant in this conversation', 403);
            }
            if (error.message === 'FORBIDDEN_PROJECT_ACCESS') {
                return sendError(res, 'Project access denied', 403);
            }
            if (error.message === 'ATTACHED_FILE_NOT_FOUND' || error.message === 'INVALID_FILE_ID') {
                return sendError(res, 'Attached file not found or invalid', 400);
            }
            return sendError(res, error.message || 'Failed to send message', 500);
        }
    }

    /**
     * DELETE /api/messages/:messageId
     */
    static async deleteMessage(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;

            if (!companyId || !userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const deletedMessage = await ChatService.deleteMessage(req.params.messageId as string, {
                userId,
                companyId,
            });

            // Emit real-time notification to conversation room
            const io = getSocketServer();
            if (io) {
                io.to(`conversation:${deletedMessage.conversationId}`).emit('message_deleted', {
                    messageId: deletedMessage._id,
                    conversationId: deletedMessage.conversationId,
                    deletedAt: deletedMessage.deletedAt,
                });
            }

            return sendSuccess(res, 'Message deleted successfully', {
                _id: deletedMessage._id,
                deletedAt: deletedMessage.deletedAt,
            });
        } catch (error: any) {
            if (error.message === 'MESSAGE_NOT_FOUND' || error.message === 'INVALID_MESSAGE_ID') {
                return sendError(res, 'Message not found', 404);
            }
            if (
                error.message === 'FORBIDDEN_MESSAGE_DELETE' ||
                error.message === 'FORBIDDEN_CONVERSATION_ACCESS'
            ) {
                return sendError(res, 'You are not authorized to delete this message', 403);
            }
            return sendError(res, error.message || 'Failed to delete message', 500);
        }
    }
}
export default ChatController;
