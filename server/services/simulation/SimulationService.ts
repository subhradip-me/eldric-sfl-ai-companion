/**
 * server/services/simulation/SimulationService.ts
 * Slice 3 — the forward-model planner's service seam: timeline → calibrate → search → policy.
 *
 * ARCHITECTURAL POSITION:
 *  - DEPENDENCY INJECTION for testability & purity of dependents: the caller supplies the
 *    NormalizedFarmState timeline and the SimContext (recipes/prices/clock). This service
 *    imports NO SnapshotService, DB, Redis, or LLM — only the pure sim core plus the DB-free
 *    history-extraction bridge. The worker layer wires in the real snapshots later.
 *  - "The LLM decides what matters; the engine decides what's true." `focus` (the goal's
 *    primary axis) is the ONLY knob the caller sets; every projected number is read back from
 *    forward-model deltas through the shared valuation inside `buildStrategyPolicy`.
 *
 * PIPELINE:
 *  1) Calibrate the model against the player's most recent REAL step (the last two timeline
 *     states) — predicted-vs-observed — yielding the confidence tier and rolling window.
 *  2) Beam-search the forward model from the latest state for the goal's objective axis.
 *  3) Fold the winning trajectory, its diverging counterfactuals, and the calibration tier
 *     into the cached, provenance-stamped StrategyPolicy.
 */

import type { NormalizedFarmState } from '../../domain/state.js';
import type { FarmId, GoalId, TimestampMs } from '../../domain/types.js';
import type { CalculationProvenance } from '../../domain/provenance.js';
import type { StrategyPolicy, StrategyCalibration, SimObjectiveFocus } from '../../domain/strategy.js';

import { beamSearch, objectiveForFocus, type SimFocus, type SimTrajectory } from '../../core/simulation/search.js';
import { generateSimCandidates } from '../../core/simulation/candidates.js';
import { buildStrategyPolicy } from '../../core/simulation/policy.js';
import { deriveConfidenceTier } from '../../core/simulation/calibration.js';
import type { SimContext } from '../../core/simulation/forwardModel.js';
import { calibrationService } from './CalibrationService.js';
import { extractFarmHistoryDelta } from '../farm/historyContextExtractors.js';

export interface BuildPolicyInput {
  farmId: FarmId;
  /** Omitted → the farm's DEFAULT (open-ended) policy. */
  goalId?: GoalId;
  /** Objective axis (defaults to XP). */
  focus?: SimFocus;
  /** Chronological states; the last is the current farm, the prior one the last real step. */
  timeline: NormalizedFarmState[];
  ctx: SimContext;
  /** Items the goal wants to acquire on the market (item → target quantity). */
  buyItems?: Record<string, number>;
  /** Max trajectory LENGTH (search depth in steps, NOT days). Defaults to 8. */
  maxSteps?: number;
  beamWidth?: number;
  counterfactualCount?: number;
  priorCalibrationWindow?: number[];
  calibrationWindowSize?: number;
  /** Sim clock — injected so the service stays clock-free. */
  computedAt: TimestampMs;
  planChangedAt?: TimestampMs;
  provenance: CalculationProvenance;
  goalReached?: boolean;
  etaDays?: number;
}

export interface BuildPolicyOutput {
  policy: StrategyPolicy;
  /** The rolling calibration window AFTER this cycle — the caller persists it. */
  calibrationWindow: number[];
}

const DEFAULTS = { focus: 'XP' as SimFocus, maxSteps: 8, beamWidth: 5, counterfactualCount: 3 };

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

/** A trajectory's opening move — the decision the plan actually made. */
function firstActionKey(t: SimTrajectory): string | null {
  const a = t.path[0];
  return a ? `${a.type}:${a.item}` : null;
}

/**
 * Honest counterfactuals: from the rejected frontier, the best trajectories whose FIRST
 * action differs from the winner's — and from one another. A distinct opening move is a
 * genuinely different decision; two plans that merely diverge later are not shown twice.
 */
function pickCounterfactuals(best: SimTrajectory, rejected: SimTrajectory[], count: number): SimTrajectory[] {
  const picked: SimTrajectory[] = [];
  const seen = new Set<string | null>([firstActionKey(best)]);
  for (const t of rejected) {
    if (picked.length >= count) break;
    const key = firstActionKey(t);
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    picked.push(t);
  }
  return picked;
}

export class SimulationService {
  buildPolicy(input: BuildPolicyInput): BuildPolicyOutput {
    const focus = input.focus ?? DEFAULTS.focus;
    const maxSteps = input.maxSteps ?? DEFAULTS.maxSteps;
    const beamWidth = input.beamWidth ?? DEFAULTS.beamWidth;
    const cfCount = input.counterfactualCount ?? DEFAULTS.counterfactualCount;
    const priorWindow = input.priorCalibrationWindow ?? [];

    if (input.timeline.length === 0) {
      throw new Error('SimulationService.buildPolicy: timeline must contain at least the latest state');
    }
    const latest = input.timeline[input.timeline.length - 1];

    // 1) Calibrate against the player's most recent real step, when the timeline has one.
    let calibrationWindow = priorWindow;
    let confidence = deriveConfidenceTier(priorWindow);
    let recentErrorPct = mean(priorWindow);
    if (input.timeline.length >= 2) {
      const prev = input.timeline[input.timeline.length - 2];
      const observed = extractFarmHistoryDelta(prev, latest, {
        farmId: input.farmId,
        fromVersion: (input.provenance.snapshotVersion ?? 1) - 1,
        toVersion: input.provenance.snapshotVersion,
        recipes: input.ctx.recipes,
        marketPrices: input.ctx.prices,
      }).value;
      const cal = calibrationService.calibrateStep({
        prevState: prev, observed, ctx: input.ctx,
        priorWindow, windowSize: input.calibrationWindowSize,
      });
      calibrationWindow = cal.window;
      confidence = cal.confidence;
      recentErrorPct = cal.recentErrorPct;
    }

    // 2) Beam-search the forward model from the latest state for the declared objective.
    const frontier = beamSearch(latest, {
      candidates: (s) => generateSimCandidates(s, input.ctx, { buyItems: input.buyItems }),
      horizon: maxSteps,
      beamWidth,
      ctx: input.ctx,
      objective: objectiveForFocus(focus),
    });
    const best: SimTrajectory =
      frontier[0] ?? { path: [], deltas: [], finalState: latest, score: 0, terminal: true };

    // 3) Fold the winner + diverging counterfactuals + calibration tier into the policy.
    const counterfactuals = pickCounterfactuals(best, frontier.slice(1), cfCount);
    const calibration: StrategyCalibration = { confidence, recentErrorPct };

    const policy = buildStrategyPolicy({
      farmId: input.farmId,
      goalId: input.goalId,
      objective: focus as SimObjectiveFocus,
      best,
      counterfactuals,
      calibration,
      computedAt: input.computedAt,
      planChangedAt: input.planChangedAt,
      provenance: input.provenance,
      goalReached: input.goalReached,
      etaDays: input.etaDays,
    });

    return { policy, calibrationWindow };
  }
}

/** Shared singleton — stateless; the rolling window is passed in and returned, never held. */
export const simulationService = new SimulationService();
