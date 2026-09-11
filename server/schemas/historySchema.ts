/**
 * server/schemas/historySchema.ts
 * Runtime Zod validation for historical events, deltas, and quality models.
 */

import { z } from 'zod';

export const EventTypeSchema = z.enum([
  'HARVEST',
  'PLANT',
  'COOK',
  'CRAFT',
  'MINE',
  'TRADE',
  'FEED',
  'DELIVERY_COMPLETE',
  'SKILL_UNLOCK',
  'EXPAND',
  'BUILD',
]);

export const ConfidenceLevelSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

export const ObservedEventSchema = z.object({
  kind: z.literal('OBSERVED'),
  id: z.string().min(1),
  type: EventTypeSchema,
  timestamp: z.number().int().positive(),
  item: z.string().optional(),
  quantity: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const InferredEventSchema = z.object({
  kind: z.literal('INFERRED'),
  id: z.string().min(1),
  type: EventTypeSchema,
  timestamp: z.number().int().positive(),
  item: z.string().optional(),
  quantity: z.number().optional(),
  confidence: ConfidenceLevelSchema,
  evidence: z.array(z.string()),
  sourceSnapshotVersion: z.number().int().nonnegative(),
  inferenceMethod: z.string().min(1),
});

export const FarmEventSchema = z.discriminatedUnion('kind', [
  ObservedEventSchema,
  InferredEventSchema,
]);

export const HistoryQualitySchema = z.object({
  complete: z.boolean(),
  gapDetected: z.boolean(),
  gapDurationMs: z.number().nonnegative().optional(),
  versionJump: z.number().int().nonnegative().optional(),
});

export const TemporalAttributionSchema = z.object({
  spansDayBoundary: z.boolean(),
  fromDay: z.number().int().nonnegative().optional(),
  toDay: z.number().int().nonnegative().optional(),
  dayBoundaryCrossedAt: z.number().int().positive().optional(),
});

export const FarmDeltaSchema = z.object({
  fromVersion: z.number().int().nonnegative(),
  toVersion: z.number().int().nonnegative(),
  fromHash: z.string().optional(),
  toHash: z.string().optional(),
  fromTimestamp: z.number().int().positive(),
  toTimestamp: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
  quality: HistoryQualitySchema,
  temporalAttribution: TemporalAttributionSchema,
  inventoryDiff: z.record(z.string(), z.number()).default({}),
  xpDiff: z.number().default(0),
  levelDiff: z.number().optional(),
  balanceDiff: z.number().default(0),
  coinsDiff: z.number().default(0),
  observedEvents: z.array(ObservedEventSchema).default([]),
  inferredEvents: z.array(InferredEventSchema).default([]),
  events: z.array(FarmEventSchema).default([]),
});

export const DailyMetricsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inGameDay: z.number().int().nonnegative().optional(),
  observed: z.object({
    xpGained: z.number(),
    netFlower: z.number(),
    coinsGained: z.number(),
    observedEventsCount: z.number().int().nonnegative(),
  }),
  inferred: z.object({
    produced: z.record(z.string(), z.number()).default({}),
    consumed: z.record(z.string(), z.number()).default({}),
    sold: z.record(z.string(), z.number()).default({}),
    bought: z.record(z.string(), z.number()).default({}),
    inferredEventsCount: z.number().int().nonnegative(),
  }),
  confidenceSummary: z.object({
    highCount: z.number().int().nonnegative(),
    mediumCount: z.number().int().nonnegative(),
    lowCount: z.number().int().nonnegative(),
  }),
  deltaCount: z.number().int().nonnegative(),
  quality: HistoryQualitySchema,
  produced: z.record(z.string(), z.number()).default({}),
  consumed: z.record(z.string(), z.number()).default({}),
  sold: z.record(z.string(), z.number()).default({}),
  bought: z.record(z.string(), z.number()).default({}),
  netFlower: z.number().default(0),
  xpGained: z.number().default(0),
});

export type ValidatedObservedEvent = z.infer<typeof ObservedEventSchema>;
export type ValidatedInferredEvent = z.infer<typeof InferredEventSchema>;
export type ValidatedFarmEvent = z.infer<typeof FarmEventSchema>;
export type ValidatedFarmDelta = z.infer<typeof FarmDeltaSchema>;
export type ValidatedDailyMetrics = z.infer<typeof DailyMetricsSchema>;
