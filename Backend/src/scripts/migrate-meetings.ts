const mongoose = require('d:/Office Work/WorkSphereBackend/Backend/node_modules/mongoose');
const crypto = require('crypto');

async function migrateMeetings() {
    const uri = 'mongodb+srv://PawConnect_db_user:8yzDmAfsD8QZZrrc@cluster0.hqawdd0.mongodb.net/WorkSphere';
    await mongoose.connect(uri);
    console.log('Connected to MongoDB. Starting safe & idempotent meeting migration...');

    const db = mongoose.connection.db;
    const calEventsCol = db.collection('calendar_events');
    const meetingsCol = db.collection('meetings');
    const participantsCol = db.collection('meetingparticipants');

    const totalCalEvents = await calEventsCol.countDocuments();
    const initialMeetingsCount = await meetingsCol.countDocuments();
    const initialParticipantsCount = await participantsCol.countDocuments();

    console.log(`Initial state: ${totalCalEvents} calendar_events, ${initialMeetingsCount} meetings, ${initialParticipantsCount} meetingparticipants`);

    const allEvents = await calEventsCol.find({}).toArray();
    let migratedCount = 0;
    let linkedCount = 0;
    let skippedCount = 0;

    const now = new Date();

    for (const ev of allEvents) {
        // 1. Check if meeting already linked to this calendar event
        const existingByCalId = await meetingsCol.findOne({ calendarEventId: ev._id });
        if (existingByCalId) {
            skippedCount++;
            continue;
        }

        // 2. Check if an existing Meeting matches by title, companyId, and start time
        const existingByMatch = await meetingsCol.findOne({
            companyId: ev.companyId,
            title: ev.title,
            scheduledStartAt: ev.startTime,
        });

        if (existingByMatch) {
            await meetingsCol.updateOne(
                { _id: existingByMatch._id },
                { $set: { calendarEventId: ev._id } }
            );
            linkedCount++;
            continue;
        }

        // 3. Migrate CalendarEvent into canonical Meeting
        const startTime = new Date(ev.startTime);
        const endTime = new Date(ev.endTime);
        const durationMinutes = Math.max(
            15,
            Math.round((endTime.getTime() - startTime.getTime()) / 60000)
        );

        let status = 'ACCEPTED';
        if (endTime.getTime() < now.getTime()) {
            status = 'COMPLETED';
        } else if (startTime.getTime() <= now.getTime() && endTime.getTime() >= now.getTime()) {
            status = 'IN_PROGRESS';
        }

        const shortHash = crypto.randomBytes(4).toString('hex');
        const meetingIdStr = `ws-meet-${Date.now().toString(36)}-${shortHash}`;

        const meetingDoc = {
            meetingId: meetingIdStr,
            companyId: ev.companyId,
            organizerId: ev.organizer?.userId || ev.companyId,
            title: ev.title,
            agenda: (ev.agenda && ev.agenda[0]) || ev.description || 'Synced Calendar Conference',
            description: ev.description || null,
            projectId: ev.projectId || null,
            taskId: ev.taskId || null,
            meetingType: ev.isQuickMeeting ? 'QUICK' : 'SCHEDULED',
            meetingLink: ev.meetingUrl || null,
            meetingProvider: ev.provider || (ev.meetingUrl ? 'google_meet' : null),
            externalMeetingId: ev.externalEventId || null,
            calendarEventId: ev._id,
            scheduledStartAt: startTime,
            scheduledEndAt: endTime,
            durationMinutes,
            timezone: ev.timeZone || 'Asia/Kolkata',
            status,
            currentVersion: 1,
            reminded15Min: true,
            reminded5Min: true,
            completedAt: status === 'COMPLETED' ? endTime : null,
            createdAt: ev.createdAt || now,
            updatedAt: ev.updatedAt || now,
        };

        const insertResult = await meetingsCol.insertOne(meetingDoc);
        const newMeetingId = insertResult.insertedId;

        // 4. Create participant records
        const participants = ev.participants || [];
        const participantDocs = [];

        // Organizer
        if (ev.organizer && ev.organizer.userId) {
            participantDocs.push({
                meetingId: newMeetingId,
                userId: ev.organizer.userId,
                companyId: ev.companyId,
                role: 'ORGANIZER',
                responseStatus: 'ACCEPTED',
                responseAt: ev.createdAt || now,
                joinedAt: status === 'COMPLETED' ? startTime : null,
                createdAt: ev.createdAt || now,
                updatedAt: ev.updatedAt || now,
            });
        }

        // Invited members
        for (const p of participants) {
            if (p.userId && (!ev.organizer?.userId || p.userId.toString() !== ev.organizer.userId.toString())) {
                const isAccepted = p.status === 'accepted' || p.status === 'organizer';
                participantDocs.push({
                    meetingId: newMeetingId,
                    userId: p.userId,
                    companyId: ev.companyId,
                    role: p.isCoOrganizer ? 'REQUIRED' : 'REQUIRED',
                    responseStatus: isAccepted ? 'ACCEPTED' : (p.status === 'declined' ? 'DECLINED' : 'PENDING'),
                    responseAt: p.respondedAt || (isAccepted ? now : null),
                    joinedAt: (status === 'COMPLETED' && isAccepted) ? startTime : null,
                    createdAt: ev.createdAt || now,
                    updatedAt: ev.updatedAt || now,
                });
            }
        }

        if (participantDocs.length > 0) {
            await participantsCol.insertMany(participantDocs);
        }

        migratedCount++;
    }

    const finalMeetingsCount = await meetingsCol.countDocuments();
    const finalParticipantsCount = await participantsCol.countDocuments();

    console.log('\n=== Migration Report ===');
    console.log(`Total CalendarEvents processed: ${allEvents.length}`);
    console.log(`New canonical Meetings created: ${migratedCount}`);
    console.log(`Existing Meetings linked: ${linkedCount}`);
    console.log(`Already synchronized: ${skippedCount}`);
    console.log(`Final Meetings count: ${finalMeetingsCount} (was ${initialMeetingsCount})`);
    console.log(`Final Participants count: ${finalParticipantsCount} (was ${initialParticipantsCount})`);
    console.log('Migration completed successfully!');

    await mongoose.disconnect();
}

migrateMeetings().catch(console.error);
