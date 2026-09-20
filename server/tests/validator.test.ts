/**
 * server/tests/validator.test.ts
 * Unit tests for DeterministicValidator: diffs, missing keys, retry signals, boosters, degraded mode.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicValidator } from '../services/ai/pipeline/DeterministicValidator.js';
import type { NormalizedFarmState } from '../domain/index.js';
import type { AIToolResult } from '../domain/index.js';

describe('AI Pipeline: DeterministicValidator', () => {
  const mockFarmState: NormalizedFarmState = {
    metadata: {
      farmId: 'farm-123',
      schemaVersion: '1.0',
      capturedAt: Date.now(),
    },
    player: {
      bumpkinId: 1001,
      level: 62,
      experience: 2500000,
      coins: 1470.8,
      equipped: {
        tool: 'Farmer Pitchfork',
      },
      skills: {
        'Munching Mastery': 1,
      },
    },
    inventory: {
      Wood: 12,
      Iron: 10,
      Gold: 2,
    },
    structures: {
      buildings: {
        'Fire Pit': [{ id: 'b1', coordinates: { x: 0, y: 0 }, readyAt: 0, createdAt: 0 }],
      },
      placedCollectibles: [],
    },
    buffs: {
      vip: true,
      timedBuffs: [],
    },
  };

  it('triggers retry with search_knowledge when entity is missing from tool results', () => {
    const report = DeterministicValidator.validate(
      { requiredEntity: 'Iron Pickaxe' },
      [],
      mockFarmState
    );

    assert.equal(report.status, 'INVALID');
    assert.ok(report.missingKeys.includes('entity:Iron Pickaxe'));
    assert.ok(report.targetTool);
    assert.equal(report.targetTool.name, 'search_knowledge');
    assert.equal(report.targetTool.args.query, 'Iron Pickaxe');
  });

  it('validates Iron Pickaxe requirements (Blacksmith missing, coins shortfall, wood/iron met)', () => {
    const mockToolResults: Array<AIToolResult<unknown>> = [
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
                ingredients: {
                  Wood: 5,
                  Iron: 3,
                },
              },
            },
          ],
        },
      },
    ];

    const report = DeterministicValidator.validate(
      { requiredEntity: 'Iron Pickaxe' },
      mockToolResults,
      mockFarmState
    );

    assert.equal(report.status, 'VALID');
    assert.ok(report.synthesis);
    assert.equal(report.synthesis.canAfford, false);

    // Blacksmith building is missing on this farm
    assert.equal(report.synthesis.buildingMet, false);
    const blacksmithRow = report.synthesis.rows.find((r) => r.item.includes('Blacksmith'));
    assert.ok(blacksmithRow);
    assert.equal(blacksmithRow.status, 'MISSING_BUILDING');

    // Coins: need 1600, have 1470.8 -> shortfall 129.2
    const coinsRow = report.synthesis.rows.find((r) => r.item === 'Coins');
    assert.ok(coinsRow);
    assert.equal(coinsRow.needed, 1600);
    assert.equal(coinsRow.stock, 1470.8);
    assert.equal(coinsRow.shortfall, 129.2);

    // Wood: need 5, have 12 -> MET
    const woodRow = report.synthesis.rows.find((r) => r.item === 'Wood');
    assert.ok(woodRow);
    assert.equal(woodRow.status, 'MET');
  });

  it('validates Barn building requirements (Level 30 MET at Lv 62, Gold shortfall)', () => {
    const mockToolResults: Array<AIToolResult<unknown>> = [
      {
        tool: 'search_knowledge',
        success: true,
        data: {
          results: [
            {
              entity: 'Barn',
              type: 'BUILDINGS',
              structuredData: {
                name: 'Barn',
                unlocksAtLevel: 30,
                ingredients: {
                  Coins: 200,
                  Wood: 150,
                  Iron: 10,
                  Gold: 10,
                },
              },
            },
          ],
        },
      },
    ];

    const report = DeterministicValidator.validate(
      { requiredEntity: 'Barn', requireBumpkinLevel: 30 },
      mockToolResults,
      mockFarmState
    );

    assert.ok(report.synthesis);
    assert.equal(report.synthesis.levelMet, true);
    assert.equal(report.synthesis.requiredLevel, 30);
    assert.equal(report.synthesis.currentLevel, 62);

    // Gold: need 10, have 2 -> shortfall 8
    const goldRow = report.synthesis.rows.find((r) => r.item === 'Gold');
    assert.ok(goldRow);
    assert.equal(goldRow.needed, 10);
    assert.equal(goldRow.stock, 2);
    assert.equal(goldRow.shortfall, 8);
    assert.equal(goldRow.status, 'SHORTFALL');
  });

  it('triggers DATA_UNAVAILABLE degraded mode when farm state is missing or rate-limited', () => {
    const mockToolResults: Array<AIToolResult<unknown>> = [
      {
        tool: 'search_knowledge',
        success: true,
        data: {
          results: [
            {
              entity: 'Pancakes',
              type: 'RECIPES',
              structuredData: {
                name: 'Pancakes',
                ingredients: { Wheat: 5, Honey: 2 },
              },
            },
          ],
        },
      },
    ];

    const report = DeterministicValidator.validate(
      { requiredEntity: 'Pancakes' },
      mockToolResults,
      null // farm state offline
    );

    assert.equal(report.status, 'DATA_UNAVAILABLE');
    assert.ok(report.missingKeys.includes('farmState'));
    assert.ok(report.synthesis);
    assert.equal(report.synthesis.degradedMode, true);
    assert.match(report.synthesis.degradedReason!, /temporarily unavailable/);
    assert.ok(report.synthesis.markdownTable.length > 0);
  });

  it('factors active boosters and buffs (VIP, Munching Mastery) into synthesis', () => {
    const mockToolResults: Array<AIToolResult<unknown>> = [
      {
        tool: 'search_knowledge',
        success: true,
        data: {
          results: [
            {
              entity: 'Boiled Eggs',
              type: 'RECIPES',
              structuredData: {
                name: 'Boiled Eggs',
                xp: 90,
                cookingSeconds: 300,
                ingredients: { Egg: 5 },
              },
            },
          ],
        },
      },
    ];

    const report = DeterministicValidator.validate(
      { requiredEntity: 'Boiled Eggs' },
      mockToolResults,
      mockFarmState
    );

    assert.ok(report.synthesis);
    assert.ok(report.synthesis.activeBuffs.length > 0);
    // Farm has VIP (+10%) and Munching Mastery (+5%) -> effective food XP boosted
    assert.ok(report.synthesis.boostedValues?.effectiveFoodXp! > 90);
    assert.match(report.synthesis.buffsImpactText!, /Active Boosters Applied/);
  });
});
