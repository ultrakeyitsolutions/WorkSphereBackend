import { Schema, model, Document, Types } from 'mongoose';

export enum RatingLabel {
    POOR      = 'Poor',
    FAIR      = 'Fair',
    AVERAGE   = 'Average',
    GOOD      = 'Good',
    EXCELLENT = 'Excellent',
}

export function getRatingLabel(rating: number): RatingLabel {
    switch (rating) {
        case 1: return RatingLabel.POOR;
        case 2: return RatingLabel.FAIR;
        case 3: return RatingLabel.AVERAGE;
        case 4: return RatingLabel.GOOD;
        case 5: return RatingLabel.EXCELLENT;
        default: return RatingLabel.AVERAGE;
    }
}

export interface ITaskExplanationRating extends Document {
    companyId:   Types.ObjectId;
    taskId:      Types.ObjectId;
    ratedById:   Types.ObjectId;   // userId of the person who submitted the rating
    rating:      number;           // 1 – 5
    ratingLabel: RatingLabel;
    createdAt:   Date;
    updatedAt:   Date;
}

const taskExplanationRatingSchema = new Schema<ITaskExplanationRating>(
    {
        companyId:   { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        taskId:      { type: Schema.Types.ObjectId, ref: 'Task',    required: true, index: true },
        ratedById:   { type: Schema.Types.ObjectId, ref: 'User',    required: true, index: true },
        rating:      { type: Number, required: true, min: 1, max: 5 },
        ratingLabel: { type: String, enum: Object.values(RatingLabel), required: true },
    },
    { timestamps: true }
);

// One rating per user per task
taskExplanationRatingSchema.index({ taskId: 1, ratedById: 1 }, { unique: true });

export const TaskExplanationRating = model<ITaskExplanationRating>(
    'TaskExplanationRating',
    taskExplanationRatingSchema
);
export default TaskExplanationRating;
