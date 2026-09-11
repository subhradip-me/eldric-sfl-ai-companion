/**
 * server/domain/provenance.ts
 * Calculation provenance and reproducibility metadata.
 *
 * ARCHITECTURAL INVARIANT:
 * Evidence -> Provenance.
 * Every strategic calculation or plan must declare its complete evidence chain:
 * which snapshot, game-data version, market-data version, and engine versions were used.
 */

import type { FarmId, SnapshotVersion, TimestampMs } from './types.js';

export type EpistemicTier = 'AUTHORITATIVE' | 'OBSERVED' | 'DERIVED' | 'INFERRED';

export interface CalculationProvenance {
  farmId: FarmId;
  snapshotVersion: SnapshotVersion;
  calculationEngineVersion: string;
  gameDataVersion: string;
  marketDataVersion?: string;
  plannerVersion?: string;
  computedAt: TimestampMs;
}

/**
 * Standard envelope for reproducible deterministic calculation results.
 */
export interface CalculationResult<T> {
  value: T;
  provenance: CalculationProvenance;
}
