import { Types } from 'mongoose';
import { Call } from './call.model';
import { CallType, CallStatus, ICallDocument } from './call.types';
import { Conversation } from '../chat/conversation.model';
import { ConversationParticipant } from '../chat/chat.service';
import { ProjectService } from '../companyadmin/projects/project.service';
import { PresenceService } from '../../sockets/presence.service';

export class CallService {
    /**
     * Start a new audio or video call.
     */
    static async initiateCall(
        conversationId: string,
        type: CallType,
        authUser: { userId: string; companyId: string }
    ): Promise<ICallDocument> {
        if (!Types.ObjectId.isValid(conversationId)) {
            throw new Error('INVALID_CONVERSATION_ID');
        }

        // 1. Verify conversation belongs to company
        const conversation = await Conversation.findOne({
            _id: conversationId,
            companyId: authUser.companyId,
        });
        if (!conversation) {
            throw new Error('CONVERSATION_NOT_FOUND');
        }

        // 2. Verify caller is a participant
        const isParticipant = await ConversationParticipant.exists({
            conversationId,
            userId: authUser.userId,
        });
        if (!isParticipant) {
            throw new Error('FORBIDDEN_CONVERSATION_ACCESS');
        }

        // 3. Verify project access
        const canAccess = await ProjectService.canAccessProject(
            authUser.companyId,
            authUser.userId,
            conversation.projectId.toString()
        );
        if (!canAccess) {
            throw new Error('FORBIDDEN_PROJECT_ACCESS');
        }

        // 4. Find other participant (receiver)
        const receiverParticipant = await ConversationParticipant.findOne({
            conversationId,
            userId: { $ne: new Types.ObjectId(authUser.userId) },
        }).lean();

        if (!receiverParticipant) {
            throw new Error('RECEIVER_NOT_FOUND');
        }

        const receiverId = receiverParticipant.userId.toString();
        const isReceiverOnline = PresenceService.isUserOnline(receiverId);

        // 5. Create Call document
        const call = await Call.create({
            companyId: new Types.ObjectId(authUser.companyId),
            projectId: conversation.projectId,
            conversationId: new Types.ObjectId(conversationId),
            callerId: new Types.ObjectId(authUser.userId),
            receiverId: new Types.ObjectId(receiverId),
            type,
            status: isReceiverOnline ? 'RINGING' : 'CALLING',
        });

        return (await Call.findById(call._id)
            .populate('callerId', 'name email avatar')
            .populate('receiverId', 'name email avatar')) as ICallDocument;
    }

    /**
     * Get call details with security authorization.
     */
    static async getCall(
        callId: string,
        authUser: { userId: string; companyId: string }
    ): Promise<ICallDocument> {
        if (!Types.ObjectId.isValid(callId)) {
            throw new Error('INVALID_CALL_ID');
        }

        const call = await Call.findById(callId)
            .populate('callerId', 'name email avatar')
            .populate('receiverId', 'name email avatar');

        if (!call) {
            throw new Error('CALL_NOT_FOUND');
        }

        // Company isolation check
        if (call.companyId.toString() !== authUser.companyId) {
            throw new Error('FORBIDDEN_COMPANY');
        }

        // Caller or Receiver check
        const isParty =
            call.callerId._id.toString() === authUser.userId ||
            call.receiverId._id.toString() === authUser.userId;

        if (!isParty) {
            throw new Error('FORBIDDEN_CALL_ACCESS');
        }

        return call;
    }

    /**
     * Update call status (ACCEPTED, DECLINED, ENDED, MISSED).
     */
    static async updateCallStatus(
        callId: string,
        status: CallStatus,
        authUser: { userId: string; companyId: string }
    ): Promise<ICallDocument> {
        const call = await this.getCall(callId, authUser);

        if (status === 'ACCEPTED') {
            // Only receiver can accept
            if (call.receiverId._id.toString() !== authUser.userId) {
                throw new Error('ONLY_RECEIVER_CAN_ACCEPT');
            }
            call.status = 'ACCEPTED';
            call.answeredAt = new Date();
        } else if (status === 'DECLINED') {
            call.status = 'DECLINED';
            call.endedAt = new Date();
        } else if (status === 'ENDED') {
            call.status = 'ENDED';
            call.endedAt = new Date();
        } else if (status === 'MISSED') {
            call.status = 'MISSED';
            call.endedAt = new Date();
        }

        await call.save();
        return call;
    }

    /**
     * Get call history for the authenticated user.
     */
    static async getCallHistory(
        authUser: { userId: string; companyId: string },
        conversationId?: string,
        limit = 20
    ): Promise<any[]> {
        const query: any = {
            companyId: authUser.companyId,
            $or: [
                { callerId: new Types.ObjectId(authUser.userId) },
                { receiverId: new Types.ObjectId(authUser.userId) },
            ],
        };

        if (conversationId && Types.ObjectId.isValid(conversationId)) {
            query.conversationId = new Types.ObjectId(conversationId);
        }

        return Call.find(query)
            .populate('callerId', 'name email avatar')
            .populate('receiverId', 'name email avatar')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    }
}
export default CallService;
