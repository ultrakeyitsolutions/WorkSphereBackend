import { Router } from 'express';
import { authorizePermissions } from '../../../middleware/authorization.middleware';
import {
    createFeature,
    getAllFeatures,
    getFeatureById,
    updateFeature,
    changeFeatureStatus,
    deleteFeature,
} from './features.controller';

const featureRouter = Router();

// POST   /api/super-admin/features          → create feature
featureRouter.post('/', authorizePermissions('FEATURE_CREATE'), createFeature);

// GET    /api/super-admin/features          → list all features
featureRouter.get('/', authorizePermissions('FEATURE_READ'), getAllFeatures);

// GET    /api/super-admin/features/:id      → get single feature
featureRouter.get('/:id', authorizePermissions('FEATURE_READ'), getFeatureById);

// PATCH  /api/super-admin/features/:id      → update feature
featureRouter.patch('/:id', authorizePermissions('FEATURE_UPDATE'), updateFeature);

// PATCH  /api/super-admin/features/:id/status → activate / deactivate feature
featureRouter.patch('/:id/status', authorizePermissions('FEATURE_UPDATE'), changeFeatureStatus);

// DELETE /api/super-admin/features/:id      → delete feature
featureRouter.delete('/:id', authorizePermissions('FEATURE_DELETE'), deleteFeature);

export default featureRouter;
