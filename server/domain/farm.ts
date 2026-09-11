/**
 * server/domain/farm.ts
 * Farm identity and FarmSnapshot domain models.
 * Enforces explicit separation between raw Community API data and normalized state.
 */

import type { FarmId, UserId, SnapshotVersion, TimestampMs } from './types.js';
import type { NormalizedFarmState } from './state.js';

/**
 * Farm entity representing a farm instance belonging to a User.
 * Relational authority lives in PostgreSQL: users (1) -> farms (N).
 */
export interface Farm {
  farmId: FarmId;
  userId: UserId;
  ownerAddress?: string;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
}

/**
 * FarmSnapshot — immutable point-in-time snapshot.
 * Preserves raw API response separately from normalized state.
 */
export interface FarmSnapshot {
  farmId: FarmId;
  snapshotVersion: SnapshotVersion;
  capturedAt: TimestampMs;
  rawHash: string;
  rawData: unknown;
  normalizedState?: NormalizedFarmState;
}

/**
 * Redis Hot Cache State projection.
 * Key: farm:{farmId}:state
 * Redis is a cacheable projection of PostgreSQL durable state.
 * Redis loss != farm history loss.
 */
export interface HotFarmCache {
  farmId: FarmId;
  snapshotVersion: SnapshotVersion;
  state: NormalizedFarmState;
  updatedAt: TimestampMs;
  syncStatus: 'SUCCESS' | 'SYNCING' | 'ERROR';
}
