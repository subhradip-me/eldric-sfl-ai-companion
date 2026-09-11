/**
 * server/domain/production.ts
 * Active / in-progress production model with explicit status provenance.
 * Separates observed API facts from deterministic projections.
 */

import type { ActivityId, TimestampMs } from './types.js';

export type ProductionCategory =
  | 'CROP'
  | 'COOKING'
  | 'GREENHOUSE'
  | 'FRUIT'
  | 'MINING'
  | 'ANIMAL';

export type ProductionStatus =
  | 'OBSERVED'   // Stated directly by the game API
  | 'PROJECTED'  // Derived or projected by calculation engine
  | 'COMPLETED'  // Ready for harvest/collection
  | 'CANCELLED'; // Invalidated or reclaimed

export interface ActiveProductionItem {
  id: ActivityId;
  category: ProductionCategory;
  item: string;
  quantity: number;
  status: ProductionStatus;
  startedAt: TimestampMs;
  readyAt: TimestampMs;
  expectedOutput: number;
  building?: string;
  slotId?: string | number;
  inputs?: Record<string, number>;
}

/**
 * Pure helper to derive progress fraction [0..1] dynamically from timestamps.
 * Progress is a derived fact, not an authoritative stored fact.
 */
export function calculateProgress(
  now: TimestampMs,
  startedAt: TimestampMs,
  readyAt: TimestampMs
): number {
  if (readyAt <= startedAt) return 1;
  if (now <= startedAt) return 0;
  if (now >= readyAt) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / (readyAt - startedAt)));
}
