/**
 * server/tests/temporalEngine.test.ts
 * Golden test suite for Phase 3 (Temporal Engine: Sunflower Clock, Seasons & Day Events).
 *
 * Verifies:
 * 1. Sunflower Clock 00:00:00.000 UTC reset & duration calculations across leap years
 * 2. Exact in-game day boundary semantics (Day 1 at epoch to Day 2 at epoch + 24h)
 * 3. Pure time invariance (zero ambient Date.now() or implicit current-time acquisition)
 * 4. Seasonal crop eligibility & modifier resolution
 * 5. Exact season boundary edge thresholds (NORMAL, WARNING, CRITICAL, EXPIRED)
 * 6. Fixture-accurate seasonal deadline warnings (farm-season-boundary.json)
 * 7. Authoritative day events without pseudo-random weather invention
 * 8. Stale snapshot temporal consistency
 * 9. Rule-version reproducibility across isolated datasets
 * 10. Service context extractor integration with NormalizedFarmState
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SFL_GENESIS_EPOCH_MS,
  MS_PER_DAY,
  getNextDailyReset,
  getDailyResetRemainingMs,
  calculateInGameDay,
  calculateGameTime,
  formatDurationRemaining,
  isCropInSeason,
  getSeasonalModifiers,
  evaluateSeasonBoundary,
  resolveDayEvents,
  createWeatherDayEvent,
  DEFAULT_SEASON_RULES_V1,
} from '../core/index.js';

import {
  extractTemporalContext,
} from '../services/farm/index.js';

import { loadFixture } from '../fixtures/index.js';
import type { SeasonalDeadlineWarning, SeasonalRuleDataset } from '../domain/calendar.js';

describe('Phase 3: Temporal Engine (Sunflower Clock, Seasons & Day Events)', () => {

  describe('1. Sunflower Clock — UTC Reset & Duration', () => {
    it('calculates the exact upcoming 00:00:00.000 UTC daily reset', () => {
      // 2024-05-10 14:30:15.123 UTC
      const now = Date.UTC(2024, 4, 10, 14, 30, 15, 123);
      const expectedReset = Date.UTC(2024, 4, 11, 0, 0, 0, 0);

      const actualReset = getNextDailyReset(now);
      assert.equal(actualReset, expectedReset);

      const remainingMs = getDailyResetRemainingMs(now);
      assert.equal(remainingMs, expectedReset - now);
    });

    it('advances to the next 24h reset when now is exactly 00:00:00.000 UTC', () => {
      const midnightUtc = Date.UTC(2024, 4, 10, 0, 0, 0, 0);
      const nextReset = getNextDailyReset(midnightUtc);
      assert.equal(nextReset, Date.UTC(2024, 4, 11, 0, 0, 0, 0));
      assert.equal(getDailyResetRemainingMs(midnightUtc), MS_PER_DAY);
    });

    it('handles leap year transitions seamlessly', () => {
      // 2024 is a leap year. Feb 28 -> Feb 29
      const feb28 = Date.UTC(2024, 1, 28, 12, 0, 0, 0);
      const resetFeb29 = getNextDailyReset(feb28);
      assert.equal(resetFeb29, Date.UTC(2024, 1, 29, 0, 0, 0, 0));

      // Feb 29 -> March 1
      const feb29 = Date.UTC(2024, 1, 29, 23, 59, 0, 0);
      const resetMar1 = getNextDailyReset(feb29);
      assert.equal(resetMar1, Date.UTC(2024, 2, 1, 0, 0, 0, 0));
    });

    it('formats duration remaining into human-readable strings', () => {
      assert.equal(formatDurationRemaining(90_000_000), '1d 1h 0m');
      assert.equal(formatDurationRemaining(3_660_000), '1h 1m');
      assert.equal(formatDurationRemaining(45_000), '0m');
      assert.equal(formatDurationRemaining(0), '0m');
    });
  });

  describe('2. Exact Day Boundary Semantics', () => {
    it('indexes in-game days strictly according to boundary semantics', () => {
      // 1. epoch -> Day 1
      assert.equal(calculateInGameDay(SFL_GENESIS_EPOCH_MS), 1);

      // 2. epoch + 1 ms -> Day 1
      assert.equal(calculateInGameDay(SFL_GENESIS_EPOCH_MS + 1), 1);

      // 3. epoch + 23:59:59.999 -> Day 1
      assert.equal(calculateInGameDay(SFL_GENESIS_EPOCH_MS + MS_PER_DAY - 1), 1);

      // 4. epoch + 24h (00:00:00.000 UTC next day) -> Day 2
      assert.equal(calculateInGameDay(SFL_GENESIS_EPOCH_MS + MS_PER_DAY), 2);

      // Arbitrary day transition:
      const day100Start = SFL_GENESIS_EPOCH_MS + 99 * MS_PER_DAY;
      assert.equal(calculateInGameDay(day100Start), 100);
      assert.equal(calculateInGameDay(day100Start + MS_PER_DAY - 1), 100);
      assert.equal(calculateInGameDay(day100Start + MS_PER_DAY), 101);
    });
  });

  describe('3. Pure Time Invariance (Zero Implicit Clocks)', () => {
    it('produces bit-for-bit identical GameTime results given the same explicit timestamp', () => {
      const fixedNow = Date.UTC(2024, 9, 15, 12, 0, 0, 0);

      const run1 = calculateGameTime({ now: fixedNow, season: 'AUTUMN' });
      const run2 = calculateGameTime({ now: fixedNow, season: 'AUTUMN' });

      assert.deepEqual(run1, run2);
      assert.equal(run1.value.season, 'AUTUMN');
      assert.equal(run1.provenance.calculationEngineVersion, '1.0.0-phase3');
      assert.equal(run1.provenance.computedAt, fixedNow);
    });
  });

  describe('4. Seasonal Crop Eligibility & Modifiers', () => {
    it('validates seasonal crop matrices across all standard seasons', () => {
      // Artichoke is exclusive to Autumn
      assert.equal(isCropInSeason('Artichoke', 'AUTUMN'), true);
      assert.equal(isCropInSeason('Artichoke', 'WINTER'), false);
      assert.equal(isCropInSeason('Artichoke', 'SPRING'), false);
      assert.equal(isCropInSeason('Artichoke', 'SUMMER'), false);

      // Rhubarb is Spring
      assert.equal(isCropInSeason('Rhubarb', 'SPRING'), true);
      assert.equal(isCropInSeason('Rhubarb', 'AUTUMN'), false);

      // Sunflower & Potato are universal
      assert.equal(isCropInSeason('Sunflower', 'SPRING'), true);
      assert.equal(isCropInSeason('Sunflower', 'WINTER'), true);
      assert.equal(isCropInSeason('Potato', 'AUTUMN'), true);
      assert.equal(isCropInSeason('Potato', 'SUMMER'), true);
    });

    it('retrieves growth and yield modifiers safely', () => {
      const mods = getSeasonalModifiers('Artichoke', 'AUTUMN');
      assert.equal(mods.growthModifier, 1.0);
      assert.equal(mods.yieldModifier, 1.0);
    });
  });

  describe('5. Season Boundary Exact Edge Thresholds', () => {
    const fixedNow = 1_700_000_000_000;

    it('evaluates remainingMs > 7d as NORMAL', () => {
      const seasonEndAt = fixedNow + 7 * MS_PER_DAY + 1; // 7d + 1ms
      const assessment = evaluateSeasonBoundary({
        now: fixedNow,
        seasonEndAt,
        currentSeason: 'AUTUMN',
        nextSeason: 'WINTER',
      });
      assert.equal(assessment.value.urgency, 'NORMAL');
      assert.equal(assessment.value.daysRemaining, 7);
      assert.equal(assessment.value.warnings.length, 0);
    });

    it('evaluates remainingMs == 7d as WARNING', () => {
      const seasonEndAt = fixedNow + 7 * MS_PER_DAY; // exact 7d
      const assessment = evaluateSeasonBoundary({
        now: fixedNow,
        seasonEndAt,
        currentSeason: 'AUTUMN',
        nextSeason: 'WINTER',
      });
      assert.equal(assessment.value.urgency, 'WARNING');
      assert.equal(assessment.value.daysRemaining, 7);
    });

    it('evaluates 3d < remainingMs <= 7d as WARNING', () => {
      const seasonEndAt = fixedNow + 3 * MS_PER_DAY + 1; // 3d + 1ms
      const assessment = evaluateSeasonBoundary({
        now: fixedNow,
        seasonEndAt,
        currentSeason: 'AUTUMN',
        nextSeason: 'WINTER',
      });
      assert.equal(assessment.value.urgency, 'WARNING');
      assert.equal(assessment.value.daysRemaining, 3);
    });

    it('evaluates remainingMs == 3d as CRITICAL', () => {
      const seasonEndAt = fixedNow + 3 * MS_PER_DAY; // exact 3d
      const assessment = evaluateSeasonBoundary({
        now: fixedNow,
        seasonEndAt,
        currentSeason: 'AUTUMN',
        nextSeason: 'WINTER',
      });
      assert.equal(assessment.value.urgency, 'CRITICAL');
      assert.equal(assessment.value.daysRemaining, 3);
    });

    it('evaluates remainingMs == 0 as CRITICAL', () => {
      const seasonEndAt = fixedNow; // exact 0
      const assessment = evaluateSeasonBoundary({
        now: fixedNow,
        seasonEndAt,
        currentSeason: 'AUTUMN',
        nextSeason: 'WINTER',
      });
      assert.equal(assessment.value.urgency, 'CRITICAL');
      assert.equal(assessment.value.daysRemaining, 0);
    });

    it('evaluates remainingMs < 0 as EXPIRED without emitting false pending deadlines', () => {
      const seasonEndAt = fixedNow - 1; // -1ms (past)
      const assessment = evaluateSeasonBoundary({
        now: fixedNow,
        seasonEndAt,
        currentSeason: 'AUTUMN',
        nextSeason: 'WINTER',
        phaseRequires: { Artichoke: 100 },
      });
      assert.equal(assessment.value.urgency, 'EXPIRED');
      assert.ok(assessment.value.daysRemaining < 0);
      assert.equal(assessment.value.warnings[0].code, 'SEASON_EXPIRED');
      // Must not emit SEASONAL_DEADLINE
      assert.equal(assessment.value.warnings.some((w: SeasonalDeadlineWarning) => w.code === 'SEASONAL_DEADLINE'), false);
    });
  });

  describe('6. Fixture Validation against farm-season-boundary.json', () => {
    it('reproduces exact seasonal deadline pressure for Artichoke', () => {
      const fixture = loadFixture<any>('farm-season-boundary');

      const now = 1_700_000_000_000;
      const daysRemaining = fixture.temporalContext.daysRemainingInSeason; // 2
      const seasonEndAt = now + daysRemaining * MS_PER_DAY + 3_600_000; // 2 days and 1 hour

      const assessment = evaluateSeasonBoundary({
        now,
        seasonEndAt,
        currentSeason: fixture.temporalContext.currentSeason, // 'AUTUMN'
        nextSeason: fixture.temporalContext.nextSeason,       // 'WINTER'
        phaseRequires: fixture.planningContext.phaseRequires, // { Artichoke: 100 }
      });

      assert.equal(assessment.value.currentSeason, 'AUTUMN');
      assert.equal(assessment.value.nextSeason, 'WINTER');
      assert.equal(assessment.value.daysRemaining, 2);
      assert.equal(assessment.value.urgency, 'CRITICAL');

      assert.equal(assessment.value.warnings.length, 1);
      const warning = assessment.value.warnings[0];

      assert.equal(warning.code, fixture.planningContext.expectedWarning.code);
      assert.equal(warning.message, fixture.planningContext.expectedWarning.message);
      assert.equal(warning.crop, 'Artichoke');
    });
  });

  describe('7. Authoritative Day Events & Weather Validation', () => {
    it('resolves scheduled events from authoritative schedule without pseudo-randomness', () => {
      const schedule = {
        50: [createWeatherDayEvent(50, 'RAINY', 'Scheduled heavy rain')],
        51: [createWeatherDayEvent(51, 'HEATWAVE', 'Heatwave warning')],
      };

      // Day 50 has RAINY
      const day50Events = resolveDayEvents(50, 'SPRING', schedule);
      assert.equal(day50Events.length, 1);
      assert.equal(day50Events[0].name, 'WEATHER_RAINY');
      assert.equal(day50Events[0].modifiers.cropGrowthSpeed, 1.2);
      assert.equal(day50Events[0].modifiers.waterUsage, 0.0);

      // Day 52 has NO scheduled events -> returns empty array, no invented weather
      const day52Events = resolveDayEvents(52, 'SPRING', schedule);
      assert.deepEqual(day52Events, []);
    });
  });

  describe('8. Stale Snapshot / Temporal Consistency', () => {
    it('guarantees evaluation strictly respects explicit now over snapshot timestamps', () => {
      const snapshotCapturedAt = 1_700_000_000_000; // T1
      const calculationNow = 1_700_100_000_000;     // T2 > T1

      const mockState: any = {
        player: { farmId: 1001, bumpkinId: 1, bumpkinLevel: 10, experience: 5000, skills: {} },
        economy: { balance: '10', coins: 1000 },
        inventory: {},
        structures: {},
        production: { active: [], summaries: { crops: 0, greenhouse: 0, cooking: 0, totalActive: 0 } },
        animals: {},
        pets: {},
        progression: {},
        deliveries: {},
        buffs: { vip: false, activeBuffNames: [] },
        temporal: { season: 'AUTUMN' },
        metadata: {
          capturedAt: snapshotCapturedAt,
          normalizerVersion: '1.0.0-phase2',
          source: 'community-api',
          freshness: 'FRESH',
        },
      };

      const result = extractTemporalContext(mockState, calculationNow, {
        seasonEndAtOverride: calculationNow + 2 * MS_PER_DAY,
        phaseRequires: { Artichoke: 50 },
      });

      assert.equal(result.gameTime.provenance.computedAt, calculationNow);
      assert.equal(result.seasonBoundary.provenance.computedAt, calculationNow);
      assert.equal(result.seasonBoundary.value.daysRemaining, 2);
    });
  });

  describe('9. Rule-Version Reproducibility', () => {
    it('produces isolated, reproducible results under distinct rule dataset versions', () => {
      const now = 1_700_000_000_000;
      const seasonEndAt = now + 2 * MS_PER_DAY;

      // Dataset A: V1 (Artichoke unavailable in Winter)
      const assessmentA = evaluateSeasonBoundary({
        now,
        seasonEndAt,
        currentSeason: 'AUTUMN',
        nextSeason: 'WINTER',
        phaseRequires: { Artichoke: 100 },
        dataset: DEFAULT_SEASON_RULES_V1,
      });

      assert.equal(assessmentA.value.warnings.length, 1);
      assert.equal(assessmentA.provenance.gameDataVersion, 'season-rules-v1.0.0');

      // Dataset B: Hypothetical V2 where Artichoke IS available in Winter
      const customRulesV2: SeasonalRuleDataset = {
        ruleVersion: 'season-rules-v2.0.0-experimental',
        seasons: {
          AUTUMN: {
            season: 'AUTUMN',
            availableCrops: ['Artichoke'],
          },
          WINTER: {
            season: 'WINTER',
            availableCrops: ['Artichoke'], // Permitted in Winter!
          },
        },
      };

      const assessmentB = evaluateSeasonBoundary({
        now,
        seasonEndAt,
        currentSeason: 'AUTUMN',
        nextSeason: 'WINTER',
        phaseRequires: { Artichoke: 100 },
        dataset: customRulesV2,
      });

      // No warning under V2 because Artichoke remains available
      assert.equal(assessmentB.value.warnings.length, 0);
      assert.equal(assessmentB.provenance.gameDataVersion, 'season-rules-v2.0.0-experimental');

      // Re-running with V1 reproduces assessment A exactly
      const assessmentA_repro = evaluateSeasonBoundary({
        now,
        seasonEndAt,
        currentSeason: 'AUTUMN',
        nextSeason: 'WINTER',
        phaseRequires: { Artichoke: 100 },
        dataset: DEFAULT_SEASON_RULES_V1,
      });

      assert.deepEqual(assessmentA, assessmentA_repro);
    });
  });

  describe('10. Service Context Extractor Integration', () => {
    it('successfully extracts and evaluates temporal context from NormalizedFarmState', () => {
      const now = 1_726_000_000_000;
      const mockState: any = {
        player: { farmId: 42, bumpkinId: 1, bumpkinLevel: 25, experience: 20000, skills: {} },
        economy: { balance: '50', coins: 5000 },
        inventory: { Artichoke: 10 },
        structures: {},
        production: { active: [], summaries: { crops: 0, greenhouse: 0, cooking: 0, totalActive: 0 } },
        animals: {},
        pets: {},
        progression: {},
        deliveries: {},
        buffs: { vip: true, activeBuffNames: [] },
        temporal: { season: 'AUTUMN' },
        metadata: {
          capturedAt: now,
          normalizerVersion: '1.0.0-phase2',
          source: 'community-api',
          freshness: 'FRESH',
        },
      };

      const extracted = extractTemporalContext(mockState, now, {
        seasonEndAtOverride: now + 5 * MS_PER_DAY,
        phaseRequires: { Artichoke: 20 },
      });

      assert.equal(extracted.season, 'AUTUMN');
      assert.equal(extracted.seasonBoundary.value.urgency, 'WARNING');
      assert.equal(extracted.seasonBoundary.value.warnings[0].code, 'SEASONAL_DEADLINE');
      assert.equal(extracted.gameTime.value.season, 'AUTUMN');
      assert.ok(extracted.gameTime.value.currentDay > 0);
    });
  });

});
