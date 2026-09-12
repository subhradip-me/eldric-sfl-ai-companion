/**
 * farm/ barrel — re-exports all farm module singletons, normalizer, extractors, and clients.
 */
export { FarmNormalizer, farmNormalizer } from './FarmNormalizer.js';
export * from './FarmNormalizer.js';
export * from './contextExtractors.js';
export * from './temporalContextExtractors.js';
export * from './historyContextExtractors.js';
export * from './plannerContextExtractors.js';
export { SunflowerClient, sunflowerClient } from './SunflowerClient.js';
export { SnapshotService, snapshotService } from './SnapshotService.js';
export { ActivityService, activityService } from './ActivityService.js';
export { DashboardService, dashboardService } from './DashboardService.js';
export type { DashboardViewModel } from './DashboardService.js';
