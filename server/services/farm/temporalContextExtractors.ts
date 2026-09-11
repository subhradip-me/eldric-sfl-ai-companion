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

  // Determine season: prefer explicit state.temporal.season, then active dataset schedule, then calendar month
  let rawSeason = state.temporal?.season as SeasonName | undefined;
  if (!rawSeason) {
    const activeSchedule = dataset.schedules?.find((s) => now >= s.startAt && now <= s.endAt);
    if (activeSchedule) {
      rawSeason = activeSchedule.season as SeasonName;
    } else {
      const month = new Date(now).getUTCMonth(); // 0-11
      if (month >= 2 && month <= 4) rawSeason = 'SPRING';
      else if (month >= 5 && month <= 7) rawSeason = 'SUMMER';
      else if (month >= 8 && month <= 10) rawSeason = 'AUTUMN';
      else rawSeason = 'WINTER';
    }
  }
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
