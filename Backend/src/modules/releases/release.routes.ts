import { Router } from 'express';
import { ReleaseController } from './release.controller';
import { validateRequest } from '../../middleware/validateRequest';
import {
    createReleaseSchema,
    updateReleaseSchema,
    listReleaseSchema,
    releaseParamSchema,
    releaseVersionBodySchema,
    releaseTasksQuerySchema,
} from './release.validator';

const router = Router({ mergeParams: true });

// GET /api/projects/:projectId/releases
router.get('/', validateRequest(listReleaseSchema), ReleaseController.getReleases);

// POST /api/projects/:projectId/releases
router.post('/', validateRequest(createReleaseSchema), ReleaseController.createRelease);

// GET /api/projects/:projectId/releases/:releaseId/summary
router.get('/:releaseId/summary', validateRequest(releaseParamSchema), ReleaseController.getReleaseSummary);

// GET /api/projects/:projectId/releases/:releaseId/tasks
router.get('/:releaseId/tasks', validateRequest(releaseTasksQuerySchema), ReleaseController.getReleaseTasks);

// POST /api/projects/:projectId/releases/:releaseId/start
router.post('/:releaseId/start', validateRequest(releaseParamSchema), ReleaseController.startRelease);

// POST /api/projects/:projectId/releases/:releaseId/release
router.post('/:releaseId/release', validateRequest(releaseVersionBodySchema), ReleaseController.releaseVersion);

// GET /api/projects/:projectId/releases/:releaseId
router.get('/:releaseId', validateRequest(releaseParamSchema), ReleaseController.getReleaseById);

// PATCH /api/projects/:projectId/releases/:releaseId
router.patch('/:releaseId', validateRequest(updateReleaseSchema), ReleaseController.updateRelease);

// DELETE /api/projects/:projectId/releases/:releaseId
router.delete('/:releaseId', validateRequest(releaseParamSchema), ReleaseController.deleteRelease);

export default router;
