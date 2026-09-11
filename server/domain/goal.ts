/**
 * server/domain/goal.ts
 * Structured goal domain models and lifecycle state.
 *
 * ARCHITECTURAL INVARIANT:
 * Hard constraints are feasibility conditions, NEVER scoring preferences.
 * Any candidate plan/action that violates a hard constraint is immediately
 * marked INVALID and discarded prior to multi-dimensional action scoring.
 */

import type { GoalId, FarmId, TimestampMs } from './types.js';

export type GoalStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export type GoalObjectiveType =
  | 'REACH_LEVEL'
  | 'MAXIMIZE_FLOWER'
  | 'MAXIMIZE_XP'
  | 'STOCKPILE_RESOURCE'
  | 'CRAFT_TARGET'
  | 'CUSTOM';

export interface GoalTarget {
  level?: number;
  xp?: number;
  flower?: number;
  items?: Record<string, number>;
  deadlineDays?: number;
  deadlineTimestamp?: TimestampMs;
}

/**
 * Hard constraints: Candidate strategies MUST NOT violate these.
 * Evaluated as feasibility checks BEFORE scoring.
 */
export interface GoalConstraint {
  maxFlowerCost?: number;
  maxTimeDays?: number;
  deadlineTimestamp?: TimestampMs;
  blacklistedItems?: string[];
  disallowMarketPurchases?: boolean;
}

/**
 * Soft preferences: Used as weights in multi-dimensional ActionScore.
 */
export interface GoalPreference {
  riskTolerance?: 'LOW' | 'BALANCED' | 'HIGH';
  primaryFocus?: 'XP' | 'FLOWER' | 'TIME';
  avoidMarket?: boolean;
}

export interface Goal {
  goalId: GoalId;
  farmId: FarmId;
  status: GoalStatus;
  objective: GoalObjectiveType;
  target: GoalTarget;
  constraints: GoalConstraint;
  preferences: GoalPreference;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
}
