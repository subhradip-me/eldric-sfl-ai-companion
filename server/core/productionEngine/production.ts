/**
 * server/core/productionEngine/production.ts
 * Pure deterministic calculations for active production, growth timers, and yield projections.
 * Invariant: Every calculation is reproducible from explicit inputs and preserves provenance.
 */

import type { ActiveProductionItem, CalculationResult, TimestampMs } from '../../domain/index.js';
import { calculateProgress } from '../../domain/production.js';
import { withProvenance } from '../provenance/index.js';

export interface ProductionYieldSummary {
  item: string;
  totalQuantity: number;
  expectedOutput: number;
  earliestReadyAt: TimestampMs;
  latestReadyAt: TimestampMs;
  items: ActiveProductionItem[];
}

export interface ActiveProductionSummary {
  byItem: Record<string, ProductionYieldSummary>;
  activeCount: number;
  completedCount: number;
  projectedAvailableAt: Record<string, { readyAt: TimestampMs; amount: number }[]>;
}

export interface NormalizeActiveProductionInput {
  items: ActiveProductionItem[];
  now: TimestampMs;
  farmId?: string;
  snapshotVersion?: number;
  computedAt?: number;
}

/**
 * Summarize and project yields from active production items at a given timestamp.
 * Pure function: takes items and explicit 'now' timestamp.
 */
export function summarizeActiveProduction(
  input: NormalizeActiveProductionInput
): CalculationResult<ActiveProductionSummary> {
  const { items, now } = input;

  const byItem: Record<string, ProductionYieldSummary> = {};
  const projectedAvailableAt: Record<string, { readyAt: TimestampMs; amount: number }[]> = {};
  let activeCount = 0;
  let completedCount = 0;

  for (const item of items) {
    const progress = calculateProgress(now, item.startedAt, item.readyAt);
    const isCompleted = progress >= 1;

    if (isCompleted) {
      completedCount++;
    } else {
      activeCount++;
    }

    if (!byItem[item.item]) {
      byItem[item.item] = {
        item: item.item,
        totalQuantity: 0,
        expectedOutput: 0,
        earliestReadyAt: item.readyAt,
        latestReadyAt: item.readyAt,
        items: [],
      };
    }

    const entry = byItem[item.item];
    entry.totalQuantity += item.quantity;
    entry.expectedOutput += item.expectedOutput;
    entry.earliestReadyAt = Math.min(entry.earliestReadyAt, item.readyAt);
    entry.latestReadyAt = Math.max(entry.latestReadyAt, item.readyAt);
    entry.items.push(item);

    if (!projectedAvailableAt[item.item]) {
      projectedAvailableAt[item.item] = [];
    }
    projectedAvailableAt[item.item].push({
      readyAt: item.readyAt,
      amount: item.expectedOutput,
    });
  }

  // Sort projections chronologically
  for (const k of Object.keys(projectedAvailableAt)) {
    projectedAvailableAt[k].sort((a, b) => a.readyAt - b.readyAt);
  }

  const result: ActiveProductionSummary = {
    byItem,
    activeCount,
    completedCount,
    projectedAvailableAt,
  };

  return withProvenance(result, {
    farmId: input.farmId,
    snapshotVersion: input.snapshotVersion,
    computedAt: input.computedAt ?? now,
  });
}
