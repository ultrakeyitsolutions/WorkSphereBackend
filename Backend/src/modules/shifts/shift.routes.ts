import { Router } from 'express';
import { ShiftController } from './shift.controller';
import { validateRequest } from '../../middleware/validateRequest';
import {
    createShiftSchema,
    updateShiftSchema,
    shiftParamSchema,
    listShiftQuerySchema,
    assignShiftSchema,
    bulkAssignShiftSchema,
    listShiftAssignmentQuerySchema,
    employeeParamSchema,
} from './shift.validator';

const router = Router();

// ─── Shift CRUD ───────────────────────────────────────────────────────────────
// POST   /api/v1/company/shifts
// GET    /api/v1/company/shifts
// GET    /api/v1/company/shifts/:shiftId
// PATCH  /api/v1/company/shifts/:shiftId
// DELETE /api/v1/company/shifts/:shiftId (soft delete / deactivate)

router.post('/', validateRequest(createShiftSchema), ShiftController.createShift);
router.get('/', validateRequest(listShiftQuerySchema), ShiftController.getShifts);
router.get('/:shiftId', validateRequest(shiftParamSchema), ShiftController.getShiftById);
router.patch('/:shiftId', validateRequest(updateShiftSchema), ShiftController.updateShift);
router.delete('/:shiftId', validateRequest(shiftParamSchema), ShiftController.deactivateShift);

export default router;
