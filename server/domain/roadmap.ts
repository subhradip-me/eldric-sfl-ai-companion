/**
 * server/domain/roadmap.ts
 * Hierarchical strategic roadmap, phases, daily objectives, and reservations.
 */

import type { GoalId, PlanId, PlanVersion, TimestampMs } from './types.js';

export interface ResourceCommitment {
  owned: number;
  inProduction: number;
  reservedForTomorrow: number;
  phaseReserve: number;
  availableNow: number;
  projectedAvailable: number;
  discretionary: number;
}

export type ResourceReservationMap = Record<string, ResourceCommitment>;
export type ResourceLedger = Record<string, ResourceCommitment>;

export interface IngredientRequirement {
  item: string;
  needed: number;
  owned: number;
  missing: number;
  unitCostFlower?: number;
  totalCostFlower?: number;
  status: 'OWNED' | 'MISSING' | 'PARTIAL';
  actionType: 'IN_INVENTORY' | 'BUY' | 'GATHER' | 'PRODUCE';
  reasoning?: string;
}

export interface StrategyCandidate {
  candidateId: string;
  title: string;
  estimatedCostFlower: number;
  estimatedDurationMinutes: number;
  estimatedCompletionAt?: TimestampMs;
  items: string[];
  requiresMarketPurchase: boolean;
  targetActions?: PlanAction[];
  ingredientBreakdown?: IngredientRequirement[];
}

export interface FeasibilityAssessment {
  isFeasible: boolean;
  status: 'VALID' | 'INVALID';
  violations: string[];
}

export interface ActionPermissionResult {
  actionPermitted: boolean;
  message?: string;
  shortfall?: number;
}

export interface PlanAction {
  actionId: string;
  type: 'PLANT' | 'HARVEST' | 'COOK' | 'BUY' | 'GATHER' | 'PRODUCE' | 'SELL' | 'RESERVE';
  item: string;
  quantity: number;
  building?: string;
  currentStock?: number;
  estimatedCostFlower?: number;
  estimatedXpGain?: number;
  estimatedReadyAt?: TimestampMs;
  reasoning: string;
  ingredientBreakdown?: IngredientRequirement[];
}

/**
 * Multi-dimensional action score.
 * Invariant: Every dimension normalized to [0, 1] before weighting.
 * Final utility is strictly bounded: finalUtility in [0, 1].
 */
export interface ActionScore {
  goalAlignment: number;        // [0..1] ↑ Higher is better
  xpImpact: number;             // [0..1] ↑ Normalized XP gained
  flowerImpact: number;         // [0..1] ↑ Normalized FLOWER score (1 = max profit, 0 = max cost)
  futureImpact: number;         // [0..1] ↑ Protection of future reserves
  timeScore: number;            // [0..1] ↑ Normalized time efficiency (1 = fastest, 0 = slowest)
  riskScore: number;            // [0..1] ↑ Normalized risk safety (1 = safest, 0 = riskiest)
  opportunityCostScore: number; // [0..1] ↑ Normalized value preserved (1 = zero sacrifice)
  finalUtility: number;         // [0..1] Derived weighted utility score
  timeMinutes?: number;
  risk?: number;
  opportunityCost?: number;
}

export interface PlanWarning {
  code: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  affectedResources?: string[];
}

export interface PlanOpportunity {
  code: string;
  title: string;
  description: string;
  potentialGainFlower?: number;
  potentialGainXp?: number;
}

export interface DailyObjective {
  dayNumber: number;
  dateStr?: string;
  title: string;
  targetActions: PlanAction[];
  reservedResources: ResourceReservationMap;
  avoidActions?: string[];
  completionCriteria: string[];
  warnings: PlanWarning[];
  opportunities: PlanOpportunity[];
  ingredientSummary?: IngredientRequirement[];
}

export interface Phase {
  phaseNumber: number;
  name: string;
  purpose: string;
  expectedDurationDays: number;
  dailyObjectives: DailyObjective[];
  completionCriteria: string[];
}

export interface Roadmap {
  planId: PlanId;
  goalId: GoalId;
  version: PlanVersion;
  phases: Phase[];
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
}
