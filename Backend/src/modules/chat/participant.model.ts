import { Schema, model } from 'mongoose';
import { IConversationParticipantDocument } from './chat.types';

const conversationParticipantSchema = new Schema<IConversationParticipantDocument>(
    {
        conversationId: {
            type: Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        joinedAt: {
            type: Date,
            default: Date.now,
        },
        lastReadAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: false,
    }
);

// Compound unique index ensuring a user can only be added once to a conversation
conversationParticipantSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
conversationParticipantSchema.index({ userId: 1, conversationId: 1 });

export const ConversationParticipant = model<IConversationParticipantDocument>(
    'ConversationParticipant',
    conversationParticipantSchema
);
export default ConversationParticipant;
