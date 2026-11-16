import mongoose from 'mongoose';
import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']); } catch {}
import dotenv from 'dotenv';
dotenv.config();

async function run() {
    await mongoose.connect(process.env.MONGODB_URI || '');
    const db = mongoose.connection.db;
    const targetEmailArg = process.argv.find(arg => arg.startsWith('--target-email='));
    const targetEmail = targetEmailArg ? targetEmailArg.split('=')[1] : (process.env.TARGET_ADMIN_EMAIL || 'manoharyalla83@gmail.com');

    let company = null;
    if (targetEmail) {
        const user = await db?.collection('users').findOne({ email: targetEmail });
        if (user && user.companyId) {
            company = await db?.collection('companies').findOne({ _id: user.companyId });
        }
    }
    if (!company) {
        company = await db?.collection('companies').findOne({ slug: 'uworksphere-qa' });
    }

    console.log('Target Company:', company ? { _id: company._id, name: company.name, slug: company.slug, email: company.companyEmail } : 'NOT FOUND');
    if (!company) {
        await mongoose.disconnect();
        return;
    }

    const companyId = company._id;
    const collections = [
        'companies', 'companysettings', 'company_module_access', 'subscriptions',
        'designations', 'companyroles', 'users', 'companymembers', 'teams',
        'managerassignments', 'managerpermissions', 'projects', 'projectsettings',
        'projectincharges', 'projectclients', 'projectteammembers', 'stages',
        'modules', 'sprints', 'releases', 'status', 'tasks', 'taskactivities',
        'timetrackings', 'shifts', 'employeeshiftassignments', 'companyleavepolicies',
        'employeemonthlyleavebalances', 'leaverequests', 'holidays', 'attendances',
        'attendanceevents', 'escalationrules', 'escalationevents', 'escalationcases',
        'escalationaudits', 'meetings', 'meetingparticipants', 'calendar_events',
        'conversations', 'conversationparticipants', 'messages',
        'monitoringactivities', 'monitoringalerts', 'notifications', 'auditlogs'
    ];

    console.log('\n================================================================');
    console.log('             INDEPENDENT MONGODB VERIFICATION AUDIT');
    console.log('================================================================');
    
    const projects = await db!.collection('projects').find({ companyId }, { projection: { _id: 1 } }).toArray();
    const pIds = projects.map(p => p._id);

    const conversations = await db!.collection('conversations').find({ companyId }, { projection: { _id: 1 } }).toArray();
    const convIds = conversations.map(c => c._id);

    let totalDocs = 0;
    for (const c of collections) {
        let count = 0;
        if (c === 'companies') {
            count = await db!.collection(c).countDocuments({ _id: companyId });
        } else if (c === 'conversationparticipants' || c === 'messages') {
            count = await db!.collection(c).countDocuments({ conversationId: { $in: convIds } });
        } else if (c === 'projectsettings' || c === 'projectincharges' || c === 'projectclients' || c === 'projectteammembers') {
            count = await db!.collection(c).countDocuments({ projectId: { $in: pIds } });
        } else {
            count = await db!.collection(c).countDocuments({ companyId });
        }
        totalDocs += count;
        console.log(`| ${c.padEnd(30)} | ${String(count).padStart(8)} documents |`);
    }
    console.log('================================================================');
    console.log(`TOTAL QA DOCUMENTS IN MONGODB: ${totalDocs}`);
    console.log('================================================================\n');

    // Test a sample user login check
    const sampleUser = await db!.collection('users').findOne({ email: targetEmail || 'qa.manager01@uworksphere.test' });
    console.log('Sample User (Admin):', {
        id: sampleUser?._id,
        name: sampleUser?.name,
        email: sampleUser?.email,
        companyId: sampleUser?.companyId,
        passwordHashPrefix: sampleUser?.password ? sampleUser.password.substring(0, 20) + '...' : 'NONE',
    });

    await mongoose.disconnect();
}

run().catch(console.error);

