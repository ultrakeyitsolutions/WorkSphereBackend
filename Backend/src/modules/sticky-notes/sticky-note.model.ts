import mongoose, { Schema, Model } from 'mongoose';
import { IStickyNoteDocument } from './sticky-note.types';
import {
    StickyNoteColor,
    StickyNotePriority,
    StickyNoteStatus,
    STICKY_NOTE_COLORS,
    STICKY_NOTE_PRIORITIES,
    STICKY_NOTE_STATUSES,
    MAX_TITLE_LENGTH,
    MAX_CONTENT_LENGTH,
} from './sticky-note.constants';

const ChecklistItemSchema = new Schema(
    {
        id: {
            type: String,
            required: true,
        },
        text: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500,
        },
        completed: {
            type: Boolean,
            default: false,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        completedAt: {
            type: Date,
            default: null,
        },
    },
    { _id: false }
);

const StickyNoteSchema = new Schema<IStickyNoteDocument>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        title: {
            type: String,
            trim: true,
            maxlength: MAX_TITLE_LENGTH,
            default: '',
        },
        content: {
            type: String,
            required: true,
            maxlength: MAX_CONTENT_LENGTH,
            default: '',
        },
        color: {
            type: String,
            enum: STICKY_NOTE_COLORS,
            default: StickyNoteColor.YELLOW,
        },
        priority: {
            type: String,
            enum: STICKY_NOTE_PRIORITIES,
            default: StickyNotePriority.MEDIUM,
        },
        tags: {
            type: [String],
            default: [],
        },
        isPinned: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: STICKY_NOTE_STATUSES,
            default: StickyNoteStatus.ACTIVE,
        },
        checklist: {
            type: [ChecklistItemSchema],
            default: [],
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            default: null,
        },
        taskId: {
            type: Schema.Types.ObjectId,
            ref: 'Task',
            default: null,
        },
        convertedTaskId: {
            type: Schema.Types.ObjectId,
            ref: 'Task',
            default: null,
        },
        reminderAt: {
            type: Date,
            default: null,
        },
        reminderSentAt: {
            type: Date,
            default: null,
        },
        archivedAt: {
            type: Date,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
        deletedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: {
            transform: (_doc, ret: Record<string, any>) => {
                ret.id = ret._id ? ret._id.toString() : ret.id;
                delete ret.__v;
                return ret;
            },
        },
    }
);

// ── Compound Indexes for Fast User Queries ─────────────────────────────────────
StickyNoteSchema.index({ userId: 1, deletedAt: 1, updatedAt: -1 });
StickyNoteSchema.index({ userId: 1, status: 1, updatedAt: -1 });
StickyNoteSchema.index({ userId: 1, isPinned: -1, updatedAt: -1 });
StickyNoteSchema.index({ userId: 1, reminderAt: 1 });
StickyNoteSchema.index({ userId: 1, tags: 1 });

// Background Scheduler Index for Due Reminders
StickyNoteSchema.index({ deletedAt: 1, reminderAt: 1, reminderSentAt: 1 });

export const StickyNote: Model<IStickyNoteDocument> =
    (mongoose.models.StickyNote as Model<IStickyNoteDocument>) ||
    mongoose.model<IStickyNoteDocument>('StickyNote', StickyNoteSchema);
