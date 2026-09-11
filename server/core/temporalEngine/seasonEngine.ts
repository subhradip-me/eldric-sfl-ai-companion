/**
 * server/core/temporalEngine/seasonEngine.ts
 * Pure deterministic Seasonal Engine for Sunflower Land.
 *
 * Responsibilities:
 * - Multi-season crop eligibility (Spring, Summer, Autumn, Winter & event seasons).
 * - Seasonal crop modifiers (growth, yield).
 * - Season boundary urgency detection (NORMAL, WARNING, CRITICAL, EXPIRED).
 * - Dual-level evaluation:
 *     - resolveSeasonBoundary: Calendar/rule-driven resolution
 *     - evaluateSeasonBoundary: Pure lower-level evaluator with explicit boundary
 *
 * Invariant: Core calculations receive explicit `now` and `ruleVersion`. Zero ambient clocks.
 */

import type { TimestampMs } from '../../domain/types.js';
import type {
  SeasonBoundaryAssessment,
  SeasonalDeadlineWarning,
  SeasonalRule,
  SeasonalRuleDataset,
  SeasonName,
  UrgencyLevel,
} from '../../domain/calendar.js';
import type { CalculationResult } from '../../domain/provenance.js';
import { SeasonBoundaryAssessmentSchema } from '../../schemas/calendarSchema.js';
import { withProvenance } from '../provenance/provenanceHelper.js';
import { MS_PER_DAY } from './sunflowerClock.js';
import { BASE_SEASON_ROTATION, DEFAULT_SEASON_RULES_V1 } from './seasonRules.js';

/**
 * Converts UPPERCASE season string to Title Case ("AUTUMN" -> "Autumn").
 */
