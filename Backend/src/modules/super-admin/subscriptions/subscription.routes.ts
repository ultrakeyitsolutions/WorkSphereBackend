import { Router } from 'express';
import { SubscriptionController } from './subscription.controller';
import { validateRequest } from '../../../middleware/validateRequest';
import {
    createSubscriptionSchema,
    changePlanSchema,
    pauseSubscriptionSchema,
    resumeSubscriptionSchema,
    cancelSubscriptionSchema
} from './subscription.schema';
import { authorizePermissions } from '../../../middleware/authorization.middleware';

const router = Router({ mergeParams: true });

// Assume higher level routing handles /api/companies/:companyId/subscription
// And applies SUPER_ADMIN and general auth middlewares.
// We optionally apply finer-grained permissions here, for example 'SUBSCRIPTION_MANAGE'.

router.get('/', authorizePermissions('SUBSCRIPTION_READ'), SubscriptionController.getSubscription);

router.post(
    '/',
    authorizePermissions('SUBSCRIPTION_CREATE'),
    validateRequest(createSubscriptionSchema),
    SubscriptionController.createSubscription
);

router.post(
    '/upgrade',
    authorizePermissions('SUBSCRIPTION_UPDATE'),
    validateRequest(changePlanSchema),
    SubscriptionController.upgradePlan
);

router.post(
    '/downgrade',
    authorizePermissions('SUBSCRIPTION_UPDATE'),
    validateRequest(changePlanSchema),
    SubscriptionController.downgradePlan
);

router.post(
    '/pause',
    authorizePermissions('SUBSCRIPTION_UPDATE'),
    validateRequest(pauseSubscriptionSchema),
    SubscriptionController.pauseSubscription
);

router.post(
    '/resume',
    authorizePermissions('SUBSCRIPTION_UPDATE'),
    validateRequest(resumeSubscriptionSchema),
    SubscriptionController.resumeSubscription
);

router.post(
    '/cancel',
    authorizePermissions('SUBSCRIPTION_DELETE'),
    validateRequest(cancelSubscriptionSchema),
    SubscriptionController.cancelSubscription
);

export default router;
