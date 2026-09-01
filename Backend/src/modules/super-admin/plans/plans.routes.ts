import { Router } from 'express';
import { authorizePermissions } from '../../../middleware/authorization.middleware';
import {
    createPlan,
    getAllPlans,
    getPlanById,
    updatePlan,
    changePlanStatus,
} from './plan.controller';

const planRouter = Router();

// POST   /api/super-admin/plans               → create plan + entitlements (transaction)
planRouter.post('/', authorizePermissions('PLAN_CREATE'), createPlan);

// GET    /api/super-admin/plans               → list all plans with entitlements
// GET    /api/super-admin/plans?includeArchived=true  → include archived plans
planRouter.get('/', authorizePermissions('PLAN_READ'), getAllPlans);

// GET    /api/super-admin/plans/:id           → get single plan with entitlements
planRouter.get('/:id', authorizePermissions('PLAN_READ'), getPlanById);

// PATCH  /api/super-admin/plans/:id           → update plan fields + entitlements
planRouter.patch('/:id', authorizePermissions('PLAN_UPDATE'), updatePlan);

// PATCH  /api/super-admin/plans/:id/status   → activate / deactivate plan
planRouter.patch('/:id/status', authorizePermissions('PLAN_DELETE'), changePlanStatus);

export default planRouter;
