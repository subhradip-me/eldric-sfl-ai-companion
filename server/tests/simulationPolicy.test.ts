/**
 * server/tests/simulationPolicy.test.ts
 * Slice 3 — pure StrategyPolicy assembly: turn a scored beam-search trajectory
 * (+ rejected counterfactuals + the calibration tier) into the cached policy shape.
 *
 * The core invariant made concrete: every projected number in the policy traces to
 * a forward-model FarmDelta through the SAME `aggregateDailyMetrics` a real day uses.
 * No number originates in the assembler — it only groups, sums, and labels.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildStrategyPolicy } from '../core/simulation/policy.js';
import { applyAction, type SimContext } from '../core/simulation/forwardModel.js';
import type { SimTrajectory } from '../core/simulation/search.js';

import type { NormalizedFarmState } from '../domain/state.js';
import type { FarmDelta } from '../domain/history.js';
import type { RecipeDefinition } from '../domain/recipes.js';
import type { CalculationProvenance } from '../domain/provenance.js';

const CAPTURED_AT = 1715342400000; // 2024-05-10T12:00:00.000Z
const NEXT_DAY = 1715428800000; // 2024-05-11T12:00:00.000Z
const COMPUTED_AT = 1715346000000;

const PUMPKIN_SOUP: RecipeDefinition = { building: 'Fire Pit', baseOutput: 1, baseXp: 24, baseCookMinutes: 3, ingredients: { Pumpkin: 10 } };

const PROVENANCE: CalculationProvenance = {
  farmId: 'farm-1',
  snapshotVersion: 7,
  calculationEngineVersion: 'sim-1.0.0',
  gameDataVersion: 'game-1.0.0',
  computedAt: COMPUTED_AT,
};

const CALIBRATION = { confidence: 'HIGH' as const, recentErrorPct: 0.04 };

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

/** Run a sequence of actions forward, returning the real trajectory the search would carry. */
function trajectoryOf(state: NormalizedFarmState, ctx: SimContext, actions: Parameters<typeof applyAction>[1][]): SimTrajectory {
  let current = state;
  const path: SimTrajectory['path'] = [];
  const deltas: FarmDelta[] = [];
  for (const action of actions) {
    const result = applyAction(current, action, ctx);
    assert.ok(result.feasible, `expected feasible action: ${JSON.stringify(action)} — ${result.blocker ?? ''}`);
    path.push(action);
    deltas.push(result.delta);
    current = result.nextState;
  }
  return { path, deltas, finalState: current, score: 0, terminal: false };
}

/** Minimal synthetic FarmDelta for exercising cross-day grouping directly. */
function synthDelta(toTimestamp: number, xpDiff: number, balanceDiff: number): FarmDelta {
  return {
    fromVersion: 0, toVersion: 1, fromTimestamp: toTimestamp, toTimestamp,
    durationMs: 0, quality: { complete: true, gapDetected: false },
    temporalAttribution: { spansDayBoundary: false },
    inventoryDiff: {}, xpDiff, levelDiff: 0, balanceDiff, coinsDiff: 0,
    observedEvents: [], inferredEvents: [], events: [],
  } as unknown as FarmDelta;
}

describe('Slice 3 policy — buildStrategyPolicy (single real day)', () => {
  it('groups a same-day cook trajectory into one day and sums its projected XP', () => {
    const state = makeState({ Pumpkin: 100 });
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP } };
    const best = trajectoryOf(state, ctx, [
      { type: 'cook', item: 'Pumpkin Soup', quantity: 1 },
      { type: 'cook', item: 'Pumpkin Soup', quantity: 1 },
    ]);

    const policy = buildStrategyPolicy({
      farmId: 'farm-1', objective: 'XP', best,
      calibration: CALIBRATION, computedAt: COMPUTED_AT, provenance: PROVENANCE,
    });

    assert.equal(policy.plan.length, 1);
    assert.equal(policy.plan[0].day, 1);
    assert.equal(policy.plan[0].date, '2024-05-10');
    assert.equal(policy.plan[0].actions.length, 2);
    assert.equal(policy.plan[0].projectedXp, 48); // 24 XP per cook, no boosts
    assert.equal(policy.plan[0].projectedNetFlower, 0);

    assert.equal(policy.projected.totalXp, 48);
    assert.equal(policy.projected.totalNetFlower, 0);
    assert.equal(policy.horizonDays, 1);

    // passthroughs and defaults
    assert.equal(policy.farmId, 'farm-1');
    assert.equal(policy.goalId, 'DEFAULT'); // goalId omitted → DEFAULT
    assert.equal(policy.objective, 'XP');
    assert.equal(policy.computedAt, COMPUTED_AT);
    assert.equal(policy.planChangedAt, COMPUTED_AT); // defaults to computedAt
    assert.deepEqual(policy.calibration, CALIBRATION);
    assert.equal(policy.provenance, PROVENANCE);
    assert.deepEqual(policy.counterfactuals, []);
  });
});

