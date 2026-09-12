import { Schema, model } from 'mongoose';
import { ICallDocument } from './call.types';

const callSchema = new Schema<ICallDocument>(
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
        conversationId: {
            type: Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true,
            index: true,
        },
        callerId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        receiverId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ['AUDIO', 'VIDEO'],
            required: true,
        },
        status: {
            type: String,
            enum: ['CALLING', 'RINGING', 'ACCEPTED', 'DECLINED', 'MISSED', 'ENDED'],
            default: 'CALLING',
            required: true,
            index: true,
        },
        answeredAt: {
            type: Date,
            default: null,
        },
        endedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes for fast call history lookups
callSchema.index({ conversationId: 1, createdAt: -1 });
callSchema.index({ callerId: 1, createdAt: -1 });
callSchema.index({ receiverId: 1, createdAt: -1 });
callSchema.index({ companyId: 1, createdAt: -1 });

export const Call = model<ICallDocument>('Call', callSchema);
export default Call;
