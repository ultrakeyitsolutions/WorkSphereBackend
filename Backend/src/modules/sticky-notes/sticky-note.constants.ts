export enum StickyNoteColor {
    YELLOW = 'YELLOW',
    BLUE = 'BLUE',
    GREEN = 'GREEN',
    RED = 'RED',
    PURPLE = 'PURPLE',
    ORANGE = 'ORANGE',
    GRAY = 'GRAY',
}

export enum StickyNotePriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    URGENT = 'URGENT',
}

export enum StickyNoteStatus {
    ACTIVE = 'ACTIVE',
    COMPLETED = 'COMPLETED',
    ARCHIVED = 'ARCHIVED',
}

export const STICKY_NOTE_COLORS = Object.values(StickyNoteColor);
export const STICKY_NOTE_PRIORITIES = Object.values(StickyNotePriority);
export const STICKY_NOTE_STATUSES = Object.values(StickyNoteStatus);

export const ALLOWED_SORT_FIELDS = [
    'createdAt',
    'updatedAt',
    'reminderAt',
    'priority',
    'title',
    'isPinned',
] as const;

export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_LENGTH = 10000;
export const MAX_TAGS_COUNT = 30;
export const MAX_CHECKLIST_ITEMS = 100;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
