/**
 * server/services/farm/plannerContextExtractors.ts
 * Bridges NormalizedFarmState, Goal, and temporal/history engines to the pure planner.
 *
 * ARCHITECTURAL INVARIANT:
 * Encapsulates calculation results in CalculationResult<Roadmap> with full provenance.
 */

import type {
  NormalizedFarmState,
  Goal,
  GameTime,
  SeasonBoundary,
  DailyMetrics,
  Roadmap,
  CalculationResult,
  StrategyCandidate,
  PlanId,
  TimestampMs,
} from '../../domain/index.js';
import { generateRoadmap } from '../../core/planner/roadmapGenerator.js';
import { withProvenance } from '../../core/provenance/index.js';

export interface PlannerContextOptions {
  gameTime?: GameTime;
  seasonBoundary?: SeasonBoundary;
  history?: DailyMetrics[];
  planId?: PlanId;
  createdAt?: TimestampMs;
  updatedAt?: TimestampMs;
  plannerVersion?: string;
  candidateOverrides?: StrategyCandidate[];
  tomorrowRequirements?: Record<string, number>;
  phaseRequirements?: Record<string, number>;
  snapshotVersion?: number;
  farmId?: string;
  computedAt?: TimestampMs;
}

/**
 * Extract planner context and generate a validated, pure deterministic Roadmap wrapped in provenance.
 */
export function extractPlannerContext(
  state: NormalizedFarmState,
  goal: Goal,
  options: PlannerContextOptions = {}
): CalculationResult<Roadmap> {
  const computedAt = options.computedAt ?? options.createdAt ?? 1700000000000;
  const planId = options.planId ?? `plan-${goal.goalId}-1`;
  const plannerVersion = options.plannerVersion ?? '1.0.0-phase5';

  const roadmap = generateRoadmap({
    state,
    goal,
    gameTime: options.gameTime,
    seasonBoundary: options.seasonBoundary,
    history: options.history,
    planId,
    createdAt: options.createdAt ?? computedAt,
    updatedAt: options.updatedAt ?? computedAt,
    plannerVersion,
    roadmapVersion: 1,
    candidateOverrides: options.candidateOverrides,
    tomorrowRequirements: options.tomorrowRequirements,
    phaseRequirements: options.phaseRequirements,
  });

  return withProvenance(roadmap, {
    farmId: options.farmId ?? String(goal.farmId ?? 'unknown_farm'),
    snapshotVersion: options.snapshotVersion ?? 1,
    plannerVersion,
    computedAt,
  });
}
