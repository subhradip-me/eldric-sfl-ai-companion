/**
 * server/core/historyEngine/deltaCalculator.ts
 * Pure deterministic state delta calculator.
 *
 * Computes mathematical differences between two consecutive NormalizedFarmState snapshots,
 * performs observation gap analysis, and analyzes cross-midnight temporal boundaries.
 *
 * Invariant: Pure calculation. Zero I/O, zero network, zero ambient clock.
 */

import type { NormalizedFarmState } from '../../domain/state.js';
import type { HistoryQuality, TemporalAttribution } from '../../domain/history.js';
import type { SnapshotVersion, TimestampMs } from '../../domain/types.js';
import { calculateInGameDay, getNextDailyReset } from '../temporalEngine/sunflowerClock.js';

export const DEFAULT_GAP_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export interface DeltaCalculatorOptions {
  fromVersion?: SnapshotVersion;
  toVersion?: SnapshotVersion;
  fromHash?: string;
  toHash?: string;
  gapThresholdMs?: number;
}

export interface DerivedDelta {
  fromVersion: SnapshotVersion;
  toVersion: SnapshotVersion;
  fromHash?: string;
  toHash?: string;
  fromTimestamp: TimestampMs;
  toTimestamp: TimestampMs;
  durationMs: number;
  quality: HistoryQuality;
  temporalAttribution: TemporalAttribution;
  inventoryDiff: Record<string, number>;
  xpDiff: number;
  levelDiff: number;
  balanceDiff: number;
  coinsDiff: number;
  newSkills: string[];
  newExpansionsCount: number;
  completedProductionItems: string[];
}

/**
 * Pure calculation of mathematical deltas between two farm states.
 */
export function calculateStateDelta(
  fromState: NormalizedFarmState,
  toState: NormalizedFarmState,
  options: DeltaCalculatorOptions = {}
): DerivedDelta {
  const fromTimestamp = fromState.metadata.capturedAt;
  const toTimestamp = toState.metadata.capturedAt;
  const durationMs = Math.max(0, toTimestamp - fromTimestamp);

  const fromVersion = options.fromVersion ?? 0;
  const toVersion = options.toVersion ?? (fromVersion > 0 ? fromVersion + 1 : 1);
  const gapThresholdMs = options.gapThresholdMs ?? DEFAULT_GAP_THRESHOLD_MS;

  // 1. Observation Gap Analysis
  const versionJump = Math.max(0, toVersion - fromVersion - 1);
  const gapDetected = durationMs > gapThresholdMs || versionJump > 0;
  const quality: HistoryQuality = {
    complete: !gapDetected,
    gapDetected,
    ...(gapDetected ? { gapDurationMs: durationMs, versionJump } : {}),
  };

  // 2. Cross-Midnight Temporal Attribution
  const nextReset = getNextDailyReset(fromTimestamp);
  const spansDayBoundary = fromTimestamp < nextReset && toTimestamp >= nextReset;
  const fromDay = calculateInGameDay(fromTimestamp);
  const toDay = calculateInGameDay(toTimestamp);

  const temporalAttribution: TemporalAttribution = {
    spansDayBoundary,
    fromDay,
    toDay,
    ...(spansDayBoundary ? { dayBoundaryCrossedAt: nextReset } : {}),
  };

  // 3. Inventory Diff
  const inventoryDiff: Record<string, number> = {};
  const fromInventory = fromState.inventory?.all ?? {};
  const toInventory = toState.inventory?.all ?? {};
  const allItems = new Set([
    ...Object.keys(fromInventory),
    ...Object.keys(toInventory),
  ]);

  for (const item of allItems) {
    const prev = fromInventory[item] ?? 0;
    const curr = toInventory[item] ?? 0;
    const diff = +(curr - prev).toFixed(4);
    if (Math.abs(diff) > 1e-6) {
      inventoryDiff[item] = diff;
    }
  }

  // 4. Progression & Economy Diffs
  const xpDiff = Math.max(0, (toState.player.experience ?? 0) - (fromState.player.experience ?? 0));
  const levelDiff = Math.max(0, (toState.player.level ?? 0) - (fromState.player.level ?? 0));
  const coinsDiff = (toState.economy.coins ?? 0) - (fromState.economy.coins ?? 0);
  const balanceDiff = +(
    (toState.economy.flowerApprox ?? parseFloat(toState.economy.flower ?? '0')) -
    (fromState.economy.flowerApprox ?? parseFloat(fromState.economy.flower ?? '0'))
  ).toFixed(4);

  // 5. Skills Unlocked
  const prevSkills = new Set(Object.keys(fromState.player.skills ?? {}));
  const currSkills = Object.keys(toState.player.skills ?? {});
  const newSkills = currSkills.filter((s) => !prevSkills.has(s));

  // 6. Island Expansions
  const prevExpansions = fromState.progression?.expansions ?? 0;
  const currExpansions = toState.progression?.expansions ?? 0;
  const newExpansionsCount = Math.max(0, currExpansions - prevExpansions);

  // 7. Completed Production Items
  // Identify items present in fromState active production that are no longer in toState
  const prevActiveIds = new Set(fromState.production.active.map((p) => p.id));
  const currActiveIds = new Set(toState.production.active.map((p) => p.id));
  const completedProductionItems = fromState.production.active
    .filter((p) => !currActiveIds.has(p.id))
    .map((p) => p.item);


  return {
    fromVersion,
    toVersion,
    fromHash: options.fromHash,
    toHash: options.toHash,
    fromTimestamp,
    toTimestamp,
    durationMs,
    quality,
    temporalAttribution,
    inventoryDiff,
    xpDiff,
    levelDiff,
    balanceDiff,
    coinsDiff,
    newSkills,
    newExpansionsCount,
    completedProductionItems,
  };
}
