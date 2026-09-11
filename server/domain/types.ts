/**
 * server/domain/types.ts
 * Core identifier and timestamp primitives for Sunflower Land AI Farm Strategist.
 * Standardizes time and ID formats across all modules.
 */

/**
 * Standard timestamp: Strictly Unix epoch milliseconds.
 * All timestamps (capturedAt, startedAt, readyAt, createdAt, nextResetAt) use this.
 */
export type TimestampMs = number;

/** Distinct domain identifier types (string-backed) */
export type UserId = string;
export type FarmId = string;
export type GoalId = string;
export type PlanId = string;
export type EventId = string;
export type ActivityId = string;

/** Monotonically increasing snapshot & plan version counters */
export type SnapshotVersion = number;
export type PlanVersion = number;

/** Data freshness enumeration */
export type FreshnessStatus = 'FRESH' | 'STALE' | 'SYNC_ERROR' | 'UNKNOWN';

/** High precision monetary strings (18 decimal places from blockchain/API) */
export type FlowerString = string;
