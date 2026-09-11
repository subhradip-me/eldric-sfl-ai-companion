/**
 * server/schemas/aiSchema.ts
 * Runtime Zod validation for Live AI Orchestration Layer.
 */

import { z } from 'zod';
import { CalculationProvenanceSchema } from './snapshotSchema.js';

export const AIToolErrorCodeSchema = z.enum([
  'INVALID_ARGUMENT',
  'TOOL_NOT_FOUND',
  'SCHEMA_VALIDATION_ERROR',
  'STALE_DATA',
  'DEPENDENCY_UNAVAILABLE',
  'TIMEOUT',
  'INTERNAL_ERROR',
]);

export const AIToolErrorSchema = z.object({
  code: AIToolErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
});

export const SnapshotFreshnessSchema = z.enum(['FRESH', 'STALE', 'VERY_STALE']);

export const AIToolResultSchema = z.object({
  tool: z.string().min(1),
  success: z.boolean(),
  data: z.unknown().optional(),
  provenance: CalculationProvenanceSchema.optional(),
  epistemicTier: z.enum(['OBSERVED', 'DERIVED', 'INFERRED']).optional(),
  staleness: SnapshotFreshnessSchema.optional(),
  warnings: z.array(z.string()).optional(),
  error: AIToolErrorSchema.optional(),
});

export const AIChatStepSchema = z.object({
  tool: z.string().min(1),
  ok: z.boolean(),
  cached: z.boolean().optional(),
  epistemicTier: z.enum(['OBSERVED', 'DERIVED', 'INFERRED']).optional(),
});

export const AIChatResponseSchema = z.object({
  success: z.boolean(),
  answer: z.string(),
  steps: z.array(AIChatStepSchema),
  warnings: z.array(z.string()).optional(),
  provenance: CalculationProvenanceSchema.optional(),
});
