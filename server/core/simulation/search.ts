/**
 * server/core/simulation/search.ts
 * Slice 3 — deterministic beam search over the pure forward model.
 *
 * ARCHITECTURAL INVARIANTS (mirror forwardModel.ts):
 *  - Pure & deterministic: zero I/O, no ambient clock, NO RNG. Ties break on a
 *    stable trajectory signature so identical inputs yield identical output.
 *  - One valuation, two directions: a trajectory is scored by aggregating the
 *    SAME `FarmDelta` objects the forward model emits through `aggregateDailyMetrics`
 *    — the identical valuation a real day receives.
 *  - The LLM decides what *matters* (the goal's `primaryFocus` → objective axis);
 *    the engine decides what's *true* (the metrics). No fabricated cross-axis
 *    conversion: the first-cut objective ranks a single declared axis.
 */

import type { NormalizedFarmState } from '../../domain/state.js';
import type { FarmDelta } from '../../domain/history.js';

import { applyAction, type SimAction, type SimContext } from './forwardModel.js';
import { aggregateDailyMetrics } from '../historyEngine/dailyAggregator.js';

/** Objective axis, sourced from the goal's declared `primaryFocus`. */
export type SimFocus = 'XP' | 'FLOWER' | 'TIME';

/** Scores a trajectory's accumulated deltas to a scalar; higher is always better. */
export type TrajectoryObjective = (deltas: FarmDelta[]) => number;

/** Enumerates the legal moves from a given state (feasibility is re-checked by applyAction). */
export type CandidateFn = (state: NormalizedFarmState) => SimAction[];

export interface SimTrajectory {
  path: SimAction[];
  deltas: FarmDelta[];
  finalState: NormalizedFarmState;
  score: number;
  /** True when the trajectory could not expand (dead-end) and was carried forward as-is. */
  terminal: boolean;
}

export interface BeamSearchOptions {
  candidates: CandidateFn;
  /** Maximum trajectory length (N). */
  horizon: number;
  /** Maximum trajectories retained on the frontier at each depth (K). */
  beamWidth: number;
  ctx?: SimContext;
  /** Defaults to an XP objective. */
  objective?: TrajectoryObjective;
}

/** Date is irrelevant to the scalar axes we read; aggregation is date-agnostic here. */
const SIM_DATE = '1970-01-01';

/**
 * Build a single-axis objective from the goal's declared focus, reusing the real-day
 * valuation (`aggregateDailyMetrics`) so simulated numbers match dashboard numbers.
 */
export function objectiveForFocus(focus: SimFocus = 'XP'): TrajectoryObjective {
  return (deltas) => {
    if (focus === 'TIME') {
      // Faster is better: negate the wall-clock the trajectory consumes.
      return -deltas.reduce((sum, d) => sum + (d.durationMs ?? 0), 0);
    }
    const metrics = aggregateDailyMetrics({ date: SIM_DATE, deltas });
    return focus === 'FLOWER' ? metrics.netFlower : metrics.xpGained;
  };
}

/** Stable, RNG-free trajectory signature for deterministic tie-breaking. */
function signature(t: SimTrajectory): string {
  return t.path.map((a) => `${a.type}:${a.item}:${a.quantity ?? 1}`).join('>');
}

/** Higher score first; ties resolved deterministically (shorter path, then signature). */
function compareTrajectory(a: SimTrajectory, b: SimTrajectory): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  return signature(a).localeCompare(signature(b));
}

function prune(trajectories: SimTrajectory[], beamWidth: number): SimTrajectory[] {
  return [...trajectories].sort(compareTrajectory).slice(0, Math.max(0, beamWidth));
}

/**
 * Deterministic beam search: from `initial`, expand each frontier trajectory by every
 * feasible candidate action, score it, and retain the top `beamWidth` by objective —
 * repeated to `horizon`. A trajectory that cannot expand is preserved as terminal so a
 * strong short plan is never lost to weaker longer ones. Returns the final frontier,
 * sorted best-first.
 */
export function beamSearch(
  initial: NormalizedFarmState,
  options: BeamSearchOptions,
): SimTrajectory[] {
  const { candidates, horizon, beamWidth, ctx = {} } = options;
  const objective = options.objective ?? objectiveForFocus('XP');

  const root: SimTrajectory = { path: [], deltas: [], finalState: initial, score: 0, terminal: false };
  let frontier: SimTrajectory[] = [root];

  for (let depth = 0; depth < horizon; depth++) {
    const next: SimTrajectory[] = [];
    let expandedAny = false;

    for (const beam of frontier) {
      if (beam.terminal) {
        next.push(beam);
        continue;
      }

      let childCount = 0;
      for (const action of candidates(beam.finalState)) {
        const result = applyAction(beam.finalState, action, ctx);
        if (!result.feasible) continue;
        childCount++;
        const deltas = [...beam.deltas, result.delta];
        next.push({
          path: [...beam.path, action],
          deltas,
          finalState: result.nextState,
          score: objective(deltas),
          terminal: false,
        });
      }

      if (childCount === 0) {
        next.push({ ...beam, terminal: true });
      } else {
        expandedAny = true;
      }
    }

    frontier = prune(next, beamWidth);
    if (!expandedAny) break; // every surviving beam is a dead-end
  }

  return frontier;
}
