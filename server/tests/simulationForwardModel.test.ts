/**
 * server/tests/simulationForwardModel.test.ts
 * Slice 3 — pure forward model (`applyAction`) golden tests.
 *
 * Honesty foundation: a simulated transition must be the SAME kind of object
 * (`FarmDelta`) that the backward model produces, scored by the SAME valuation.
 * The cook path must reuse `calculateFoodXp`, so sim XP == dashboard XP by construction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculateFoodXp } from '../core/index.js';
import { applyAction } from '../core/simulation/forwardModel.js';
import type { SimAction, SimContext } from '../core/simulation/forwardModel.js';

import type { NormalizedFarmState } from '../domain/state.js';
import type { RecipeDefinition } from '../domain/recipes.js';

const CAPTURED_AT = 1715342400000;

interface MakeStateOptions {
  inventoryAll?: Record<string, number>;
  experience?: number;
  buildings?: Record<string, unknown[]>;
  capturedAt?: number;
}

function makeState(options: MakeStateOptions = {}): NormalizedFarmState {
  return {
    player: {
      bumpkinId: 1001,
      level: 10,
      experience: options.experience ?? 5000,
      skills: {},
      equipped: {},
    },
    economy: {
      flower: '10.0',
      flowerApprox: 10.0,
      sfl: 10.0,
      coins: 1000,
    },
    inventory: {
      all: options.inventoryAll ?? { Pumpkin: 100 },
      seeds: {},
      crops: {},
      food: {},
      resources: {},
      tools: {},
      collectibles: {},
      fishing: {},
      special: {},
    },
    structures: {
      buildings: (options.buildings ?? { 'Fire Pit': [{ readyAt: null, coordinates: { x: 0, y: 0 } }] }) as never,
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
      capturedAt: options.capturedAt ?? CAPTURED_AT,
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

describe('Slice 3 forward model — applyAction(cook)', () => {
  it('consumes recipe ingredients, yields the food, and awards XP equal to calculateFoodXp', () => {
    const state = makeState({ inventoryAll: { Pumpkin: 100 }, experience: 5000 });
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP } };
    const action: SimAction = { type: 'cook', item: 'Pumpkin Soup', quantity: 1 };

    const result = applyAction(state, action, ctx);

    const expected = calculateFoodXp({ recipeName: 'Pumpkin Soup', recipe: PUMPKIN_SOUP }).value;

    assert.equal(result.feasible, true);
    assert.equal(result.delta.xpDiff, expected.batchXp);
    assert.equal(result.delta.inventoryDiff['Pumpkin'], -10);
    assert.equal(result.delta.inventoryDiff['Pumpkin Soup'], 1);
    assert.equal(result.nextState.inventory.all['Pumpkin'], 90);
    assert.equal(result.nextState.player.experience, 5024);
  });

  it('does not mutate the input state (zero side effects)', () => {
    const state = makeState({ inventoryAll: { Pumpkin: 100 }, experience: 5000 });
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP } };

    applyAction(state, { type: 'cook', item: 'Pumpkin Soup', quantity: 1 }, ctx);

    assert.equal(state.inventory.all['Pumpkin'], 100);
    assert.equal(state.player.experience, 5000);
    assert.equal(state.inventory.all['Pumpkin Soup'], undefined);
  });
});

describe('Slice 3 forward model — applyAction(cook) feasibility gates', () => {
  it('reports infeasible (never negative inventory) when ingredients are short', () => {
    const state = makeState({ inventoryAll: { Pumpkin: 5 } });
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP } };

    const result = applyAction(state, { type: 'cook', item: 'Pumpkin Soup', quantity: 1 }, ctx);

    assert.equal(result.feasible, false);
    assert.match(result.blocker ?? '', /Pumpkin/);
    assert.equal(result.delta.xpDiff, 0);
    assert.equal(state.inventory.all['Pumpkin'], 5);
    assert.equal(result.nextState.inventory.all['Pumpkin'], 5);
  });

  it('reports infeasible when the required building is absent', () => {
    const state = makeState({ inventoryAll: { Pumpkin: 100 }, buildings: {} });
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP } };

    const result = applyAction(state, { type: 'cook', item: 'Pumpkin Soup', quantity: 1 }, ctx);

    assert.equal(result.feasible, false);
    assert.match(result.blocker ?? '', /Fire Pit/);
  });
});

describe('Slice 3 forward model — applyAction(sell)', () => {
  it('removes units and credits FLOWER at the market unit price', () => {
    const state = makeState({ inventoryAll: { Wood: 50 } });
    const ctx: SimContext = { now: CAPTURED_AT, prices: { Wood: 0.5 } };

    const result = applyAction(state, { type: 'sell', item: 'Wood', quantity: 50 }, ctx);

    assert.equal(result.feasible, true);
    assert.equal(result.delta.inventoryDiff['Wood'], -50);
    assert.equal(result.delta.balanceDiff, 25);
    assert.equal(result.nextState.inventory.all['Wood'], 0);
    assert.equal(result.nextState.economy.flowerApprox, 35);
  });

  it('reports infeasible (never negative inventory) when units are short', () => {
    const state = makeState({ inventoryAll: { Wood: 10 } });
    const ctx: SimContext = { now: CAPTURED_AT, prices: { Wood: 0.5 } };

    const result = applyAction(state, { type: 'sell', item: 'Wood', quantity: 50 }, ctx);

    assert.equal(result.feasible, false);
    assert.match(result.blocker ?? '', /Wood/);
    assert.equal(result.delta.balanceDiff, 0);
    assert.equal(result.nextState.inventory.all['Wood'], 10);
  });

  it('reports infeasible when the item has no market price', () => {
    const state = makeState({ inventoryAll: { Sunflower: 100 } });
    const ctx: SimContext = { now: CAPTURED_AT, prices: {} };

    const result = applyAction(state, { type: 'sell', item: 'Sunflower', quantity: 100 }, ctx);

    assert.equal(result.feasible, false);
    assert.match(result.blocker ?? '', /price/i);
  });
});

describe('Slice 3 forward model — applyAction(buy)', () => {
  it('adds units and debits FLOWER at the market unit price', () => {
    const state = makeState({ inventoryAll: {} });
    const ctx: SimContext = { now: CAPTURED_AT, prices: { Wood: 0.5 } };

    const result = applyAction(state, { type: 'buy', item: 'Wood', quantity: 10 }, ctx);

    assert.equal(result.feasible, true);
    assert.equal(result.delta.inventoryDiff['Wood'], 10);
    assert.equal(result.delta.balanceDiff, -5);
    assert.equal(result.nextState.inventory.all['Wood'], 10);
    assert.equal(result.nextState.economy.flowerApprox, 5);
  });

  it('reports infeasible when FLOWER balance cannot cover the purchase', () => {
    const state = makeState({ inventoryAll: {} });
    const ctx: SimContext = { now: CAPTURED_AT, prices: { Wood: 0.5 } };

    const result = applyAction(state, { type: 'buy', item: 'Wood', quantity: 30 }, ctx);

    assert.equal(result.feasible, false);
    assert.match(result.blocker ?? '', /FLOWER|afford|balance/i);
    assert.equal(result.nextState.economy.flowerApprox, 10);
    assert.equal(result.nextState.inventory.all['Wood'] ?? 0, 0);
  });

  it('reports infeasible when the item has no market price', () => {
    const state = makeState({ inventoryAll: {} });
    const ctx: SimContext = { now: CAPTURED_AT, prices: {} };

    const result = applyAction(state, { type: 'buy', item: 'Mystery', quantity: 1 }, ctx);

    assert.equal(result.feasible, false);
    assert.match(result.blocker ?? '', /price/i);
  });
});
