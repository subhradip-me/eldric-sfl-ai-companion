/**
 * server/tests/calibrationService.test.ts
 * Slice 3 — CalibrationService: the predicted-vs-observed honesty loop at the service layer.
 *
 * It reconstructs the SimAction the player actually took from an observed FarmDelta,
 * re-runs the forward model on the PRIOR state to get the model's PREDICTED delta, and
 * scores the two through the pure calibration primitives. A perfectly-predicted step is
 * HIGH confidence; injected drift lowers the tier; an unsupported step is reported as
 * uncalibrated with the rolling window left untouched.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calibrationService } from '../services/simulation/CalibrationService.js';
import { applyAction, type SimContext } from '../core/simulation/forwardModel.js';

import type { NormalizedFarmState } from '../domain/state.js';
import type { FarmDelta } from '../domain/history.js';
import type { RecipeDefinition } from '../domain/recipes.js';

const CAPTURED_AT = 1715342400000; // 2024-05-10T12:00:00.000Z

const PUMPKIN_SOUP: RecipeDefinition = { building: 'Fire Pit', baseOutput: 1, baseXp: 24, baseCookMinutes: 3, ingredients: { Pumpkin: 10 } };

function makeState(inventoryAll: Record<string, number>): NormalizedFarmState {
  return {
    player: { bumpkinId: 1001, level: 10, experience: 5000, skills: {}, equipped: {} },
    economy: { flower: '10.0', flowerApprox: 10.0, sfl: 10.0, coins: 1000 },
    inventory: {
      all: inventoryAll,
      seeds: {}, crops: {}, food: {}, resources: {}, tools: {},
      collectibles: {}, fishing: {}, special: {},
    },
    structures: {
      buildings: { 'Fire Pit': [{ readyAt: null, coordinates: { x: 0, y: 0 } }] } as never,
      placedCollectibles: [],
    },
    production: { active: [] },
    animals: { animals: {} },
    pets: { pets: {} },
    progression: { islandType: 'spring', expansions: 5, ascensionLevel: 0, sunstones: 0 },
    deliveries: { orders: [] },
    buffs: { vip: false, activeBuffNames: [] },
    temporal: { season: 'SPRING' },
    metadata: { capturedAt: CAPTURED_AT, normalizerVersion: '1.0.0-test', source: 'test', freshness: 'FRESH' },
  };
}

describe('CalibrationService — a perfectly-predicted step is HIGH confidence', () => {
  it('reconstructs the cook and reports ~0 error when the model matches reality', () => {
    const prevState = makeState({ Pumpkin: 100 });
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP } };
    const real = applyAction(prevState, { type: 'cook', item: 'Pumpkin Soup', quantity: 2 }, ctx);
    assert.ok(real.feasible, real.blocker);

    const res = calibrationService.calibrateStep({ prevState, observed: real.delta, ctx, priorWindow: [] });

    assert.equal(res.calibrated, true);
    assert.equal(res.action?.type, 'cook');
    assert.equal(res.action?.quantity, 2); // recovered from OUTPUT units via a 1-batch probe
    assert.ok(res.recentErrorPct < 0.01, `expected ~0 error, got ${res.recentErrorPct}`);
    assert.equal(res.confidence, 'HIGH');
    assert.equal(res.window.length, 1);
  });
});

describe('CalibrationService — injected drift lowers the confidence tier', () => {
  it('reports LOW confidence when observed XP far exceeds the model prediction', () => {
    const prevState = makeState({ Pumpkin: 100 });
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP } };
    const observed = {
      fromVersion: 0, toVersion: 1, fromTimestamp: CAPTURED_AT, toTimestamp: CAPTURED_AT + 180000,
      durationMs: 180000, quality: { complete: true, gapDetected: false },
      temporalAttribution: { spansDayBoundary: false },
      inventoryDiff: { Pumpkin: -10, 'Pumpkin Soup': 1 }, xpDiff: 200, levelDiff: 0, balanceDiff: 0, coinsDiff: 0,
      observedEvents: [{ kind: 'OBSERVED', id: 'o1', type: 'COOK', timestamp: CAPTURED_AT + 180000, item: 'Pumpkin Soup', quantity: 1 }],
      inferredEvents: [], events: [],
    } as unknown as FarmDelta;

    const res = calibrationService.calibrateStep({ prevState, observed, ctx, priorWindow: [] });

    assert.equal(res.calibrated, true);
    assert.equal(res.action?.type, 'cook');
    assert.ok(res.recentErrorPct > 0.25, `expected high error, got ${res.recentErrorPct}`);
    assert.equal(res.confidence, 'LOW');
  });
});

describe('CalibrationService — an unsupported step is reported, not faked', () => {
  it('leaves the window untouched and keeps the prior confidence when the step is a harvest', () => {
    const prevState = makeState({});
    const ctx: SimContext = { now: CAPTURED_AT };
    const observed = {
      fromVersion: 0, toVersion: 1, fromTimestamp: CAPTURED_AT, toTimestamp: CAPTURED_AT + 60000,
      durationMs: 60000, quality: { complete: true, gapDetected: false },
      temporalAttribution: { spansDayBoundary: false },
      inventoryDiff: { Sunflower: 20 }, xpDiff: 40, levelDiff: 0, balanceDiff: 0, coinsDiff: 0,
      observedEvents: [],
      inferredEvents: [{ kind: 'INFERRED', id: 'i1', type: 'HARVEST', timestamp: CAPTURED_AT + 60000, item: 'Sunflower', quantity: 20, confidence: 'HIGH', evidence: [], sourceSnapshotVersion: 1, inferenceMethod: 'test' }],
      events: [],
    } as unknown as FarmDelta;

    const res = calibrationService.calibrateStep({ prevState, observed, ctx, priorWindow: [0.05, 0.05] });

    assert.equal(res.calibrated, false);
    assert.match(res.reason ?? '', /harvest|unsupported/i);
    assert.deepEqual(res.window, [0.05, 0.05]); // window preserved on an uncalibratable step
    assert.equal(res.recentErrorPct, 0.05);
    assert.equal(res.confidence, 'HIGH');
  });
});

describe('CalibrationService — reconstructs a market sell', () => {
  it('recovers the sell action and confirms a matching prediction', () => {
    const prevState = makeState({ Wood: 50 });
    const ctx: SimContext = { now: CAPTURED_AT, prices: { Wood: 0.5 } };
    const real = applyAction(prevState, { type: 'sell', item: 'Wood', quantity: 50 }, ctx);
    assert.ok(real.feasible, real.blocker);

    const res = calibrationService.calibrateStep({ prevState, observed: real.delta, ctx, priorWindow: [] });

    assert.equal(res.calibrated, true);
    assert.equal(res.action?.type, 'sell');
    assert.equal(res.action?.quantity, 50);
    assert.equal(res.confidence, 'HIGH');
  });
});
