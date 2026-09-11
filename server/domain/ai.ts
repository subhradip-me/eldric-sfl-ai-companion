/**
 * server/domain/ai.ts
 * Domain contracts for Live AI Orchestration Layer.
 *
 * ARCHITECTURAL INVARIANT:
 * The orchestrator may decide which deterministic tool to invoke,
 * but it may never supply an authoritative fact that the tool is supposed to determine.
 */

import type { CalculationProvenance, EpistemicTier } from './provenance.js';

export type AIToolErrorCode =
  | 'INVALID_ARGUMENT'
  | 'TOOL_NOT_FOUND'
  | 'SCHEMA_VALIDATION_ERROR'
  | 'STALE_DATA'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

export interface AIToolError {
  code: AIToolErrorCode;
  message: string;
  retryable: boolean;
}

export type SnapshotFreshness = 'FRESH' | 'STALE' | 'VERY_STALE';

/**
 * Common tool result envelope for all AI tools.
 * Invariant: Every tool returns a uniform envelope with provenance and epistemic tier.
 */
export interface AIToolResult<T = unknown> {
  tool: string;
  success: boolean;
  data?: T;
  provenance?: CalculationProvenance;
  epistemicTier?: EpistemicTier;
  staleness?: SnapshotFreshness;
  warnings?: string[];
  error?: AIToolError;
}

export interface AIChatStep {
  tool: string;
  ok: boolean;
  cached?: boolean;
  epistemicTier?: EpistemicTier;
}

export interface AIChatResponse {
  success: boolean;
  answer: string;
  steps: AIChatStep[];
  warnings?: string[];
  provenance?: CalculationProvenance;
}
