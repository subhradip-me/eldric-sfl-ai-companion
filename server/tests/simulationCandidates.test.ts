/**
 * server/tests/simulationCandidates.test.ts
 * Slice 3 — pure candidate generation: enumerate the legal SimActions from a state.
 *
 * "The engine decides what's candidates." generateSimCandidates enumerates the legal
 * moves from a farm state (cook feasible recipes, sell priced stock, buy explicitly
 * targeted items); the beam search then decides which ordering serves the goal.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateSimCandidates } from '../core/simulation/candidates.js';
import { beamSearch, objectiveForFocus } from '../core/simulation/search.js';
import type { SimContext } from '../core/simulation/forwardModel.js';

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
    metadata: { capturedAt: CAPTURED_AT, normalizerVersion: '1.0.0-test', source: 'test', freshness: 'FRESH' },
  };
}

const PUMPKIN_SOUP: RecipeDefinition = { building: 'Fire Pit', baseOutput: 1, baseXp: 24, baseCookMinutes: 3, ingredients: { Pumpkin: 10 } };
const BOILED_EGGS: RecipeDefinition = { building: 'Fire Pit', baseOutput: 1, baseXp: 10, baseCookMinutes: 6, ingredients: { Egg: 5 } };
const CAULI_BURGER: RecipeDefinition = { building: 'Kitchen', baseOutput: 1, baseXp: 250, baseCookMinutes: 180, ingredients: { Cauliflower: 15 } };

describe('Slice 3 candidates — generateSimCandidates', () => {
  it('emits a cook candidate for every recipe whose building is present, and none for absent buildings', () => {
    const state = makeState({ Pumpkin: 100, Egg: 20 });
    const ctx: SimContext = {
      now: CAPTURED_AT,
      recipes: { 'Pumpkin Soup': PUMPKIN_SOUP, 'Boiled Eggs': BOILED_EGGS, 'Cauliflower Burger': CAULI_BURGER },
    };

    const cooks = generateSimCandidates(state, ctx).filter((a) => a.type === 'cook');

    assert.deepEqual(
      cooks.map((a) => a.item).sort(),
      ['Boiled Eggs', 'Pumpkin Soup'], // Kitchen recipe excluded — no Kitchen on the farm
    );
  });

  it('emits a full-stock sell candidate for each priced item and skips unpriced items', () => {
    const state = makeState({ Wood: 50, Stone: 20, MysticShard: 5 });
    const ctx: SimContext = { now: CAPTURED_AT, prices: { Wood: 0.5, Stone: 0.3 } };

    const sells = generateSimCandidates(state, ctx).filter((a) => a.type === 'sell');

    assert.deepEqual(
      sells.map((a) => ({ item: a.item, quantity: a.quantity })).sort((x, y) => x.item.localeCompare(y.item)),
      [{ item: 'Stone', quantity: 20 }, { item: 'Wood', quantity: 50 }],
    );
  });

  it('emits buy candidates only for explicitly targeted items, with their target quantity', () => {
    const state = makeState({ Pumpkin: 0 });
    const ctx: SimContext = { now: CAPTURED_AT, prices: { Pumpkin: 0.5 } };

    const none = generateSimCandidates(state, ctx).filter((a) => a.type === 'buy');
    assert.equal(none.length, 0);

    const withBuy = generateSimCandidates(state, ctx, { buyItems: { Pumpkin: 30 } }).filter((a) => a.type === 'buy');
    assert.deepEqual(withBuy.map((a) => ({ item: a.item, quantity: a.quantity })), [{ item: 'Pumpkin', quantity: 30 }]);
  });

  it('drives a beam search end-to-end over a real state (no hand-written candidate list)', () => {
    const state = makeState({ Pumpkin: 100 });
    const ctx: SimContext = { now: CAPTURED_AT, recipes: { 'Pumpkin Soup': PUMPKIN_SOUP }, prices: { Pumpkin: 0.5 } };

    const results = beamSearch(state, {
      candidates: (s) => generateSimCandidates(s, ctx),
      horizon: 2,
      beamWidth: 3,
      ctx,
      objective: objectiveForFocus('XP'),
    });

    const best = results[0];
    assert.ok(best.path.length >= 1);
    assert.ok(best.score > 0); // cooking produced XP
    assert.ok(best.path.every((a) => a.type === 'cook' || a.type === 'sell'));
  });
});
