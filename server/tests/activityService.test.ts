import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { activityService, resolveItemPrice } from '../services/farm/ActivityService.js';

describe('ActivityService & Price Resolution Tests', () => {
  const mockPrices = {
    Wood: 0.0019,
    Stone: 0.002,
    Iron: 0.005,
    Kale: 0.017,
    Barley: 0.019,
    Wheat: 0.035,
    Egg: 0.01,
  };

  test('resolveItemPrice resolves direct P2P prices', () => {
    assert.equal(resolveItemPrice('Wood', mockPrices), 0.0019);
    assert.equal(resolveItemPrice('Kale', mockPrices), 0.017);
  });

  test('resolveItemPrice derives seed prices at ~40% of crop market price', () => {
    const kaleSeedPrice = resolveItemPrice('Kale Seed', mockPrices);
    assert.equal(kaleSeedPrice, +(0.017 * 0.4).toFixed(6));

    const barleySeedPrice = resolveItemPrice('Barley Seed', mockPrices);
    assert.equal(barleySeedPrice, +(0.019 * 0.4).toFixed(6));
  });

  test('resolveItemPrice derives tool cost from component recipes', () => {
    // Axe = 5 Wood (0.0019) + 1 Stone (0.002) = 0.0095 + 0.002 = 0.0115
    const axePrice = resolveItemPrice('Axe', mockPrices);
    assert.equal(axePrice, 0.0115);
  });

  test('resolveItemPrice derives animal feed from crop recipes', () => {
    // Hay = 3 Wheat (0.035) = 0.105
    const hayPrice = resolveItemPrice('Hay', mockPrices);
    assert.equal(hayPrice, 0.105);
  });

  test('diff and valuate accurately separates produced gains vs spent consumables', () => {
    const prev = {
      xp: 1000,
      flower: 10,
      inventory: {
        'Kale Seed': 300,
        Axe: 20,
        Wood: 100,
        Kale: 0,
      },
      farmActivity: { 'Tree Chopped': 50 },
      created_at: 1000000,
    };

    const curr = {
      xp: 1500,
      flower: 10,
      inventory: {
        'Kale Seed': 100, // spent 200 Kale Seeds
        Axe: 10,         // spent 10 Axes
        Wood: 600,       // produced 500 Wood
        Kale: 200,       // produced 200 Kale
      },
      farmActivity: { 'Tree Chopped': 100 },
      created_at: 1003600,
    };

    const diff = activityService.diff(prev, curr);
    assert.equal(diff.xpDelta, 500);
    assert.equal(diff.inferred['Kale Seed'], -200);
    assert.equal(diff.inferred['Axe'], -10);
    assert.equal(diff.inferred['Wood'], 500);
    assert.equal(diff.inferred['Kale'], 200);

    const valued = activityService.valuate(diff, mockPrices);
    // Produced: 500 Wood * 0.0019 (0.95) + 200 Kale * 0.017 (3.4) = 4.35
    assert.equal(valued.valuation.producedFlower, 4.35);

    // Spent: 200 Kale Seed (200 * 0.0068 = 1.36) + 10 Axe (10 * 0.0115 = 0.115) = 1.475
    assert.equal(valued.valuation.spentFlower, 1.475);

    // Net: 4.35 - 1.475 = 2.875
    assert.equal(valued.valuation.netFlower, 2.875);
    assert.ok(valued.valuation.producedPerItem['Wood'] > 0);
    assert.ok(valued.valuation.spentPerItem['Kale Seed'] > 0);
  });

  test('dailySummary computes multi-day production, expenses, and net profit margins', () => {
    const snap1 = {
      xp: 1000,
      flower: 10,
      inventory: { 'Kale Seed': 100, Kale: 0, Wood: 100 },
      farmActivity: {},
      created_at: 1789600000000, // day 1
    };
    const snap2 = {
      xp: 1500,
      flower: 10,
      inventory: { 'Kale Seed': 50, Kale: 50, Wood: 200 },
      farmActivity: {},
      created_at: 1789600000000 + 3600000, // same day
    };

    const summary = activityService.dailySummary([snap1, snap2], mockPrices);
    assert.equal(summary.days.length, 1);
    const day = summary.days[0];
    assert.ok(day.producedFlower > 0);
    assert.ok(day.spentFlower > 0);
    assert.equal(day.netFlower, +(day.producedFlower - day.spentFlower).toFixed(6));

    assert.ok(summary.totals.totalProducedFlower > 0);
    assert.ok(summary.totals.totalSpentFlower > 0);
    assert.ok(summary.totals.profitMarginPct > 0);
    assert.ok(summary.totals.topProduced.length > 0);
    assert.ok(summary.totals.topSpent.length > 0);
    assert.equal(summary.totals.topSpent[0].item, 'Kale Seed');
  });
});
