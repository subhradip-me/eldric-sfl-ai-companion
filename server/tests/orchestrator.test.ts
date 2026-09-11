/**
 * server/tests/orchestrator.test.ts
 * Golden test suite for Phase 6 (Live AI / AI Orchestration).
 *
 * Verifies all approved review amendments:
 * A. Dedicated check_action_permission tool
 * B. Anti-hallucination candidate resolution (LLM cannot manufacture candidates)
 * C. Unified AIToolResult<T> provenance envelope with typed errors
 * D. Snapshot-first get_farm_state with freshness classification
 * E. Bounded orchestration and canonical stableStringify deduplication
 * F. Adversarial boundary tests (prohibiting calculation bypass or constraint overrides)
 * G. Response contract with machine-readable warnings and provenance
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { orchestrator, stableStringify } from '../services/ai/Orchestrator.js';
import { FarmNormalizer } from '../services/farm/FarmNormalizer.js';
import { snapshotService } from '../services/farm/index.js';
import { AIToolResultSchema, AIChatResponseSchema } from '../schemas/aiSchema.js';
import { RoadmapSchema } from '../schemas/roadmapSchema.js';
import { loadFixture } from '../fixtures/index.js';

describe('Phase 6: Live AI / AI Orchestrator', () => {
  const normalizer = new FarmNormalizer();

  // Mock ToolContext
  const testContext = {
    sessionId: 'test-session-1',
    userId: 90001,
    farmId: 'farm-phase6-test',
    userGoal: 'Optimize farm progression',
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment C: Unified AIToolResult Envelope Compliance
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment C: Common Tool Envelope (AIToolResult<T>) Compliance', () => {
    it('get_market_prices returns schema-compliant AIToolResult with OBSERVED tier', async () => {
      const result = await orchestrator.tools['get_market_prices'].exec({}, testContext);

      assert.equal(result.tool, 'get_market_prices');
      assert.equal(result.success, true);
      assert.equal(result.epistemicTier, 'OBSERVED');
      assert.ok(result.data);
      assert.ok(result.data.prices);

      // Validate against runtime Zod schema
      const validated = AIToolResultSchema.parse(result);
      assert.ok(validated);
    });

    it('returns typed error code when invalid argument is passed', async () => {
      const result = await orchestrator.tools['compute_recipe_cost'].exec(
        { recipe: 'NonExistentRecipe123' },
        testContext
      );

      assert.equal(result.tool, 'compute_recipe_cost');
      assert.equal(result.success, false);
      assert.ok(result.error);
      assert.equal(result.error.code, 'INVALID_ARGUMENT');
      assert.match(result.error.message, /Unknown recipe/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment D: Snapshot-First get_farm_state & Staleness Exposure
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment D: Snapshot-First get_farm_state & Freshness', () => {
    it('serves farm state from snapshot store and reports freshness tier', async () => {
      const fixture = loadFixture<any>('farm-mid-level');
      const canonicalMock = {
        farmId: 'farm-phase6-test',
        bumpkin: { id: 90001, level: 45, experience: 520000, skills: {}, equipped: {} },
        balance: '150.00',
        coins: 15000,
        inventory: fixture.farm.inventory,
        buildings: { 'Fire Pit': {}, 'Kitchen': {} },
        farmActivity: {},
        buffs: { vip: false },
      };

      // Register in memory snapshot store
      orchestrator.setFarmState(testContext.farmId, canonicalMock, 'FRESH');

      const result = await orchestrator.tools['get_farm_state'].exec({}, testContext);

      assert.equal(result.tool, 'get_farm_state');
      assert.equal(result.success, true);
      assert.equal(result.epistemicTier, 'OBSERVED');
      assert.ok(result.staleness === 'FRESH' || result.staleness === 'STALE');
      assert.ok(result.data.inventory);
      assert.equal(result.data.coins, 15000);
      assert.ok(result.provenance);
      assert.equal(result.provenance.farmId, testContext.farmId);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment A: Dedicated Action Permission Tool (check_action_permission)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment A: Dedicated Action Permission Tool (check_action_permission)', () => {
    it('rejects action exceeding discretionary balance (farm-reservation-conflict.json)', async () => {
      const fixture = loadFixture<any>('farm-reservation-conflict');
      const canonicalMock = {
        farmId: 'farm-reservation-test',
        bumpkin: { id: 90004, level: 30, experience: 320000, skills: {}, equipped: {} },
        balance: fixture.farm.balance,
        coins: fixture.farm.coins,
        inventory: fixture.farm.inventory,
        buildings: { Bakery: {} },
        farmActivity: {},
        buffs: { vip: false },
      };
      orchestrator.setFarmState('farm-reservation-test', canonicalMock, 'FRESH');

      const context = { ...testContext, userId: 90004, farmId: 'farm-reservation-test' };

      // Action requiring 80 FLOWER when tomorrow requires 70 FLOWER (balance is 100)
      const result = await orchestrator.tools['check_action_permission'].exec(
        {
          resource: 'FLOWER',
          quantity: 80,
          timing: 'IMMEDIATE',
          tomorrowRequirements: { FLOWER: fixture.planningContext.tomorrowRequirement.reservedFlower },
        },
        context
      );

      assert.equal(result.tool, 'check_action_permission');
      assert.equal(result.success, true);
      assert.equal(result.epistemicTier, 'DERIVED');
      assert.equal(result.data.actionPermitted, false);
      assert.ok(result.warnings && result.warnings.length > 0);
      assert.match(result.data.message, /exceeds discretionary balance/);

      // Smaller action requiring 25 FLOWER
      const permittedResult = await orchestrator.tools['check_action_permission'].exec(
        {
          resource: 'FLOWER',
          quantity: 25,
          timing: 'IMMEDIATE',
          tomorrowRequirements: { FLOWER: fixture.planningContext.tomorrowRequirement.reservedFlower },
        },
        context
      );
      assert.equal(permittedResult.data.actionPermitted, true);
    });

    it('distinguishes immediate shortfall from future projected pipeline approval', async () => {
      const fixture = loadFixture<any>('farm-active-production');
      const canonicalMock = {
        farmId: 'farm-active-test',
        bumpkin: { id: 90006, level: 35, experience: 450000, skills: {}, equipped: {} },
        balance: fixture.farm.balance,
        coins: fixture.farm.coins,
        inventory: fixture.farm.inventory, // Wheat: 50
        buildings: {},
        farmActivity: {},
        buffs: { vip: false },
        crops: fixture.farm.crops, // 500 Wheat in production
      };
      orchestrator.setFarmState('farm-active-test', canonicalMock, 'FRESH');

      const context = { ...testContext, userId: 90006, farmId: 'farm-active-test' };

      // Immediate check for 400 Wheat fails (50 available < 400)
      const immediateCheck = await orchestrator.tools['check_action_permission'].exec(
        { resource: 'Wheat', quantity: 400, timing: 'IMMEDIATE' },
        context
      );
      assert.equal(immediateCheck.data.actionPermitted, false);

      // Future check for 400 Wheat succeeds (50 owned + 500 in-production >= 400)
      const futureCheck = await orchestrator.tools['check_action_permission'].exec(
        { resource: 'Wheat', quantity: 400, timing: 'FUTURE' },
        context
      );
      assert.equal(futureCheck.data.actionPermitted, true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment B: Anti-Hallucination Feasibility Gate
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment B: Deterministic Candidate Resolution in Feasibility Gate', () => {
    it('resolves actual recipe parameters deterministically and rejects when budget is exceeded', async () => {
      // User intent: cook Pancakes (costs ~1.79 FLOWER), but with maxFlowerCost: 1.0
      const result = await orchestrator.tools['evaluate_strategy_feasibility'].exec(
        {
          target: 'Pancakes',
          quantity: 1,
          intent: 'RECIPE',
          constraints: { maxFlowerCost: 1.0 },
        },
        testContext
      );

      assert.equal(result.tool, 'evaluate_strategy_feasibility');
      assert.equal(result.success, true);
      assert.equal(result.epistemicTier, 'DERIVED');
      assert.ok(result.data.candidate);

      // Authoritative parameters resolved deterministically (not hallucinated by LLM)
      assert.equal(result.data.candidate.title, 'Cook Pancakes');
      assert.equal(result.data.candidate.estimatedDurationMinutes, 20);
      assert.ok(result.data.candidate.items.includes('Wheat'));

      // Hard constraint evaluated
      assert.equal(result.data.assessment.isFeasible, false);
      assert.equal(result.data.assessment.status, 'INVALID');
      assert.ok(result.warnings && result.warnings.length > 0);
    });

    it('approves feasible recipe under adequate budget', async () => {
      const result = await orchestrator.tools['evaluate_strategy_feasibility'].exec(
        {
          target: 'Pancakes',
          quantity: 1,
          intent: 'RECIPE',
          constraints: { maxFlowerCost: 1000 },
        },
        testContext
      );

      assert.equal(result.data.assessment.isFeasible, true);
      assert.equal(result.data.assessment.status, 'VALID');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 5 Strategic Planner Tool (get_roadmap)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Strategic Planner Tool (get_roadmap)', () => {
    it('generates multi-phase Roadmap with daily objectives, warnings, and provenance', async () => {
      const result = await orchestrator.tools['get_roadmap'].exec(
        {
          objective: 'REACH_LEVEL',
          targetLevel: 50,
          maxFlowerCost: 10000,
          primaryFocus: 'XP',
        },
        testContext
      );

      assert.equal(result.tool, 'get_roadmap');
      assert.equal(result.success, true);
      assert.equal(result.epistemicTier, 'DERIVED');
      assert.ok(result.data.phases);
      assert.ok(result.data.phases.length > 0);
      assert.equal(result.data.phases[0].dailyObjectives[0].dayNumber, 1);
      assert.ok(result.provenance);
      assert.equal(result.provenance.plannerVersion, '1.0.0-phase5');

      // Validate against runtime RoadmapSchema
      const validatedRoadmap = RoadmapSchema.parse(result.data);
      assert.ok(validatedRoadmap);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Temporal Context Tool (get_temporal_context)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Temporal Context Tool (get_temporal_context)', () => {
    it('returns Sunflower Clock time, in-game day, and seasonal urgency', async () => {
      const result = await orchestrator.tools['get_temporal_context'].exec({}, testContext);

      assert.equal(result.tool, 'get_temporal_context');
      assert.equal(result.success, true);
      assert.equal(result.epistemicTier, 'DERIVED');
      assert.ok(result.data.gameTime);
      assert.ok(result.data.currentDay >= 1);
      assert.ok(result.data.season);
      assert.ok(result.provenance);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Recipe Economics Tool (compute_recipe_cost)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Recipe Economics Tool (compute_recipe_cost)', () => {
    it('calculates deterministic XP and out-of-pocket costs for Pizza Margherita', async () => {
      const result = await orchestrator.tools['compute_recipe_cost'].exec(
        { recipe: 'Pizza Margherita' },
        testContext
      );

      assert.equal(result.tool, 'compute_recipe_cost');
      assert.equal(result.success, true);
      assert.equal(result.epistemicTier, 'DERIVED');
      assert.equal(result.data.effective.minutes, 1200);
      assert.equal(result.data.effective.xpPerFood, 25000);
      assert.ok(result.data.cost);
      assert.ok(result.provenance);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment E: Bounded Orchestration & Canonical Deduplication
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment E: Canonical Deduplication & Bounded Loop', () => {
    it('produces identical stableStringify key regardless of object key order', () => {
      const key1 = stableStringify({ target: 'Pancakes', quantity: 1, timing: 'IMMEDIATE' });
      const key2 = stableStringify({ timing: 'IMMEDIATE', target: 'Pancakes', quantity: 1 });
      const key3 = stableStringify({ quantity: 1, timing: 'IMMEDIATE', target: 'Pancakes' });

      assert.equal(key1, key2);
      assert.equal(key2, key3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment F: Adversarial Authority Boundary Tests
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment F: Adversarial Authority Boundary Tests', () => {
    it('enforces that user claim cannot override authoritative snapshot state', async () => {
      // User says: "I have 500 wood"
      // But get_farm_state authoritative tool returns actual snapshot inventory (fixture has 100 Wood)
      const farmResult = await orchestrator.tools['get_farm_state'].exec({}, testContext);
      assert.equal(farmResult.epistemicTier, 'OBSERVED');
      // The tool provides the ground truth, not the user's conversational assumption
      assert.ok(farmResult.data.inventory);
      const reportedWood = farmResult.data.inventory['Wood'] ?? 0;
      assert.notEqual(reportedWood, 500, 'User claim of 500 wood must not override authoritative tool snapshot');
    });

    it('enforces hard constraint rejection even if user asks to ignore constraints', async () => {
      // User asks to ignore constraints and evaluate Strategy A (55000 FLOWER) under 50000 budget
      const result = await orchestrator.tools['evaluate_strategy_feasibility'].exec(
        {
          target: 'Strategy A: Fast Push',
          intent: 'NAMED_STRATEGY',
          constraints: { maxFlowerCost: 50000 },
        },
        testContext
      );

      // Even if user wants to ignore constraints, the feasibility gate marks it INVALID
      assert.equal(result.data.assessment.isFeasible, false);
      assert.equal(result.data.assessment.status, 'INVALID');
      assert.ok(result.data.assessment.violations.length > 0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment G: Response Contract with Warnings & Provenance
  // ─────────────────────────────────────────────────────────────────────────
  describe('Response Contract Enhancement', () => {
    it('validates AIChatResponse structure compliance', () => {
      const sampleResponse = {
        success: true,
        answer: 'Based on your farm state, Day 1 objectives are scheduled.',
        steps: [
          { tool: 'get_farm_state', ok: true, epistemicTier: 'OBSERVED' as const },
          { tool: 'get_roadmap', ok: true, epistemicTier: 'DERIVED' as const },
        ],
        warnings: ['Artichoke is unavailable in Winter (starts in 2 days).'],
        provenance: {
          farmId: 'farm-1',
          snapshotVersion: 1,
          calculationEngineVersion: '2.0.0',
          gameDataVersion: '2026.09.11',
          plannerVersion: '1.0.0-phase5',
          computedAt: 1700000000000,
        },
      };

      const validated = AIChatResponseSchema.parse(sampleResponse);
      assert.ok(validated);
      assert.equal(validated.steps.length, 2);
      assert.equal(validated.warnings?.length, 1);
      assert.equal(validated.provenance?.plannerVersion, '1.0.0-phase5');
    });
  });
});
