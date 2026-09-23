/**
 * server/tests/simulationService.test.ts
 * Slice 3 — SimulationService: the timeline → calibrate → beam-search → StrategyPolicy driver.
 *
 * It is the only sim piece that touches the service seam, yet stays DB-free by DEPENDENCY
 * INJECTION: the caller passes the NormalizedFarmState timeline and the SimContext, never a
 * SnapshotService. The service (1) calibrates the model against the player's most recent real
 * step, (2) beam-searches the forward model from the latest state for the goal's objective,
 * and (3) folds the winner + rejected alternatives + the calibration tier into a StrategyPolicy.
 *
 * The invariant under test: the objective actually steers the plan, alternatives survive as
 * honest counterfactuals, and identical inputs yield an identical policy (pure & deterministic).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { simulationService } from '../services/simulation/SimulationService.js';
import { applyAction, type SimContext } from '../core/simulation/forwardModel.js';

import type { NormalizedFarmState } from '../domain/state.js';
import type { RecipeDefinition } from '../domain/recipes.js';
import type { CalculationProvenance } from '../domain/provenance.js';

const CAPTURED_AT = 1715342400000; // 2024-05-10T12:00:00.000Z
const COMPUTED_AT = 1715346000000;

const PUMPKIN_SOUP: RecipeDefinition = { building: 'Fire Pit', baseOutput: 1, baseXp: 24, baseCookMinutes: 3, ingredients: { Pumpkin: 10 } };

const PROVENANCE: CalculationProvenance = {
  farmId: 'farm-1', snapshotVersion: 7, calculationEngineVersion: 'sim-1.0.0',
  gameDataVersion: 'game-1.0.0', computedAt: COMPUTED_AT,
};

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

/** A real 2-state timeline: state0 → state1 via a single forward-model cook. */
function cookedTimeline(ctx: SimContext): NormalizedFarmState[] {
  const state0 = makeState({ Pumpkin: 100 });
  const step = applyAction(state0, { type: 'cook', item: 'Pumpkin Soup', quantity: 1 }, ctx);
  assert.ok(step.feasible, step.blocker);
  return [state0, step.nextState];
}

describe('SimulationService — builds a policy from a timeline', () => {
  it('projects XP-positive cooking and carries HIGH calibration for a perfectly-predicted last step', () => {
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP } };
    const timeline = cookedTimeline(ctx);

    const { policy, calibrationWindow } = simulationService.buildPolicy({
      farmId: 'farm-1', focus: 'XP', timeline, ctx,
      maxSteps: 3, beamWidth: 3, computedAt: COMPUTED_AT, provenance: PROVENANCE, priorCalibrationWindow: [],
    });

    assert.equal(policy.farmId, 'farm-1');
    assert.equal(policy.goalId, 'DEFAULT'); // goalId omitted → DEFAULT
    assert.equal(policy.objective, 'XP');
    assert.ok(policy.plan.length >= 1);
    assert.equal(policy.plan[0].actions[0].type, 'cook');
    assert.ok(policy.projected.totalXp > 0, `expected XP gain, got ${policy.projected.totalXp}`);
    // the observed last step was a clean cook → the model reproduces it exactly
    assert.equal(policy.calibration.confidence, 'HIGH');
    assert.ok(policy.calibration.recentErrorPct < 0.01);
    assert.equal(calibrationWindow.length, 1); // the real step contributed one sample
  });
});

describe('SimulationService — records a diverging alternative as a counterfactual', () => {
  it('keeps the sell-first alternative as a counterfactual when XP favors cooking', () => {
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP }, prices: { Pumpkin: 0.02 } };
    const timeline = cookedTimeline(ctx);

    const { policy } = simulationService.buildPolicy({
      farmId: 'farm-1', focus: 'XP', timeline, ctx,
      maxSteps: 3, beamWidth: 5, computedAt: COMPUTED_AT, provenance: PROVENANCE,
    });

    assert.equal(policy.plan[0].actions[0].type, 'cook'); // XP objective leads with cooking
    assert.ok(policy.counterfactuals.length >= 1);
    assert.ok(policy.counterfactuals.some((c) => /sell/i.test(c.label)), 'expected a sell counterfactual');
  });
});

describe('SimulationService — the objective steers the plan', () => {
  it('leads with a sell when the goal weights FLOWER', () => {
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP }, prices: { Pumpkin: 0.5 } };
    const timeline = cookedTimeline(ctx);

    const { policy } = simulationService.buildPolicy({
      farmId: 'farm-1', focus: 'FLOWER', timeline, ctx,
      maxSteps: 3, beamWidth: 4, computedAt: COMPUTED_AT, provenance: PROVENANCE,
    });

    assert.equal(policy.objective, 'FLOWER');
    assert.equal(policy.plan[0].actions[0].type, 'sell'); // FLOWER objective monetizes stock
    assert.ok(policy.projected.totalNetFlower > 0);
  });
});

describe('SimulationService — deterministic', () => {
  it('produces an identical policy for identical inputs', () => {
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP }, prices: { Pumpkin: 0.02 } };
    const build = () => simulationService.buildPolicy({
      farmId: 'farm-1', focus: 'XP', timeline: cookedTimeline(ctx), ctx,
      maxSteps: 4, beamWidth: 4, computedAt: COMPUTED_AT, provenance: PROVENANCE, priorCalibrationWindow: [],
    });

    const a = build();
    const b = build();
    assert.deepEqual(a.policy, b.policy);
    assert.deepEqual(a.calibrationWindow, b.calibrationWindow);
  });
});
