import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { Role } from '../modules/roles/role.model';
import { Permission } from '../modules/permissions/permission.model';

dotenv.config();

const patchPermissions = async () => {
    await connectDatabase();

    const permsToEnsure = [
        { name: 'COMPANY_CREATE', description: 'Allows creating new companies and their admin users' },
        { name: 'COMPANY_READ', description: 'Allows reading company data' },
        { name: 'COMPANY_UPDATE', description: 'Allows updating company data' },
        { name: 'COMPANY_DELETE', description: 'Allows deleting companies' },
        { name: 'COMPANY_SUSPEND', description: 'Allows suspending a company' },
        { name: 'COMPANY_ACTIVATE', description: 'Allows activating a suspended company' },
        { name: 'COMPANY_ADMIN_PASSWORD_RESET', description: 'Allows resetting a company admin password' },
    ];

    const ids: mongoose.Types.ObjectId[] = [];
    for (const perm of permsToEnsure) {
        let doc = await Permission.findOne({ name: perm.name });
        if (!doc) {
            doc = await Permission.create(perm);
            console.log(`  ✔ Created permission: ${perm.name}`);
        } else {
            console.log(`  - Permission already exists: ${perm.name}`);
        }
        ids.push(doc._id as mongoose.Types.ObjectId);
    }

    const role = await Role.findOne({ name: 'SUPER_ADMIN' });
    if (!role) {
        console.error('❌ SUPER_ADMIN role not found. Run npm run seed first.');
        await mongoose.disconnect();
        process.exit(1);
    }

    const existing = (role.permissions as any[]).map(String);
    const toAdd = ids.filter((id) => !existing.includes(String(id)));

    if (toAdd.length > 0) {
        role.permissions.push(...(toAdd as any));
        await role.save();
        console.log(`✅ Added ${toAdd.length} permission(s) to SUPER_ADMIN role.`);
    } else {
        console.log('✅ SUPER_ADMIN role already has all required permissions.');
    }

    await mongoose.disconnect();
    process.exit(0);
};

patchPermissions().catch((e) => {
    console.error('Error:', e.message || e);
    mongoose.disconnect().then(() => process.exit(1));
});
