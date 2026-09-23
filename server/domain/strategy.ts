/**
 * server/domain/strategy.ts
 * Slice 3 — the StrategyPolicy: the cached, provenance-stamped output of the
 * background forward-model planner. Serialized to Redis (hot cache) and to the
 * strategy_plans Postgres audit; read by the get_best_plan tool and narrated by
 * the Explainer, which never computes.
 *
 * ARCHITECTURAL INVARIANT: every projected number here originates in the forward
 * model + the shared valuation (aggregateDailyMetrics), never in the LLM. The
 * type is deliberately structural (no core imports) so it can serialize cleanly.
 */

import type { FarmId, GoalId, TimestampMs } from './types.js';
import type { ConfidenceLevel } from './history.js';
import type { CalculationProvenance } from './provenance.js';

/** The single objective axis the plan was optimized for (mirrors the core SimFocus). */
export type SimObjectiveFocus = 'XP' | 'FLOWER' | 'TIME';

/** A single forward-model move as stored in a plan (structural; no core dependency). */
export interface StrategyPlanActionRecord {
  type: string;
  item: string;
  quantity: number;
}

/** One in-game day of the plan, with that day's projected gains from the shared valuation. */
export interface StrategyPlanDay {
  /** 1-based in-game day index over the trajectory's distinct UTC dates. */
  day: number;
  /** UTC YYYY-MM-DD the day's actions land on. */
  date: string;
  actions: StrategyPlanActionRecord[];
  projectedXp: number;
  projectedNetFlower: number;
  reasoning?: string;
}

/** Whole-trajectory projection totals (sum of the per-day valuations). */
export interface StrategyProjection {
  totalXp: number;
  totalNetFlower: number;
  goalReached?: boolean;
  etaDays?: number;
}

/** A rejected alternative trajectory, scored against the chosen plan. */
export interface StrategyCounterfactual {
  label: string;
  /** XP delta relative to the chosen plan (counterfactual − chosen). */
  deltaXp: number;
  /** Net-FLOWER delta relative to the chosen plan (counterfactual − chosen). */
  deltaFlower: number;
  whyRejected: string;
}

/** The honesty tier carried from the calibration loop. */
export interface StrategyCalibration {
  confidence: ConfidenceLevel;
  recentErrorPct: number;
}

/** The cached policy keyed `strategy:{farmId}:{goalId|DEFAULT}` in Redis. */
export interface StrategyPolicy {
  farmId: FarmId;
  goalId: GoalId | 'DEFAULT';
  computedAt: TimestampMs;
  planChangedAt: TimestampMs;
  horizonDays: number;
  objective: SimObjectiveFocus;
  plan: StrategyPlanDay[];
  projected: StrategyProjection;
  counterfactuals: StrategyCounterfactual[];
  calibration: StrategyCalibration;
  provenance: CalculationProvenance;
}
