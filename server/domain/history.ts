/**
 * server/domain/history.ts
 * Historical delta and event domain models.
 *
 * NOTE: Snapshot comparison produces BEST-EFFORT inferred history,
 * not guaranteed reconstruction of every individual in-game click.
 */

import type { EventId, SnapshotVersion, TimestampMs } from './types.js';

export type EventType =
  | 'HARVEST'
  | 'PLANT'
  | 'COOK'
  | 'CRAFT'
  | 'MINE'
  | 'TRADE'
  | 'FEED'
  | 'DELIVERY_COMPLETE'
  | 'SKILL_UNLOCK'
  | 'EXPAND'
  | 'BUILD';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/** Explicit state transition confirmed directly by API data */
export interface ObservedEvent {
  kind: 'OBSERVED';
  id: EventId;
  type: EventType;
  timestamp: TimestampMs;
  item?: string;
  quantity?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Inferred state transition deduced from state deltas.
 * Always carries evidence, confidence, source snapshot version, and inference method.
 */
export interface InferredEvent {
  kind: 'INFERRED';
  id: EventId;
  type: EventType;
  timestamp: TimestampMs;
  item?: string;
  quantity?: number;
  confidence: ConfidenceLevel;
  evidence: string[];
  sourceSnapshotVersion: SnapshotVersion;
  inferenceMethod: string;
}

export type FarmEvent = ObservedEvent | InferredEvent;

export interface TradeEvent {
  id: EventId;
  timestamp: TimestampMs;
  tradeType: 'BUY' | 'SELL';
  item: string;
  quantity: number;
  grossValue: number;
  tax: number;
  teamTax: number;
  netValue: number;
}

export interface FarmDelta {
  fromVersion: SnapshotVersion;
  toVersion: SnapshotVersion;
  fromTimestamp: TimestampMs;
  toTimestamp: TimestampMs;
  inventoryDiff: Record<string, number>;
  xpDiff: number;
  balanceDiff: number;
  coinsDiff: number;
  events: FarmEvent[];
}

export interface DailyMetrics {
  date: string; // YYYY-MM-DD
  produced: Record<string, number>;
  consumed: Record<string, number>;
  sold: Record<string, number>;
  bought: Record<string, number>;
  netFlower: number;
  xpGained: number;
}
