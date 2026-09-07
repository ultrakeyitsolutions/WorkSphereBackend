import { Router } from 'express';
import { TaskIntelligenceController } from './task-intelligence.controller';

const router = Router();

router.get('/:taskId', TaskIntelligenceController.getTaskIntelligence);

export default router;
