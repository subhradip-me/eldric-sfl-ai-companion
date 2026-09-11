/**
 * server/core/planner/roadmapGenerator.ts
 * Pure deterministic hierarchical strategic planner and roadmap generator.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Zero ambient clocks or random UUIDs. planId, timestamps, and versions are explicit.
 * 2. Feasibility Gate: Hard constraints discard INVALID candidates prior to scoring.
 * 3. Temporal & Resource separation: availableNow guards immediate actions, projectedAvailable guards future.
 * 4. 7-dimensional utility scoring strictly in [0, 1].
 * 5. Seasonal boundary integration: injects SEASONAL_DEADLINE warnings and prioritizes urgent crops.
 * 6. Epistemic preservation: Inferred history signals are never promoted to authoritative state.
 */

import type {
  Goal,
  NormalizedFarmState,
  GameTime,
  SeasonBoundary,
  DailyMetrics,
  Roadmap,
  Phase,
  DailyObjective,
  PlanAction,
  PlanWarning,
  PlanOpportunity,
  StrategyCandidate,
  PlanId,
  PlanVersion,
  TimestampMs,
} from '../../domain/index.js';
import { generateCandidates } from './candidateGenerator.js';
import { evaluateFeasibility } from './feasibilitySolver.js';
import { buildResourceLedger, checkImmediateActionPermitted } from './reservationEngine.js';
import { scoreCandidate } from './actionScorer.js';

export interface GenerateRoadmapParams {
  state: NormalizedFarmState;
  goal: Goal;
  gameTime?: GameTime;
  seasonBoundary?: SeasonBoundary;
  history?: DailyMetrics[];
  planId: PlanId;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
  plannerVersion?: string;
  roadmapVersion?: PlanVersion;
  candidateOverrides?: StrategyCandidate[];
  tomorrowRequirements?: Record<string, number>;
  phaseRequirements?: Record<string, number>;
}

