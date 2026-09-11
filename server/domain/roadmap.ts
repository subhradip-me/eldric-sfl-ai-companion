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
  discretionary: number;
}

export type ResourceReservationMap = Record<string, ResourceCommitment>;

export interface PlanAction {
  actionId: string;
  type: 'PLANT' | 'HARVEST' | 'COOK' | 'BUY' | 'SELL' | 'RESERVE';
  item: string;
  quantity: number;
  building?: string;
  estimatedCostFlower?: number;
  estimatedXpGain?: number;
  estimatedReadyAt?: TimestampMs;
  reasoning: string;
}

/**
 * Multi-dimensional action score.
 * Notice the utility direction for each dimension:
 * - Higher is better (↑): goalAlignment, xpImpact, flowerImpact, futureImpact
 * - Lower is better (↓): timeMinutes, risk, opportunityCost
 */
export interface ActionScore {
  goalAlignment: number;   // [0..1] ↑ Higher is better
  xpImpact: number;        // Total XP gained ↑ Higher is better
  flowerImpact: number;    // Net FLOWER change ↑ Higher is better (positive is earnings)
  futureImpact: number;    // [0..1] Protection of future reserves ↑ Higher is better
  timeMinutes: number;     // Execution time in minutes ↓ Lower is better
  risk: number;            // [0..1] Risk of price swing or missing deadline ↓ Lower is better
  opportunityCost: number; // [0..1] Value of alternative uses foregone ↓ Lower is better
  finalUtility: number;    // Derived weighted utility score
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
