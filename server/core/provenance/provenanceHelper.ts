/**
 * server/core/provenance/provenanceHelper.ts
 * Standard envelope constructor for reproducible deterministic calculation results.
 *
 * ARCHITECTURAL INVARIANT:
 * Evidence -> Provenance.
 * Every strategic calculation result encapsulates its full provenance envelope.
 */

import type { CalculationProvenance, CalculationResult, FarmId, SnapshotVersion, TimestampMs } from '../../domain/index.js';

export interface ProvenanceOptions {
  farmId?: FarmId;
  snapshotVersion?: SnapshotVersion;
  calculationEngineVersion?: string;
  gameDataVersion?: string;
  marketDataVersion?: string;
  plannerVersion?: string;
  computedAt?: TimestampMs;
}

export const CURRENT_CORE_ENGINE_VERSION = '2.0.0';
export const CURRENT_GAME_DATA_VERSION = '2026.09.11';

/**
 * Wrap any deterministic calculation output into a CalculationResult<T> envelope.
 */
export function withProvenance<T>(
  value: T,
  options: ProvenanceOptions = {}
): CalculationResult<T> {
  const provenance: CalculationProvenance = {
    farmId: options.farmId ?? 'unknown_farm',
    snapshotVersion: options.snapshotVersion ?? 0,
    calculationEngineVersion: options.calculationEngineVersion ?? CURRENT_CORE_ENGINE_VERSION,
    gameDataVersion: options.gameDataVersion ?? CURRENT_GAME_DATA_VERSION,
    marketDataVersion: options.marketDataVersion,
    plannerVersion: options.plannerVersion,
    computedAt: options.computedAt ?? 1700000000000,
  };

  return {
    value,
    provenance,
  };
}
