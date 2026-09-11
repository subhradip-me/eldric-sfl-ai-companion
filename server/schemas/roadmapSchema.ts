/**
 * server/schemas/roadmapSchema.ts
 * Runtime Zod validation for hierarchical roadmap, phases, actions, scores, and feasibility.
 */

import { z } from 'zod';

export const ResourceCommitmentSchema = z.object({
  owned: z.number().nonnegative(),
  inProduction: z.number().nonnegative(),
  reservedForTomorrow: z.number().nonnegative(),
  phaseReserve: z.number().nonnegative(),
  availableNow: z.number().nonnegative(),
  projectedAvailable: z.number().nonnegative(),
  discretionary: z.number().nonnegative(),
});

export const ResourceReservationMapSchema = z.record(z.string(), ResourceCommitmentSchema);

export const PlanActionSchema = z.object({
  actionId: z.string().min(1),
  type: z.enum(['PLANT', 'HARVEST', 'COOK', 'BUY', 'SELL', 'RESERVE']),
  item: z.string().min(1),
  quantity: z.number().positive(),
  building: z.string().optional(),
  estimatedCostFlower: z.number().optional(),
  estimatedXpGain: z.number().optional(),
  estimatedReadyAt: z.number().int().positive().optional(),
  reasoning: z.string().min(1),
});

export const ActionScoreSchema = z.object({
  goalAlignment: z.number().min(0).max(1),
  xpImpact: z.number().min(0).max(1),
  flowerImpact: z.number().min(0).max(1),
  futureImpact: z.number().min(0).max(1),
  timeScore: z.number().min(0).max(1),
  riskScore: z.number().min(0).max(1),
  opportunityCostScore: z.number().min(0).max(1),
  finalUtility: z.number().min(0).max(1),
  timeMinutes: z.number().optional(),
  risk: z.number().optional(),
  opportunityCost: z.number().optional(),
});

export const StrategyCandidateSchema = z.object({
  candidateId: z.string().min(1),
  title: z.string().min(1),
  estimatedCostFlower: z.number().nonnegative(),
  estimatedDurationMinutes: z.number().nonnegative(),
  estimatedCompletionAt: z.number().int().positive().optional(),
  items: z.array(z.string()),
  requiresMarketPurchase: z.boolean(),
  targetActions: z.array(PlanActionSchema).optional(),
});

export const FeasibilityAssessmentSchema = z.object({
  isFeasible: z.boolean(),
  status: z.enum(['VALID', 'INVALID']),
  violations: z.array(z.string()),
});

export const ActionPermissionResultSchema = z.object({
  actionPermitted: z.boolean(),
  message: z.string().optional(),
  shortfall: z.number().optional(),
});

export const PlanWarningSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['CRITICAL', 'WARNING', 'INFO']),
  message: z.string().min(1),
  affectedResources: z.array(z.string()).optional(),
});

export const PlanOpportunitySchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  potentialGainFlower: z.number().optional(),
  potentialGainXp: z.number().optional(),
});

export const DailyObjectiveSchema = z.object({
  dayNumber: z.number().int().positive(),
  dateStr: z.string().optional(),
  title: z.string().min(1),
  targetActions: z.array(PlanActionSchema).default([]),
  reservedResources: ResourceReservationMapSchema.default({}),
  avoidActions: z.array(z.string()).optional(),
  completionCriteria: z.array(z.string()).default([]),
  warnings: z.array(PlanWarningSchema).default([]),
  opportunities: z.array(PlanOpportunitySchema).default([]),
});

export const PhaseSchema = z.object({
  phaseNumber: z.number().int().positive(),
  name: z.string().min(1),
  purpose: z.string().min(1),
  expectedDurationDays: z.number().int().positive(),
  dailyObjectives: z.array(DailyObjectiveSchema).default([]),
  completionCriteria: z.array(z.string()).default([]),
});

export const RoadmapSchema = z.object({
  planId: z.string().min(1),
  goalId: z.string().min(1),
  version: z.number().int().positive(),
  plannerVersion: z.string().optional(),
  phases: z.array(PhaseSchema).default([]),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export type ValidatedResourceCommitment = z.infer<typeof ResourceCommitmentSchema>;
export type ValidatedStrategyCandidate = z.infer<typeof StrategyCandidateSchema>;
export type ValidatedFeasibilityAssessment = z.infer<typeof FeasibilityAssessmentSchema>;
export type ValidatedPlanAction = z.infer<typeof PlanActionSchema>;
export type ValidatedActionScore = z.infer<typeof ActionScoreSchema>;
export type ValidatedDailyObjective = z.infer<typeof DailyObjectiveSchema>;
export type ValidatedPhase = z.infer<typeof PhaseSchema>;
export type ValidatedRoadmap = z.infer<typeof RoadmapSchema>;
