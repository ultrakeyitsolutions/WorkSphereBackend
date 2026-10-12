import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import CalendarEvent from '../src/modules/calendar/calendar-event.model';

describe('CalendarEvent Mongoose Model Schema Validation', () => {
    const validCompanyId = new Types.ObjectId();
    const validOrganizerId = new Types.ObjectId();
    const participant1Id = new Types.ObjectId();
    const participant2Id = new Types.ObjectId();
    const participant3Id = new Types.ObjectId();

    const baseEvent = {
        companyId: validCompanyId,
        title: 'Strategy & Roadmap Review',
        startTime: new Date('2026-10-15T10:00:00Z'),
        endTime: new Date('2026-10-15T11:00:00Z'),
        timeZone: 'Asia/Kolkata',
        organizer: {
            userId: validOrganizerId,
            name: 'Sarah Connor',
            email: 'sarah@worksphere.com',
        },
    };

    it('should pass validation when multiple participants have status "invited" and normalize them to "pending"', async () => {
        const event = new CalendarEvent({
            ...baseEvent,
            participants: [
                {
                    userId: validOrganizerId,
                    name: 'Sarah Connor',
                    email: 'sarah@worksphere.com',
                    status: 'organizer',
                },
                {
                    userId: participant1Id,
                    name: 'John Doe',
                    email: 'john@worksphere.com',
                    status: 'invited',
                },
                {
                    userId: participant2Id,
                    name: 'Jane Smith',
                    email: 'jane@worksphere.com',
                    status: 'invited',
                },
                {
                    userId: participant3Id,
                    name: 'Bob Wilson',
                    email: 'bob@worksphere.com',
                    status: 'invited',
                },
            ],
        });

        const validationError = await event.validate().catch((err) => err);
        expect(validationError).toBeUndefined();

        // Verify status was normalized to 'pending'
        expect(event.participants[0].status).toBe('organizer');
        expect(event.participants[1].status).toBe('pending');
        expect(event.participants[2].status).toBe('pending');
        expect(event.participants[3].status).toBe('pending');
    });

    it('should validate all supported participant statuses: accepted, declined, tentative, pending, organizer', async () => {
        const event = new CalendarEvent({
            ...baseEvent,
            participants: [
                {
                    userId: validOrganizerId,
                    name: 'Organizer User',
                    email: 'org@worksphere.com',
                    status: 'organizer',
                },
                {
                    userId: new Types.ObjectId(),
                    name: 'Accepted User',
                    email: 'acc@worksphere.com',
                    status: 'accepted',
                },
                {
                    userId: new Types.ObjectId(),
                    name: 'Pending User',
                    email: 'pend@worksphere.com',
                    status: 'pending',
                },
                {
                    userId: new Types.ObjectId(),
                    name: 'Declined User',
                    email: 'dec@worksphere.com',
                    status: 'declined',
                },
                {
                    userId: new Types.ObjectId(),
                    name: 'Tentative User',
                    email: 'tent@worksphere.com',
                    status: 'tentative',
                },
            ],
        });

        const validationError = await event.validate().catch((err) => err);
        expect(validationError).toBeUndefined();
        expect(event.participants.map((p) => p.status)).toEqual([
            'organizer',
            'accepted',
            'pending',
            'declined',
            'tentative',
        ]);
    });

    it('should reject invalid status with Mongoose ValidationError', async () => {
        const event = new CalendarEvent({
            ...baseEvent,
            participants: [
                {
                    userId: new Types.ObjectId(),
                    name: 'Invalid User',
                    email: 'invalid@worksphere.com',
                    status: 'unsupported_status_xyz',
                },
            ],
        });

        let validationError: any;
        try {
            await event.validate();
        } catch (err) {
            validationError = err;
        }

        expect(validationError).toBeDefined();
        expect(validationError.name).toBe('ValidationError');
        expect(validationError.errors['participants.0.status']).toBeDefined();
    });

    it('should default participant status to pending if not provided', async () => {
        const event = new CalendarEvent({
            ...baseEvent,
            participants: [
                {
                    userId: new Types.ObjectId(),
                    name: 'Default User',
                    email: 'default@worksphere.com',
                },
            ],
        });

        await event.validate();
        expect(event.participants[0].status).toBe('pending');
    });
});
