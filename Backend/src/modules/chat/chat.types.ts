import { Document, Types } from 'mongoose';

export type ConversationType = 'PRIVATE';
export type MessageType = 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO';

export interface IConversation {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    type: ConversationType;
    lastMessage?: Types.ObjectId;
    lastMessageAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IConversationDocument extends IConversation, Document {}

export interface IConversationParticipant {
    conversationId: Types.ObjectId;
    userId: Types.ObjectId;
    joinedAt: Date;
    lastReadAt: Date;
}

export interface IConversationParticipantDocument extends IConversationParticipant, Document {}

export interface IMessage {
    conversationId: Types.ObjectId;
    senderId: Types.ObjectId;
    messageType: MessageType;
    text?: string | null;
    fileId?: Types.ObjectId | null;
    deliveredAt?: Date | null;
    readAt?: Date | null;
    deletedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IMessageDocument extends IMessage, Document {}
