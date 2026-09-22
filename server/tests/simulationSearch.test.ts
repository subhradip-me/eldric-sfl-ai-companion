/**
 * server/tests/simulationSearch.test.ts
 * Slice 3 — deterministic beam search over the forward model.
 *
 * Honesty foundation: a trajectory is scored by aggregating the SAME `FarmDelta`
 * objects the forward model emits through `aggregateDailyMetrics` — the identical
 * valuation a real day gets. The search is a pure mechanism (expand feasible
 * candidates, keep top-K by a goal-focused objective, to horizon N); the objective
 * axis (XP / FLOWER / TIME) is the goal's declared `primaryFocus`, never a
 * fabricated cross-axis conversion.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { beamSearch, objectiveForFocus } from '../core/simulation/search.js';
import type { SimAction, SimContext } from '../core/simulation/forwardModel.js';

import type { NormalizedFarmState } from '../domain/state.js';
import type { RecipeDefinition } from '../domain/recipes.js';

const CAPTURED_AT = 1715342400000;

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
    metadata: {
      capturedAt: CAPTURED_AT,
      normalizerVersion: '1.0.0-test',
      source: 'test',
      freshness: 'FRESH',
    },
  };
}

const PUMPKIN_SOUP: RecipeDefinition = {
  building: 'Fire Pit',
  baseOutput: 1,
  baseXp: 24,
  baseCookMinutes: 3,
  ingredients: { Pumpkin: 10 },
};

const CTX: SimContext = {
  now: CAPTURED_AT,
  recipes: { 'Pumpkin Soup': PUMPKIN_SOUP },
  prices: { Pumpkin: 0.5 },
};

/** Two competing moves at every step: cook (XP, no FLOWER) vs sell (FLOWER, no XP). */
const candidates = (): SimAction[] => [
  { type: 'cook', item: 'Pumpkin Soup', quantity: 1 },
  { type: 'sell', item: 'Pumpkin', quantity: 10 },
];

describe('Slice 3 beam search — objective drives the chosen trajectory', () => {
  it('an XP objective maximizes cooked-food XP over the horizon', () => {
    const state = makeState({ Pumpkin: 100 });

    const results = beamSearch(state, {
      candidates,
      horizon: 3,
      beamWidth: 2,
      ctx: CTX,
      objective: objectiveForFocus('XP'),
    });

    const best = results[0];
    assert.equal(best.path.length, 3);
    assert.ok(best.path.every((a) => a.type === 'cook'));
    assert.equal(best.score, 72); // 3 batches × 24 XP
    assert.equal(best.finalState.inventory.all['Pumpkin'], 70);
  });

  it('a FLOWER objective maximizes net FLOWER over the horizon', () => {
    const state = makeState({ Pumpkin: 100 });

    const results = beamSearch(state, {
      candidates,
      horizon: 3,
      beamWidth: 2,
      ctx: CTX,
      objective: objectiveForFocus('FLOWER'),
    });

    const best = results[0];
    assert.equal(best.path.length, 3);
    assert.ok(best.path.every((a) => a.type === 'sell'));
    assert.equal(best.score, 15); // 3 × (10 Pumpkin × 0.5)
  });
});

describe('Slice 3 beam search — mechanism guarantees', () => {
  it('is deterministic: identical inputs yield identical trajectories (no RNG)', () => {
    const state = makeState({ Pumpkin: 100 });
    const opts = { candidates, horizon: 3, beamWidth: 2, ctx: CTX, objective: objectiveForFocus('XP') };

    const a = beamSearch(state, opts);
    const b = beamSearch(state, opts);

    assert.deepEqual(a.map((t) => t.path), b.map((t) => t.path));
    assert.deepEqual(a.map((t) => t.score), b.map((t) => t.score));
  });

  it('never emits an infeasible path and preserves a terminal beam that cannot expand', () => {
    // Only enough Pumpkin for a single cook (10); selling is unpriced here.
    const state = makeState({ Pumpkin: 15 });
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP } };
    const cookOnly = (): SimAction[] => [{ type: 'cook', item: 'Pumpkin Soup', quantity: 1 }];

    const results = beamSearch(state, {
      candidates: cookOnly,
      horizon: 3,
      beamWidth: 2,
      ctx,
      objective: objectiveForFocus('XP'),
    });

    const best = results[0];
    assert.equal(best.path.length, 1); // second cook infeasible → terminal preserved
    assert.equal(best.score, 24);
    assert.equal(best.finalState.inventory.all['Pumpkin'], 5);
  });

  it('keeps at most beamWidth trajectories on the frontier', () => {
    const state = makeState({ Pumpkin: 100 });

    const results = beamSearch(state, {
      candidates,
      horizon: 3,
      beamWidth: 2,
      ctx: CTX,
      objective: objectiveForFocus('XP'),
    });

    assert.ok(results.length <= 2);
    // Sorted descending by score.
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score);
    }
  });
});
