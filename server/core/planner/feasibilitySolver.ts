/**
 * server/core/planner/feasibilitySolver.ts
 * Pure deterministic feasibility gate for strategy candidates.
 *
 * ARCHITECTURAL INVARIANT:
 * Hard constraints are feasibility gates, NEVER scoring preferences.
 * Any candidate violating a hard constraint is marked INVALID and discarded
 * BEFORE utility scoring.
 */

import type {
  StrategyCandidate,
  GoalConstraint,
  GameTime,
  FeasibilityAssessment,
} from '../../domain/index.js';

export interface EvaluateFeasibilityParams {
  candidate: StrategyCandidate;
  constraints: GoalConstraint;
  gameTime?: GameTime;
}

/**
 * Evaluate whether a candidate strategy satisfies all hard constraints.
 * Supports both:
 *   evaluateFeasibility(candidate, constraints, gameTime)
 * and:
 *   evaluateFeasibility({ candidate, constraints, gameTime })
 */
export function evaluateFeasibility(
  candidateOrParams: StrategyCandidate | EvaluateFeasibilityParams,
  maybeConstraints?: GoalConstraint,
  maybeGameTime?: GameTime
): FeasibilityAssessment {
  let candidate: StrategyCandidate;
  let constraints: GoalConstraint;
  let gameTime: GameTime | undefined;

  if ('candidate' in candidateOrParams) {
    candidate = candidateOrParams.candidate;
    constraints = candidateOrParams.constraints;
    gameTime = candidateOrParams.gameTime;
  } else {
    candidate = candidateOrParams;
    constraints = maybeConstraints ?? {};
    gameTime = maybeGameTime;
  }

  const violations: string[] = [];

  // 1. maxFlowerCost check
  if (constraints.maxFlowerCost != null) {
    if (candidate.estimatedCostFlower > constraints.maxFlowerCost) {
      violations.push(
        `Hard constraint violated: cost ${candidate.estimatedCostFlower} exceeds maxFlowerCost ${constraints.maxFlowerCost}`
      );
    }
  }

  // 2. maxTimeDays check
  if (constraints.maxTimeDays != null) {
    const durationDays = candidate.estimatedDurationMinutes / 1440;
    if (durationDays > constraints.maxTimeDays) {
      violations.push(
        `Hard constraint violated: duration ${candidate.estimatedDurationMinutes} minutes exceeds maxTimeDays ${constraints.maxTimeDays}`
      );
    }
  }

  // 3. deadlineTimestamp check
  if (constraints.deadlineTimestamp != null) {
    let completionAt = candidate.estimatedCompletionAt;
    if (completionAt == null && gameTime != null) {
      const currentTs = (gameTime as any).currentTimestampMs ?? 1700000000000;
      completionAt = currentTs + candidate.estimatedDurationMinutes * 60 * 1000;
    }

    if (completionAt != null && completionAt > constraints.deadlineTimestamp) {
      violations.push(
        `Hard constraint violated: completion timestamp ${completionAt} exceeds deadline ${constraints.deadlineTimestamp}`
      );
    }
  }

  // 4. blacklistedItems check
  if (constraints.blacklistedItems && constraints.blacklistedItems.length > 0) {
    const blacklistSet = new Set(constraints.blacklistedItems);
    for (const item of candidate.items) {
      if (blacklistSet.has(item)) {
        violations.push(`Hard constraint violated: item '${item}' is blacklisted`);
      }
    }
  }

  // 5. disallowMarketPurchases check
  if (constraints.disallowMarketPurchases === true && candidate.requiresMarketPurchase === true) {
    violations.push('Hard constraint violated: market purchases are disallowed');
  }

  const isFeasible = violations.length === 0;

  return {
    isFeasible,
    status: isFeasible ? 'VALID' : 'INVALID',
    violations,
  };
}
