/**
 * server/core/economyEngine/deliveries.ts
 * Pure deterministic evaluation of Sunflower Land Codex Deliveries,
 * Weekly Chores, Poppy Mega Bounty Board, and Codex Tasks.
 *
 * Invariant: Every calculation is reproducible, preserves provenance,
 * and maintains zero external framework dependencies.
 */

import type {
  CalculationResult,
  MarketPrice,
} from '../../domain/index.js';
import { withProvenance } from '../provenance/index.js';
import { getItemPrice } from './cost.js';

export type DeliveryRewardType = 'COINS' | 'SFL' | 'SHINY_FEATHERS';

export interface EvaluatedOrderItem {
  item: string;
  needed: number;
  owned: number;
  missing: number;
  hasEnough: boolean;
  unitCostFlower: number | null;
  totalCostFlower: number | null;
}

export interface EvaluatedOrder {
  id: string;
  npc: string;
  completed: boolean;
  completedAt: number | null;
  items: EvaluatedOrderItem[];
  readyNow: boolean;
  rewardType: DeliveryRewardType;
  rewardCoins: number;
  rewardSfl: number;
  rewardFeathers: number;
  ascensionPoints: number;
  totalCostFlower: number;
  hasUnpricedIngredients: boolean;
  coinsPerFlowerCost?: number;
  netProfitSfl?: number;
  sflRoiMultiplier?: number;
  feathersPerFlowerCost?: number;
  roiSummary: string;
}

export interface DeliveriesEvaluationResult {
  totalOrders: number;
  activeOrdersCount: number;
  completedOrdersCount: number;
  readyNowCount: number;
  bestCoinsDelivery: EvaluatedOrder | null;
  bestSflDelivery: EvaluatedOrder | null;
  bestFeathersDelivery: EvaluatedOrder | null;
  bestReadyNowDelivery: EvaluatedOrder | null;
  readyNowDeliveries: EvaluatedOrder[];
  activeCoinDeliveries: EvaluatedOrder[];
  activeSflDeliveries: EvaluatedOrder[];
  activeFeatherDeliveries: EvaluatedOrder[];
  activeOrders: EvaluatedOrder[];
  completedOrders: EvaluatedOrder[];
  completedDeliveries: EvaluatedOrder[];
  recommendation: string;
}

export interface EvaluateDeliveriesInput {
  orders: Array<{
    id: string;
    from?: string;
    items?: Record<string, number>;
    reward?: Record<string, unknown>;
    completedAt?: number | null;
  }>;
  inventory: Record<string, number | string>;
  prices?: MarketPrice;
  isVip?: boolean;
  farmId?: string;
  snapshotVersion?: number;
  computedAt?: number;
}

/**
 * Deterministic seasonal feather mapping by NPC tier.
 * Matches in-game Ascension Age Codex delivery rewards.
 */
const SEASONAL_NPC_BASE_FEATHERS: Record<string, number> = {
  pharaoh: 6,
  tywin: 6,
  cornwell: 3,
  bert: 3,
  raven: 3,
  jester: 3,
  finley: 2,
  miranda: 2,
  finn: 2,
  "pumpkin' pete": 2,
  pumpkin_pete: 2,
  timmy: 2,
};

/**
 * Evaluate all delivery orders deterministically against live inventory and market prices.
 */
