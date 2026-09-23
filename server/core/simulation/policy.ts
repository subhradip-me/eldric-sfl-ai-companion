/**
 * server/core/simulation/policy.ts
 * Slice 3 — pure StrategyPolicy assembly: fold a scored beam-search trajectory,
 * its rejected counterfactuals, and the calibration tier into the cached policy shape.
 *
 * ARCHITECTURAL INVARIANTS (mirror forwardModel.ts):
 *  - Pure & deterministic: zero I/O, no ambient clock (computedAt is injected), no RNG.
 *  - "No number originates here." Every projected XP / FLOWER value is read back from a
 *    forward-model `FarmDelta` through the SAME `aggregateDailyMetrics` a real day uses;
 *    the assembler only buckets by day, sums, and labels. Day grouping is by the UTC
 *    calendar date of each delta's real `toTimestamp` — a faithful read, not a fabrication.
 */

import type { FarmDelta } from '../../domain/history.js';
import type { FarmId, GoalId, TimestampMs } from '../../domain/types.js';
import type { CalculationProvenance } from '../../domain/provenance.js';
import type {
  StrategyPolicy,
  StrategyPlanDay,
  StrategyCounterfactual,
  StrategyCalibration,
  StrategyPlanActionRecord,
  SimObjectiveFocus,
} from '../../domain/strategy.js';
import type { SimTrajectory } from './search.js';
import type { SimAction } from './forwardModel.js';
import { aggregateDailyMetrics } from '../historyEngine/dailyAggregator.js';

export interface BuildStrategyPolicyParams {
  farmId: FarmId;
  /** Omitted → the farm's DEFAULT (open-ended) policy. */
  goalId?: GoalId;
  objective: SimObjectiveFocus;
  best: SimTrajectory;
  /** Rejected alternatives, scored against `best`. */
  counterfactuals?: SimTrajectory[];
  calibration: StrategyCalibration;
  /** Sim clock — injected so the assembler stays clock-free. */
  computedAt: TimestampMs;
  /** Defaults to `computedAt`. Set to the prior value when the plan is unchanged. */
  planChangedAt?: TimestampMs;
  provenance: CalculationProvenance;
  goalReached?: boolean;
  etaDays?: number;
}

/** UTC calendar date (YYYY-MM-DD) of an epoch-ms timestamp. */
function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function toRecord(action: SimAction): StrategyPlanActionRecord {
  return { type: action.type, item: action.item, quantity: action.quantity ?? 1 };
}

function round4(n: number): number {
  return +n.toFixed(4);
}

/** Sum XP and net FLOWER over a set of deltas via the shared real-day valuation. */
function totals(deltas: FarmDelta[]): { xp: number; flower: number } {
  const m = aggregateDailyMetrics({ date: '1970-01-01', deltas });
  return { xp: m.xpGained, flower: m.netFlower };
}

/** Group a trajectory's (action, delta) pairs into 1-based in-game days by UTC date. */
function groupIntoDays(best: SimTrajectory): StrategyPlanDay[] {
  const buckets = new Map<string, { actions: SimAction[]; deltas: FarmDelta[] }>();
  const n = Math.min(best.path.length, best.deltas.length);
  for (let i = 0; i < n; i++) {
    const date = utcDate(best.deltas[i].toTimestamp);
    let bucket = buckets.get(date);
    if (!bucket) {
      bucket = { actions: [], deltas: [] };
      buckets.set(date, bucket);
    }
    bucket.actions.push(best.path[i]);
    bucket.deltas.push(best.deltas[i]);
  }

  const dates = [...buckets.keys()].sort(); // YYYY-MM-DD sorts chronologically
  return dates.map((date, index) => {
    const bucket = buckets.get(date)!;
    const { xp, flower } = totals(bucket.deltas);
    return {
      day: index + 1,
      date,
      actions: bucket.actions.map(toRecord),
      projectedXp: xp,
      projectedNetFlower: flower,
    };
  });
}

/** Format a signed delta for a human-readable counterfactual line. */
function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function describe(trajectory: SimTrajectory): string {
  if (trajectory.path.length === 0) return 'no-op';
  return trajectory.path.map((a) => `${a.type} ${a.item}×${a.quantity ?? 1}`).join(' → ');
}

/**
 * Assemble the cached, provenance-stamped StrategyPolicy from a chosen trajectory.
 * Pure: the caller supplies the clock, the calibration tier, and the provenance chain.
 */
export function buildStrategyPolicy(params: BuildStrategyPolicyParams): StrategyPolicy {
  const { best, computedAt, provenance } = params;

  const plan = groupIntoDays(best);
  const totalXp = plan.reduce((sum, d) => sum + d.projectedXp, 0);
  const totalNetFlower = round4(plan.reduce((sum, d) => sum + d.projectedNetFlower, 0));

  const bestTotals = totals(best.deltas);
  const counterfactuals: StrategyCounterfactual[] = (params.counterfactuals ?? []).map((cf) => {
    const cfTotals = totals(cf.deltas);
    const deltaXp = cfTotals.xp - bestTotals.xp;
    const deltaFlower = round4(cfTotals.flower - bestTotals.flower);
    return {
      label: describe(cf),
      deltaXp,
      deltaFlower,
      whyRejected: `${signed(deltaXp)} XP but ${signed(deltaFlower)} FLOWER vs the chosen plan; rejected on the ${params.objective} objective`,
    };
  });

  return {
    farmId: params.farmId,
    goalId: params.goalId ?? 'DEFAULT',
    computedAt,
    planChangedAt: params.planChangedAt ?? computedAt,
    horizonDays: plan.length,
    objective: params.objective,
    plan,
    projected: {
      totalXp,
      totalNetFlower,
      ...(params.goalReached != null ? { goalReached: params.goalReached } : {}),
      ...(params.etaDays != null ? { etaDays: params.etaDays } : {}),
    },
    counterfactuals,
    calibration: params.calibration,
    provenance,
  };
}
