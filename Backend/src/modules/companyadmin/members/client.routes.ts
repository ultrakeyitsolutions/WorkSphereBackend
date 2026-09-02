import { Router } from 'express';
import * as ClientController from './client.controller';

const router = Router();

router.get('/', ClientController.getClients);
router.get('/:memberId', ClientController.getClientById);
router.put('/:memberId', ClientController.updateClient);
router.delete('/:memberId', ClientController.deleteClient);

export default router;
