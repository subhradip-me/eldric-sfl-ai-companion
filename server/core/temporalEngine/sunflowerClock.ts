/**
 * server/core/temporalEngine/sunflowerClock.ts
 * Deterministic Sunflower Clock engine.
 *
 * Invariant: Core temporal calculations must never obtain the current time implicitly.
 * Any timestamp used by calculations must originate from an explicit input (now: TimestampMs).
 * Zero ambient Date.now() or new Date() without argument.
 */

import type { TimestampMs } from '../../domain/types.js';
import type { BaseSeason, DayEvent, EventSeason, GameTime, SeasonName } from '../../domain/calendar.js';
import type { CalculationResult } from '../../domain/provenance.js';
import { GameTimeSchema } from '../../schemas/calendarSchema.js';
import { withProvenance } from '../provenance/provenanceHelper.js';

/**
 * Sunflower Land genesis epoch: April 15, 2022 00:00:00.000 UTC
 */
export const SFL_GENESIS_EPOCH_MS: TimestampMs = 1649980800000;
export const MS_PER_DAY = 86_400_000;

/**
 * Returns the epoch timestamp (ms) of the next upcoming 00:00:00.000 UTC reset.
 * If `now` is exactly on midnight UTC, the next reset is 24 hours later.
 */
export function getNextDailyReset(now: TimestampMs): TimestampMs {
  const d = new Date(now);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0, 0, 0, 0
  );
}

/**
 * Returns remaining milliseconds until the next 00:00:00.000 UTC daily reset.
 */
export function getDailyResetRemainingMs(now: TimestampMs): number {
  return getNextDailyReset(now) - now;
}

/**
 * Calculates in-game day index (1-based) from genesis epoch.
 *
 * Exact boundary semantics:
 *   epoch                  -> Day 1
 *   epoch + 1 ms           -> Day 1
 *   epoch + 23:59:59.999   -> Day 1
 *   epoch + 24h            -> Day 2
 *   23:59:59.999 UTC       -> current day
 *   00:00:00.000 UTC       -> next day
 */
export function calculateInGameDay(
  now: TimestampMs,
  epochMs: TimestampMs = SFL_GENESIS_EPOCH_MS
): number {
  const diffMs = now - epochMs;
  if (diffMs < 0) {
    return Math.floor(diffMs / MS_PER_DAY);
  }
  return Math.floor(diffMs / MS_PER_DAY) + 1;
}

/**
 * Formats a duration in milliseconds into a concise human-readable string.
 * Example: 90000000 -> "1d 1h 0m"
 */
export function formatDurationRemaining(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(' ');
}

export interface CalculateGameTimeParams {
  now: TimestampMs;
  season: SeasonName;
  baseSeason?: BaseSeason;
  eventSeason?: EventSeason;
  activeEvents?: DayEvent[];
  epochMs?: TimestampMs;
  ruleVersion?: string;
}

/**
 * Pure calculation of GameTime with full validation and provenance.
 */
export function calculateGameTime(
  params: CalculateGameTimeParams
): CalculationResult<GameTime> {
  const {
    now,
    season,
    baseSeason,
    eventSeason,
    activeEvents = [],
    epochMs = SFL_GENESIS_EPOCH_MS,
    ruleVersion = 'season-rules-v1.0.0',
  } = params;

  const currentDay = calculateInGameDay(now, epochMs);
  const nextResetAt = getNextDailyReset(now);
  const gameTimeSeconds = Math.floor(now / 1000);

  const rawGameTime: GameTime = {
    currentDay,
    season,
    ...(baseSeason ? { baseSeason } : {}),
    ...(eventSeason ? { eventSeason } : {}),
    gameTimeSeconds,
    nextResetAt,
    activeEvents,
  };

  const validated = GameTimeSchema.parse(rawGameTime);

  return withProvenance<GameTime>(
    validated,
    {
      calculationEngineVersion: '1.0.0-phase3',
      gameDataVersion: ruleVersion,
      computedAt: now,
    }
  );
}
