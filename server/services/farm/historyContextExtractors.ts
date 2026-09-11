/**
 * server/services/farm/historyContextExtractors.ts
 * Context Extraction Layer for historical deltas and event inference.
 * Bridges application NormalizedFarmState pairs to pure core history engine.
 */

import type { NormalizedFarmState } from '../../domain/state.js';
import type { DailyMetrics, FarmDelta } from '../../domain/history.js';
import type { CalculationResult } from '../../domain/provenance.js';
import type { RecipeDefinition } from '../../domain/recipes.js';
import type { SnapshotVersion } from '../../domain/types.js';
import {
  calculateStateDelta,
  extractObservedEvents,
  inferEventsFromDelta,
  aggregateDailyMetrics,
  withProvenance,
} from '../../core/index.js';
import { FarmDeltaSchema } from '../../schemas/historySchema.js';

export interface HistoryExtractionOptions {
  farmId?: string | number;
  fromVersion?: SnapshotVersion;
  toVersion?: SnapshotVersion;
  fromHash?: string;
  toHash?: string;
  gapThresholdMs?: number;
  recipes?: Record<string, RecipeDefinition>;
  marketPrices?: Record<string, number>;
}

/**
 * Extracts historical delta and infers events between two NormalizedFarmState instances.
 */
export function extractFarmHistoryDelta(
  fromState: NormalizedFarmState,
  toState: NormalizedFarmState,
  options: HistoryExtractionOptions = {}
): CalculationResult<FarmDelta> {
  const derived = calculateStateDelta(fromState, toState, {
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    fromHash: options.fromHash,
    toHash: options.toHash,
    gapThresholdMs: options.gapThresholdMs,
  });

  const observedEvents = extractObservedEvents(fromState, toState, derived);
  const inferredEvents = inferEventsFromDelta(fromState, toState, derived, {
    recipes: options.recipes,
    marketPrices: options.marketPrices,
  });

  const rawDelta: FarmDelta = {
    fromVersion: derived.fromVersion,
    toVersion: derived.toVersion,
    fromHash: derived.fromHash,
    toHash: derived.toHash,
    fromTimestamp: derived.fromTimestamp,
    toTimestamp: derived.toTimestamp,
    durationMs: derived.durationMs,
    quality: derived.quality,
    temporalAttribution: derived.temporalAttribution,
    inventoryDiff: derived.inventoryDiff,
    xpDiff: derived.xpDiff,
    levelDiff: derived.levelDiff,
    balanceDiff: derived.balanceDiff,
    coinsDiff: derived.coinsDiff,
    observedEvents,
    inferredEvents,
    events: [...observedEvents, ...inferredEvents],
  };

  const validated = FarmDeltaSchema.parse(rawDelta);

  return withProvenance<FarmDelta>(validated, {
    farmId: String(options.farmId ?? toState.player.bumpkinId ?? 'unknown_farm'),
    snapshotVersion: derived.toVersion,
    calculationEngineVersion: '1.0.0-phase4',
    computedAt: derived.toTimestamp,
  });

}


/**
 * Aggregates a series of validated FarmDeltas into DailyMetrics with provenance.
 */
export function extractDailyMetrics(
  deltas: FarmDelta[],
  inGameDay: number,
  dateStr: string
): CalculationResult<DailyMetrics> {
  const metrics = aggregateDailyMetrics({
    deltas,
    inGameDay,
    date: dateStr,
  });

  return withProvenance<DailyMetrics>(metrics, {
    calculationEngineVersion: '1.0.0-phase4',
    computedAt: deltas.length > 0 ? deltas[deltas.length - 1].toTimestamp : 1700000000000,
  });
}
