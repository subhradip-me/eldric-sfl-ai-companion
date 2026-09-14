/**
 * server/tests/inventoryStrategy.test.ts
 * Deterministic test suite for granular inventory fidelity, active production netting,
 * gatherable classification, and payload bounds by construction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import farmFixture from '../fixtures/farm-346853928974080.json' with { type: 'json' };
import { FarmNormalizer } from '../services/farm/FarmNormalizer.js';
import { generateCandidates } from '../core/planner/candidateGenerator.js';
import { generateRoadmap } from '../core/planner/roadmapGenerator.js';
import { stableStringify } from '../services/ai/Orchestrator.js';
import type { Goal, NormalizedFarmState } from '../domain/index.js';

describe('Inventory Strategy & Payload Bounds Acceptance Suite', () => {
  const normalizer = new FarmNormalizer();
  const normalizedFarm = normalizer.normalize(farmFixture.farm, {
    farmId: '346853928974080',
  }).normalizedState;

  const sampleGoal: Goal = {
    goalId: 'goal-level-up',
    farmId: '346853928974080',
    status: 'ACTIVE',
    objective: 'MAXIMIZE_XP',
    target: { xp: 50000 },
    constraints: {},
    preferences: { primaryFocus: 'XP' },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  it('correctly maps Crimstone as OWNED and Fish Oil as PRODUCE in Crimstone Infused Fish Oil', () => {
    const candidates = generateCandidates({
      goal: sampleGoal,
      state: normalizedFarm,
    });

    const fishOilCand = candidates.find((c) => c.title.includes('Crimstone Infused Fish Oil'));
    assert.ok(fishOilCand, 'Crimstone Infused Fish Oil candidate was generated');

    const crimstoneReq = fishOilCand.ingredientBreakdown?.find((i) => i.item === 'Crimstone');
    assert.ok(crimstoneReq, 'Crimstone requirement present');
    assert.equal(crimstoneReq.needed, 1);
    assert.equal(crimstoneReq.owned, 22);
    assert.equal(crimstoneReq.missing, 0);
    assert.equal(crimstoneReq.status, 'OWNED');
    assert.equal(crimstoneReq.actionType, 'IN_INVENTORY');
    assert.equal(crimstoneReq.unitCostFlower, 0);

    const fishOilReq = fishOilCand.ingredientBreakdown?.find((i) => i.item === 'Fish Oil');
    assert.ok(fishOilReq, 'Fish Oil requirement present');
    assert.equal(fishOilReq.needed, 1);
    assert.equal(fishOilReq.owned, 0);
    assert.equal(fishOilReq.missing, 1);
    assert.equal(fishOilReq.status, 'MISSING');
    assert.equal(fishOilReq.actionType, 'PRODUCE'); // Not on market, so produce in-house
  });

  it('correctly handles fractional quantities without integer truncation (Honey 11.517)', () => {
    const candidates = generateCandidates({
      goal: sampleGoal,
      state: normalizedFarm,
    });

    // Find any candidate using Honey or inspect ingredientBreakdown directly
    const honeyCand = candidates.find((c) =>
      c.ingredientBreakdown?.some((i) => i.item === 'Honey')
    );
    assert.ok(honeyCand, 'A candidate requiring Honey was generated');

    const honeyReq = honeyCand.ingredientBreakdown?.find((i) => i.item === 'Honey');
    assert.ok(honeyReq, 'Honey requirement present');
    assert.ok(honeyReq.owned > 11.5 && honeyReq.owned < 11.6, `Expected ~11.517 Honey, got ${honeyReq.owned}`);
    if (honeyReq.needed > honeyReq.owned) {
      assert.equal(honeyReq.status, 'PARTIAL');
      assert.equal(honeyReq.missing, Math.round((honeyReq.needed - honeyReq.owned) * 10000) / 10000);
    }
  });

  it('deducts inputs committed to activeProduction from owned inventory', () => {
    const stateWithActiveProduction: NormalizedFarmState = {
      ...normalizedFarm,
      production: {
        ...normalizedFarm.production,
        active: [
          {
            id: 'prod-1' as any,
            category: 'COOKING',
            item: 'Some In-Flight Recipe',
            quantity: 1,
            status: 'OBSERVED',
            startedAt: 1700000000000,
            readyAt: 1700001000000,
            expectedOutput: 1,
            inputs: {
              Honey: 5,
              Crimstone: 2,
            },
          },
        ],
      },
    };

    const candidates = generateCandidates({
      goal: sampleGoal,
      state: stateWithActiveProduction,
    });

    const fishOilCand = candidates.find((c) => c.title.includes('Crimstone Infused Fish Oil'));
    assert.ok(fishOilCand);
    const crimstoneReq = fishOilCand.ingredientBreakdown?.find((i) => i.item === 'Crimstone');
    assert.ok(crimstoneReq);
    // Original 22 - 2 in flight = 20 available
    assert.equal(crimstoneReq.owned, 20);

    const honeyCand = candidates.find((c) =>
      c.ingredientBreakdown?.some((i) => i.item === 'Honey')
    );
    assert.ok(honeyCand);
    const honeyReq = honeyCand.ingredientBreakdown?.find((i) => i.item === 'Honey');
    assert.ok(honeyReq);
    // Original 11.517 - 5 in flight = 6.517 available
    assert.ok(honeyReq.owned > 6.5 && honeyReq.owned < 6.6, `Expected ~6.517 Honey after netting, got ${honeyReq.owned}`);
  });

  it('guarantees get_roadmap payload is bounded under 15 KB and parses valid JSON', () => {
    const roadmap = generateRoadmap({
      goal: sampleGoal,
      state: normalizedFarm,
    });

    const jsonStr = stableStringify(roadmap.phases);
    const sizeBytes = Buffer.byteLength(jsonStr, 'utf8');

    // Assert Payload Hierarchy:
    // TARGET: < 10 KB (normal)
    // SOFT LIMIT: 15 KB (acceptable)
    // HARD LIMIT: 32 KB (transport limit, beyond which payload_too_large structured error triggers)
    assert.ok(
      sizeBytes < 10000,
      `Roadmap phases size ${sizeBytes} bytes is within normal TARGET budget (< 10 KB)`
    );
    assert.ok(
      sizeBytes <= 15000,
      `Roadmap phases size ${sizeBytes} bytes respects SOFT LIMIT (<= 15 KB)`
    );

    // Verify it parses as 100% valid JSON without truncated syntax errors
    const parsed = JSON.parse(jsonStr);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 1);
    assert.ok(parsed[0].dailyObjectives[0].targetActions.length > 0);
  });
});
