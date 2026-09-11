/**
 * server/tests/coreCalculation.test.ts
 * Golden test suite for Phase 1 (Deterministic Calculation Core & Provenance).
 * Verifies pure mathematical reproducibility, dependency expansion, yield projections,
 * cost calculations, and provenance preservation across frozen fixtures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  levelFromXp,
  xpRequiredForLevel,
  calculateLevelProgress,
  calculateFoodXp,
  resolveDependencies,
  calculateMissingResources,
  summarizeActiveProduction,
  calculateCostBreakdown,
  evaluateBuyVsFarm,
  withProvenance,
} from '../core/index.js';

import { loadFixture } from '../fixtures/index.js';
import recipesData from '../data/recipes.json' with { type: 'json' };

describe('Phase 1: Deterministic Calculation Core & Provenance', () => {

  describe('1. XP & Level Progression Primitives', () => {
    it('accurately derives level from cumulative XP', () => {
      assert.equal(levelFromXp(0), 1);
      assert.equal(levelFromXp(1), 1);
      assert.equal(levelFromXp(2), 2);
      assert.equal(levelFromXp(205), 4);
      assert.equal(levelFromXp(10183905), 80);
      assert.equal(levelFromXp(244206000), 200);
      assert.equal(levelFromXp(583230647), 200); // Beyond level 200 caps at 200
    });

    it('returns exact XP required for any target milestone', () => {
      assert.equal(xpRequiredForLevel(1), 0);
      assert.equal(xpRequiredForLevel(50), 985405);
      assert.equal(xpRequiredForLevel(80), 10183905);
      assert.equal(xpRequiredForLevel(100), 24083905);
    });

    it('computes level progress fraction toward milestone', () => {
      const progress = calculateLevelProgress(5000000, 80);
      assert.ok(progress.currentLevel < 80);
      assert.equal(progress.targetLevel, 80);
      assert.ok(progress.remainingXp > 0);
      assert.ok(progress.progressFraction > 0 && progress.progressFraction < 1);
    });
  });

  describe('2. Food XP & Skill Multipliers with Provenance', () => {
    const mockPizza = {
      building: 'Kitchen',
      baseXp: 25000,
      baseCookMinutes: 60,
      ingredients: { Wheat: 10, Tomato: 5 },
    };

    it('applies Double Nom (2x output, 2x ingredients) and wraps in provenance', () => {
      const result = calculateFoodXp({
        recipeName: 'Pizza Margherita',
        recipe: mockPizza,
        skills: { 'Double Nom': 1 },
        farmId: 'farm_123',
        snapshotVersion: 500,
      });

      assert.equal(result.value.output, 2);
      assert.equal(result.value.batchXp, 50000);
      assert.equal(result.value.effectiveIngredients['Wheat'], 20);
      assert.equal(result.value.effectiveIngredients['Tomato'], 10);
      assert.ok(result.value.applied.includes('Double Nom'));

      // Provenance verification
      assert.equal(result.provenance.farmId, 'farm_123');
      assert.equal(result.provenance.snapshotVersion, 500);
      assert.ok(result.provenance.calculationEngineVersion);
    });

    it('stacks VIP (+10%) and Munching Mastery (+5%) deterministically', () => {
      const baseCake = {
        building: 'Bakery',
        baseXp: 1000,
        baseCookMinutes: 30,
        ingredients: { Wheat: 5 },
      };

      const result = calculateFoodXp({
        recipeName: 'Wheat Cake',
        recipe: baseCake,
        isVip: true,
        skills: { 'Munching Mastery': 1 },
      });

      // 1000 * 1.1 (VIP) * 1.05 (Munching) = 1155
      assert.equal(result.value.xpPerFood, 1155);
      assert.ok(result.value.applied.includes('VIP Access'));
      assert.ok(result.value.applied.includes('Munching Mastery'));
    });
  });

  describe('3. Recursive Dependency Expansion', () => {
    const miniRecipes = {
      'Club Sandwich': {
        building: 'Kitchen',
        baseCookMinutes: 45,
        ingredients: { Bread: 2, Carrot: 5 },
      },
      Bread: {
        building: 'Fire Pit',
        baseCookMinutes: 15,
        ingredients: { Wheat: 6 },
      },
    };

    it('recursively resolves multi-tier craft dependencies to base resources', () => {
      const result = resolveDependencies({
        targetItem: 'Club Sandwich',
        quantity: 3,
        recipes: miniRecipes,
        farmId: 'farm_test',
        snapshotVersion: 42,
      });

      // 3 Club Sandwich requires:
      // Carrot: 3 * 5 = 15
      // Bread: 3 * 2 = 6
      // Wheat: 6 * 6 = 36
      assert.equal(result.value.baseResources['Carrot'], 15);
      assert.equal(result.value.baseResources['Wheat'], 36);
      assert.equal(result.value.intermediateSteps.length, 2);
      assert.equal(result.provenance.farmId, 'farm_test');
    });

    it('detects cyclic dependencies and throws an error', () => {
      const cyclic = {
        ItemA: { building: 'Kitchen', ingredients: { ItemB: 1 } },
        ItemB: { building: 'Kitchen', ingredients: { ItemA: 1 } },
      };

      assert.throws(() => {
        resolveDependencies({
          targetItem: 'ItemA',
          recipes: cyclic,
        });
      }, /cycle/i);
    });

    it('accurately calculates missing resources against owned inventory', () => {
      const required = { Wheat: 100, Wood: 50, Stone: 20 };
      const owned = { Wheat: 80, Wood: 100 };

      const shortfall = calculateMissingResources(required, owned);
      assert.equal(shortfall.missing['Wheat'], 20);
      assert.equal(shortfall.missing['Stone'], 20);
      assert.equal(shortfall.missing['Wood'], undefined); // Wood is fully covered
      assert.equal(shortfall.isFullySatisfied, false);
      assert.ok(shortfall.satisfiedPct > 50 && shortfall.satisfiedPct < 100);
    });
  });

  describe('4. Active Production Engine', () => {
    it('summarizes active items, projects yields, and determines completion', () => {
      const now = 2000;
      const activeItems = [
        {
          id: 'plot_1',
          category: 'CROP' as const,
          item: 'Wheat',
          quantity: 25,
          status: 'OBSERVED' as const,
          startedAt: 1000,
          readyAt: 3000,
          expectedOutput: 250,
        },
        {
          id: 'plot_2',
          category: 'CROP' as const,
          item: 'Wheat',
          quantity: 25,
          status: 'OBSERVED' as const,
          startedAt: 500,
          readyAt: 1500, // already completed at now = 2000
          expectedOutput: 250,
        },
      ];

      const summary = summarizeActiveProduction({
        items: activeItems,
        now,
        farmId: 'farm_prod',
      });

      assert.equal(summary.value.activeCount, 1);
      assert.equal(summary.value.completedCount, 1);
      assert.equal(summary.value.byItem['Wheat'].expectedOutput, 500);
      assert.equal(summary.provenance.farmId, 'farm_prod');
    });
  });

  describe('5. Economic Cost Breakdown & Buy vs Farm ROI', () => {
    it('calculates out-of-pocket costs and partitions buy vs mustProduce', () => {
      const required = { Wheat: 100, UntradableOre: 10 };
      const inventory = { Wheat: 20 };
      const prices = { Wheat: 0.05 };
      const itemsMeta = { UntradableOre: { tradable: false } };

      const cost = calculateCostBreakdown({
        requiredResources: required,
        inventory,
        prices,
        itemsMeta,
      });

      // Need 80 Wheat @ 0.05 = 4.0 FLOWER
      assert.equal(cost.value.flower, 4.0);
      assert.equal(cost.value.buy['Wheat'], 80);
      assert.equal(cost.value.mustProduce['UntradableOre'], 10);
    });

    it('evaluates buy vs farm ROI comparison', () => {
      // Market price 0.02, crafting cost 0.05 -> Buy is cheaper
      const eval1 = evaluateBuyVsFarm('Stone', 0.05, 0.02);
      assert.equal(eval1.recommendation, 'BUY_FROM_MARKET');

      // Market price 0.10, crafting cost 0.03 -> Farm in house is cheaper
      const eval2 = evaluateBuyVsFarm('Wheat', 0.03, 0.10);
      assert.equal(eval2.recommendation, 'FARM_IN_HOUSE');
    });
  });

  describe('6. Golden End-to-End Pipeline on Real Observed Fixture', () => {
    it('runs deterministic calculation pipeline end-to-end on farm-high-level-spooky.json', () => {
      const fixture = loadFixture<any>('farm-high-level-spooky');
      const farm = fixture.farm;

      // 1. Current XP & Level
      const currentXp = Number(farm.bumpkin.experience);
      const currentLevel = levelFromXp(currentXp);
      assert.ok(currentLevel >= 150, 'Observed spooky farm is high-level');

      // 2. Recipe calculation using real game recipes.json
      const targetRecipe = 'Pumpkin Soup';
      const recipeDef = (recipesData as any)[targetRecipe];
      assert.ok(recipeDef, 'Recipe must exist in recipes.json');

      const foodXp = calculateFoodXp({
        recipeName: targetRecipe,
        recipe: recipeDef,
        skills: farm.bumpkin.skills,
        isVip: true,
        farmId: 'spooky_10340',
        snapshotVersion: 1001,
      });

      assert.ok(foodXp.value.batchXp > 0);
      assert.equal(foodXp.provenance.farmId, 'spooky_10340');
      assert.equal(foodXp.provenance.snapshotVersion, 1001);

      // 3. Resolve dependencies against massive observed inventory
      const deps = resolveDependencies({
        targetItem: targetRecipe,
        quantity: 10,
        recipes: recipesData as any,
      });

      assert.ok(Object.keys(deps.value.baseResources).length > 0);

      // 4. Check missing resources
      const ownedInventory: Record<string, number> = {};
      for (const [k, v] of Object.entries(farm.inventory)) {
        ownedInventory[k] = Number(v);
      }

      const shortfall = calculateMissingResources(deps.value.baseResources, ownedInventory);
      // High level farm owns tens of thousands of pumpkins
      assert.equal(shortfall.isFullySatisfied, true);

      // 5. Cost calculation
      const cost = calculateCostBreakdown({
        requiredResources: deps.value.baseResources,
        inventory: ownedInventory,
        prices: { Pumpkin: 0.001 },
      });

      // Out of pocket should be 0 because farm already owns sufficient pumpkins
      assert.equal(cost.value.flower, 0);
      assert.ok(cost.value.totalFlower > 0);
    });
  });

});
