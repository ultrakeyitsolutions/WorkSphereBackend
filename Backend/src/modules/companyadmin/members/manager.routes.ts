import { Router } from 'express';
import * as ManagerController from './manager.controller';

const router = Router();

router.get('/', ManagerController.getManagers);
router.get('/:memberId', ManagerController.getManagerById);
router.put('/:memberId', ManagerController.updateManager);
router.delete('/:memberId', ManagerController.deleteManager);

export default router;
