/**
 * server/schemas/goalSchema.ts
 * Runtime Zod validation for Goal domain objects and lifecycle transitions.
 */

import { z } from 'zod';

export const GoalStatusSchema = z.enum([
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);

export const GoalObjectiveSchema = z.enum([
  'REACH_LEVEL',
  'MAXIMIZE_FLOWER',
  'MAXIMIZE_XP',
  'STOCKPILE_RESOURCE',
  'CRAFT_TARGET',
  'CUSTOM',
]);

export const GoalTargetSchema = z.object({
  level: z.number().int().min(1).max(200).optional(),
  xp: z.number().positive().optional(),
  flower: z.number().positive().optional(),
  items: z.record(z.string(), z.number().positive()).optional(),
  deadlineDays: z.number().positive().optional(),
  deadlineTimestamp: z.number().positive().optional(),
});

export const GoalConstraintSchema = z.object({
  maxFlowerCost: z.number().nonnegative().optional(),
  maxTimeDays: z.number().positive().optional(),
  deadlineTimestamp: z.number().positive().optional(),
  blacklistedItems: z.array(z.string()).optional(),
  disallowMarketPurchases: z.boolean().optional(),
});

export const GoalPreferenceSchema = z.object({
  riskTolerance: z.enum(['LOW', 'BALANCED', 'HIGH']).default('BALANCED'),
  primaryFocus: z.enum(['XP', 'FLOWER', 'TIME']).default('XP'),
  avoidMarket: z.boolean().default(false),
});

export const GoalSchema = z.object({
  goalId: z.string().min(1),
  farmId: z.string().min(1),
  status: GoalStatusSchema.default('DRAFT'),
  objective: GoalObjectiveSchema,
  target: GoalTargetSchema,
  constraints: GoalConstraintSchema.default({}),
  preferences: GoalPreferenceSchema.default({
    riskTolerance: 'BALANCED',
    primaryFocus: 'XP',
    avoidMarket: false,
  }),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export type ValidatedGoal = z.infer<typeof GoalSchema>;