export function generateRoadmap(params: GenerateRoadmapParams): Roadmap {
  const {
    state,
    goal,
    gameTime,
    seasonBoundary,
    history: _history,
    planId,
    createdAt,
    updatedAt,
    roadmapVersion = 1,
    candidateOverrides,
    tomorrowRequirements = {},
    phaseRequirements = {},
  } = params;

  // 1. Build Item-Specific Resource Ledger
  const ledger = buildResourceLedger({
    state,
    tomorrowRequirements,
    phaseRequirements,
  });

  // 2. Candidate Generation Stage
  const rawCandidates = generateCandidates({
    goal,
    state,
    gameTime,
    candidateOverrides,
  });

  // 3. Hard Feasibility Gate (Discard INVALID before scoring)
  const feasibleCandidates: StrategyCandidate[] = [];
  const discardedCandidates: Array<{ candidate: StrategyCandidate; violations: string[] }> = [];

  for (const cand of rawCandidates) {
    const assessment = evaluateFeasibility(cand, goal.constraints, gameTime);
    if (assessment.isFeasible) {
      feasibleCandidates.push(cand);
    } else {
      discardedCandidates.push({ candidate: cand, violations: assessment.violations });
    }
  }

  // 4. Utility Scoring & Ranking
  const scoredCandidates = feasibleCandidates.map((candidate) => {
    const score = scoreCandidate(candidate, goal, ledger);
    return {
      candidate,
      score,
    };
  });

  // Sort descending by final utility
  scoredCandidates.sort((a, b) => b.score.finalUtility - a.score.finalUtility);

  // 5. Build Warnings & Opportunities
  const warnings: PlanWarning[] = [];
  const opportunities: PlanOpportunity[] = [];

  // Seasonal boundary urgency
  const affectedCrops: string[] = (seasonBoundary as any)?.affectedCrops ??
    seasonBoundary?.warnings?.map((w) => w.crop).filter((c): c is string => Boolean(c)) ??
    [];

  if (seasonBoundary && (seasonBoundary.urgency === 'WARNING' || seasonBoundary.urgency === 'CRITICAL')) {
    const crops = affectedCrops.length > 0 ? affectedCrops.join(', ') : 'Exclusive crops';
    warnings.push({
      code: 'SEASONAL_DEADLINE',
      severity: seasonBoundary.urgency === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
      message: `${crops} is unavailable in ${seasonBoundary.nextSeason ?? 'the next season'} (starts in ${seasonBoundary.daysRemaining} days). Prioritize completing ${crops} cycles before the season reset.`,
      affectedResources: affectedCrops,
    });
  }

  // 6. Action Permission & Immediate Actions
  const day1Actions: PlanAction[] = [];
  const avoidActions: string[] = [];

  // Prioritize seasonal crops if season boundary warning is active
  const inventoryAll = state.inventory?.all ?? (state as any).farm?.inventory ?? (state as any).inventory ?? {};
  const activeProd = state.production?.active ?? (state as any).activeProduction ?? [];
  if (seasonBoundary && affectedCrops.length > 0) {
    for (const crop of affectedCrops) {
      const ownedCrop = inventoryAll[crop] ?? 0;
      const readyProduction = activeProd.find((p: any) => p.item === crop);
      if (readyProduction || ownedCrop > 0) {
        day1Actions.push({
          actionId: `act-seasonal-${crop.toLowerCase()}`,
          type: readyProduction ? 'HARVEST' : 'PLANT',
          item: crop,
          quantity: readyProduction ? 1 : 10,
          reasoning: `Seasonal urgency: secure ${crop} harvest prior to season end`,
        });
      }
    }
  }

  // Add top ranked candidate actions
  for (const { candidate } of scoredCandidates) {
    if (candidate.targetActions && candidate.targetActions.length > 0) {
      for (const act of candidate.targetActions) {
        // Immediate action permission check
        if (act.estimatedCostFlower && act.estimatedCostFlower > 0) {
          const perm = checkImmediateActionPermitted('FLOWER', act.estimatedCostFlower, ledger);
          if (!perm.actionPermitted) {
            avoidActions.push(
              `DO NOT EXECUTE ${act.type} ${act.item}: ${perm.message}`
            );
            warnings.push({
              code: 'RESERVATION_CONFLICT',
              severity: 'CRITICAL',
              message: perm.message ?? 'Spending exceeds discretionary balance',
              affectedResources: ['FLOWER'],
            });
            continue;
          }
        }
        day1Actions.push(act);
      }
    }
  }

  // Deduplicate day 1 actions by actionId
  const seenActionIds = new Set<string>();
  const uniqueDay1Actions = day1Actions.filter((a) => {
    if (seenActionIds.has(a.actionId)) return false;
    seenActionIds.add(a.actionId);
    return true;
  });

  // Opportunities
  if (scoredCandidates.length > 0) {
    const best = scoredCandidates[0];
    opportunities.push({
      code: 'OPTIMAL_STRATEGY',
      title: best.candidate.title,
      description: `Recommended with utility score ${(best.score.finalUtility * 100).toFixed(1)}% based on your ${goal.preferences.primaryFocus ?? 'XP'} focus.`,
      potentialGainFlower: best.candidate.estimatedCostFlower <= 0 ? 500 : undefined,
      potentialGainXp: best.candidate.targetActions?.reduce((sum, a) => sum + (a.estimatedXpGain ?? 0), 0),
    });
  }

  // 7. Compose Daily Objectives & Phases
  const dailyObjectives: DailyObjective[] = [
    {
      dayNumber: 1,
      dateStr: (gameTime as any)?.utcDateStr ?? (gameTime ? `Day ${gameTime.currentDay}` : undefined),
      title: `Day 1: ${goal.objective.replace(/_/g, ' ')} Execution`,
      targetActions: uniqueDay1Actions,
      reservedResources: ledger,
      avoidActions: avoidActions.length > 0 ? avoidActions : undefined,
      completionCriteria: [
        'Complete scheduled harvest cycles',
        'Fulfill daily production requirements without breaching reserves',
      ],
      warnings,
      opportunities,
    },
  ];

  const phase1: Phase = {
    phaseNumber: 1,
    name: `Phase 1: Foundation & Initial Momentum`,
    purpose: `Initiate strategy execution while respecting resource commitments and deadlines.`,
    expectedDurationDays: 7,
    dailyObjectives,
    completionCriteria: [
      `Reach initial milestone towards ${goal.objective}`,
      'Maintain required tomorrow reserves without deficit',
    ],
  };

  return {
    planId,
    goalId: goal.goalId,
    version: roadmapVersion,
    phases: [phase1],
    createdAt,
    updatedAt,
  };
}
