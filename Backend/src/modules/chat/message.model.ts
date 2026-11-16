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
        clientMessageId: {
            type: String,
            trim: true,
            default: null,
            index: true,
        },
        status: {
            type: String,
            enum: ['PENDING', 'UPLOADING', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED'],
            default: 'SENT',
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
        audioMetadata: {
            duration: { type: Number, default: 0 },
            mimeType: { type: String, default: null },
            fileSize: { type: Number, default: 0 },
            waveformData: { type: [Number], default: [] },
        },
        videoMetadata: {
            duration: { type: Number, default: 0 },
            width: { type: Number, default: 0 },
            height: { type: Number, default: 0 },
            thumbnailUrl: { type: String, default: null },
            mimeType: { type: String, default: null },
            fileSize: { type: Number, default: 0 },
            codec: { type: String, default: null },
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
messageSchema.index({ conversationId: 1, clientMessageId: 1 }, { sparse: true });

export const Message = model<IMessageDocument>('Message', messageSchema);
export default Message;
