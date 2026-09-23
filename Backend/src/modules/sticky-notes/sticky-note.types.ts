import { Types, Document } from 'mongoose';
import { StickyNoteColor, StickyNotePriority, StickyNoteStatus } from './sticky-note.constants';

export interface IChecklistItem {
    id: string;
    text: string;
    completed: boolean;
    createdAt: Date;
    completedAt?: Date | null;
}

export interface IStickyNote {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    title?: string;
    content: string;
    color: StickyNoteColor;
    priority: StickyNotePriority;
    tags: string[];
    isPinned: boolean;
    status: StickyNoteStatus;
    checklist: IChecklistItem[];
    projectId?: Types.ObjectId | null;
    taskId?: Types.ObjectId | null;
    convertedTaskId?: Types.ObjectId | null;
    reminderAt?: Date | null;
    reminderSentAt?: Date | null;
    archivedAt?: Date | null;
    completedAt?: Date | null;
    deletedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface IStickyNoteDocument extends IStickyNote, Document {
    _id: Types.ObjectId;
}

export interface CreateStickyNoteInput {
    title?: string;
    content: string;
    color?: StickyNoteColor;
    priority?: StickyNotePriority;
    tags?: string[];
    isPinned?: boolean;
    checklist?: Array<{
        id?: string;
        text: string;
        completed?: boolean;
    }>;
    projectId?: string | null;
    taskId?: string | null;
    reminderAt?: string | Date | null;
}

export interface UpdateStickyNoteInput {
    title?: string;
    content?: string;
    color?: StickyNoteColor;
    priority?: StickyNotePriority;
    tags?: string[];
    isPinned?: boolean;
    checklist?: Array<{
        id?: string;
        text: string;
        completed?: boolean;
        completedAt?: string | Date | null;
    }>;
    projectId?: string | null;
    taskId?: string | null;
    reminderAt?: string | Date | null;
}

export interface StickyNoteQueryFilters {
    page?: number;
    limit?: number;
    search?: string;
    status?: StickyNoteStatus;
    priority?: StickyNotePriority;
    color?: StickyNoteColor;
    isPinned?: boolean;
    tag?: string;
    projectId?: string;
    taskId?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export interface ConvertToTaskInput {
    projectId?: string;
    title?: string;
    description?: string;
    priority?: string;
    dueDate?: string;
    stageId?: string;
    statusId?: string;
    moduleId?: string;
}

export interface StickyNoteStats {
    total: number;
    active: number;
    completed: number;
    archived: number;
    pinned: number;
    upcomingReminders: number;
}

export type UpcomingTimeframe = 'today' | 'tomorrow' | 'this-week' | 'all';

export interface UpcomingRemindersFilter {
    timeframe?: UpcomingTimeframe;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
}
