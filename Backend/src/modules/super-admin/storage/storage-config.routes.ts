import { Router } from 'express';
import { StorageConfigController } from './storage-config.controller';
import { validateRequest } from '../../../middleware/validateRequest';
import {
    updateStorageConfigSchema,
    testStorageConfigSchema,
    rollbackStorageConfigSchema,
} from './storage-config.validator';

const router = Router();

// GET /api/super-admin/storage/configuration
router.get('/configuration', StorageConfigController.getConfiguration);

// PUT /api/super-admin/storage/configuration
router.put(
    '/configuration',
    validateRequest(updateStorageConfigSchema),
    StorageConfigController.updateConfiguration
);

// POST /api/super-admin/storage/test
router.post(
    '/test',
    validateRequest(testStorageConfigSchema),
    StorageConfigController.testConfiguration
);

// GET /api/super-admin/storage/health
router.get('/health', StorageConfigController.getHealth);

// GET /api/super-admin/storage/history
router.get('/history', StorageConfigController.getHistory);

// POST /api/super-admin/storage/rollback/:historyId
router.post(
    '/rollback/:historyId',
    validateRequest(rollbackStorageConfigSchema),
    StorageConfigController.rollback
);

export default router;
