/**
 * server/schemas/strategySchema.ts
 * Slice 3 — runtime Zod validation for the StrategyPolicy at the storage boundary.
 *
 * Mirrors the structural domain type in ../domain/strategy.ts and reuses the shared
 * CalculationProvenanceSchema (snapshotSchema) and ConfidenceLevelSchema (historySchema)
 * so the policy's provenance and honesty tier validate under one definition. This is the
 * gate the StrategyPolicyStore parses through before caching — a malformed plan is refused
 * here, never persisted.
 */

import { z } from 'zod';
import { ConfidenceLevelSchema } from './historySchema.js';
import { CalculationProvenanceSchema } from './snapshotSchema.js';

/** The single objective axis the plan was optimized for (mirrors SimObjectiveFocus). */
export const SimObjectiveFocusSchema = z.enum(['XP', 'FLOWER', 'TIME']);

/** A single forward-model move as stored in a plan. */
export const StrategyPlanActionRecordSchema = z.object({
  type: z.string().min(1),
  item: z.string().min(1),
  quantity: z.number(),
});

/** One in-game day of the plan, with that day's projected gains from the shared valuation. */
export const StrategyPlanDaySchema = z.object({
  day: z.number().int().positive(),
  date: z.string().min(1),
  actions: z.array(StrategyPlanActionRecordSchema).default([]),
  projectedXp: z.number(),
  projectedNetFlower: z.number(),
  reasoning: z.string().optional(),
});

/** Whole-trajectory projection totals (sum of the per-day valuations). */
export const StrategyProjectionSchema = z.object({
  totalXp: z.number(),
  totalNetFlower: z.number(),
  goalReached: z.boolean().optional(),
  etaDays: z.number().optional(),
});

/** A rejected alternative trajectory, scored against the chosen plan. */
export const StrategyCounterfactualSchema = z.object({
  label: z.string().min(1),
  deltaXp: z.number(),
  deltaFlower: z.number(),
  whyRejected: z.string(),
});

/** The honesty tier carried from the calibration loop. */
export const StrategyCalibrationSchema = z.object({
  confidence: ConfidenceLevelSchema,
  recentErrorPct: z.number(),
});

/** The cached policy keyed `strategy:{farmId}:{goalId|DEFAULT}`. */
export const StrategyPolicySchema = z.object({
  farmId: z.string().min(1),
  goalId: z.string().min(1), // GoalId | 'DEFAULT' — both non-empty strings
  computedAt: z.number(),
  planChangedAt: z.number(),
  horizonDays: z.number().int().nonnegative(),
  objective: SimObjectiveFocusSchema,
  plan: z.array(StrategyPlanDaySchema).default([]),
  projected: StrategyProjectionSchema,
  counterfactuals: z.array(StrategyCounterfactualSchema).default([]),
  calibration: StrategyCalibrationSchema,
  provenance: CalculationProvenanceSchema,
});

export type ValidatedStrategyPlanDay = z.infer<typeof StrategyPlanDaySchema>;
export type ValidatedStrategyCounterfactual = z.infer<typeof StrategyCounterfactualSchema>;
export type ValidatedStrategyPolicy = z.infer<typeof StrategyPolicySchema>;
