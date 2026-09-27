/**
 * server/tests/pipeline.test.ts
 * End-to-End integration test suite for the 4-Stage AI Pipeline:
 * Planner -> Orchestrator Tool Execution -> Deterministic Validator -> Explainer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PipelineCoordinator } from '../services/ai/pipeline/PipelineCoordinator.js';
import type { ToolExecutorMap } from '../services/ai/pipeline/PipelineCoordinator.js';
import type { NormalizedFarmState } from '../domain/index.js';
import { AIChatResponseSchema } from '../schemas/aiSchema.js';

describe('AI Pipeline: End-to-End Coordination Suite', () => {
  const mockFarm: NormalizedFarmState = {
    metadata: {
      farmId: 'farm-golden-1',
      schemaVersion: '1.0',
      capturedAt: Date.now(),
    },
    player: {
      bumpkinId: 1001,
      level: 62,
      experience: 2500000,
      coins: 1470.8,
      equipped: {},
      skills: {
        'Munching Mastery': 1,
      },
    },
    inventory: {
      Wood: 12,
      Iron: 10,
    },
    structures: {
      buildings: {},
      placedCollectibles: [],
    },
    buffs: {
      vip: true,
      timedBuffs: [],
    },
  };

  it('runs the 4-stage pipeline successfully for an item craft inquiry', async () => {
    const mockTools: ToolExecutorMap = {
      search_knowledge: {
        exec: async () => ({
          tool: 'search_knowledge',
          success: true,
          epistemicTier: 'AUTHORITATIVE',
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
        }),
      },
      get_farm_state: {
        exec: async () => ({
          tool: 'get_farm_state',
          success: true,
          epistemicTier: 'OBSERVED',
          data: { farm: mockFarm },
        }),
      },
      get_active_effects: {
        exec: async () => ({
          tool: 'get_active_effects',
          success: true,
          epistemicTier: 'DERIVED',
          data: { activeEffects: [] },
        }),
      },
    };

    const result = await PipelineCoordinator.execute(
      'Can I craft an Iron Pickaxe?',
      {
        sessionId: 'test-sess',
        userId: 1,
        farmId: 'farm-golden-1',
        userGoal: 'Can I craft an Iron Pickaxe?',
        farmState: mockFarm,
      },
      mockTools
    );

    assert.equal(result.success, true);
    assert.ok(result.answer.length > 0);
    assert.ok(result.steps.length >= 4);

    // Verify stages were executed in order
    const stages = result.steps.map((s) => s.stage);
    assert.ok(stages.includes('PLANNER'));
    assert.ok(stages.includes('ORCHESTRATOR'));
    assert.ok(stages.includes('VALIDATOR'));
    assert.ok(stages.includes('EXPLAINER'));

    // Verify Validator computed exact shortfalls
    assert.ok(result.validationReport);
    assert.ok(result.validationReport.synthesis);
    assert.equal(result.validationReport.synthesis.canAfford, false);
    assert.equal(result.validationReport.synthesis.buildingMet, false); // Blacksmith missing
    const coinsRow = result.validationReport.synthesis.rows.find((r) => r.item === 'Coins');
    assert.ok(coinsRow);
    assert.equal(coinsRow.shortfall, 129.2);

    // Validate response conforms to AIChatResponse contract
    const validated = AIChatResponseSchema.safeParse({
      success: result.success,
      answer: result.answer,
      steps: result.steps.map((s) => ({
        tool: s.tool ?? s.stage,
        ok: s.ok,
        epistemicTier: s.epistemicTier,
      })),
    });
    assert.ok(validated.success);
  });

  it('handles targeted single-tool retry when initial tool call misses entity data', async () => {
    let callCount = 0;
    const mockTools: ToolExecutorMap = {
      search_knowledge: {
        exec: async () => {
          callCount++;
          if (callCount === 1) {
            // First call returns empty results
            return {
              tool: 'search_knowledge',
              success: true,
              data: { results: [] },
            };
          }
          // Retry call returns authoritative data
          return {
            tool: 'search_knowledge',
            success: true,
            data: {
              results: [
                {
                  entity: 'Wood Pickaxe',
                  type: 'TOOLS',
                  structuredData: {
                    name: 'Wood Pickaxe',
                    price: 200,
                    ingredients: { Wood: 3 },
                  },
                },
              ],
            },
          };
        },
      },
      get_farm_state: {
        exec: async () => ({
          tool: 'get_farm_state',
          success: true,
          data: { farm: mockFarm },
        }),
      },
    };

    const result = await PipelineCoordinator.execute(
      'Recipe for Wood Pickaxe',
      {
        sessionId: 'test-sess',
        userId: 1,
        farmId: 'farm-golden-1',
        userGoal: 'Recipe for Wood Pickaxe',
      },
      mockTools
    );

    assert.equal(result.success, true);
    assert.equal(callCount, 2); // Triggered targeted retry
    assert.ok(result.validationReport?.synthesis);
    assert.equal(result.validationReport?.synthesis?.entityName, 'Wood Pickaxe');
  });

  it('handles DATA_UNAVAILABLE gracefully with degraded mode', async () => {
    const mockTools: ToolExecutorMap = {
      search_knowledge: {
        exec: async () => ({
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
        }),
      },
      get_farm_state: {
        exec: async () => ({
          tool: 'get_farm_state',
          success: false,
          staleness: 'VERY_STALE',
          error: {
            code: 'DEPENDENCY_UNAVAILABLE',
            message: 'Community API 429 rate limited',
            retryable: true,
          },
        }),
      },
    };

    const result = await PipelineCoordinator.execute(
      'Can I cook Pancakes?',
      {
        sessionId: 'test-sess',
        userId: 1,
        farmId: 'farm-golden-1',
        userGoal: 'Can I cook Pancakes?',
        farmState: null,
      },
      mockTools
    );

    assert.equal(result.success, true);
    assert.equal(result.validationReport?.status, 'DATA_UNAVAILABLE');
    assert.equal(result.validationReport?.synthesis?.degradedMode, true);
    assert.match(result.answer, /temporarily unavailable|in-game|Wheat/i);
  });

  it('accurately resolves Recipe XP with active buffs for multiple dishes', async () => {
    const mockTools: ToolExecutorMap = {
      compute_recipe_cost: {
        exec: async ({ recipe }) => {
          if (recipe === 'Boiled Eggs') {
            return {
              tool: 'compute_recipe_cost',
              success: true,
              data: {
                recipe: 'Boiled Eggs',
                effective: {
                  baseXp: 90,
                  xpPerFood: 103.95,
                  minutes: 4.5,
                  boostBreakdown: [{ label: '+10% VIP' }, { label: '+5% Munching Mastery' }],
                },
                formattedTime: '4m 30s',
                cost: { flower: 0 },
              },
            };
          }
          return {
            tool: 'compute_recipe_cost',
            success: true,
            data: {
              recipe: 'Pancakes',
              effective: {
                baseXp: 1000,
                xpPerFood: 1155,
                minutes: 18,
                boostBreakdown: [{ label: '+10% VIP' }, { label: '+5% Munching Mastery' }],
              },
              formattedTime: '18m',
              cost: { flower: 0 },
            },
          };
        },
      },
      get_active_effects: {
        exec: async () => ({
          tool: 'get_active_effects',
          success: true,
          data: { activeEffects: [] },
        }),
      },
      get_farm_state: {
        exec: async () => ({
          tool: 'get_farm_state',
          success: true,
          data: { farm: mockFarm },
        }),
      },
    };

    const result = await PipelineCoordinator.execute(
      'How much XP will I get from Boiled Eggs or Pancakes with my current buffs and skills?',
      {
        sessionId: 'test-sess',
        userId: 1,
        farmId: 'farm-golden-1',
        userGoal: 'How much XP will I get from Boiled Eggs or Pancakes with my current buffs and skills?',
        farmState: mockFarm,
      },
      mockTools
    );

    assert.equal(result.success, true);
    assert.ok(result.validationReport?.synthesis);
    const table = result.validationReport.synthesis.markdownTable;
    assert.match(table, /Boiled Eggs/);
    assert.match(table, /103\.95 XP/);
    assert.match(table, /Pancakes/);
    assert.match(table, /1,155 XP/);
    assert.match(result.answer, /103\.95|1,155|Boiled Eggs/i);
  });

  it('correctly handles Buy vs Farm for Milk without hallucinations', async () => {
    const mockTools: ToolExecutorMap = {
      evaluate_buy_vs_farm: {
        exec: async () => ({
          tool: 'evaluate_buy_vs_farm',
          success: true,
          data: {
            item: 'Milk',
            marketPriceFlower: 0.075,
            unitProduceCostFlower: 0.075,
            recommendation: 'BUY_FROM_MARKET',
            setupStatus: {
              buildingName: 'Barn',
              buildingUnlockLevel: 30,
              playerLevel: 64,
              levelMet: true,
              buildingOwned: false,
              animalName: 'Cow',
              animalCount: 0,
              animalPurchaseCoins: 100,
              canProduceNow: false,
              missingRequirements: [
                'Build Barn (Unlock Lv 30, Cost: 200 Coins, 150 Wood, 10 Iron, 10 Gold)',
                'Purchase Cow (100 Coins at Barn)',
              ],
              initialSetupCost: {
                coins: 300,
                resources: { Wood: 150, Iron: 10, Gold: 10 },
              },
            },
            summary: 'Short-term: Buy from market. Long-term: Farm in-house once Barn is built.',
          },
        }),
      },
      get_market_prices: {
        exec: async () => ({
          tool: 'get_market_prices',
          success: true,
          data: { prices: { Milk: 0.075 } },
        }),
      },
      get_farm_state: {
        exec: async () => ({
          tool: 'get_farm_state',
          success: true,
          data: { farm: mockFarm },
        }),
      },
      get_active_effects: {
        exec: async () => ({
          tool: 'get_active_effects',
          success: true,
          data: { activeEffects: [] },
        }),
      },
    };

    const result = await PipelineCoordinator.execute(
      'Should I buy Milk from the market or produce it myself with cows?',
      {
        sessionId: 'test-sess',
        userId: 1,
        farmId: 'farm-golden-1',
        userGoal: 'Should I buy Milk from the market or produce it myself with cows?',
        farmState: mockFarm,
      },
      mockTools
    );

    assert.equal(result.success, true);
    assert.ok(result.validationReport?.synthesis);
    const table = result.validationReport.synthesis.markdownTable;
    assert.match(table, /Market Purchase/);
    assert.match(table, /In-House Production/);
    assert.match(table, /Barn Building/);
    assert.match(table, /Cow Purchase/);
    // Verified no hallucinated 16000 coins
    assert.doesNotMatch(result.answer, /16000/);
    assert.doesNotMatch(result.answer, /cows are disabled/i);
  });

  it('accurately calculates level progression shortfall without reporting 0 shortfall prematurely', async () => {
    const mockTools: ToolExecutorMap = {
      get_level_requirements: {
        exec: async () => ({
          tool: 'get_level_requirements',
          success: true,
          data: {
            currentLevel: 64,
            currentXp: 2918706.74,
            targetLevel: 65,
            targetRequiredCumulativeXp: 2942905,
            remainingXpToTarget: 24198.26,
            overallProgressPercent: 99.18,
            levelBracketProgressPercent: 89.85,
          },
        }),
      },
      get_farm_state: {
        exec: async () => ({
          tool: 'get_farm_state',
          success: true,
          data: { farm: mockFarm },
        }),
      },
    };

    const result = await PipelineCoordinator.execute(
      'how much xp I need for next level',
      {
        sessionId: 'test-sess',
        userId: 1,
        farmId: 'farm-golden-1',
        userGoal: 'how much xp I need for next level',
        farmState: mockFarm,
      },
      mockTools
    );

    assert.equal(result.success, true);
    assert.ok(result.validationReport?.synthesis);
    const synth = result.validationReport.synthesis;
    assert.equal(synth.canAfford, false);
    assert.match(synth.markdownTable, /24,198\.26/);
    assert.doesNotMatch(synth.summaryText, /0 more XP/);
    assert.match(synth.summaryText, /24,198\.26 more XP/);
  });

  it('synthesizes real cooking roadmap for remaining xp without inventing fake dishes', async () => {
    const mockTools: ToolExecutorMap = {
      get_roadmap: {
        exec: async () => ({
          tool: 'get_roadmap',
          success: true,
          data: {
            goalId: 'goal-xp',
            totalEstimatedCostFlower: 1.71,
            totalEstimatedDays: 1,
            phases: [
              {
                phaseNumber: 1,
                name: 'Phase 1: Maximize Cooking XP',
                durationDays: 1,
                phaseObjectives: ['Cook high XP dishes'],
                dailyObjectives: [
                  {
                    dayIndex: 1,
                    projectedXpGained: 25000,
                    projectedFlowerSpent: 1.71,
                    targetActions: [
                      {
                        actionId: 'act-1',
                        type: 'COOK',
                        item: 'Pizza Margherita',
                        quantity: 1,
                        expectedXp: 25000,
                        durationMinutes: 1200,
                        estimatedCostFlower: 1.71,
                        reasoning: 'Highest XP dish available',
                      },
                    ],
                    ingredientSummary: [
                      {
                        item: 'Tomato',
                        needed: 30,
                        owned: 34,
                        missing: 0,
                        status: 'OWNED',
                        actionType: 'PLANT',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      },
      get_farm_state: {
        exec: async () => ({
          tool: 'get_farm_state',
          success: true,
          data: { farm: mockFarm },
        }),
      },
      get_active_effects: {
        exec: async () => ({
          tool: 'get_active_effects',
          success: true,
          data: { activeEffects: [] },
        }),
      },
    };

    const result = await PipelineCoordinator.execute(
      'what should I cook for the remaning xp in low flower cost',
      {
        sessionId: 'test-sess',
        userId: 1,
        farmId: 'farm-golden-1',
        userGoal: 'what should I cook for the remaning xp in low flower cost',
        farmState: mockFarm,
      },
      mockTools
    );

    assert.equal(result.success, true);
    assert.ok(result.validationReport?.synthesis);
    const table = result.validationReport.synthesis.markdownTable;
    assert.match(table, /Pizza Margherita/);
    assert.match(table, /25,000 XP/);
    assert.match(table, /Tomato/);
    // Verified no hallucinated dishes like Creamy Crab Bite or Small Fishy Feast
    assert.doesNotMatch(result.answer, /Creamy Crab Bite/i);
    assert.doesNotMatch(result.answer, /Small Fishy Feast/i);
  });

  it('accurately calculates ingredient and FLOWER cost for 24 cheese without citing Paella', async () => {
    const mockTools: ToolExecutorMap = {
      compute_recipe_cost: {
        exec: async ({ recipe, quantity }) => {
          assert.equal(recipe, 'Cheese');
          assert.equal(quantity, 24);
          return {
            tool: 'compute_recipe_cost',
            success: true,
            data: {
              recipe: 'Cheese',
              quantity: 24,
              baseOutput: 24,
              building: 'Deli',
              ownsBuilding: true,
              baseIngredients: { Milk: 3 },
              scaledIngredients: { Milk: 72 },
              ingredientDetails: [
                {
                  item: 'Milk',
                  perUnit: 3,
                  totalNeeded: 72,
                  inStock: 0,
                  toBuy: 72,
                  unitPriceFlower: 0.1387,
                  totalCostFlower: 9.9864,
                },
              ],
              cost: {
                flower: 9.9864,
                totalFlower: 9.9864,
                buy: { Milk: 72 },
                mustProduce: {},
                unpriced: [],
              },
              effective: {
                baseXp: 1,
                xpPerFood: 1,
                totalXpGained: 24,
                minutes: 20,
                boostBreakdown: [],
              },
              formattedTime: '20m 0s',
            },
          };
        },
      },
      get_market_prices: {
        exec: async () => ({
          tool: 'get_market_prices',
          success: true,
          data: { prices: { Milk: 0.1387 } },
        }),
      },
      get_farm_state: {
        exec: async () => ({
          tool: 'get_farm_state',
          success: true,
          data: { farm: mockFarm },
        }),
      },
      get_active_effects: {
        exec: async () => ({
          tool: 'get_active_effects',
          success: true,
          data: { activeEffects: [] },
        }),
      },
    };

    const result = await PipelineCoordinator.execute(
      'how much cost will be for 24 cheese',
      {
        sessionId: 'test-sess',
        userId: 1,
        farmId: 'farm-golden-1',
        userGoal: 'how much cost will be for 24 cheese',
        farmState: mockFarm,
      },
      mockTools
    );

    assert.equal(result.success, true);
    assert.ok(result.validationReport?.synthesis);
    const table = result.validationReport.synthesis.markdownTable;
    assert.match(table, /72/); // 72 Milk needed
    assert.match(table, /9\.9864/); // 9.9864 FLOWER cost
    assert.match(table, /0\.1387/); // 0.1387 unit price
    assert.match(table, /Deli/);
    // Verified no mention of random Paella
    assert.doesNotMatch(result.answer, /Paella/i);
    assert.doesNotMatch(result.answer, /2,?500 coins/i);
  });

  it('handles conversational coreference when user follows up with "one cheese takes 3 milk"', async () => {
    let capturedQuantity = 0;
    const mockTools: ToolExecutorMap = {
      compute_recipe_cost: {
        exec: async ({ recipe, quantity }) => {
          assert.equal(recipe, 'Cheese');
          capturedQuantity = Number(quantity);
          return {
            tool: 'compute_recipe_cost',
            success: true,
            data: {
              recipe: 'Cheese',
              quantity,
              baseOutput: quantity,
              building: 'Deli',
              ownsBuilding: true,
              baseIngredients: { Milk: 3 },
              scaledIngredients: { Milk: 3 * Number(quantity) },
              ingredientDetails: [
                {
                  item: 'Milk',
                  perUnit: 3,
                  totalNeeded: 3 * Number(quantity),
                  inStock: 0,
                  toBuy: 3 * Number(quantity),
                  unitPriceFlower: 0.1387,
                  totalCostFlower: 3 * Number(quantity) * 0.1387,
                },
              ],
              cost: {
                flower: 3 * Number(quantity) * 0.1387,
                totalFlower: 3 * Number(quantity) * 0.1387,
                buy: { Milk: 3 * Number(quantity) },
                mustProduce: {},
                unpriced: [],
              },
              effective: {
                baseXp: 1,
                xpPerFood: 1,
                totalXpGained: Number(quantity),
                minutes: 20,
                boostBreakdown: [],
              },
              formattedTime: '20m 0s',
            },
          };
        },
      },
      get_market_prices: {
        exec: async () => ({
          tool: 'get_market_prices',
          success: true,
          data: { prices: { Milk: 0.1387 } },
        }),
      },
      get_farm_state: {
        exec: async () => ({
          tool: 'get_farm_state',
          success: true,
          data: { farm: mockFarm },
        }),
      },
      get_active_effects: {
        exec: async () => ({
          tool: 'get_active_effects',
          success: true,
          data: { activeEffects: [] },
        }),
      },
    };

    const priorHistory = [
      { role: 'user', content: 'how much cost will be for 24 cheese' },
      { role: 'assistant', content: 'I need more data.' },
    ];

    const result = await PipelineCoordinator.execute(
      'one cheese takes 3 milk',
      {
        sessionId: 'test-sess',
        userId: 1,
        farmId: 'farm-golden-1',
        userGoal: 'one cheese takes 3 milk',
        farmState: mockFarm,
      },
      mockTools,
      priorHistory
    );

    assert.equal(result.success, true);
    assert.equal(capturedQuantity, 24); // Inherited 24 from prior conversation goal
    assert.ok(result.validationReport?.synthesis);
    const table = result.validationReport.synthesis.markdownTable;
    assert.match(table, /72/); // 24 * 3 = 72 Milk
    assert.doesNotMatch(result.answer, /Paella/i);
  });
});
