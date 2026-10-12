import mongoose from 'mongoose';
import { env } from '../config/env';
import { decrypt } from '../utils/encryption';

async function repairDB() {
    await mongoose.connect(env.MONGODB_URI);
    console.log('Connected to MongoDB. Scanning calendar_oauth_tokens...');

    const oauthCol = mongoose.connection.collection('calendar_oauth_tokens');
    const allOAuths = await oauthCol.find({}).toArray();
    for (const o of allOAuths) {
        if (o.accessTokenEncrypted) {
            try {
                const decrypted = decrypt(o.accessTokenEncrypted);
                if (decrypted.startsWith('ws_acc_')) {
                    console.log('Found fake mock OAuth token for', o.accountEmail, '- setting isConnected: false');
                    await oauthCol.updateOne({ _id: o._id }, { $set: { isConnected: false } });
                }
            } catch (e: any) {
                console.error('Decryption failed for token:', e.message);
            }
        }
    }

    console.log('Scanning calendar_events for fake URLs...');
    const eventCol = mongoose.connection.collection('calendar_events');
    const allEvents = await eventCol.find({ provider: 'google_meet' }).toArray();
    for (const ev of allEvents) {
        if (ev.meetingUrl) {
            const match = ev.meetingUrl.match(/^https:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/i);
            const isFake = match && ev.externalEventId === match[1];
            if (isFake) {
                console.log('Cleaning up fake meetingUrl', ev.meetingUrl, 'on event', ev.title);
                await eventCol.updateOne({ _id: ev._id }, { $set: { meetingUrl: null, externalEventId: null } });
            }
        }
    }

    console.log('Database repair complete!');
    await mongoose.disconnect();
}

repairDB().catch(console.error);
