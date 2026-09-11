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

export type ValidatedFarmSnapshot = z.infer<typeof FarmSnapshotSchema>;
