/**
 * server/tests/deliveries.test.ts
 * Unit test suite for Codex Deliveries, Weekly Chores, and Poppy Mega Bounty Board.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateDeliveries, evaluateCodexTasks } from '../core/economyEngine/deliveries.js';
import { orchestrator } from '../services/ai/Orchestrator.js';
import { AIToolResultSchema } from '../schemas/aiSchema.js';

describe('Codex Deliveries & Tasks Engine', () => {
  const userFarmOrders = [
    {
      createdAt: 1788740171906,
      readyAt: 1788740171906,
      from: 'pharaoh',
      id: '52253b',
      items: { Sand: 10, 'Sand Shovel': 15, Vase: 2 },
      reward: {},
    },
    {
      createdAt: 1788740171906,
      readyAt: 1788740171906,
      from: 'cornwell',
      id: '11481c',
      items: { Artichoke: 120, Feather: 45 },
      reward: {},
    },
    {
      createdAt: 1789062672152,
      id: '53dfb5',
      from: 'victoria',
      items: { Olive: 2, Wheat: 20 },
      readyAt: 1789062672152,
      reward: { coins: 1100, items: {} },
    },
    {
      createdAt: 1789188416948,
      id: '25c33a',
      from: 'corale',
      items: { 'Mahi Mahi': 2 },
      readyAt: 1789188416948,
      reward: { coins: 578, items: {} },
    },
    {
      createdAt: 1789194078635,
      id: '808284',
      from: 'peggy',
      items: { 'Banana Blast': 2 },
      readyAt: 1789194078635,
      reward: { coins: 928, items: {} },
    },
    {
      createdAt: 1789224469467,
      id: '016d9b',
      from: 'tango',
      items: { Banana: 4, Tomato: 30 },
      readyAt: 1789224469467,
      reward: { coins: 544, items: {} },
    },
    {
      createdAt: 1789273869692,
      id: '520aea',
      from: 'betty',
      items: { Wheat: 15, Yam: 75 },
      readyAt: 1789273869692,
      reward: { coins: 549, items: {} },
      completedAt: 1789274676476,
    },
    {
      createdAt: 1789273869748,
      id: '447c2e',
      from: 'grimtooth',
      items: { 'Boiled Eggs': 3 },
      readyAt: 1789273869748,
      reward: { sfl: 0.4 },
    },
    {
      createdAt: 1789273869748,
      id: 'c318c1',
      from: 'grubnuk',
      items: { 'Kale Omelette': 1 },
      readyAt: 1789273869748,
      reward: { sfl: 0.5 },
    },
    {
      createdAt: 1789273869748,
      id: '8d3991',
      from: 'guria',
      items: { 'Purple Daffodil': 1 },
      readyAt: 1789273869748,
      reward: { sfl: 1.1 },
      completedAt: 1789274118900,
    },
  ];

  const userInventory = {
    'Mahi Mahi': 5,
    Vase: 9,
    Sand: 3,
    'Sand Shovel': 0,
    Banana: 25,
    Tomato: 8,
    'Boiled Eggs': 2,
    Egg: 2,
    Wheat: 0.2451,
  };

  const marketPrices = {
    Wheat: 0.035,
    Olive: 0.04,
    'Mahi Mahi': 0.015,
    Banana: 0.005,
    Tomato: 0.003,
    Sand: 0.001,
    'Boiled Eggs': 0.01,
    Egg: 0.01,
  };

  it('evaluateDeliveries correctly identifies Corale as READY TO DELIVER NOW', () => {
    const res = evaluateDeliveries({
      orders: userFarmOrders,
      inventory: userInventory,
      prices: marketPrices,
      isVip: true,
      farmId: '346853928974080',
    });

    assert.equal(res.value.readyNowCount, 1);
    assert.equal(res.value.bestReadyNowDelivery?.npc, 'corale');
    assert.equal(res.value.bestReadyNowDelivery?.rewardCoins, 578);
    assert.equal(res.value.bestReadyNowDelivery?.readyNow, true);
  });

  it('evaluateDeliveries ranks Victoria as top Coin payout and Grimtooth as top SFL', () => {
    const res = evaluateDeliveries({
      orders: userFarmOrders,
      inventory: userInventory,
      prices: marketPrices,
      isVip: true,
      farmId: '346853928974080',
    });

    assert.equal(res.value.bestCoinsDelivery?.npc, 'victoria');
    assert.equal(res.value.bestCoinsDelivery?.rewardCoins, 1100);
    assert.equal(res.value.bestCoinsDelivery?.readyNow, false);

    assert.equal(res.value.bestSflDelivery?.npc, 'grubnuk');
    assert.equal(res.value.bestSflDelivery?.rewardSfl, 0.5);

    // Grimtooth should also be in activeSflDeliveries
    const grimtooth = res.value.activeSflDeliveries.find((d) => d.npc === 'grimtooth');
    assert.ok(grimtooth);
    assert.equal(grimtooth.rewardSfl, 0.4);
    assert.equal(grimtooth.items[0].owned, 2);
    assert.equal(grimtooth.items[0].needed, 3);
  });

  it('evaluateDeliveries assigns 9 Shiny Feathers to Pharaoh under VIP', () => {
    const res = evaluateDeliveries({
      orders: userFarmOrders,
      inventory: userInventory,
      prices: marketPrices,
      isVip: true,
      farmId: '346853928974080',
    });

    assert.equal(res.value.bestFeathersDelivery?.npc, 'pharaoh');
    assert.equal(res.value.bestFeathersDelivery?.rewardFeathers, 9);
    assert.equal(res.value.bestFeathersDelivery?.ascensionPoints, 45);

    const cornwell = res.value.activeFeatherDeliveries.find((d) => d.npc === 'cornwell');
    assert.ok(cornwell);
    assert.equal(cornwell.rewardFeathers, 6);
    assert.equal(cornwell.ascensionPoints, 30);
  });

  it('evaluateDeliveries correctly separates completed orders', () => {
    const res = evaluateDeliveries({
      orders: userFarmOrders,
      inventory: userInventory,
      prices: marketPrices,
      isVip: true,
    });

    assert.equal(res.value.completedOrdersCount, 2); // betty and guria
    assert.ok(res.value.completedDeliveries.some((d) => d.npc === 'betty'));
    assert.ok(res.value.completedDeliveries.some((d) => d.npc === 'guria'));
  });

  it('evaluateCodexTasks accurately computes Pumpkin Pete 199/200 progress', () => {
    const res = evaluateCodexTasks({
      choreBoard: {
        chores: {
          "pumpkin' pete": {
            name: 'Harvest Pumpkins 200 times',
            initialProgress: 518,
            reward: { items: { 'Shiny Feather': 1 } },
          },
        },
      },
      farmActivity: {
        'Pumpkin Harvested': 717,
      },
      isVip: true,
    });

    const peteChore = res.value.weeklyChores.find((c) => c.npc === "pumpkin' pete");
    assert.ok(peteChore);
    assert.equal(peteChore.currentProgress, 199);
    assert.equal(peteChore.targetCount, 200);
    assert.equal(peteChore.remainingCount, 1);
    assert.equal(peteChore.rewardFeathers, 4); // 1 base + 3 VIP
    assert.equal(peteChore.ascensionPoints, 12);
  });

  it('evaluateCodexTasks correctly flags ready-to-claim bounties on Poppy board', () => {
    const res = evaluateCodexTasks({
      bounties: {
        requests: [
          { id: 'b1', name: 'Mahi Mahi', items: { 'Shiny Feather': 1 } },
          { id: 'b2', name: 'Blue Daffodil', items: { 'Shiny Feather': 7 } },
        ],
        completed: [],
      },
      inventory: {
        'Mahi Mahi': 5,
        'Blue Daffodil': 0,
      },
      isVip: true,
    });

    const mahiBounty = res.value.bounties.find((b) => b.name === 'Mahi Mahi');
    assert.ok(mahiBounty);
    assert.equal(mahiBounty.category, 'FISH');
    assert.equal(mahiBounty.canClaimNow, true);

    const daffBounty = res.value.bounties.find((b) => b.name === 'Blue Daffodil');
    assert.ok(daffBounty);
    assert.equal(daffBounty.category, 'FLOWER');
    assert.equal(daffBounty.canClaimNow, false);
  });

  describe('AI Orchestrator: get_deliveries & get_codex_chores_and_bounties Tools', () => {
    const testContext = {
      sessionId: 'test-codex-session',
      userId: 90001,
      farmId: '346853928974080',
      userGoal: 'Which delivery gives the best return?',
    };

    it('get_deliveries tool executes successfully and conforms to AIToolResultSchema', async () => {
      orchestrator.setFarmState('346853928974080', {
        farm: {
          delivery: { orders: userFarmOrders },
          inventory: userInventory,
          vip: { expiresAt: Date.now() + 100000000 },
          balance: '10.00',
          coins: 1000,
        },
      });

      const result = await orchestrator.tools['get_deliveries'].exec({}, testContext);

      assert.equal(result.success, true, result.error?.message);
      assert.equal(result.epistemicTier, 'OBSERVED');
      assert.ok(result.data);
      assert.equal(result.data.readyNowCount, 1);
      assert.equal(result.data.bestReadyNowDelivery?.npc, 'corale');
      assert.equal(result.data.bestCoinsDelivery?.npc, 'victoria');

      const validated = AIToolResultSchema.parse(result);
      assert.ok(validated);
    });

    it('get_deliveries filters by category properly', async () => {
      const coinResult = await orchestrator.tools['get_deliveries'].exec({ category: 'COINS' }, testContext);
      assert.ok(coinResult.data.activeOrders.every((o: any) => o.rewardType === 'COINS'));

      const readyResult = await orchestrator.tools['get_deliveries'].exec({ category: 'READY_NOW' }, testContext);
      assert.equal(readyResult.data.activeOrders.length, 1);
      assert.equal(readyResult.data.activeOrders[0].npc, 'corale');
    });

    it('get_codex_chores_and_bounties tool executes and conforms to AIToolResultSchema', async () => {
      orchestrator.setFarmState('346853928974080', {
        farm: {
          choreBoard: {
            chores: {
              "pumpkin' pete": {
                name: 'Harvest Pumpkins 200 times',
                initialProgress: 518,
                reward: { items: { 'Shiny Feather': 1 } },
              },
            },
          },
          farmActivity: { 'Pumpkin Harvested': 717 },
          bounties: {
            requests: [{ id: 'b1', name: 'Mahi Mahi', items: { 'Shiny Feather': 1 } }],
          },
          inventory: userInventory,
        },
      });

      const result = await orchestrator.tools['get_codex_chores_and_bounties'].exec({}, testContext);

      assert.equal(result.tool, 'get_codex_chores_and_bounties');
      assert.equal(result.success, true);
      assert.equal(result.epistemicTier, 'OBSERVED');
      assert.ok(result.data.weeklyChores.length > 0);
      assert.equal(result.data.weeklyChores[0].currentProgress, 199);

      const validated = AIToolResultSchema.parse(result);
      assert.ok(validated);
    });
  });
});
