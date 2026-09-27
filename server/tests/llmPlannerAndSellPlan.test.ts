/**
 * server/tests/llmPlannerAndSellPlan.test.ts
 * Test suite for the LLM Planner + Deterministic Guardrail + Sell-Plan Resolver
 * (docs/superpowers/specs/2026-09-22-llm-planner-and-sell-resolver-design.md, Slices 1 + 2).
 *
 * Coverage:
 *  - LlmPlanner.parse: canned JSON → ClassifiedPlan; malformed / unknown intent → null; fence stripping.
 *  - PlanGuardrail.validate: unknown tools dropped, baseline injected, args coerced, empty → null, directives clamped.
 *  - Planner: deterministic fallback routes MARKET_PRICES / SELL_ADVICE; known intents still route.
 *  - resolve_sell_plan: placed nodes / untradables excluded; preserve honored; ledger reserves excluded;
 *    gap-fill math; shortfall reported.
 *  - Regression: the exact screenshot queries never propose selling a placed node.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LlmPlanner } from '../services/ai/pipeline/LlmPlanner.js';
import { PlanGuardrail } from '../services/ai/pipeline/PlanGuardrail.js';
import { Planner } from '../services/ai/pipeline/Planner.js';
import type { ClassifiedPlan, ToolCatalog, PipelineContext } from '../services/ai/pipeline/types.js';
import { orchestrator } from '../services/ai/Orchestrator.js';
import type { SellPlanResult } from '../domain/index.js';

// A minimal tool catalog mirroring the real registered tools + parameter schemas.
const CATALOG: ToolCatalog = {
  get_farm_state: { description: 'Authoritative farm state', parameters: { type: 'object', properties: {} } },
  get_active_effects: { description: 'Active boosts', parameters: { type: 'object', properties: {} } },
  get_market_prices: { description: 'Live P2P prices', parameters: { type: 'object', properties: {} } },
  resolve_sell_plan: {
    description: 'Sell-plan resolver',
    parameters: {
      type: 'object',
      properties: {
        gapFlower: { type: 'number' },
        preserve: { type: 'array', items: { type: 'string' } },
        reserveForGoal: { type: 'string' },
      },
    },
  },
  compute_recipe_cost: {
    description: 'Recipe economics',
    parameters: { type: 'object', properties: { recipe: { type: 'string' }, quantity: { type: 'number' } } },
  },
};

const ctx: PipelineContext = {
  sessionId: 'sess-sell-1',
  userId: 91234,
  farmId: 'farm-sell-test',
  userGoal: '',
};

describe('Slice 1: LlmPlanner.parse (pure JSON → ClassifiedPlan)', () => {
  it('parses a well-formed MARKET_PRICES classification', () => {
    const raw = JSON.stringify({
      intent: 'MARKET_PRICES',
      criteria: { checkBoosters: true, requiredEntity: 'Crimstone' },
      plannedTools: [
        { name: 'get_market_prices', args: {} },
        { name: 'get_farm_state', args: {} },
      ],
      synthesisDirectives: ['Cite live P2P prices; never quote KB base values as current prices.'],
    });
    const plan = LlmPlanner.parse(raw, CATALOG);
    assert.ok(plan);
    assert.equal(plan!.intent, 'MARKET_PRICES');
    assert.equal(plan!.plannedTools.length, 2);
    assert.equal(plan!.criteria.requiredEntity, 'Crimstone');
    assert.equal(plan!.synthesisDirectives.length, 1);
  });

  it('strips markdown code fences and leading prose before parsing', () => {
    const raw = 'Here is the plan:\n```json\n{"intent":"SELL_ADVICE","plannedTools":[{"name":"resolve_sell_plan","args":{"gapFlower":20}}],"synthesisDirectives":[]}\n```';
    const plan = LlmPlanner.parse(raw, CATALOG);
    assert.ok(plan);
    assert.equal(plan!.intent, 'SELL_ADVICE');
    assert.equal(plan!.plannedTools[0].name, 'resolve_sell_plan');
    assert.equal(plan!.plannedTools[0].args.gapFlower, 20);
  });

  it('returns null for malformed JSON', () => {
    assert.equal(LlmPlanner.parse('not json at all', CATALOG), null);
    assert.equal(LlmPlanner.parse('{ intent: MARKET_PRICES,', CATALOG), null);
  });

  it('returns null for an unknown intent', () => {
    const raw = JSON.stringify({ intent: 'TELEPORT', plannedTools: [{ name: 'get_farm_state', args: {} }] });
    assert.equal(LlmPlanner.parse(raw, CATALOG), null);
  });

  it('returns null when no known tool survives', () => {
    const raw = JSON.stringify({ intent: 'GENERAL_QUERY', plannedTools: [{ name: 'do_evil', args: {} }] });
    assert.equal(LlmPlanner.parse(raw, CATALOG), null);
  });

  it('drops non-string synthesisDirectives (never a number)', () => {
    const raw = JSON.stringify({
      intent: 'GENERAL_QUERY',
      plannedTools: [{ name: 'get_farm_state', args: {} }],
      synthesisDirectives: ['keep it short', 42, null, 'cite live data'],
    });
    const plan = LlmPlanner.parse(raw, CATALOG);
    assert.ok(plan);
    assert.deepEqual(plan!.synthesisDirectives, ['keep it short', 'cite live data']);
  });
});

describe('Slice 1: PlanGuardrail.validate (authoritative repair)', () => {
  const base: ClassifiedPlan = {
    intent: 'MARKET_PRICES',
    criteria: { checkBoosters: true },
    plannedTools: [{ name: 'get_market_prices', args: {} }],
    synthesisDirectives: ['cite live prices'],
  };

  it('drops unknown tools and keeps valid ones', () => {
    const plan = PlanGuardrail.validate(
      { ...base, plannedTools: [{ name: 'get_market_prices', args: {} }, { name: 'nonexistent_tool', args: {} }] },
      CATALOG,
      'check the p2p market'
    );
    assert.ok(plan);
    const names = plan!.plannedTools.map((t) => t.name);
    assert.ok(names.includes('get_market_prices'));
    assert.ok(!names.includes('nonexistent_tool'));
  });

  it('force-injects baseline tools when absent', () => {
    const plan = PlanGuardrail.validate(base, CATALOG, 'check the p2p market');
    assert.ok(plan);
    const names = plan!.plannedTools.map((t) => t.name);
    assert.ok(names.includes('get_farm_state'), 'baseline get_farm_state injected');
    assert.ok(names.includes('get_active_effects'), 'baseline get_active_effects injected');
  });

  it('coerces arg types against the tool schema (string → number)', () => {
    const plan = PlanGuardrail.validate(
      {
        intent: 'SELL_ADVICE',
        criteria: {},
        plannedTools: [{ name: 'resolve_sell_plan', args: { gapFlower: '25', preserve: ['Gold'], junk: 'x' } }],
        synthesisDirectives: [],
      },
      CATALOG,
      'what should I sell for 25 flower'
    );
    assert.ok(plan);
    const sell = plan!.plannedTools.find((t) => t.name === 'resolve_sell_plan');
    assert.ok(sell);
    assert.strictEqual(sell!.args.gapFlower, 25); // coerced to number
    assert.deepEqual(sell!.args.preserve, ['Gold']);
    assert.equal(sell!.args.junk, undefined); // unknown arg dropped
  });

  it('returns null when no valid tool remains (caller must fall back)', () => {
    const plan = PlanGuardrail.validate(
      { ...base, plannedTools: [{ name: 'ghost', args: {} }] },
      CATALOG,
      'anything'
    );
    assert.equal(plan, null);
  });

  it('clamps directive count and length', () => {
    const many = Array.from({ length: 20 }, (_, i) => `directive ${i} `.repeat(60));
    const plan = PlanGuardrail.validate({ ...base, synthesisDirectives: many }, CATALOG, 'x');
    assert.ok(plan);
    assert.ok(plan!.synthesisDirectives!.length <= 8);
    for (const d of plan!.synthesisDirectives!) assert.ok(d.length <= 400);
  });
});

describe('Slice 1: Planner deterministic fallback routing', () => {
  it('routes "check the p2p market" to MARKET_PRICES', async () => {
    const plan = await Planner.deterministicPlan('check the p2p market', ctx);
    assert.equal(plan.intent, 'MARKET_PRICES');
    assert.ok(plan.plannedTools.some((t) => t.name === 'get_market_prices'));
    assert.ok((plan.synthesisDirectives ?? []).length > 0);
  });

  it('routes "what should I sell to fill the FLOWER gap" to SELL_ADVICE', async () => {
    const plan = await Planner.deterministicPlan(
      'what should I sell to fill the FLOWER gap',
      ctx
    );
    assert.equal(plan.intent, 'SELL_ADVICE');
    assert.ok(plan.plannedTools.some((t) => t.name === 'resolve_sell_plan'));
  });

  it('extracts a named FLOWER gap into resolve_sell_plan.args', async () => {
    const plan = await Planner.deterministicPlan('what should I sell to raise 40 FLOWER', ctx);
    assert.equal(plan.intent, 'SELL_ADVICE');
    const sell = plan.plannedTools.find((t) => t.name === 'resolve_sell_plan');
    assert.equal(sell?.args.gapFlower, 40);
  });

  it('still routes a named recipe to RECIPE_OR_CRAFT', async () => {
    const plan = await Planner.deterministicPlan('how much XP from Pancakes', ctx);
    assert.equal(plan.intent, 'RECIPE_OR_CRAFT');
    assert.ok(plan.plannedTools.some((t) => t.name === 'compute_recipe_cost'));
  });

  it('Planner.plan with a catalog but no LLM keys degrades to deterministic routing', async () => {
    // No CLAUDE_API_KEY / GROQ_API_KEY in the test env → classify() returns null → fallback.
    const plan = await Planner.plan('check the p2p market', ctx, [], CATALOG);
    assert.equal(plan.intent, 'MARKET_PRICES');
    assert.equal(plan.planSource, 'DETERMINISTIC');
  });
});

describe('Slice 2: resolve_sell_plan resolver', () => {
  // Normalized farm state (has `.player`, so setFarmState uses it directly).
  const farm = {
    metadata: { farmId: ctx.farmId, schemaVersion: '1.0', capturedAt: Date.now() },
    player: { bumpkinId: 1, level: 60, experience: 1_000_000, coins: 100, equipped: {}, skills: {} },
    economy: { flower: '0', flowerApprox: 0, sfl: 0, coins: 100 },
    inventory: {
      all: { Wheat: 100, Wood: 200, Gold: 5, Carrot: 50, Crimstone: 20, 'Crimstone Rock': 3 },
      seeds: {}, crops: {}, food: {}, resources: {}, tools: {}, collectibles: {}, fishing: {}, special: {},
    },
    structures: { buildings: {}, placedCollectibles: [] },
    production: { active: [] },
    buffs: { vip: false, timedBuffs: [] },
    animals: { animals: {} },
    temporal: {},
  };

  const run = (args: Record<string, unknown>) => {
    orchestrator.setFarmState(ctx.farmId, farm as never, 'FRESH', 1);
    return orchestrator.tools['resolve_sell_plan'].exec(args, {
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      farmId: ctx.farmId,
    });
  };

  it('never lists a placed node or untradable resource as a candidate', async () => {
    const res = await run({});
    assert.equal(res.success, true);
    const data = res.data as SellPlanResult;
    const candNames = data.candidates.map((c) => c.item);
    assert.ok(!candNames.includes('Crimstone Rock'), 'Crimstone Rock must never be sellable');
    assert.ok(!candNames.includes('Crimstone'), 'Crimstone (tradable:false) must never be sellable');
    // Both appear in the excluded list as NOT_SELLABLE.
    const rockEx = data.excluded.find((e) => e.item === 'Crimstone Rock');
    assert.ok(rockEx && rockEx.reason === 'NOT_SELLABLE');
  });

  it('ranks candidates by total FLOWER value (Wheat first)', async () => {
    const res = await run({});
    const data = res.data as SellPlanResult;
    assert.equal(data.candidates[0].item, 'Wheat'); // 100 * 0.035 = 3.5 is the largest pool
    // Total proceeds = 3.5 + 0.38 + 0.05 + 0.04 = 3.97
    assert.ok(Math.abs(data.proceedsFlower - 3.97) < 1e-6);
  });

  it('fills a reachable gap and trims quantities', async () => {
    const res = await run({ gapFlower: 3 });
    const data = res.data as SellPlanResult;
    assert.equal(data.gapFilled, true);
    assert.equal(data.candidates.length, 1); // Wheat alone covers 3 FLOWER
    assert.equal(data.candidates[0].item, 'Wheat');
    assert.ok(data.candidates[0].qtyToSell < 100); // trimmed, not the full stock
    assert.ok(data.proceedsFlower >= 3);
    assert.equal(data.shortfallFlower, 0);
  });

  it('reports an honest shortfall when inventory cannot cover the gap', async () => {
    const res = await run({ gapFlower: 100 });
    const data = res.data as SellPlanResult;
    assert.equal(data.gapFilled, false);
    assert.ok(data.shortfallFlower > 0);
    assert.ok(Math.abs(data.shortfallFlower - (100 - data.proceedsFlower)) < 1e-6);
  });

  it('honors soft preserve[] (player asked to keep it)', async () => {
    const res = await run({ preserve: ['Wheat'] });
    const data = res.data as SellPlanResult;
    assert.ok(!data.candidates.some((c) => c.item === 'Wheat'));
    const ex = data.excluded.find((e) => e.item === 'Wheat');
    assert.ok(ex && ex.reason === 'PRESERVED_BY_REQUEST');
  });

  it('excludes ledger-reserved recipe ingredients (reserveForGoal)', async () => {
    // Pancakes x10 reserves Wheat 10*10 = 100, exactly the full stock.
    const res = await run({ reserveForGoal: 'Pancakes x10' });
    const data = res.data as SellPlanResult;
    assert.ok(!data.candidates.some((c) => c.item === 'Wheat'), 'reserved Wheat not sellable');
    const ex = data.excluded.find((e) => e.item === 'Wheat');
    assert.ok(ex && ex.reason === 'RESERVED_FOR_RECIPE');
  });
});
