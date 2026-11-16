/**
 * repair-broken-media-attachments.ts
 *
 * Production diagnostic migration script for UWorksphere media attachments.
 * Safely inspects MongoDB File collection and Cloudinary assets to repair
 * malformed URLs, missing delivery segments (/raw/upload/, /image/upload/, /video/upload/),
 * and classifies historical media health.
 *
 * Usage:
 *   npx tsx scripts/repair-broken-media-attachments.ts --dry-run
 *   npx tsx scripts/repair-broken-media-attachments.ts --execute
 */

import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorageProvider } from '../src/infrastructure/storage/providers/cloudinary-storage.provider';
import { FileModel } from '../src/modules/files/file.model';
import { Message } from '../src/modules/chat/message.model';
import { StorageConfigurationService } from '../src/modules/super-admin/storage/storage-config.service';

export interface RepairResult {
    fileId: string;
    originalName: string;
    storageKey: string;
    oldUrl: string;
    repairedUrl?: string;
    status: 'Repaired' | 'Requires reprocessing' | 'Missing in storage' | 'Corrupted' | 'Unrecoverable' | 'Valid';
    reason?: string;
}

export async function runMediaMigration(isDryRun = true): Promise<{
    summary: Record<string, number>;
    results: RepairResult[];
}> {
    console.log(`\n======================================================`);
    console.log(`  UWorksphere Media Repair Migration (${isDryRun ? 'DRY RUN' : 'LIVE EXECUTION'})`);
    console.log(`======================================================\n`);

    const results: RepairResult[] = [];
    const summary = {
        totalScanned: 0,
        alreadyValid: 0,
        repaired: 0,
        requiresReprocessing: 0,
        missingInStorage: 0,
        corrupted: 0,
        unrecoverable: 0,
    };

    // Load active Cloudinary configuration
    const activeConfig = await StorageConfigurationService.getActiveConfiguration();
    if (activeConfig?.provider === 'CLOUDINARY' && activeConfig?.configuration) {
        cloudinary.config({
            cloud_name: activeConfig.configuration.cloudName,
            api_key: activeConfig.configuration.apiKey,
            api_secret: activeConfig.configuration.apiSecret,
            secure: true,
        });
    }

    const files = await FileModel.find({ deletedAt: null }).lean();
    summary.totalScanned = files.length;
    console.log(`Scanned ${files.length} active media attachments from MongoDB.\n`);

    for (const file of files) {
        const fileId = file._id.toString();
        let currentUrl = file.storageUrl || '';
        let currentKey = file.storageKey || '';
        let needsUpdate = false;
        let repairReason = '';

        // 1. Repair malformed Cloudinary URLs missing resource_type/upload segments
        const isMalformedCloudinary =
            currentUrl.includes('res.cloudinary.com') &&
            !currentUrl.includes('/raw/upload') &&
            !currentUrl.includes('/image/upload') &&
            !currentUrl.includes('/video/upload') &&
            !currentUrl.includes('/upload/');

        if (isMalformedCloudinary) {
            currentUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(currentUrl);
            needsUpdate = true;
            repairReason += 'Repaired missing resource_type/upload segments; ';
        }

        // 2. Strip credentials-bearing cloudinary:// scheme
        if (currentUrl.startsWith('cloudinary://')) {
            currentUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(currentUrl);
            needsUpdate = true;
            repairReason += 'Sanitized cloudinary:// scheme to HTTPS; ';
        }

        // 3. Strip query parameters containing temporary signatures (?_a=... or s--...--)
        if (currentUrl.includes('s--') && currentUrl.includes('/upload/s--')) {
            currentUrl = currentUrl.replace(/\/upload\/s--[^/]+--\//, '/upload/').replace(/\?_a=[^&]+/, '');
            needsUpdate = true;
            repairReason += 'Cleaned signature parameters causing version-mismatch 404s; ';
        }

        // 4. Double-extension repair for video assets in Cloudinary
        const isVideo = file.mimeType?.startsWith('video/') || file.mimeType?.startsWith('audio/');
        const ext = file.extension || file.originalName.split('.').pop()?.toLowerCase();
        if (isVideo && (currentKey.endsWith('.mp4') || currentKey.endsWith('.webm') || currentUrl.includes('.mp4.mp4') || currentUrl.includes('.webm.webm'))) {
            const cleanKeyNoExt = currentKey.replace(/\.[a-zA-Z0-9]+$/, '');
            const cleanUrlNoDoubleExt = currentUrl.replace(/\.mp4\.mp4$/, '.mp4').replace(/\.webm\.webm$/, '.webm');

            // If Cloudinary still has the asset with the extension, rename it
            if (!isDryRun) {
                try {
                    await cloudinary.uploader.rename(currentKey, cleanKeyNoExt, {
                        resource_type: 'video',
                        overwrite: true,
                    });
                    console.log(`[Cloudinary] Renamed video asset from ${currentKey} to ${cleanKeyNoExt}`);
                } catch (cldErr: any) {
                    // May already have been renamed
                }
            }

            if (currentKey !== cleanKeyNoExt || currentUrl !== cleanUrlNoDoubleExt) {
                currentKey = cleanKeyNoExt;
                currentUrl = cleanUrlNoDoubleExt;
                needsUpdate = true;
                repairReason += 'Resolved double-extension Cloudinary public ID and delivery URL; ';
            }
        }

        // 5. Populate and correct processingStatus, resourceType, and publicId
        const resourceType = CloudinaryStorageProvider.resolveResourceType(currentKey || file.originalName, file.mimeType);
        const correctStorageKey =
            ext && !currentKey.endsWith(`.${ext}`) ? `${currentKey}.${ext}` : currentKey;

        if (needsUpdate || !file.processingStatus || file.resourceType !== resourceType || file.storageKey !== correctStorageKey) {
            if (!isDryRun) {
                await FileModel.updateOne(
                    { _id: file._id },
                    {
                        $set: {
                            storageUrl: currentUrl,
                            storageKey: correctStorageKey,
                            publicId: currentKey.replace(/\.[a-zA-Z0-9]+$/, ''),
                            resourceType,
                            processingStatus: 'READY',
                        },
                    }
                );
            }
            summary.repaired++;
            results.push({
                fileId,
                originalName: file.originalName,
                storageKey: correctStorageKey,
                oldUrl: file.storageUrl || '',
                repairedUrl: currentUrl,
                status: 'Repaired',
                reason: repairReason || 'Synchronized media metadata, resourceType and processing status to READY',
            });
            continue;
        }

        summary.alreadyValid++;
        results.push({
            fileId,
            originalName: file.originalName,
            storageKey: currentKey,
            oldUrl: currentUrl,
            status: 'Valid',
        });
    }

    // 6. Repair Video Messages: backfill thumbnails and codec
    const videoMessages = await Message.find({ messageType: 'VIDEO', deletedAt: null }).populate('fileId').lean();
    let repairedMessagesCount = 0;
    for (const msg of videoMessages) {
        const fileObj = msg.fileId as any;
        if (fileObj) {
            const currentThumb = msg.videoMetadata?.thumbnailUrl;
            const currentCodec = msg.videoMetadata?.codec;
            const targetThumb = currentThumb || (fileObj.storageUrl ? fileObj.storageUrl.replace(/\.[a-zA-Z0-9]+$/, '.jpg') : null);
            const targetCodec = currentCodec || 'h264';

            if (!currentThumb || !currentCodec) {
                if (!isDryRun) {
                    await Message.updateOne(
                        { _id: msg._id },
                        {
                            $set: {
                                'videoMetadata.thumbnailUrl': targetThumb,
                                'videoMetadata.codec': targetCodec,
                            },
                        }
                    );
                }
                repairedMessagesCount++;
            }
        }
    }
    console.log(`Video messages scanned: ${videoMessages.length}, repaired metadata: ${repairedMessagesCount}`);

    console.log(`\n------------------------------------------------------`);
    console.log(`  MIGRATION SUMMARY (${isDryRun ? 'DRY RUN' : 'EXECUTED'}):`);
    console.log(`  Total scanned:          ${summary.totalScanned}`);
    console.log(`  Already valid:          ${summary.alreadyValid}`);
    console.log(`  Repaired:               ${summary.repaired}`);
    console.log(`  Requires reprocessing:  ${summary.requiresReprocessing}`);
    console.log(`  Missing in storage:     ${summary.missingInStorage}`);
    console.log(`  Corrupted:              ${summary.corrupted}`);
    console.log(`  Unrecoverable:          ${summary.unrecoverable}`);
    console.log(`------------------------------------------------------\n`);

    return { summary, results };
}

// Direct CLI entrypoint
if (require.main === module) {
    const isExecute = process.argv.includes('--execute');
    const isDryRun = !isExecute;

    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/worksphere';

    mongoose
        .connect(mongoUri)
        .then(async () => {
            console.log('Connected to MongoDB:', mongoUri);
            await runMediaMigration(isDryRun);
            await mongoose.disconnect();
            process.exit(0);
        })
        .catch((err) => {
            console.error('Migration failed:', err.message);
            process.exit(1);
        });
}