export function evaluateDeliveries(input: EvaluateDeliveriesInput): CalculationResult<DeliveriesEvaluationResult> {
  const {
    orders = [],
    inventory = {},
    prices = {},
    isVip = false,
    farmId,
    snapshotVersion = 0,
    computedAt = Date.now(),
  } = input;

  const evaluatedList: EvaluatedOrder[] = [];

  for (const rawOrder of orders) {
    const id = String(rawOrder.id ?? '');
    const rawNpc = String(rawOrder.from ?? 'Unknown');
    const npcKey = rawNpc.toLowerCase().trim();
    const completed = Boolean(rawOrder.completedAt && Number(rawOrder.completedAt) > 0);
    const completedAt = rawOrder.completedAt ? Number(rawOrder.completedAt) : null;

    const rawItems: Record<string, number> = rawOrder.items ?? {};
    const itemEntries = Object.entries(rawItems);

    let allReady = itemEntries.length > 0;
    let orderCostFlower = 0;
    let hasUnpriced = false;

    const evaluatedItems: EvaluatedOrderItem[] = itemEntries.map(([itemName, neededVal]) => {
      const needed = Number(neededVal);
      const owned = Number(inventory[itemName] ?? 0);
      const missing = Math.max(0, needed - owned);
      const hasEnough = owned >= needed;
      if (!hasEnough) allReady = false;

      const unitPrice = getItemPrice(itemName, prices);
      let totalItemCost: number | null = null;
      if (unitPrice != null) {
        totalItemCost = Number((needed * unitPrice).toFixed(4));
        orderCostFlower += totalItemCost;
      } else {
        hasUnpriced = true;
      }

      return {
        item: itemName,
        needed,
        owned: Math.round(owned * 1000) / 1000,
        missing: Math.round(missing * 1000) / 1000,
        hasEnough,
        unitCostFlower: unitPrice,
        totalCostFlower: totalItemCost,
      };
    });

    const reward = (rawOrder.reward ?? {}) as Record<string, unknown>;
    const coins = Number(reward.coins ?? 0);
    const sfl = Number(reward.sfl ?? 0);
    const rewardItems = (reward.items ?? {}) as Record<string, number>;

    let feathers = 0;
    let rewardType: DeliveryRewardType = 'COINS';

    if (sfl > 0) {
      rewardType = 'SFL';
    } else if (coins > 0) {
      rewardType = 'COINS';
    } else {
      rewardType = 'SHINY_FEATHERS';
      const explicitFeathers = rewardItems['Shiny Feather'] ?? rewardItems['shiny_feather'];
      if (explicitFeathers != null && Number(explicitFeathers) > 0) {
        feathers = Number(explicitFeathers) + (isVip ? 3 : 0);
      } else {
        const baseFeathers = SEASONAL_NPC_BASE_FEATHERS[npcKey] ?? 2;
        feathers = baseFeathers + (isVip ? 3 : 0);
      }
    }

    const ascensionPoints = feathers * 5;
    const roundedCost = Number(orderCostFlower.toFixed(4));

    let coinsPerFlowerCost: number | undefined;
    let netProfitSfl: number | undefined;
    let sflRoiMultiplier: number | undefined;
    let feathersPerFlowerCost: number | undefined;
    let roiSummary = '';

    if (rewardType === 'COINS') {
      coinsPerFlowerCost = roundedCost > 0 ? Math.round(coins / roundedCost) : coins;
      roiSummary = `${coins.toLocaleString()} Coins for ~${roundedCost.toFixed(3)} FLOWER ingredient cost`;
    } else if (rewardType === 'SFL') {
      netProfitSfl = Number((sfl - roundedCost).toFixed(4));
      sflRoiMultiplier = roundedCost > 0 ? Number((sfl / roundedCost).toFixed(2)) : undefined;
      roiSummary = `${sfl} SFL for ~${roundedCost.toFixed(3)} FLOWER cost (net profit: ${netProfitSfl >= 0 ? '+' : ''}${netProfitSfl.toFixed(3)} SFL)`;
    } else {
      feathersPerFlowerCost = roundedCost > 0 ? Number((feathers / roundedCost).toFixed(2)) : feathers;
      roiSummary = `${feathers} Shiny Feathers (+${ascensionPoints} Ascension Age pts) for ~${roundedCost.toFixed(3)} FLOWER cost`;
    }

    evaluatedList.push({
      id,
      npc: rawNpc,
      completed,
      completedAt,
      items: evaluatedItems,
      readyNow: !completed && allReady,
      rewardType,
      rewardCoins: coins,
      rewardSfl: sfl,
      rewardFeathers: feathers,
      ascensionPoints,
      totalCostFlower: roundedCost,
      hasUnpricedIngredients: hasUnpriced,
      coinsPerFlowerCost,
      netProfitSfl,
      sflRoiMultiplier,
      feathersPerFlowerCost,
      roiSummary,
    });
  }

  const activeOrders = evaluatedList.filter((o) => !o.completed);
  const completedOrders = evaluatedList.filter((o) => o.completed);

  const activeCoinDeliveries = activeOrders
    .filter((o) => o.rewardType === 'COINS')
    .sort((a, b) => b.rewardCoins - a.rewardCoins);

  const activeSflDeliveries = activeOrders
    .filter((o) => o.rewardType === 'SFL')
    .sort((a, b) => (b.netProfitSfl ?? b.rewardSfl) - (a.netProfitSfl ?? a.rewardSfl));

  const activeFeatherDeliveries = activeOrders
    .filter((o) => o.rewardType === 'SHINY_FEATHERS')
    .sort((a, b) => b.rewardFeathers - a.rewardFeathers);

  const readyNowDeliveries = activeOrders.filter((o) => o.readyNow);

  // Best candidates
  const bestCoinsDelivery = activeCoinDeliveries[0] ?? null;
  const bestSflDelivery = activeSflDeliveries[0] ?? null;
  const bestFeathersDelivery = activeFeatherDeliveries[0] ?? null;
  const bestReadyNowDelivery = readyNowDeliveries.sort((a, b) => {
    // If coins, compare coins; if feathers, compare feathers
    if (a.rewardType === 'COINS' && b.rewardType === 'COINS') return b.rewardCoins - a.rewardCoins;
    if (a.rewardType === 'SFL' && b.rewardType === 'SFL') return b.rewardSfl - a.rewardSfl;
    return b.rewardFeathers - a.rewardFeathers;
  })[0] ?? null;

  // Build recommendation text
  const parts: string[] = [];
  if (bestReadyNowDelivery) {
    parts.push(
      `Ready to Deliver Now: ${bestReadyNowDelivery.npc} (${bestReadyNowDelivery.items.map((i) => `${i.needed} ${i.item}`).join(', ')} for ${
        bestReadyNowDelivery.rewardType === 'COINS'
          ? `${bestReadyNowDelivery.rewardCoins.toLocaleString()} Coins`
          : bestReadyNowDelivery.rewardType === 'SFL'
          ? `${bestReadyNowDelivery.rewardSfl} SFL`
          : `${bestReadyNowDelivery.rewardFeathers} Shiny Feathers`
      }) — you own all items, 0 extra investment needed!`
    );
  }
  if (bestCoinsDelivery && bestCoinsDelivery.id !== bestReadyNowDelivery?.id) {
    parts.push(`Top Coins: ${bestCoinsDelivery.npc} (${bestCoinsDelivery.rewardCoins.toLocaleString()} Coins)`);
  }
  if (bestSflDelivery) {
    parts.push(`Top SFL: ${bestSflDelivery.npc} (${bestSflDelivery.rewardSfl} SFL, net profit ~${bestSflDelivery.netProfitSfl ?? bestSflDelivery.rewardSfl} SFL)`);
  }
  if (bestFeathersDelivery) {
    parts.push(`Top Feathers: ${bestFeathersDelivery.npc} (${bestFeathersDelivery.rewardFeathers} Shiny Feathers / +${bestFeathersDelivery.ascensionPoints} Ascension Age pts)`);
  }

  const recommendation = parts.join(' | ');

  const result: DeliveriesEvaluationResult = {
    totalOrders: evaluatedList.length,
    activeOrdersCount: activeOrders.length,
    completedOrdersCount: completedOrders.length,
    readyNowCount: readyNowDeliveries.length,
    bestCoinsDelivery,
    bestSflDelivery,
    bestFeathersDelivery,
    bestReadyNowDelivery,
    readyNowDeliveries,
    activeCoinDeliveries,
    activeSflDeliveries,
    activeFeatherDeliveries,
    activeOrders,
    completedOrders,
    completedDeliveries: completedOrders,
    recommendation,
  };

  return withProvenance(result, {
    farmId,
    snapshotVersion,
    calculationEngineVersion: '2.0.0',
    gameDataVersion: '2026.09.13',
    computedAt,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Codex Weekly Chores & Poppy Mega Bounty Board
// ─────────────────────────────────────────────────────────────────────────────

export interface EvaluatedChore {
  npc: string;
  name: string;
  targetCount: number;
  currentProgress: number;
  isCompleted: boolean;
  rewardFeathers: number;
  ascensionPoints: number;
  progressPercent: number;
  remainingCount: number;
}

export interface EvaluatedBounty {
  id: string;
  name: string;
  category: 'FLOWER' | 'FISH' | 'CRUSTACEAN' | 'ANIMAL' | 'ARTEFACT' | 'GIANT_CROP' | 'OTHER';
  rewardFeathers: number;
  rewardCoins: number;
  ownedInInventory: number;
  canClaimNow: boolean;
  isCompleted: boolean;
  levelRequired?: number;
}

export interface CodexTasksResult {
  weeklyChores: EvaluatedChore[];
  bounties: EvaluatedBounty[];
  dailyChores: Array<{ description: string; activity: string; requirement: number }>;
  summary: {
    readyToClaimBountiesCount: number;
    almostCompletedChoresCount: number;
    completedBountiesCount: number;
  };
  recommendation: string;
}

export interface EvaluateCodexTasksInput {
  choreBoard?: Record<string, any>;
  bounties?: { requests?: any[]; completed?: any[] };
  dailyChores?: { chores?: Record<string, any> };
  farmActivity?: Record<string, number>;
  inventory?: Record<string, number | string>;
  isVip?: boolean;
  farmId?: string;
  snapshotVersion?: number;
  computedAt?: number;
}

/**
 * Activity mapper from chore name to farmActivity counter.
 */
function extractActivityProgress(choreName: string, farmActivity: Record<string, number> = {}, initialProgress = 0): { current: number; target: number } {
  const match = choreName.match(/(?:Harvest|Mine|Fish|Cook|Collect|Pick|Eat|Drink|Craft|Spend|Grow|Dig)\s+(.+?)\s+(\d+)\s+times/i)
    || choreName.match(/(?:Eat|Drink|Spend)\s+([\d,]+)\s+(.+)/i)
    || choreName.match(/(?:Mine|Collect|Craft|Cook|Harvest)\s+(\d+)\s+(.+)/i);

  let target = 1;
  let activityKey = '';

  const lower = choreName.toLowerCase();
  if (lower.includes('harvest pumpkins')) {
    activityKey = 'Pumpkin Harvested';
    target = 200;
  } else if (lower.includes('grow purple cosmos')) {
    activityKey = 'Purple Cosmos Harvested';
    target = 5;
  } else if (lower.includes('harvest broccoli')) {
    activityKey = 'Broccoli Harvested';
    target = 150;
  } else if (lower.includes('harvest potatoes')) {
    activityKey = 'Potato Harvested';
    target = 175;
  } else if (lower.includes('fish 80 times') || lower.includes('fish 70 times')) {
    activityKey = 'Rod Casted';
    target = lower.includes('80') ? 80 : 70;
  } else if (lower.includes('pick bananas')) {
    activityKey = 'Banana Harvested';
    target = 125;
  } else if (lower.includes('collect eggs')) {
    activityKey = 'Egg Collected';
    target = 100;
  } else if (lower.includes('craft 100 fishing rods')) {
    activityKey = 'Rod Crafted';
    target = 100;
  } else if (lower.includes('mine stones 100 times')) {
    activityKey = 'Stone Mined';
    target = 100;
  } else if (lower.includes('mine stones 200 times')) {
    activityKey = 'Stone Mined';
    target = 200;
  } else if (lower.includes('dig 200 times')) {
    activityKey = 'Treasure Dug';
    target = 200;
  } else if (lower.includes('spend 80,808 coins')) {
    activityKey = 'Coins Spent';
    target = 80808;
  } else if (lower.includes('grow white lotus')) {
    activityKey = 'White Lotus Harvested';
    target = 4;
  } else if (lower.includes('collect milk')) {
    activityKey = 'Milk Collected';
    target = 75;
  } else if (lower.includes('pizza margherita')) {
    activityKey = 'Pizza Margherita Cooked';
    target = 12;
  }

  const actCount = farmActivity[activityKey] ?? 0;
  const current = Math.max(0, actCount - initialProgress);

  return { current, target };
}

/**
 * Classify a bounty item into its Codex category.
 */
function categorizeBounty(name: string): EvaluatedBounty['category'] {
  const lower = name.toLowerCase();
  if (['daffodil', 'cosmos', 'balloon flower', 'carnation', 'clover', 'pansy', 'lotus', 'edelweiss', 'lavender', 'gladiolus'].some((f) => lower.includes(f))) {
    return 'FLOWER';
  }
  if (['mahi mahi', 'napoleanfish', 'moray eel', 'butterflyfish', 'sea horse', 'tuna', 'porgy', 'halibut', 'tilapia', 'surgeonfish', 'walleye', 'blackfish', 'saw shark', 'angelfish', 'ray', 'sunfish', 'flounder'].some((f) => lower.includes(f))) {
    return 'FISH';
  }
  if (['crab', 'grapes', 'isopod', 'barnacle'].some((c) => lower.includes(c))) {
    return 'CRUSTACEAN';
  }
  if (['chicken', 'cow', 'sheep'].some((a) => lower === a)) {
    return 'ANIMAL';
  }
  if (['obsidian', 'doll'].some((a) => lower.includes(a))) {
    return 'ARTEFACT';
  }
  if (['giant', 'adirondack', 'warty'].some((g) => lower.includes(g))) {
    return 'GIANT_CROP';
  }
  return 'OTHER';
}

/**
 * Evaluate Codex Weekly Chores and Poppy Mega Bounty Board.
 */
export function evaluateCodexTasks(input: EvaluateCodexTasksInput): CalculationResult<CodexTasksResult> {
  const {
    choreBoard = {},
    bounties = {},
    dailyChores = {},
    farmActivity = {},
    inventory = {},
    isVip = false,
    farmId,
    snapshotVersion = 0,
    computedAt = Date.now(),
  } = input;

  // 1. Weekly Chores (Codex Tab 21)
  const rawChoresMap: Record<string, any> = choreBoard.chores ?? choreBoard ?? {};
  const evaluatedChores: EvaluatedChore[] = Object.entries(rawChoresMap).map(([npc, chore]) => {
    const choreName = String(chore.name ?? '');
    const initialProgress = Number(chore.initialProgress ?? 0);
    const { current, target } = extractActivityProgress(choreName, farmActivity, initialProgress);

    const baseReward = Number(chore.reward?.items?.['Shiny Feather'] ?? 1);
    const rewardFeathers = baseReward + (isVip ? 3 : 0);
    const ascensionPoints = rewardFeathers * 3;
    const isCompleted = current >= target;
    const progressPercent = Math.min(100, Math.round((current / Math.max(1, target)) * 100));
    const remainingCount = Math.max(0, target - current);

    return {
      npc,
      name: choreName,
      targetCount: target,
      currentProgress: current,
      isCompleted,
      rewardFeathers,
      ascensionPoints,
      progressPercent,
      remainingCount,
    };
  });

  // 2. Poppy Mega Bounty Board (Codex Tab 33)
  const rawBountyReqs: any[] = bounties.requests ?? [];
  const rawBountyCompleted: any[] = bounties.completed ?? [];
  const completedIds = new Set(rawBountyCompleted.map((c) => String(c.id ?? '')));

  const evaluatedBounties: EvaluatedBounty[] = rawBountyReqs.map((req) => {
    const id = String(req.id ?? '');
    const name = String(req.name ?? '');
    const category = categorizeBounty(name);
    const rewardFeathers = Number(req.items?.['Shiny Feather'] ?? 0);
    const rewardCoins = Number(req.coins ?? 0);
    const owned = Number(inventory[name] ?? 0);
    const isCompleted = completedIds.has(id);
    const canClaimNow = !isCompleted && owned >= 1;

    return {
      id,
      name,
      category,
      rewardFeathers,
      rewardCoins,
      ownedInInventory: owned,
      canClaimNow,
      isCompleted,
      levelRequired: req.level,
    };
  });

  // 3. Daily Bumpkin Chores
  const rawDaily: Record<string, any> = dailyChores.chores ?? {};
  const evaluatedDaily = Object.values(rawDaily).map((c) => ({
    description: String(c.description ?? ''),
    activity: String(c.activity ?? ''),
    requirement: Number(c.requirement ?? 1),
  }));

  const readyToClaimBounties = evaluatedBounties.filter((b) => b.canClaimNow);
  const almostCompletedChores = evaluatedChores.filter((c) => !c.isCompleted && c.remainingCount <= 10);

  const recommendationParts: string[] = [];
  if (almostCompletedChores.length > 0) {
    recommendationParts.push(
      `Almost Completed Chores: ${almostCompletedChores.map((c) => `${c.npc} (${c.remainingCount} left for ${c.rewardFeathers} Shiny Feathers)`).join(', ')}`
    );
  }
  if (readyToClaimBounties.length > 0) {
    recommendationParts.push(
      `Bounties Claimable Now: ${readyToClaimBounties.map((b) => `${b.name} (${b.rewardFeathers > 0 ? `${b.rewardFeathers} Feathers` : `${b.rewardCoins} Coins`})`).join(', ')}`
    );
  }

  const recommendation = recommendationParts.join(' | ') || 'No immediate chore or bounty claims available.';

  const result: CodexTasksResult = {
    weeklyChores: evaluatedChores,
    bounties: evaluatedBounties,
    dailyChores: evaluatedDaily,
    summary: {
      readyToClaimBountiesCount: readyToClaimBounties.length,
      almostCompletedChoresCount: almostCompletedChores.length,
      completedBountiesCount: completedIds.size,
    },
    recommendation,
  };

  return withProvenance(result, {
    farmId,
    snapshotVersion,
    calculationEngineVersion: '2.0.0',
    gameDataVersion: '2026.09.13',
    computedAt,
  });
}
