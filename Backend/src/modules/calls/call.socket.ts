import { Server, Socket } from 'socket.io';
import { CallService } from './call.service';

export const registerCallHandlers = (io: Server, socket: Socket): void => {
    const user = socket.data.user;
    if (!user) return;

    /**
     * Call Accepted
     */
    socket.on('call_accepted', async (data: { callId: string }) => {
        try {
            const { callId } = data;
            const updatedCall = await CallService.updateCallStatus(callId, 'ACCEPTED', {
                userId: user.userId,
                companyId: user.companyId,
            });

            // Notify caller that call was accepted
            io.to(`user:${updatedCall.callerId._id}`).emit('call_accepted', {
                callId: updatedCall._id,
                answeredAt: updatedCall.answeredAt,
            });
        } catch (error) {
            console.error('[CallSocket] Error in call_accepted:', error);
        }
    });

    /**
     * Call Declined
     */
    socket.on('call_declined', async (data: { callId: string }) => {
        try {
            const { callId } = data;
            const updatedCall = await CallService.updateCallStatus(callId, 'DECLINED', {
                userId: user.userId,
                companyId: user.companyId,
            });

            // Notify caller that call was declined
            io.to(`user:${updatedCall.callerId._id}`).emit('call_declined', {
                callId: updatedCall._id,
                endedAt: updatedCall.endedAt,
            });
        } catch (error) {
            console.error('[CallSocket] Error in call_declined:', error);
        }
    });

    /**
     * Call Ended
     */
    socket.on('call_ended', async (data: { callId: string }) => {
        try {
            const { callId } = data;
            const updatedCall = await CallService.updateCallStatus(callId, 'ENDED', {
                userId: user.userId,
                companyId: user.companyId,
            });

            const callerIdStr = updatedCall.callerId._id.toString();
            const receiverIdStr = updatedCall.receiverId._id.toString();
            const targetPeerId = user.userId === callerIdStr ? receiverIdStr : callerIdStr;

            io.to(`user:${targetPeerId}`).emit('call_ended', {
                callId: updatedCall._id,
                endedAt: updatedCall.endedAt,
                endedBy: user.userId,
            });
        } catch (error) {
            console.error('[CallSocket] Error in call_ended:', error);
        }
    });

    /**
     * WebRTC Signaling: SDP Offer
     */
    socket.on('call_offer', async (data: { callId: string; sdp: any }) => {
        try {
            const { callId, sdp } = data;
            const call = await CallService.getCall(callId, {
                userId: user.userId,
                companyId: user.companyId,
            });

            const callerIdStr = call.callerId._id.toString();
            const receiverIdStr = call.receiverId._id.toString();
            const targetPeerId = user.userId === callerIdStr ? receiverIdStr : callerIdStr;

            io.to(`user:${targetPeerId}`).emit('call_offer', {
                callId: call._id,
                sdp,
                senderId: user.userId,
            });
        } catch (error) {
            console.error('[CallSocket] Error in call_offer:', error);
        }
    });

    /**
     * WebRTC Signaling: SDP Answer
     */
    socket.on('call_answer', async (data: { callId: string; sdp: any }) => {
        try {
            const { callId, sdp } = data;
            const call = await CallService.getCall(callId, {
                userId: user.userId,
                companyId: user.companyId,
            });

            const callerIdStr = call.callerId._id.toString();
            const receiverIdStr = call.receiverId._id.toString();
            const targetPeerId = user.userId === callerIdStr ? receiverIdStr : callerIdStr;

            io.to(`user:${targetPeerId}`).emit('call_answer', {
                callId: call._id,
                sdp,
                senderId: user.userId,
            });
        } catch (error) {
            console.error('[CallSocket] Error in call_answer:', error);
        }
    });

    /**
     * WebRTC Signaling: ICE Candidate
     */
    socket.on('ice_candidate', async (data: { callId: string; candidate: any }) => {
        try {
            const { callId, candidate } = data;
            const call = await CallService.getCall(callId, {
                userId: user.userId,
                companyId: user.companyId,
            });

            const callerIdStr = call.callerId._id.toString();
            const receiverIdStr = call.receiverId._id.toString();
            const targetPeerId = user.userId === callerIdStr ? receiverIdStr : callerIdStr;

            io.to(`user:${targetPeerId}`).emit('ice_candidate', {
                callId: call._id,
                candidate,
                senderId: user.userId,
            });
        } catch (error) {
            console.error('[CallSocket] Error in ice_candidate:', error);
        }
    });
};
