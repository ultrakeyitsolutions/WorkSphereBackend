import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Company } from '../modules/super-admin/companies/company.model';
import { CompanySettings, DEFAULT_GENERAL_SETTINGS, DEFAULT_FEATURE_FLAGS, DEFAULT_ATTENDANCE_POLICIES, DEFAULT_SECURITY_POLICIES } from '../modules/companyadmin/settings/company-settings.model';

dotenv.config();

/**
 * Idempotent migration script to backfill settings for existing companies.
 */
export const seedCompanySettings = async () => {
    try {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGODB_URI as string);
            console.log('📦 Connected to MongoDB');
        }

        const companies = await Company.find({}).lean();
        console.log(`Found ${companies.length} companies to evaluate for settings initialization.`);

        let createdCount = 0;
        let skippedCount = 0;

        for (const company of companies) {
            const existing = await CompanySettings.findOne({ companyId: company._id });
            if (!existing) {
                await CompanySettings.create({
                    companyId: company._id,
                    general: {
                        timezone: company.timezone || DEFAULT_GENERAL_SETTINGS.timezone,
                        currency: company.currency || DEFAULT_GENERAL_SETTINGS.currency,
                        dateFormat: DEFAULT_GENERAL_SETTINGS.dateFormat,
                        language: DEFAULT_GENERAL_SETTINGS.language,
                    },
                    features: { ...DEFAULT_FEATURE_FLAGS },
                    attendancePolicies: { ...DEFAULT_ATTENDANCE_POLICIES },
                    securityPolicies: { ...DEFAULT_SECURITY_POLICIES },
                    schemaVersion: 1,
                });
                createdCount++;
                console.log(`+ Initialized settings for company: ${company.name} (${company._id})`);
            } else {
                skippedCount++;
            }
        }

        console.log(`✅ Company settings migration complete: ${createdCount} created, ${skippedCount} already existed.`);
    } catch (error) {
        console.error('❌ Company settings migration failed:', error);
        throw error;
    }
};

if (require.main === module) {
    seedCompanySettings()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}