export function formatSeasonName(season?: string): string {
  if (!season) return '';
  return season
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Checks if a specific crop can be planted/harvested in a given season.
 */
export function isCropInSeason(
  crop: string,
  season: SeasonName,
  dataset: SeasonalRuleDataset = DEFAULT_SEASON_RULES_V1
): boolean {
  const rule: SeasonalRule | undefined = dataset.seasons[season];
  if (!rule) {
    // If season rule is not defined, fall back to permissible true
    return true;
  }

  if (rule.unavailableCrops && rule.unavailableCrops.includes(crop)) {
    return false;
  }

  if (rule.availableCrops && rule.availableCrops.length > 0) {
    return rule.availableCrops.includes(crop);
  }

  return true;
}

/**
 * Retrieves seasonal growth and yield modifiers for a crop.
 */
export function getSeasonalModifiers(
  crop: string,
  season: SeasonName,
  dataset: SeasonalRuleDataset = DEFAULT_SEASON_RULES_V1
): { growthModifier: number; yieldModifier: number } {
  const rule = dataset.seasons[season];
  if (!rule) {
    return { growthModifier: 1.0, yieldModifier: 1.0 };
  }

  return {
    growthModifier: rule.growthModifiers?.[crop] ?? 1.0,
    yieldModifier: rule.yieldModifiers?.[crop] ?? 1.0,
  };
}

export interface EvaluateSeasonBoundaryParams {
  now: TimestampMs;
  seasonEndAt: TimestampMs;
  currentSeason: SeasonName;
  nextSeason?: SeasonName;
  phaseRequires?: Record<string, number>;
  dataset?: SeasonalRuleDataset;
}

/**
 * Evaluates season boundary urgency and emits deadline warnings for seasonal resources.
 *
 * Exact edge thresholds:
 *   remainingMs > 7d          -> NORMAL
 *   3d < remainingMs <= 7d    -> WARNING
 *   0 <= remainingMs <= 3d    -> CRITICAL
 *   remainingMs < 0           -> EXPIRED
 */
export function evaluateSeasonBoundary(
  params: EvaluateSeasonBoundaryParams
): CalculationResult<SeasonBoundaryAssessment> {
  const {
    now,
    seasonEndAt,
    currentSeason,
    nextSeason = BASE_SEASON_ROTATION[currentSeason] || 'NEXT_SEASON',
    phaseRequires = {},
    dataset = DEFAULT_SEASON_RULES_V1,
  } = params;

  const remainingMs = seasonEndAt - now;

  let urgency: UrgencyLevel;
  let daysRemaining: number;
  const warnings: SeasonalDeadlineWarning[] = [];

  if (remainingMs < 0) {
    // Season has already ended
    urgency = 'EXPIRED';
    daysRemaining = Math.floor(remainingMs / MS_PER_DAY);

    warnings.push({
      code: 'SEASON_EXPIRED',
      severity: 'INFO',
      message: `${formatSeasonName(currentSeason)} season has already ended. Transition to ${formatSeasonName(nextSeason)} is pending or active.`,
      daysRemaining,
      currentSeason,
      nextSeason,
    });
  } else {
    // Active season with countdown
    daysRemaining = Math.floor(remainingMs / MS_PER_DAY);

    if (remainingMs > 7 * MS_PER_DAY) {
      urgency = 'NORMAL';
    } else if (remainingMs > 3 * MS_PER_DAY) {
      urgency = 'WARNING';
    } else {
      urgency = 'CRITICAL';
    }

    // Check if any requested resource in phaseRequires becomes unavailable in nextSeason
    if (urgency === 'WARNING' || urgency === 'CRITICAL') {
      const warningSeverity = urgency === 'CRITICAL' ? 'CRITICAL' : 'WARNING';

      for (const [item, quantity] of Object.entries(phaseRequires)) {
        if (quantity <= 0) continue;

        const availableNow = isCropInSeason(item, currentSeason, dataset);
        const availableNext = isCropInSeason(item, nextSeason, dataset);

        if (availableNow && !availableNext) {
          warnings.push({
            code: 'SEASONAL_DEADLINE',
            severity: warningSeverity,
            message: `${item} is unavailable in ${formatSeasonName(nextSeason)} (starts in ${daysRemaining} days). Prioritize completing ${item} cycles before the season reset.`,
            crop: item,
            daysRemaining,
            currentSeason,
            nextSeason,
          });
        }
      }
    }
  }

  const rawAssessment: SeasonBoundaryAssessment = {
    currentSeason,
    nextSeason,
    seasonEndAt,
    remainingMs,
    daysRemaining,
    urgency,
    warnings,
  };

  const validated = SeasonBoundaryAssessmentSchema.parse(rawAssessment);

  return withProvenance<SeasonBoundaryAssessment>(
    validated,
    {
      calculationEngineVersion: '1.0.0-phase3',
      gameDataVersion: dataset.ruleVersion,
      computedAt: now,
    }
  );
}

export interface ResolveSeasonBoundaryParams {
  now: TimestampMs;
  currentSeason: SeasonName;
  phaseRequires?: Record<string, number>;
  dataset?: SeasonalRuleDataset;
}

/**
 * High-level season boundary resolver: automatically queries versioned calendar schedules
 * to determine seasonEndAt and nextSeason before delegating to evaluateSeasonBoundary.
 */
export function resolveSeasonBoundary(
  params: ResolveSeasonBoundaryParams
): CalculationResult<SeasonBoundaryAssessment> {
  const {
    now,
    currentSeason,
    phaseRequires = {},
    dataset = DEFAULT_SEASON_RULES_V1,
  } = params;

  // Search dataset schedules for active window matching currentSeason where now is within bounds
  let matchingSchedule = dataset.schedules?.find(
    (s) => s.season === currentSeason && now >= s.startAt && now <= s.endAt
  );

  // If not currently within bounds, check for an upcoming schedule for currentSeason
  if (!matchingSchedule) {
    matchingSchedule = dataset.schedules?.find(
      (s) => s.season === currentSeason && s.endAt >= now
    );
  }

  // If still no schedule matches (e.g. historical or future date outside defined schedules),
  // fallback: if an explicit schedule exists, use its endAt only if s.endAt >= now, otherwise dynamic 90 days from now.
  const seasonEndAt: TimestampMs =
    matchingSchedule?.endAt ??
    (now + 90 * MS_PER_DAY);

  const nextSeason: SeasonName =
    matchingSchedule?.nextSeason ??
    BASE_SEASON_ROTATION[currentSeason] ??
    'NEXT_SEASON';

  return evaluateSeasonBoundary({
    now,
    seasonEndAt,
    currentSeason,
    nextSeason,
    phaseRequires,
    dataset,
  });
}
