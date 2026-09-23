import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../middleware/auth.middleware';
import { authorizeRoles } from '../../middleware/authorization.middleware';
import {
    getSounds,
    getSound,
    uploadSound,
    updateSound,
    deleteSound,
    getMappings,
    getMapping,
    updateMapping,
    getDefaultSound,
    setDefaultSound,
    testSound,
} from './notification-sound.controller';
import { NOTIFICATION_SOUND_MAX_SIZE_MB } from './notification-sound.constants';

const router = Router();

// Multer memory storage configuration
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: NOTIFICATION_SOUND_MAX_SIZE_MB * 1024 * 1024,
    },
});

const uploadAudioMiddleware = upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
]);

const normalizeUploadedFile = (req: any, _res: any, next: any) => {
    if (req.files) {
        if (req.files['file'] && req.files['file'][0]) {
            req.file = req.files['file'][0];
        } else if (req.files['audio'] && req.files['audio'][0]) {
            req.file = req.files['audio'][0];
        }
    }
    next();
};

// ── Super Admin Authentication & Authorization Middleware ─────────────────────
router.use(authenticate);
router.use(authorizeRoles('SUPER_ADMIN'));

// ── Default Sound Configuration ───────────────────────────────────────────────
// GET /api/superadmin/notification-sounds/default
// PUT /api/superadmin/notification-sounds/default
router.get('/default', getDefaultSound);
router.put('/default', setDefaultSound);

// ── Event-to-Sound Mappings ───────────────────────────────────────────────────
// GET /api/superadmin/notification-sounds/mappings
// GET /api/superadmin/notification-sounds/mappings/:notificationType
// PUT /api/superadmin/notification-sounds/mappings/:notificationType
router.get('/mappings', getMappings);
router.get('/mappings/:notificationType', getMapping);
router.put('/mappings/:notificationType', updateMapping);

// ── Test Sound Preview ────────────────────────────────────────────────────────
// POST /api/superadmin/notification-sounds/test
router.post('/test', testSound);

// ── Sound Library CRUD ────────────────────────────────────────────────────────
// GET    /api/superadmin/notification-sounds
// POST   /api/superadmin/notification-sounds
// GET    /api/superadmin/notification-sounds/:soundId
// PATCH  /api/superadmin/notification-sounds/:soundId
// DELETE /api/superadmin/notification-sounds/:soundId
router.get('/', getSounds);
router.post('/', uploadAudioMiddleware, normalizeUploadedFile, uploadSound);
router.get('/:soundId', getSound);
router.patch('/:soundId', uploadAudioMiddleware, normalizeUploadedFile, updateSound);
router.delete('/:soundId', deleteSound);

export default router;
