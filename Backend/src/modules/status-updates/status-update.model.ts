import { Schema, model } from 'mongoose';
import { IStatusUpdateDocument } from './status-update.types';

const statusUpdateFeedbackSchema = new Schema(
    {
        comment: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000,
        },
        authorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        authorRole: {
            type: String,
            default: 'COMPANY_ADMIN',
            trim: true,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: true }
);

const statusUpdateSchema = new Schema<IStatusUpdateDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        employeeId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        date: {
            type: String,
            required: true,
            trim: true,
            match: /^\d{4}-\d{2}-\d{2}$/,
            index: true,
        },
        statusCategory: {
            type: String,
            enum: ['COMPLETED', 'IN_PROGRESS', 'PENDING', 'BLOCKED'],
            default: 'IN_PROGRESS',
            index: true,
        },
        todayWork: {
            type: String,
            required: true,
            trim: true,
            maxlength: 5000,
        },
        currentWork: {
            type: String,
            default: '',
            trim: true,
            maxlength: 5000,
        },
        nextWork: {
            type: String,
            default: '',
            trim: true,
            maxlength: 5000,
        },
        blockers: {
            type: String,
            default: '',
            trim: true,
            maxlength: 5000,
        },
        additionalComments: {
            type: String,
            default: '',
            trim: true,
            maxlength: 5000,
        },
        associatedProjects: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Project',
            },
        ],
        associatedTasks: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Task',
            },
        ],
        feedback: [statusUpdateFeedbackSchema],
        isEdited: {
            type: Boolean,
            default: false,
        },
        lastEditedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// One status update per employee per date in a company
statusUpdateSchema.index({ companyId: 1, employeeId: 1, date: 1 }, { unique: true });

// Optimizing administrative and feed queries
statusUpdateSchema.index({ companyId: 1, date: -1 });
statusUpdateSchema.index({ companyId: 1, statusCategory: 1, date: -1 });
statusUpdateSchema.index({ companyId: 1, employeeId: 1, createdAt: -1 });

export const StatusUpdate = model<IStatusUpdateDocument>('StatusUpdate', statusUpdateSchema);
export default StatusUpdate;

