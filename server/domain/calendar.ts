/**
 * server/domain/calendar.ts
 * Temporal engine and Sunflower Clock domain models.
 * Separates authoritative game temporal context from external discovery.
 */

import type { TimestampMs } from './types.js';

export type SeasonName =
  | 'SPRING'
  | 'SUMMER'
  | 'AUTUMN'
  | 'WINTER'
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

export interface SeasonalRule {
  season: SeasonName;
  availableCrops: string[];
  unavailableCrops?: string[];
  growthModifiers?: Record<string, number>;
  yieldModifiers?: Record<string, number>;
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
  gameTimeSeconds: number;
  nextResetAt: TimestampMs;
  activeEvents: DayEvent[];
}
