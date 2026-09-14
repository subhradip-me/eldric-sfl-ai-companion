/**
 * server/tests/animalEconomics.test.ts
 * Unit tests for deterministic animal feed production economics, setup evaluation,
 * and AI Orchestrator evaluate_buy_vs_farm tool.
 *
 * Invariant: Everything is evaluated strictly according to the live market; zero hardcoded fallback prices.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateAnimalProduceCost,
  getFarmAnimalSetupStatus,
  animalLevelFromXp,
  ANIMAL_BUILDING_TIERS,
  ANIMAL_PURCHASE_RULES,
} from '../core/index.js';
import { farmNormalizer } from '../services/farm/index.js';
import { Orchestrator } from '../services/ai/index.js';
import type { NormalizedFarmState } from '../domain/index.js';

describe('Animal Produce Economics & Feed Production Engine', () => {
  it('calculates Cow Milk economics at Level 0 strictly from market prices (5x Kernel Blend -> 1 Milk)', () => {
    // Market: Kernel Blend is 0.015 FLOWER, Milk is 0.03 FLOWER
    const marketPrices = { 'Kernel Blend': 0.015, Milk: 0.03 };
    const res = calculateAnimalProduceCost({
      produceItem: 'Milk',
      animalLevel: 0,
      prices: marketPrices,
    });

    assert.ok(res);
    assert.equal(res.animalType, 'Cow');
    assert.equal(res.activeTier.feedItem, 'Kernel Blend');
    assert.equal(res.activeTier.feedQuantity, 5);
    assert.equal(res.activeTier.feedUnitPriceFlower, 0.015);
    assert.equal(res.activeTier.produceYield, 1);
    assert.equal(res.activeTier.feedCostFlower, 0.075);
    assert.equal(res.activeTier.unitCostFlower, 0.075); // 5 * 0.015 / 1 = 0.075
    assert.equal(res.secondaryProduce?.item, 'Leather');
    assert.equal(res.secondaryProduce?.quantity, 1);
  });

  it('calculates Cow Milk economics at Level 3 strictly from market prices (5x Hay -> 2 Milk)', () => {
    // Market: Hay is 0.013 FLOWER, Milk is 0.03 FLOWER
    const marketPrices = { Hay: 0.013, Milk: 0.03 };
    const res = calculateAnimalProduceCost({
      produceItem: 'Milk',
      animalLevel: 3,
      prices: marketPrices,
    });

    assert.ok(res);
    assert.equal(res.activeTier.feedItem, 'Hay');
    assert.equal(res.activeTier.feedQuantity, 5);
    assert.equal(res.activeTier.feedUnitPriceFlower, 0.013);
    assert.equal(res.activeTier.produceYield, 2);
    assert.equal(res.activeTier.feedCostFlower, 0.065);
    assert.equal(res.activeTier.unitCostFlower, 0.0325); // 0.065 / 2 = 0.0325
  });

  it('calculates Chicken Egg economics strictly from market prices', () => {
    const marketPrices = { 'Kernel Blend': 0.015, Egg: 0.01 };
    const res = calculateAnimalProduceCost({
      produceItem: 'Egg',
      animalLevel: 0,
      prices: marketPrices,
    });

    assert.ok(res);
    assert.equal(res.animalType, 'Chicken');
    assert.equal(res.activeTier.feedItem, 'Kernel Blend');
    assert.equal(res.activeTier.feedQuantity, 1);
    assert.equal(res.activeTier.unitCostFlower, 0.015);
  });

  it('calculates Sheep Wool economics strictly from market prices', () => {
    const marketPrices = { 'Kernel Blend': 0.015, Wool: 0.024 };
    const res = calculateAnimalProduceCost({
      produceItem: 'Wool',
      animalLevel: 0,
      prices: marketPrices,
    });

    assert.ok(res);
    assert.equal(res.animalType, 'Sheep');
    assert.equal(res.activeTier.feedItem, 'Kernel Blend');
    assert.equal(res.activeTier.feedQuantity, 3);
    assert.equal(res.activeTier.produceYield, 1);
    assert.equal(res.activeTier.unitCostFlower, 0.045); // 3 * 0.015
    assert.equal(res.secondaryProduce?.item, 'Merino Wool');
    assert.equal(res.secondaryProduce?.quantity, 1);
  });

  it('returns null unitCostFlower when feed item is not listed on market (never hardcodes price)', () => {
    // Empty market prices - feed is unpriced
    const emptyMarketPrices = {};
    const res = calculateAnimalProduceCost({
      produceItem: 'Milk',
      animalLevel: 0,
      prices: emptyMarketPrices,
    });

    assert.ok(res);
    assert.equal(res.activeTier.feedUnitPriceFlower, null);
    assert.equal(res.activeTier.feedCostFlower, null);
    assert.equal(res.activeTier.unitCostFlower, null);
  });

  it('applies freeChickenFeed flag to produce 0 feed cost for chickens even without market prices', () => {
    const res = calculateAnimalProduceCost({
      produceItem: 'Egg',
      animalLevel: 0,
      freeChickenFeed: true,
    });

    assert.ok(res);
    assert.equal(res.activeTier.feedCostFlower, 0);
    assert.equal(res.activeTier.unitCostFlower, 0);
  });

  it('applies yield additions and feed cost multipliers dynamically from market prices', () => {
    const marketPrices = { 'Kernel Blend': 0.02 };
    const res = calculateAnimalProduceCost({
      produceItem: 'Milk',
      animalLevel: 0,
      prices: marketPrices,
      feedCostMultiplier: 0.9, // -10% feed cost
      yieldAddition: 0.5,       // +0.5 Milk yield bonus
    });

    assert.ok(res);
    assert.equal(res.activeTier.feedCostFlower, 0.09);  // 5 * 0.02 * 0.9 = 0.09
    assert.equal(res.activeTier.produceYield, 1.5);    // 1 + 0.5 = 1.5
    assert.equal(res.activeTier.unitCostFlower, 0.06); // 0.09 / 1.5 = 0.06
  });

  it('evaluates farm animal setup status when building and animal are missing', () => {
    const mockFarm = {
      player: { level: 62 },
      structures: { buildings: {} },
      animals: { animals: {} },
      inventory: { all: {} },
    } as unknown as NormalizedFarmState;

    const setup = getFarmAnimalSetupStatus('Cow', mockFarm);
    assert.equal(setup.buildingName, 'Barn');
    assert.equal(setup.buildingUnlockLevel, 30);
    assert.equal(setup.playerLevel, 62);
    assert.equal(setup.levelMet, true);
    assert.equal(setup.buildingOwned, false);
    assert.equal(setup.canProduceNow, false);
    assert.equal(setup.initialSetupCost.coins, 300); // 200 Barn + 100 Cow
    assert.equal(setup.initialSetupCost.resources.Wood, 150);
    assert.equal(setup.initialSetupCost.resources.Iron, 10);
    assert.equal(setup.initialSetupCost.resources.Gold, 10);
  });

  it('evaluates farm animal setup status when Barn and Cow are owned', () => {
    const mockFarm = {
      player: { level: 62 },
      structures: {
        buildings: {
          Barn: [{ level: 1, coordinates: { x: 0, y: 0 } }],
        },
      },
      animals: {
        animals: {
          c1: { id: 'c1', type: 'cow', level: 2 },
        },
      },
      inventory: { all: { Cow: 1 } },
    } as unknown as NormalizedFarmState;

    const setup = getFarmAnimalSetupStatus('Cow', mockFarm);
    assert.equal(setup.buildingOwned, true);
    assert.equal(setup.animalCount, 1);
    assert.equal(setup.canProduceNow, true);
    assert.equal(setup.missingRequirements.length, 0);
  });
});

describe('AI Orchestrator: evaluate_buy_vs_farm Tool', () => {
  it('executes evaluate_buy_vs_farm for Milk and returns DERIVED tier with provenance', async () => {
    const orchestrator = new Orchestrator();
    orchestrator.setFarmState('farm-test', {
      player: { id: 1, level: 62, experience: 50000 },
      economy: { flowerApprox: 25.5, coins: 1500 },
      inventory: {
        all: {
          Wood: 200,
          Stone: 100,
          Iron: 20,
          Gold: 15,
          'Kernel Blend': 10,
        },
      },
      structures: { buildings: {} },
      animals: { animals: {} },
    });

    const tool = orchestrator.tools['evaluate_buy_vs_farm'];
    assert.ok(tool);

    const result = await tool.exec(
      { item: 'Milk' },
      { userId: 1, farmId: 'farm-test' }
    );

    assert.equal(result.success, true);
    assert.equal(result.tool, 'evaluate_buy_vs_farm');
    assert.equal(result.epistemicTier, 'DERIVED');
    assert.ok(result.provenance);

    const data = result.data;
    assert.equal(data.item, 'Milk');
    assert.equal(data.category, 'ANIMAL_PRODUCE');
    assert.ok(data.animalEconomics);
    assert.equal(data.animalEconomics.animalType, 'Cow');
    assert.equal(data.animalEconomics.feedOnHand, 10);
    assert.equal(data.animalEconomics.hasEnoughFeedForCycle, true);
    assert.equal(data.setupStatus.canProduceNow, false);
    assert.equal(data.setupStatus.levelMet, true); // Level 62 >= 30
    assert.ok(data.summary.length > 0);
  });
});

describe('Animal Level Calculation from Cumulative XP', () => {
  it('correctly calculates Cow level across progression milestones', () => {
    assert.equal(animalLevelFromXp('Cow', 0), 0);
    assert.equal(animalLevelFromXp('Cow', 180), 1);
    assert.equal(animalLevelFromXp('Cow', 1080), 4);
    assert.equal(animalLevelFromXp('Cow', 1100), 4);
    assert.equal(animalLevelFromXp('Cow', 1880), 5);
    assert.equal(animalLevelFromXp('Cow', 2575), 7);
    assert.equal(animalLevelFromXp('Cow', 3640), 9);
    assert.equal(animalLevelFromXp('Cow', 4320), 10);
    assert.equal(animalLevelFromXp('Cow', 4360), 10);
    assert.equal(animalLevelFromXp('Cow', 8160), 15);
  });

  it('correctly calculates Chicken and Sheep level across progression milestones', () => {
    assert.equal(animalLevelFromXp('Chicken', 0), 0);
    assert.equal(animalLevelFromXp('Chicken', 60), 1);
    assert.equal(animalLevelFromXp('Chicken', 1480), 10);
    assert.equal(animalLevelFromXp('Sheep', 0), 0);
    assert.equal(animalLevelFromXp('Sheep', 120), 1);
    assert.equal(animalLevelFromXp('Sheep', 5440), 15);
  });
});

describe('Real User Farm Snapshot: Cow and Barn State Normalization', () => {
  const userPayload = {
    farm: {
      coins: 998.52,
      balance: '1.9984',
      bumpkin: {
        id: 346853928974080,
        experience: 2495578,
      },
      inventory: {
        'Kernel Blend': '0.45',
        Hay: '1.6',
        NutriBarley: '0.65',
        Milk: '0',
        Wood: '0.1',
        Iron: '6',
      },
      buildings: {
        Barn: [
          {
            id: '404e3fdd',
            createdAt: 1782240572066,
            readyAt: 1782240572066,
            coordinates: { x: 11, y: 1 },
          },
        ],
        'Hen House': [
          {
            id: 'fed469c1',
            createdAt: 1782240924176,
            readyAt: 1782240924176,
            coordinates: { x: 11, y: -3 },
          },
        ],
      },
      barn: {
        level: 1,
        animals: {
          '0': { id: '0', type: 'Cow', state: 'idle', experience: 4360 },
          '1': { id: '1', type: 'Cow', state: 'idle', experience: 4325 },
          'b1b818da': { id: 'b1b818da', type: 'Cow', state: 'idle', experience: 3640 },
          '12f4606f': { id: '12f4606f', type: 'Cow', state: 'happy', experience: 1880 },
          '9d1fc1f4': { id: '9d1fc1f4', type: 'Cow', state: 'idle', experience: 2575 },
          '43052c28': { id: '43052c28', type: 'Cow', state: 'idle', experience: 1085 },
          'b257790a': { id: 'b257790a', type: 'Cow', state: 'idle', experience: 1100 },
          '3bb9e573': { id: '3bb9e573', type: 'Cow', state: 'idle', experience: 0 },
          '5280ee5e': { id: '5280ee5e', type: 'Cow', state: 'idle', experience: 0 },
          '9e2d5521': { id: '9e2d5521', type: 'Cow', state: 'idle', experience: 0 },
        },
      },
      henHouse: {
        level: 1,
        animals: {
          'dd8e0afd': { id: 'dd8e0afd', type: 'Chicken', state: 'idle', experience: 1480 },
          '6edd80f0': { id: '6edd80f0', type: 'Chicken', state: 'idle', experience: 1445 },
          '8b9f8d72': { id: '8b9f8d72', type: 'Chicken', state: 'idle', experience: 1490 },
        },
      },
    },
  };

  it('normalizes Barn and Hen House animals with correct counts and derived levels', () => {
    const norm = farmNormalizer.normalize(userPayload).normalizedState;

    assert.ok(norm.structures.buildings.Barn);
    assert.equal(norm.structures.buildings.Barn[0].level, 1);
    assert.ok(norm.structures.buildings['Hen House']);
    assert.equal(norm.structures.buildings['Hen House'][0].level, 1);

    const animals = Object.values(norm.animals.animals);
    const cows = animals.filter((a) => a.type === 'cow');
    const chickens = animals.filter((a) => a.type === 'chicken');

    assert.equal(cows.length, 10);
    assert.equal(chickens.length, 3);

    // Verify derived cow levels from XP
    const cow0 = norm.animals.animals['0'];
    assert.equal(cow0.experience, 4360);
    assert.equal(cow0.level, 10);

    const cowB1 = norm.animals.animals['b1b818da'];
    assert.equal(cowB1.experience, 3640);
    assert.equal(cowB1.level, 9);

    const cow12 = norm.animals.animals['12f4606f'];
    assert.equal(cow12.experience, 1880);
    assert.equal(cow12.level, 5);

    const cowNew = norm.animals.animals['3bb9e573'];
    assert.equal(cowNew.experience, 0);
    assert.equal(cowNew.level, 0);
  });

  it('evaluates setup status as canProduceNow=true for real user farm', () => {
    const norm = farmNormalizer.normalize(userPayload).normalizedState;
    const setup = getFarmAnimalSetupStatus('Cow', norm);

    assert.equal(setup.buildingOwned, true);
    assert.equal(setup.buildingLevel, 1);
    assert.equal(setup.animalCount, 10);
    assert.equal(setup.highestAnimalLevel, 10);
    assert.equal(setup.canProduceNow, true);
    assert.equal(setup.missingRequirements.length, 0);
  });

  it('AI Orchestrator evaluate_buy_vs_farm accurately identifies user ownership of 10 cows in Barn Lv 1', async () => {
    const orchestrator = new Orchestrator();
    const norm = farmNormalizer.normalize(userPayload).normalizedState;
    orchestrator.setFarmState('user-farm', norm);

    const tool = orchestrator.tools['evaluate_buy_vs_farm'];
    const result = await tool.exec({ item: 'Milk' }, { userId: 1, farmId: 'user-farm' });

    assert.equal(result.success, true);
    assert.equal(result.data.setupStatus.canProduceNow, true);
    assert.equal(result.data.setupStatus.buildingOwned, true);
    assert.equal(result.data.setupStatus.buildingLevel, 1);
    assert.equal(result.data.setupStatus.animalCount, 10);
    assert.equal(result.data.setupStatus.highestAnimalLevel, 10);
    assert.match(result.data.summary, /You already own Barn/);
    assert.match(result.data.summary, /10 Cows/);
  });
});

