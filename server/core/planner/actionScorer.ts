/**
 * server/core/planner/actionScorer.ts
 * Pure deterministic 7-dimensional utility scoring engine.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Every dimension is strictly normalized to [0, 1] before weighting.
 * 2. Directionality is uniform: higher is always better (1.0 = best, 0.0 = worst).
 * 3. Weights are normalized so sum(weights) === 1.0.
 * 4. finalUtility is strictly bounded: 0.0 <= finalUtility <= 1.0.
 */

import type {
  StrategyCandidate,
  Goal,
  GoalPreference,
  ActionScore,
  ResourceLedger,
} from '../../domain/index.js';

export interface ScoreWeights {
  wAlignment: number;
  wXp: number;
  wFlower: number;
  wFuture: number;
  wTime: number;
  wRisk: number;
  wOpportunity: number;
}

/**
 * Derive normalized weights from goal preferences such that sum(weights) === 1.0.
 */
export function deriveScoreWeights(preferences: GoalPreference = {}): ScoreWeights {
  let wAlignment = 0.25;
  let wXp = 0.20;
  let wFlower = 0.20;
  let wFuture = 0.10;
  let wTime = 0.10;
  let wRisk = 0.075;
  let wOpportunity = 0.075;

  const focus = preferences.primaryFocus ?? 'XP';
  if (focus === 'XP') {
    wXp = 0.35;
    wFlower = 0.12;
    wAlignment = 0.25;
    wTime = 0.10;
    wFuture = 0.08;
    wRisk = 0.05;
    wOpportunity = 0.05;
  } else if (focus === 'FLOWER') {
    wFlower = 0.35;
    wXp = 0.12;
    wAlignment = 0.25;
    wTime = 0.08;
    wFuture = 0.10;
    wRisk = 0.05;
    wOpportunity = 0.05;
  } else if (focus === 'TIME') {
    wTime = 0.30;
    wAlignment = 0.25;
    wXp = 0.15;
    wFlower = 0.10;
    wFuture = 0.10;
    wRisk = 0.05;
    wOpportunity = 0.05;
  }

  const riskTolerance = preferences.riskTolerance ?? 'BALANCED';
  if (riskTolerance === 'LOW') {
    wRisk += 0.08;
  } else if (riskTolerance === 'HIGH') {
    wRisk = Math.max(0.02, wRisk - 0.03);
  }

  // Normalize so sum === 1.0
  const total = wAlignment + wXp + wFlower + wFuture + wTime + wRisk + wOpportunity;
  return {
    wAlignment: wAlignment / total,
    wXp: wXp / total,
    wFlower: wFlower / total,
    wFuture: wFuture / total,
    wTime: wTime / total,
    wRisk: wRisk / total,
    wOpportunity: wOpportunity / total,
  };
}

/**
 * Score a single candidate across all 7 dimensions with strict [0, 1] bounds.
 */
export function scoreCandidate(
  candidate: StrategyCandidate,
  goal: Goal,
  _ledger?: ResourceLedger,
  benchmarkMaxTimeMinutes: number = 2880 // 48 hours default benchmark
): ActionScore {
  const weights = deriveScoreWeights(goal.preferences);

  // 1. Goal Alignment [0..1] ↑ Higher is better
  let goalAlignment = 0.5;
  if (goal.objective === 'REACH_LEVEL' || goal.objective === 'MAXIMIZE_XP') {
    const xpGain = candidate.targetActions?.reduce((sum, a) => sum + (a.estimatedXpGain ?? 0), 0) ?? 0;
    goalAlignment = xpGain > 0 ? 1.0 : 0.4;
  } else if (goal.objective === 'STOCKPILE_RESOURCE' || goal.objective === 'CRAFT_TARGET') {
    const targetItems = Object.keys(goal.target.items ?? {});
    const deliversTarget = candidate.items.some((i) => targetItems.includes(i));
    goalAlignment = deliversTarget ? 1.0 : 0.2;
  } else if (goal.objective === 'MAXIMIZE_FLOWER') {
    goalAlignment = candidate.estimatedCostFlower <= 0 ? 1.0 : 0.4;
  }

  // 2. XP Impact [0..1] ↑ Normalized XP contribution
  const totalXp = candidate.targetActions?.reduce((sum, a) => sum + (a.estimatedXpGain ?? 0), 0) ?? 0;
  const benchmarkXp = goal.target.xp ?? 5000;
  const xpImpact = Math.min(1.0, Math.max(0.0, totalXp / benchmarkXp));

  // 3. FLOWER Impact [0..1] ↑ 1.0 = maximum profit, 0.5 = break-even / 0 cost, 0.0 = high cost
  const cost = candidate.estimatedCostFlower;
  const benchmarkCost = goal.constraints.maxFlowerCost ?? 50000;
  let flowerImpact = 0.5;
  if (cost > 0) {
    const costRatio = Math.min(1.0, cost / Math.max(1, benchmarkCost));
    flowerImpact = Math.max(0.0, 0.5 * (1.0 - costRatio));
  } else {
    // Zero cost or profitable
    flowerImpact = 0.5 + 0.5 * (candidate.requiresMarketPurchase ? 0 : 0.5);
  }

  // 4. Future Impact [0..1] ↑ Protection of future reserves
  let futureImpact = 1.0;
  if (candidate.requiresMarketPurchase) {
    futureImpact = 0.7; // Relying on external market slightly strains future flexibility
  }

  // 5. Time Score [0..1] ↑ Faster is better (1 = instant, 0 = longest)
  const duration = candidate.estimatedDurationMinutes;
  const timeScore = Math.max(0.0, 1.0 - Math.min(1.0, duration / benchmarkMaxTimeMinutes));

  // 6. Risk Score [0..1] ↑ Safer is better (1 = zero risk, 0 = highest risk)
  // Deterministic recipes/harvesting have 0 risk; market dependencies carry minor risk
  const rawRisk = candidate.requiresMarketPurchase ? 0.2 : 0.0;
  const riskScore = Math.max(0.0, 1.0 - rawRisk);

  // 7. Opportunity Cost Score [0..1] ↑ Less sacrifice is better (1 = no sacrifice)
  const rawOpportunityCost = candidate.items.length > 3 ? 0.3 : 0.1;
  const opportunityCostScore = Math.max(0.0, 1.0 - rawOpportunityCost);

  // Weighted utility: strictly in [0, 1]
  const finalUtility = Math.min(
    1.0,
    Math.max(
      0.0,
      weights.wAlignment * goalAlignment +
        weights.wXp * xpImpact +
        weights.wFlower * flowerImpact +
        weights.wFuture * futureImpact +
        weights.wTime * timeScore +
        weights.wRisk * riskScore +
        weights.wOpportunity * opportunityCostScore
    )
  );

  return {
    goalAlignment,
    xpImpact,
    flowerImpact,
    futureImpact,
    timeScore,
    riskScore,
    opportunityCostScore,
    finalUtility,
    timeMinutes: duration,
    risk: rawRisk,
    opportunityCost: rawOpportunityCost,
  };
}
