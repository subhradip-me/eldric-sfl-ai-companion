/**
 * server/core/historyEngine/dailyAggregator.ts
 * Aggregates farm deltas and events into DailyMetrics with explicit
 * observed vs inferred separation and confidence statistics.
 *
 * Invariant: Pure calculation. Zero ambient clock, zero network, zero I/O.
 */

import type { DailyMetrics, FarmDelta, HistoryQuality } from '../../domain/history.js';
import { DailyMetricsSchema } from '../../schemas/historySchema.js';

export interface AggregateDailyMetricsParams {
  date: string; // YYYY-MM-DD
  inGameDay?: number;
  deltas: FarmDelta[];
}

/**
 * Aggregates a series of FarmDelta objects into DailyMetrics.
 */
export function aggregateDailyMetrics(
  params: AggregateDailyMetricsParams
): DailyMetrics {
  const { date, inGameDay, deltas } = params;

  let xpGained = 0;
  let netFlower = 0;
  let coinsGained = 0;
  let observedEventsCount = 0;
  let inferredEventsCount = 0;

  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  const produced: Record<string, number> = {};
  const consumed: Record<string, number> = {};
  const sold: Record<string, number> = {};
  const bought: Record<string, number> = {};

  let anyGap = false;
  let totalGapDurationMs = 0;

  for (const delta of deltas) {
    xpGained += delta.xpDiff;
    netFlower = +(netFlower + delta.balanceDiff).toFixed(4);
    if (delta.coinsDiff > 0) {
      coinsGained += delta.coinsDiff;
    }

    observedEventsCount += delta.observedEvents.length;
    inferredEventsCount += delta.inferredEvents.length;

    if (delta.quality.gapDetected) {
      anyGap = true;
      totalGapDurationMs += delta.quality.gapDurationMs ?? 0;
    }

    // Process inferred events
    for (const evt of delta.inferredEvents) {
      if (evt.confidence === 'HIGH') highCount++;
      else if (evt.confidence === 'MEDIUM') mediumCount++;
      else lowCount++;

      const qty = evt.quantity ?? 1;

      if (evt.type === 'HARVEST' && evt.item) {
        produced[evt.item] = (produced[evt.item] ?? 0) + qty;
      } else if (evt.type === 'COOK' && evt.item) {
        produced[evt.item] = (produced[evt.item] ?? 0) + qty;
      } else if (evt.type === 'TRADE' && evt.item) {
        sold[evt.item] = (sold[evt.item] ?? 0) + qty;
      } else if (evt.type === 'FEED' && evt.item) {
        consumed[evt.item] = (consumed[evt.item] ?? 0) + qty;
      }
    }

    // Also process negative inventory diffs into consumed
    for (const [item, diff] of Object.entries(delta.inventoryDiff)) {
      if (diff < 0) {
        const absDiff = Math.abs(diff);
        consumed[item] = (consumed[item] ?? 0) + absDiff;
      }
    }
  }

  const quality: HistoryQuality = {
    complete: !anyGap,
    gapDetected: anyGap,
    ...(anyGap ? { gapDurationMs: totalGapDurationMs } : {}),
  };

  const rawMetrics: DailyMetrics = {
    date,
    ...(inGameDay != null ? { inGameDay } : {}),
    observed: {
      xpGained,
      netFlower,
      coinsGained,
      observedEventsCount,
    },
    inferred: {
      produced,
      consumed,
      sold,
      bought,
      inferredEventsCount,
    },
    confidenceSummary: {
      highCount,
      mediumCount,
      lowCount,
    },
    deltaCount: deltas.length,
    quality,
    produced,
    consumed,
    sold,
    bought,
    netFlower,
    xpGained,
  };

  return DailyMetricsSchema.parse(rawMetrics);
}
