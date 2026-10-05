import { Router } from 'express';
import overviewRoutes from './overview/overview.routes';
import companiesRoutes from './companies/dashboard-companies.routes';
import usersRoutes from './users/users.routes';
import projectsRoutes from './projects/projects.routes';
import analyticsRoutes from './analytics/analytics.routes';
import subscriptionsRoutes from './subscriptions/dashboard-subscriptions.routes';
import securityRoutes from './security/security.routes';
import auditRoutes from './audit/audit.routes';
import impersonationRoutes from './impersonation/impersonation.routes';
import systemHealthRoutes from './system-health/system-health.routes';
import { notificationSoundRoutes } from '../notification-sounds';
import globalSearchRoutes from './global-search/global-search.routes';

const router = Router();

// Modular superadmin sub-routers
router.use('/overview', overviewRoutes);
router.use('/companies', companiesRoutes);
router.use('/users', usersRoutes);
router.use('/projects', projectsRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/subscriptions', subscriptionsRoutes);
router.use('/security', securityRoutes);
router.use('/audit', auditRoutes);
router.use('/impersonation', impersonationRoutes);
router.use('/system-health', systemHealthRoutes);
router.use('/notification-sounds', notificationSoundRoutes);
router.use('/global-search', globalSearchRoutes);

export default router;

export * from './overview/overview.service';
export * from './overview/overview.controller';
export * from './companies/dashboard-companies.service';
export * from './companies/dashboard-companies.controller';
export * from './users/users.service';
export * from './users/users.controller';
export * from './projects/projects.service';
export * from './projects/projects.controller';
export * from './analytics/analytics.service';
export * from './analytics/analytics.controller';
export * from './subscriptions/dashboard-subscriptions.service';
export * from './subscriptions/dashboard-subscriptions.controller';
export * from './security/security.service';
export * from './security/security.controller';
export * from './audit/audit.service';
export * from './audit/audit.controller';
export * from './system-health/system-health.service';
export * from './system-health/system-health.controller';
