/**
 * server/domain/calendar.ts
 * Temporal engine and Sunflower Clock domain models.
 * Separates authoritative game temporal context from external discovery.
 */

import type { TimestampMs } from './types.js';

export type BaseSeason = 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';

export type EventSeason =
  | 'SOLAR_FLARE'
  | 'DAWN_BREAKER'
  | 'WITCHES_EVE'
  | 'CATCH_THE_KRAKEN'
  | 'SPRING_BLOSSOM'
  | 'CLASH_OF_FACTIONS'
  | 'PHARAOHS_TREASURE'
  | 'BULL_RUN'
  | 'WINDS_OF_CHANGE'
  | 'GREAT_BLOOM'
  | 'BETTER_TOGETHER'
  | 'PAW_PRINTS'
  | 'CRABS_AND_TRAPS'
  | 'ASCENSION_AGE'
  | string;

export type SeasonName = BaseSeason | EventSeason;

export interface SeasonalRule {
  season: SeasonName;
  availableCrops: string[];
  unavailableCrops?: string[];
  growthModifiers?: Record<string, number>;
  yieldModifiers?: Record<string, number>;
}

export interface SeasonSchedule {
  season: SeasonName;
  startAt: TimestampMs;
  endAt: TimestampMs;
  nextSeason?: SeasonName;
}

export interface SeasonalRuleDataset {
  ruleVersion: string;
  seasons: Record<string, SeasonalRule>;
  schedules?: SeasonSchedule[];
}

export type UrgencyLevel = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXPIRED';

export interface SeasonalDeadlineWarning {
  code: 'SEASONAL_DEADLINE' | 'SEASON_EXPIRED';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  crop?: string;
  daysRemaining: number;
  currentSeason: SeasonName;
  nextSeason?: SeasonName;
}

export interface SeasonBoundaryAssessment {
  currentSeason: SeasonName;
  nextSeason?: SeasonName;
  seasonEndAt: TimestampMs;
  remainingMs: number;
  daysRemaining: number;
  urgency: UrgencyLevel;
  warnings: SeasonalDeadlineWarning[];
}

export interface DayEvent {
  dayNumber: number;
  name: string;
  description?: string;
  modifiers: Record<string, number>;
}

export interface GameTime {
  currentDay: number;
  season: SeasonName;
  baseSeason?: BaseSeason;
  eventSeason?: EventSeason;
  gameTimeSeconds: number;
  nextResetAt: TimestampMs;
  activeEvents: DayEvent[];
}
