import { Document, Types } from 'mongoose';

export type CallType = 'AUDIO' | 'VIDEO';
export type CallStatus = 'CALLING' | 'RINGING' | 'ACCEPTED' | 'DECLINED' | 'MISSED' | 'ENDED';

export interface ICall {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    conversationId: Types.ObjectId;
    callerId: Types.ObjectId;
    receiverId: Types.ObjectId;
    type: CallType;
    status: CallStatus;
    answeredAt?: Date | null;
    endedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ICallDocument extends ICall, Document {}
