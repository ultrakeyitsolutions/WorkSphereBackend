import { Router } from 'express';
import { ShiftController } from './shift.controller';
import { validateRequest } from '../../middleware/validateRequest';
import {
    assignShiftSchema,
    bulkAssignShiftSchema,
    listShiftAssignmentQuerySchema,
    employeeParamSchema,
    idSchema,
} from './shift.validator';
import { z } from 'zod';

const router = Router();

const assignmentParamSchema = z.object({
    params: z.object({
        assignmentId: idSchema,
    }),
});

// ─── Shift Assignments ────────────────────────────────────────────────────────
// GET    /api/v1/company/shift-assignments
// POST   /api/v1/company/shift-assignments
// POST   /api/v1/company/shift-assignments/bulk
// DELETE /api/v1/company/shift-assignments/:assignmentId
// GET    /api/v1/company/shift-assignments/employees/:employeeId/current
// GET    /api/v1/company/shift-assignments/employees/:employeeId/history

router.get('/', validateRequest(listShiftAssignmentQuerySchema), ShiftController.getShiftAssignments);
router.post('/', validateRequest(assignShiftSchema), ShiftController.assignShift);
router.post('/bulk', validateRequest(bulkAssignShiftSchema), ShiftController.bulkAssignShift);
router.delete('/:assignmentId', validateRequest(assignmentParamSchema), ShiftController.endAssignment);
router.get('/employees/:employeeId/current', validateRequest(employeeParamSchema), ShiftController.getEmployeeShift);
router.get('/employees/:employeeId/history', validateRequest(employeeParamSchema), ShiftController.getEmployeeShiftHistory);

export default router;
