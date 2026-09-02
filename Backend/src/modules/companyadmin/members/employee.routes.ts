import { Router } from 'express';
import * as EmployeeController from './employee.controller';

const router = Router();

router.get('/', EmployeeController.getEmployees);
router.get('/:memberId', EmployeeController.getEmployeeById);
router.put('/:memberId', EmployeeController.updateEmployee);
router.delete('/:memberId', EmployeeController.deleteEmployee);

export default router;