describe('Slice 3 policy — counterfactuals scored against the chosen plan', () => {
  it('reports each rejected alternative as an XP/FLOWER delta relative to the winner', () => {
    const state = makeState({ Pumpkin: 100, Wood: 50 });
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP }, prices: { Wood: 0.5 } };

    const best = trajectoryOf(state, ctx, [
      { type: 'cook', item: 'Pumpkin Soup', quantity: 1 },
      { type: 'cook', item: 'Pumpkin Soup', quantity: 1 },
    ]);
    const cf = trajectoryOf(state, ctx, [{ type: 'sell', item: 'Wood', quantity: 50 }]);

    const policy = buildStrategyPolicy({
      farmId: 'farm-1', goalId: 'reach-l15', objective: 'XP', best,
      counterfactuals: [cf],
      calibration: CALIBRATION, computedAt: COMPUTED_AT, provenance: PROVENANCE,
    });

    assert.equal(policy.goalId, 'reach-l15');
    assert.equal(policy.counterfactuals.length, 1);
    const [only] = policy.counterfactuals;
    assert.equal(only.deltaXp, -48); // selling forgoes 48 cooked XP
    assert.equal(only.deltaFlower, 25); // 50 Wood @ 0.5
    assert.match(only.label, /sell/i);
    assert.match(only.label, /Wood/);
    assert.equal(typeof only.whyRejected, 'string');
    assert.ok(only.whyRejected.length > 0);
  });
});

describe('Slice 3 policy — multi-day grouping & projection totals', () => {
  it('buckets deltas by UTC date into 1-based days and sums totals across them', () => {
    const best: SimTrajectory = {
      path: [
        { type: 'cook', item: 'A', quantity: 1 },
        { type: 'cook', item: 'B', quantity: 1 },
        { type: 'cook', item: 'C', quantity: 1 },
      ],
      deltas: [
        synthDelta(CAPTURED_AT, 10, 0),
        synthDelta(CAPTURED_AT, 20, 0),
        synthDelta(NEXT_DAY, 5, 3),
      ],
      finalState: makeState({}),
      score: 0,
      terminal: false,
    };

    const policy = buildStrategyPolicy({
      farmId: 'farm-1', objective: 'XP', best,
      calibration: CALIBRATION, computedAt: COMPUTED_AT, provenance: PROVENANCE,
    });

    assert.equal(policy.plan.length, 2);
    assert.equal(policy.horizonDays, 2);

    assert.deepEqual(
      policy.plan.map((d) => ({ day: d.day, date: d.date, actions: d.actions.length, xp: d.projectedXp })),
      [
        { day: 1, date: '2024-05-10', actions: 2, xp: 30 },
        { day: 2, date: '2024-05-11', actions: 1, xp: 5 },
      ],
    );

    assert.equal(policy.projected.totalXp, 35);
    assert.equal(policy.projected.totalNetFlower, 3);
  });

  it('passes goalReached / etaDays through into the projection', () => {
    const best: SimTrajectory = {
      path: [{ type: 'cook', item: 'A', quantity: 1 }],
      deltas: [synthDelta(CAPTURED_AT, 10, 0)],
      finalState: makeState({}), score: 0, terminal: false,
    };
    const policy = buildStrategyPolicy({
      farmId: 'farm-1', objective: 'XP', best,
      calibration: CALIBRATION, computedAt: COMPUTED_AT, provenance: PROVENANCE,
      goalReached: true, etaDays: 3,
    });
    assert.equal(policy.projected.goalReached, true);
    assert.equal(policy.projected.etaDays, 3);
  });
});

describe('Slice 3 policy — empty trajectory', () => {
  it('produces an empty plan with zeroed projection and no counterfactuals', () => {
    const best: SimTrajectory = {
      path: [], deltas: [], finalState: makeState({}), score: 0, terminal: true,
    };
    const policy = buildStrategyPolicy({
      farmId: 'farm-1', objective: 'FLOWER', best,
      calibration: CALIBRATION, computedAt: COMPUTED_AT, provenance: PROVENANCE,
    });
    assert.deepEqual(policy.plan, []);
    assert.equal(policy.horizonDays, 0);
    assert.equal(policy.projected.totalXp, 0);
    assert.equal(policy.projected.totalNetFlower, 0);
    assert.deepEqual(policy.counterfactuals, []);
  });
});
