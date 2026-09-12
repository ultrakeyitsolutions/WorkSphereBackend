import { Schema, model } from 'mongoose';
import { IConversationDocument } from './chat.types';

const conversationSchema = new Schema<IConversationDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ['PRIVATE'],
            default: 'PRIVATE',
            required: true,
        },
        lastMessage: {
            type: Schema.Types.ObjectId,
            ref: 'Message',
            default: null,
        },
        lastMessageAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
conversationSchema.index({ companyId: 1, projectId: 1, lastMessageAt: -1 });
conversationSchema.index({ projectId: 1, lastMessageAt: -1 });

export const Conversation = model<IConversationDocument>('Conversation', conversationSchema);
export default Conversation;
