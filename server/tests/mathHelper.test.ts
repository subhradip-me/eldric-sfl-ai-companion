/**
 * server/tests/mathHelper.test.ts
 * Unit test suite for MathHelper: float precision, resource diffs, boosters, table formatting.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MathHelper } from '../services/ai/pipeline/MathHelper.js';
import type { ActiveEffect } from '../core/effectEngine/effectTypes.js';

describe('AI Pipeline: MathHelper', () => {
  it('handles exact float precision without floating-point drift', () => {
    const diff = MathHelper.roundFloat(1600 - 1470.8, 3);
    assert.equal(diff, 129.2);

    const rounded = MathHelper.roundFloat(0.1 + 0.2, 4);
    assert.equal(rounded, 0.3);
  });

  it('computes accurate resource diffs against inventory and coins', () => {
    const requirements = {
      Coins: 1600,
      Wood: 5,
      Iron: 3,
    };
    const inventory = {
      wood: 2,
      iron: 10,
    };
    const coins = 1470.8;

    const res = MathHelper.computeResourceDiffs(requirements, inventory, coins);
    assert.equal(res.canAfford, false);
    assert.equal(res.rows.length, 3);

    const coinRow = res.rows.find((r) => r.item === 'Coins');
    assert.ok(coinRow);
    assert.equal(coinRow.needed, 1600);
    assert.equal(coinRow.stock, 1470.8);
    assert.equal(coinRow.shortfall, 129.2);
    assert.equal(coinRow.status, 'SHORTFALL');

    const woodRow = res.rows.find((r) => r.item === 'Wood');
    assert.ok(woodRow);
    assert.equal(woodRow.needed, 5);
    assert.equal(woodRow.stock, 2);
    assert.equal(woodRow.shortfall, 3);
    assert.equal(woodRow.status, 'SHORTFALL');

    const ironRow = res.rows.find((r) => r.item === 'Iron');
    assert.ok(ironRow);
    assert.equal(ironRow.needed, 3);
    assert.equal(ironRow.stock, 10);
    assert.equal(ironRow.shortfall, 0);
    assert.equal(ironRow.surplus, 7);
    assert.equal(ironRow.status, 'MET');
  });

  it('generates clean markdown diff table with status badges', () => {
    const { rows } = MathHelper.computeResourceDiffs({ Wood: 10 }, { Wood: 15 });
    const table = MathHelper.formatDiffTable(rows);
    assert.match(table, /\| Requirement \| Needed \| In Stock \| Shortfall \| Status \|/);
    assert.match(table, /\| \*\*Wood\*\* \| 10 \| 15 \| 0 \| ✅ MET \|/);
  });

  it('factors in active boosters and buffs (XP and cook speed multipliers)', () => {
    const mockEffects: ActiveEffect[] = [
      {
        sourceId: 'Munching Mastery',
        sourceType: 'passive_skill',
        domain: 'xp',
        operation: 'multiply',
        target: 'food',
        value: 1.05,
        description: '+5% Food XP',
        ruleVersion: '1.0',
        activation: { kind: 'passive_skill', skill: 'Munching Mastery', rank: 1 },
        active: true,
      },
      {
        sourceId: 'VIP',
        sourceType: 'vip',
        domain: 'xp',
        operation: 'multiply',
        target: 'global',
        value: 1.1,
        description: 'VIP 10% XP bonus',
        ruleVersion: '1.0',
        activation: { kind: 'vip', expiresAt: 9999999999, active: true },
        active: true,
      },
      {
        sourceId: 'Fast Feasts',
        sourceType: 'passive_skill',
        domain: 'cooking',
        operation: 'multiply',
        target: 'global',
        value: 0.9,
        description: '10% faster cook time',
        ruleVersion: '1.0',
        activation: { kind: 'passive_skill', skill: 'Fast Feasts', rank: 1 },
        active: true,
      },
    ];

    const result = MathHelper.applyBoosters('Pancakes', { xp: 1000, cookTime: 60 }, mockEffects);
    assert.ok(result.boostedValues.effectiveFoodXp);
    // 1000 * 1.05 * 1.1 = 1155
    assert.equal(result.boostedValues.effectiveFoodXp, 1155);

    // 60 * 0.9 = 54
    assert.equal(result.boostedValues.effectiveCookTime, 54);
    assert.equal(result.activeBuffs.length, 3);
    assert.match(result.buffsImpactText, /Active Boosters Applied/);
  });
});
