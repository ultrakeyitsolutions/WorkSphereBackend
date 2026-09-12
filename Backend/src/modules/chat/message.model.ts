import { Schema, model } from 'mongoose';
import { IMessageDocument } from './chat.types';

const messageSchema = new Schema<IMessageDocument>(
    {
        conversationId: {
            type: Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true,
            index: true,
        },
        senderId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        messageType: {
            type: String,
            enum: ['TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO'],
            required: true,
        },
        text: {
            type: String,
            trim: true,
            default: null,
        },
        fileId: {
            type: Schema.Types.ObjectId,
            ref: 'File',
            default: null,
            index: true,
        },
        deliveredAt: {
            type: Date,
            default: null,
        },
        readAt: {
            type: Date,
            default: null,
        },
        deletedAt: {
            type: Date,
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, deletedAt: 1 });
messageSchema.index({ senderId: 1 });

export const Message = model<IMessageDocument>('Message', messageSchema);
export default Message;
