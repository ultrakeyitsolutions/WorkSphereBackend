import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { CallService } from './call.service';
import { sendSuccess, sendError } from '../../utils/response';
import { getSocketServer } from '../../sockets/socket-server';

export class CallController {
    /**
     * POST /api/calls
     */
    static async startCall(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;

            if (!companyId || !userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const { conversationId, type } = req.body;

            const call = await CallService.initiateCall(conversationId, type, {
                userId,
                companyId,
            });

            // Emit real-time incoming_call event to receiver's personal room
            const io = getSocketServer();
            if (io) {
                io.to(`user:${call.receiverId._id}`).emit('incoming_call', {
                    callId: call._id,
                    conversationId: call.conversationId,
                    caller: call.callerId,
                    type: call.type,
                    status: call.status,
                    createdAt: call.createdAt,
                });
            }

            return sendSuccess(res, 'Call initiated successfully', call, 201);
        } catch (error: any) {
            if (error.message === 'CONVERSATION_NOT_FOUND' || error.message === 'INVALID_CONVERSATION_ID') {
                return sendError(res, 'Conversation not found', 404);
            }
            if (error.message.startsWith('FORBIDDEN')) {
                return sendError(res, 'You are not authorized to call in this conversation', 403);
            }
            return sendError(res, error.message || 'Failed to initiate call', 500);
        }
    }

    /**
     * GET /api/calls/:callId
     */
    static async getCall(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;

            if (!companyId || !userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const call = await CallService.getCall(req.params.callId as string, {
                userId,
                companyId,
            });

            return sendSuccess(res, 'Call details retrieved successfully', call);
        } catch (error: any) {
            if (error.message === 'CALL_NOT_FOUND' || error.message === 'INVALID_CALL_ID') {
                return sendError(res, 'Call not found', 404);
            }
            if (error.message.startsWith('FORBIDDEN')) {
                return sendError(res, 'You are not authorized to view this call', 403);
            }
            return sendError(res, error.message || 'Failed to retrieve call details', 500);
        }
    }

    /**
     * GET /api/calls
     */
    static async getHistory(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.user?.companyId;
            const userId = req.user?.userId;

            if (!companyId || !userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const conversationId = req.query.conversationId as string | undefined;
            const limit = parseInt(req.query.limit as string, 10) || 20;

            const history = await CallService.getCallHistory(
                { userId, companyId },
                conversationId,
                limit
            );

            return sendSuccess(res, 'Call history retrieved successfully', history);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve call history', 500);
        }
    }
}
export default CallController;
