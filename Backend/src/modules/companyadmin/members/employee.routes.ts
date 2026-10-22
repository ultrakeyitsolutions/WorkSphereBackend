import { Router } from 'express';
import * as EmployeeController from './employee.controller';
import { updateMemberStatus } from './member.controller';

const router = Router();

router.get('/', EmployeeController.getEmployees);
router.get('/:memberId', EmployeeController.getEmployeeById);
router.put('/:memberId', EmployeeController.updateEmployee);
router.patch('/:memberId/status', updateMemberStatus);
router.delete('/:memberId', EmployeeController.deleteEmployee);

export default router;
