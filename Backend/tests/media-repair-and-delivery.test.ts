import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudinaryStorageProvider } from '../src/infrastructure/storage/providers/cloudinary-storage.provider';
import FileService from '../src/modules/files/file.service';
import FileController from '../src/modules/files/file.controller';

describe('Media Architecture & Cloudinary Repair Suite', () => {
    describe('CloudinaryStorageProvider.toHttpsDeliveryUrl Repair Logic', () => {
        it('repairs malformed Cloudinary PDF URL missing raw/upload segment (Bug B)', () => {
            const malformedUrl =
                'https://res.cloudinary.com/kjl8mluw/worksphere/companies/6aeb64160f41569b98dfa80f/chats/1794293855384-b557692f-UWorksphere_Professional_Documentation_FIXED.pdf';
            const repaired = CloudinaryStorageProvider.toHttpsDeliveryUrl(malformedUrl);
            expect(repaired).toBe(
                'https://res.cloudinary.com/kjl8mluw/raw/upload/worksphere/companies/6aeb64160f41569b98dfa80f/chats/1794293855384-b557692f-UWorksphere_Professional_Documentation_FIXED.pdf'
            );
        });

        it('repairs malformed Cloudinary video URL missing video/upload segment (Bug A)', () => {
            const malformedUrl =
                'https://res.cloudinary.com/kjl8mluw/worksphere/companies/6aeb64160f41569b98dfa80f/chats/1794293855384-video.mp4';
            const repaired = CloudinaryStorageProvider.toHttpsDeliveryUrl(malformedUrl);
            expect(repaired).toBe(
                'https://res.cloudinary.com/kjl8mluw/video/upload/worksphere/companies/6aeb64160f41569b98dfa80f/chats/1794293855384-video.mp4'
            );
        });

        it('repairs malformed Cloudinary image URL missing image/upload segment', () => {
            const malformedUrl =
                'https://res.cloudinary.com/kjl8mluw/worksphere/companies/6aeb64160f41569b98dfa80f/chats/1794293855384-photo.png';
            const repaired = CloudinaryStorageProvider.toHttpsDeliveryUrl(malformedUrl);
            expect(repaired).toBe(
                'https://res.cloudinary.com/kjl8mluw/image/upload/worksphere/companies/6aeb64160f41569b98dfa80f/chats/1794293855384-photo.png'
            );
        });

        it('preserves already-valid Cloudinary URLs', () => {
            const validRaw =
                'https://res.cloudinary.com/kjl8mluw/raw/upload/v1234/worksphere/companies/test.pdf';
            expect(CloudinaryStorageProvider.toHttpsDeliveryUrl(validRaw)).toBe(validRaw);

            const validVideo =
                'https://res.cloudinary.com/kjl8mluw/video/upload/v1234/worksphere/companies/video.mp4';
            expect(CloudinaryStorageProvider.toHttpsDeliveryUrl(validVideo)).toBe(validVideo);
        });

        it('handles custom delivery URL without stripping resource_type and upload prefix', () => {
            const customDelivery = 'https://res.cloudinary.com/kjl8mluw';
            const storageKey = 'worksphere/companies/test.pdf';
            const url = CloudinaryStorageProvider.toHttpsDeliveryUrl(storageKey, 'kjl8mluw', customDelivery);
            expect(url).toBe('https://res.cloudinary.com/kjl8mluw/raw/upload/worksphere/companies/test.pdf');
        });
    });

    describe('Signed URL Generation & Authorized Streaming', () => {
        const provider = new CloudinaryStorageProvider({
            cloudName: 'test-cloud',
            apiKey: 'test-key',
            apiSecret: 'test-secret',
        });

        it('generates authorized signed URLs for raw documents with signature parameters', () => {
            const signedUrl = provider.getSignedUrl('worksphere/test.pdf');
            expect(signedUrl).toContain('test-cloud');
            expect(signedUrl).toContain('signature=');
            expect(signedUrl).toContain('api_key=test-key');
        });

        it('generates clean delivery URLs for video playback with video/upload resource type', () => {
            const videoUrl = provider.getSignedUrl('worksphere/demo.mp4');
            expect(videoUrl).toContain('test-cloud');
            expect(videoUrl).toContain('video/upload');
            expect(videoUrl).toContain('worksphere/demo.mp4');
        });

        it('generates video thumbnail preview URL converting video to JPG', () => {
            const thumbUrl = provider.getThumbnailUrl('worksphere/demo.mp4');
            expect(thumbUrl).toContain('test-cloud');
            expect(thumbUrl).toContain('video/upload');
            expect(thumbUrl).toContain('.jpg');
        });
    });

    describe('Download Direct Streaming Verification', () => {
        it('streams file with attachment disposition and correct MIME type instead of redirecting to raw HTML error pages', async () => {
            const mockFile = {
                _id: '64b12345cdef678901234567',
                originalName: 'presentation.pdf',
                mimeType: 'application/pdf',
                size: 1024,
                storageKey: 'worksphere/presentation.pdf',
                storageUrl: 'https://res.cloudinary.com/test-cloud/raw/upload/worksphere/presentation.pdf',
            };

            vi.spyOn(FileService, 'getAuthorizedFile').mockResolvedValue(mockFile as any);
            const streamSpy = vi.spyOn(FileService, 'streamFile').mockResolvedValue(undefined as any);

            const req: any = {
                user: { userId: 'user1', companyId: 'comp1', role: 'MEMBER' },
                params: { fileId: '64b12345cdef678901234567' },
                headers: {},
                query: {},
                method: 'GET',
            };

            const res: any = {
                setHeader: vi.fn(),
                redirect: vi.fn(),
                status: vi.fn().mockReturnThis(),
                json: vi.fn(),
                headersSent: false,
            };

            await FileController.downloadFile(req, res);

            // Verified: streamFile is called with 'attachment' disposition, preventing redirect to Cloudinary 404/401 HTML
            expect(streamSpy).toHaveBeenCalledWith(
                '64b12345cdef678901234567',
                expect.any(Object),
                undefined,
                res,
                false,
                'attachment'
            );
            expect(res.redirect).not.toHaveBeenCalled();
        });
    });
});

