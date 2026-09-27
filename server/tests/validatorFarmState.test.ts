/**
 * server/tests/validatorFarmState.test.ts
 * Regression tests: DeterministicValidator must read affordability from the
 * REAL NormalizedFarmState shape (economy.coins, inventory.all), not a
 * flattened mock. Guards against false "cannot afford" verdicts in production.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FarmNormalizer } from '../services/farm/FarmNormalizer.js';
import { DeterministicValidator } from '../services/ai/pipeline/DeterministicValidator.js';
import type { AIToolResult } from '../domain/index.js';

describe('DeterministicValidator against real NormalizedFarmState', () => {
  const normalizer = new FarmNormalizer();

  // A player who can clearly afford an Iron Pickaxe:
  // 15,000 coins, 100 Wood, 50 Iron, and owns a Blacksmith.
  const { normalizedState } = normalizer.normalize(
    {
      id: 'farm-real',
      bumpkin: { id: 1, level: 62, experience: 2500000 },
      balance: '150.00',
      coins: 15000,
      inventory: { Wood: 100, Iron: 50, Gold: 20 },
      buildings: { Blacksmith: [{}] },
    },
    { farmId: 'farm-real' }
  );

  const ironPickaxeTools: Array<AIToolResult<unknown>> = [
    {
      tool: 'search_knowledge',
      success: true,
      data: {
        results: [
          {
            entity: 'Iron Pickaxe',
            type: 'TOOLS',
            structuredData: {
              name: 'Iron Pickaxe',
              price: 1600,
              ingredients: { Wood: 5, Iron: 3 },
            },
          },
        ],
      },
    },
  ];

  it('reads coins from economy.coins (not player.coins) so affordable crafts are not falsely rejected', () => {
    const report = DeterministicValidator.validate(
      { requiredEntity: 'Iron Pickaxe' },
      ironPickaxeTools,
      normalizedState
    );

    const coinsRow = report.synthesis?.rows.find((r) => r.item === 'Coins');
    assert.ok(coinsRow, 'Coins row should exist');
    assert.equal(coinsRow.stock, 15000, 'Coins stock must come from economy.coins');
    assert.equal(coinsRow.status, 'MET', 'Player has 15000 coins for a 1600-coin tool');
  });

  it('reads item stock from inventory.all so owned ingredients are counted', () => {
    const report = DeterministicValidator.validate(
      { requiredEntity: 'Iron Pickaxe' },
      ironPickaxeTools,
      normalizedState
    );

    const woodRow = report.synthesis?.rows.find((r) => r.item === 'Wood');
    const ironRow = report.synthesis?.rows.find((r) => r.item === 'Iron');
    assert.ok(woodRow && ironRow);
    assert.equal(woodRow.stock, 100, 'Wood stock must come from inventory.all');
    assert.equal(woodRow.status, 'MET');
    assert.equal(ironRow.stock, 50, 'Iron stock must come from inventory.all');
    assert.equal(ironRow.status, 'MET');
  });

  it('reports canAfford=true for a fully-equipped, well-stocked player', () => {
    const report = DeterministicValidator.validate(
      { requiredEntity: 'Iron Pickaxe' },
      ironPickaxeTools,
      normalizedState
    );

    assert.equal(report.synthesis?.canAfford, true);
    assert.equal(report.synthesis?.buildingMet, true, 'Blacksmith is owned');
  });
});
