import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardService } from '../services/farm/DashboardService.js';
import { farmNormalizer } from '../services/farm/FarmNormalizer.js';

test('DashboardService: builds fallback view model gracefully with minimal inputs', () => {
  const vm = dashboardService.build(null as any, null as any, null as any, 'test-hash');

  assert.equal(vm.overview.kpis.level, 1);
  assert.equal(vm.overview.kpis.xp, 0);
  assert.equal(vm.overview.kpis.targetXp, 24_083_905);
  assert.equal(vm.overview.kpis.pctComplete, 0);
  assert.equal(vm.overview.kpis.flowerApprox, 0);
  assert.equal(vm.overview.kpis.coins, 0);
  assert.equal(vm.cooking.buildings.length, 0);
  assert.equal(vm.crops.activeCrops.length, 0);
  assert.equal(vm.animals.henHouse.chickensCount, 0);
  assert.equal(vm.resources.primary.wood, 0);
  assert.equal(vm.effects.diagnostics.rawHash, 'test-hash');
});

test('DashboardService: deterministic category extraction from canonical & normalized farm state', () => {
  const rawFarm = {
    bumpkin: {
      level: 15,
      experience: 150000,
      equipped: {
        hat: 'Straw Hat',
        shirt: 'Red Farmer Shirt',
      },
      skills: {
        'Green Thumb': 1,
        'Lumberjack': 2,
      },
    },
    inventory: {
      Sunflower: '120',
      'Sunflower Seed': '50',
      Potato: '200',
      Wood: '500',
      Stone: '150',
      Iron: '30',
      Gold: '5',
      Axe: '10',
      Egg: '45',
      Milk: '12',
      'Mashed Potato': '3',
      Wheat: '80',
    },
    buildings: {
      'Fire Pit': [
        {
          id: 'fp-1',
          oil: 5,
          coordinates: { x: 2, y: 3 },
          crafting: [
            { name: 'Mashed Potato', readyAt: Date.now() + 60000, amount: 1 },
          ],
        },
      ],
    },
    crops: {
      '0': {
        name: 'Sunflower',
        plantedAt: Date.now() - 10000,
        amount: 2,
      },
    },
    chickens: {
      'c-1': { fedAt: Date.now() },
      'c-2': { fedAt: Date.now() },
    },
    collectibles: {
      'Fat Chicken': [{ coordinates: { x: 5, y: 5 } }],
      'Scarecrow': [{ coordinates: { x: 1, y: 1 } }],
    },
    coins: 1250.5,
    flower: 4.85,
    vip: {
      bundles: [{ name: '1 Month VIP', boughtAt: Date.now() }],
    },
  };

  const normResult = farmNormalizer.normalize(rawFarm, { farmId: 'test-farm-1', source: 'test' });
  const vm = dashboardService.build(normResult.normalizedState, rawFarm as any, null, normResult.rawHash);

  // 1. Overview
  assert.equal(vm.overview.kpis.level, 15);
  assert.equal(vm.overview.kpis.xp, 150000);
  assert.equal(vm.overview.kpis.coins, 1250.5);
  assert.equal(vm.overview.kpis.flowerApprox, 4.85);
  assert.equal(vm.overview.buildings.length, 1);
  assert.equal(vm.overview.health.totalBuildingsCount, 1);
  assert.equal(vm.overview.buildings[0].name, 'Fire Pit');
  assert.equal(vm.overview.buildings[0].category, 'Cooking');

  // 2. Cooking
  assert.equal(vm.cooking.buildings.length, 1);
  assert.equal(vm.cooking.buildings[0].name, 'Fire Pit');
  assert.equal(vm.cooking.buildings[0].oil, 5);
  assert.equal(vm.cooking.buildings[0].isBusy, true);
  assert.equal(vm.cooking.foodInventory['Mashed Potato'], 3);
  assert.equal(vm.cooking.totalMealsInStock, 3);

  // 3. Crops
  assert.equal(vm.crops.activeCrops.length, 1);
  assert.equal(vm.crops.activeCrops[0].item, 'Sunflower');
  assert.equal(vm.crops.seeds['Sunflower Seed'], 50);
  assert.equal(vm.crops.produce['Sunflower'], 120);

  // 4. Animals
  assert.equal(vm.animals.henHouse.chickensCount, 2);
  assert.equal(vm.animals.henHouse.eggsInStock, 45);
  assert.equal(vm.animals.barn.milkStock, 12);
  assert.equal(vm.animals.feedInventory['Wheat'], 80);

  // 5. Resources
  assert.equal(vm.resources.primary.wood, 500);
  assert.equal(vm.resources.primary.stone, 150);
  assert.equal(vm.resources.primary.iron, 30);
  assert.equal(vm.resources.primary.gold, 5);
  assert.equal(vm.resources.tools['Axe'], 10);

  // 6. Effects
  assert.equal(vm.effects.placedCollectiblesCount, 2);
  assert.equal(vm.effects.skills.length, 2);
  assert.equal(vm.effects.wearables['hat'], 'Straw Hat');
  assert.equal(vm.effects.diagnostics.rawHash, normResult.rawHash);
});
