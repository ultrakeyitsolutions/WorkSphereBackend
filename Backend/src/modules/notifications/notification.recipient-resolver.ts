import mongoose, { Types } from 'mongoose';
import { NotificationEventPayload } from './notification.types';

// ─── Recipient Resolver ───────────────────────────────────────────────────
// Server-side resolver that calculates target recipient user IDs for notification events.

export class RecipientResolver {
    /**
     * Resolves an array of unique user IDs to receive the notification.
     * Always excludes the actorId (initiator) unless explicitly configured otherwise.
     */
    public static async resolveRecipients(payload: NotificationEventPayload): Promise<Types.ObjectId[]> {
        const recipientsSet = new Set<string>();

        // 1. Explicitly provided recipient IDs
        const explicitList = payload.recipientIds || payload.explicitRecipientIds;
        if (explicitList && explicitList.length > 0) {
            for (const rid of explicitList) {
                if (rid) recipientsSet.add(rid.toString());
            }
        }

        // 2. Dynamic lookup based on entity / type if recipientIds not fully specified
        if (payload.entityId && payload.entityType) {
            try {
                const dynamicRecipients = await this.resolveDynamicRecipients(payload);
                for (const dr of dynamicRecipients) {
                    if (dr) recipientsSet.add(dr.toString());
                }
            } catch (err) {
                // Non-blocking fallback: if dynamic lookup fails, proceed with explicit recipients
                console.error('[RecipientResolver] Dynamic resolution error:', err);
            }
        }

        // 3. Exclude actor (the person who triggered the event) unless requested
        const actorIdStr = payload.actorId ? payload.actorId.toString() : null;

        const finalRecipientIds: Types.ObjectId[] = [];
        for (const idStr of recipientsSet) {
            if (idStr === actorIdStr && !payload.metadata?.includeActor) {
                continue;
            }
            if (Types.ObjectId.isValid(idStr)) {
                finalRecipientIds.push(new Types.ObjectId(idStr));
            }
        }

        return finalRecipientIds;
    }

    /**
     * Dynamic fallback lookups for Task, Project, Chat, Meeting, Attendance
     */
    private static async resolveDynamicRecipients(payload: NotificationEventPayload): Promise<string[]> {
        const recipients: string[] = [];
        const { entityId, entityType, companyId } = payload;

        if (!entityId || !entityType || !companyId) return recipients;

        const db = mongoose.connection;
        const objectId = Types.ObjectId.isValid(entityId) ? new Types.ObjectId(entityId) : null;
        if (!objectId) return recipients;

        switch (entityType.toUpperCase()) {
            case 'TASK': {
                const task = await db.collection('tasks').findOne(
                    { _id: objectId, companyId: new Types.ObjectId(companyId) },
                    { projection: { assignedToId: 1, createdBy: 1 } }
                );
                if (task) {
                    if (task.assignedToId) recipients.push(task.assignedToId.toString());
                    if (task.createdBy) recipients.push(task.createdBy.toString());
                }
                break;
            }

            case 'PROJECT': {
                const teamMembers = await db.collection('projectteammembers').find(
                    { projectId: objectId }
                ).toArray();
                for (const tm of teamMembers) {
                    if (tm.userId) recipients.push(tm.userId.toString());
                }

                const inCharges = await db.collection('projectincharges').find(
                    { projectId: objectId }
                ).toArray();
                for (const ic of inCharges) {
                    if (ic.userId) recipients.push(ic.userId.toString());
                }
                break;
            }

            case 'CONVERSATION':
            case 'CHAT': {
                const participants = await db.collection('participants').find(
                    { conversationId: objectId, isActive: true }
                ).toArray();
                for (const p of participants) {
                    if (p.userId) recipients.push(p.userId.toString());
                }
                break;
            }

            case 'ATTENDANCE': {
                const companyMembers = await db.collection('companymembers').find(
                    { companyId: new Types.ObjectId(companyId), role: { $in: ['ADMIN', 'MANAGER', 'COMPANY_ADMIN'] }, status: 'ACTIVE' }
                ).toArray();
                for (const cm of companyMembers) {
                    if (cm.userId) recipients.push(cm.userId.toString());
                }
                break;
            }

            case 'MEETING': {
                // Check dedicated meetings collection first
                const meetingDoc = await db.collection('meetings').findOne(
                    { _id: objectId, companyId: new Types.ObjectId(companyId) }
                );
                if (meetingDoc) {
                    if (meetingDoc.organizerId) {
                        recipients.push(meetingDoc.organizerId.toString());
                    }
                    const participants = await db.collection('meetingparticipants').find(
                        { meetingId: objectId }
                    ).toArray();
                    for (const p of participants) {
                        if (p.userId) recipients.push(p.userId.toString());
                    }
                    break;
                }

                // Fallback to legacy calendarevents
                const legacyMeeting = await db.collection('calendarevents').findOne(
                    { _id: objectId, companyId: new Types.ObjectId(companyId) }
                );
                if (legacyMeeting && legacyMeeting.participants) {
                    for (const p of legacyMeeting.participants) {
                        if (p.userId) recipients.push(p.userId.toString());
                    }
                }
                if (legacyMeeting && legacyMeeting.organizer && legacyMeeting.organizer.userId) {
                    recipients.push(legacyMeeting.organizer.userId.toString());
                }
                break;
            }

            case 'CALENDAREVENT':
            case 'CALENDAR': {
                const meeting = await db.collection('calendarevents').findOne(
                    { _id: objectId, companyId: new Types.ObjectId(companyId) }
                );
                if (meeting && meeting.participants) {
                    for (const p of meeting.participants) {
                        if (p.userId) recipients.push(p.userId.toString());
                    }
                }
                if (meeting && meeting.organizer && meeting.organizer.userId) {
                    recipients.push(meeting.organizer.userId.toString());
                }
                break;
            }

            default:
                break;
        }

        return recipients;
    }
}
