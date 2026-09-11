/**
 * server/schemas/snapshotSchema.ts
 * Runtime Zod validation for FarmSnapshot envelopes.
 * Ensures snapshot version monotonicity and data integrity.
 */

import { z } from 'zod';

export const FarmSnapshotSchema = z.object({
  farmId: z.string().min(1, 'farmId is required'),
  snapshotVersion: z.number().int().nonnegative('snapshotVersion must be a non-negative integer'),
  capturedAt: z.number().int().positive('capturedAt must be a positive epoch millisecond timestamp'),
  rawHash: z.string().min(1, 'rawHash is required'),
  rawData: z.unknown(),
  normalizedState: z.record(z.string(), z.unknown()).optional(),
});

export const CalculationProvenanceSchema = z.object({
  farmId: z.string().min(1),
  snapshotVersion: z.number().int().nonnegative(),
  calculationEngineVersion: z.string(),
  gameDataVersion: z.string(),
  marketDataVersion: z.string().optional(),
  plannerVersion: z.string().optional(),
  computedAt: z.number(),
});

export type ValidatedFarmSnapshot = z.infer<typeof FarmSnapshotSchema>;
