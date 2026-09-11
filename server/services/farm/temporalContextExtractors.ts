/**
 * server/services/farm/temporalContextExtractors.ts
 * Bridges NormalizedFarmState to pure Phase 3 Temporal Engine functions.
 * Keeps server/core pure while facilitating full application state integration.
 */

import type {
  NormalizedFarmState,
  FarmId,
  SnapshotVersion,
  TimestampMs,
  SeasonName,
  BaseSeason,
  EventSeason,
  SeasonalRuleDataset,
  DayEvent,
  GameTime,
  SeasonBoundaryAssessment,
  CalculationResult,
} from '../../domain/index.js';
import {
  calculateGameTime,
  evaluateSeasonBoundary,
  resolveSeasonBoundary,
  resolveDayEvents,
  calculateInGameDay,
  DEFAULT_SEASON_RULES_V1,
  type DayEventSchedule,
} from '../../core/index.js';

export interface TemporalContextOptions {
  farmId?: FarmId;
  snapshotVersion?: SnapshotVersion;
  dataset?: SeasonalRuleDataset;
  schedule?: DayEventSchedule;
  phaseRequires?: Record<string, number>;
  seasonEndAtOverride?: TimestampMs;
  activeEventsOverride?: DayEvent[];
}

export interface ExtractedTemporalResult {
  currentDay: number;
  season: SeasonName;
  baseSeason?: BaseSeason;
  eventSeason?: EventSeason;
  gameTime: CalculationResult<GameTime>;
  seasonBoundary: CalculationResult<SeasonBoundaryAssessment>;
  dayEvents: DayEvent[];
}

/**
 * Extracts temporal context from NormalizedFarmState and evaluates game time
 * and seasonal boundaries deterministically for explicit `now`.
 */
export function extractTemporalContext(
  state: NormalizedFarmState,
  now: TimestampMs,
  options: TemporalContextOptions = {}
): ExtractedTemporalResult {
  const {
    dataset = DEFAULT_SEASON_RULES_V1,
    schedule = {},
    phaseRequires = {},
    seasonEndAtOverride,
    activeEventsOverride,
  } = options;

  const rawSeason = (state.temporal?.season as SeasonName) || 'SPRING';
  const currentDay = calculateInGameDay(now);

  const dayEvents = activeEventsOverride ?? resolveDayEvents(currentDay, rawSeason, schedule);

  const gameTime = calculateGameTime({
    now,
    season: rawSeason,
    activeEvents: dayEvents,
    ruleVersion: dataset.ruleVersion,
  });

  const seasonBoundary = seasonEndAtOverride != null
    ? evaluateSeasonBoundary({
        now,
        seasonEndAt: seasonEndAtOverride,
        currentSeason: rawSeason,
        phaseRequires,
        dataset,
      })
    : resolveSeasonBoundary({
        now,
        currentSeason: rawSeason,
        phaseRequires,
        dataset,
      });

  return {
    currentDay,
    season: rawSeason,
    gameTime,
    seasonBoundary,
    dayEvents,
  };
}
