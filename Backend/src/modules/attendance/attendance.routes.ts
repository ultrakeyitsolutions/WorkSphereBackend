import { Router } from 'express';
import { AttendanceController } from './attendance.controller';

const router = Router();

router.post('/check-in', AttendanceController.checkIn);
router.post('/check-out', AttendanceController.checkOut);
router.get('/status', AttendanceController.getCurrentStatus);

export default router;
