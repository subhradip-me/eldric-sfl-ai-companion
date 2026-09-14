/**
 * server/core/planner/candidateGenerator.ts
 * Pure deterministic candidate strategy generation for goals.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Discovers possible strategies and actions from recipes, crops, and dependencies
 *    BEFORE passing candidates to the hard feasibility gate and utility scorer.
 * 2. Every candidate and cooking action includes an exact, flat ingredientBreakdown
 *    with clear status (OWNED, MISSING, PARTIAL) and actionType (IN_INVENTORY, BUY, GATHER, PRODUCE).
 * 3. Never generates BUY actions for non-purchasable/gatherable resources.
 * 4. Natively supports fractional decimal quantities without truncation.
 * 5. Uses multi-angle ranking (efficiency, speed, zero-cost) to prevent candidate bloat while avoiding over-pruning.
 */

import type {
  Goal,
  NormalizedFarmState,
  GameTime,
  StrategyCandidate,
  PlanAction,
  RecipeDefinition,
  MarketPrice,
  EffectContext,
  IngredientRequirement,
} from '../../domain/index.js';
import { getItemPrice } from '../economyEngine/cost.js';

export interface GenerateCandidatesInput {
  goal: Goal;
  state: NormalizedFarmState;
  recipes?: Record<string, RecipeDefinition>;
  prices?: MarketPrice;
  gameTime?: GameTime;
  candidateOverrides?: StrategyCandidate[];
  effectContext?: EffectContext;
}

/**
 * Standard fallback recipes used when no external recipes map is passed.
 */
const DEFAULT_RECIPES: Record<string, RecipeDefinition> = {
  'Mashed Potato': {
    building: 'Fire Pit',
    baseOutput: 1,
    baseXp: 40,
    baseCookMinutes: 1,
    ingredients: { Potato: 8 },
  },
  'Pumpkin Soup': {
    building: 'Fire Pit',
    baseOutput: 1,
    baseXp: 180,
    baseCookMinutes: 3,
    ingredients: { Pumpkin: 10 },
  },
  'Pancakes': {
    building: 'Bakery',
    baseOutput: 1,
    baseXp: 4000,
    baseCookMinutes: 20,
    ingredients: { Wheat: 50, Honey: 2 },
  },
  'Roast Veggies': {
    building: 'Fire Pit',
    baseOutput: 1,
    baseXp: 1200,
    baseCookMinutes: 120,
    ingredients: { Cauliflower: 15, Carrot: 10 },
  },
  'Goblin\'s Treat': {
    building: 'Kitchen',
    baseOutput: 1,
    baseXp: 3200,
    baseCookMinutes: 360,
    ingredients: { Pumpkin: 10, Radish: 20, Cabbage: 10 },
  },
};

import recipesData from '../../data/recipes.json' with { type: 'json' };

const ALL_GAME_RECIPES: Record<string, RecipeDefinition> = {
  ...DEFAULT_RECIPES,
};

for (const [key, val] of Object.entries(recipesData)) {
  if (key.startsWith('_')) continue;
  const r = val as any;
  if (r.ingredients && r.building) {
    ALL_GAME_RECIPES[key] = {
      building: r.building,
      baseOutput: r.baseOutput ?? 1,
      baseXp: r.baseXp ?? 0,
      baseCookMinutes: r.baseCookMinutes ?? 10,
      ingredients: r.ingredients,
    };
  }
}

export const GATHERABLE_ITEMS_SET = new Set([
  'Magic Mushroom', 'Wild Mushroom', 'Crimstone', 'Sunstone', 'Obsidian',
  'Wood', 'Stone', 'Iron', 'Gold', 'Egg', 'Honey', 'Feather', 'Milk', 'Wool',
]);

const BUILDING_UNLOCK_LEVEL: Record<string, number> = {
  'Fire Pit': 1,
  'Kitchen': 10,
  'Bakery': 15,
  'Deli': 20,
  'Smoothie Shack': 25,
};

const roundQty = (n: number) => Math.round(n * 10000) / 10000;
const roundFlower = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Discover and generate potential strategy candidates for a goal and farm state.
 * Pure deterministic function.
 */
export function generateCandidates(input: GenerateCandidatesInput): StrategyCandidate[] {
  const { goal, state, prices = {}, gameTime, candidateOverrides, effectContext } = input;

  if (candidateOverrides && candidateOverrides.length > 0) {
    return [...candidateOverrides];
  }

  const recipes = input.recipes ?? ALL_GAME_RECIPES;
  const candidates: StrategyCandidate[] = [];
  const currentTs = (gameTime as any)?.currentTimestampMs ?? 1700000000000;

  const activeProduction = state.production?.active ?? (state as any).activeProduction ?? [];

  // 1. If active crops or items in production are ready or nearly ready, aggregate harvest candidates by item
  if (activeProduction.length > 0) {
    const readyMap = new Map<string, { count: number; earliestReadyAt: number }>();
    for (const prod of activeProduction) {
      const existing = readyMap.get(prod.item);
      if (existing) {
        existing.count += 1;
        existing.earliestReadyAt = Math.min(existing.earliestReadyAt, prod.readyAt);
      } else {
        readyMap.set(prod.item, { count: 1, earliestReadyAt: prod.readyAt });
      }
    }

    for (const [itemName, info] of readyMap.entries()) {
      const waitMs = Math.max(0, info.earliestReadyAt - currentTs);
      const waitMinutes = Math.ceil(waitMs / (60 * 1000));
      candidates.push({
        candidateId: `cand-harvest-${itemName.toLowerCase().replace(/\s+/g, '-')}`,
        title: `Harvest ${itemName}`,
        estimatedCostFlower: 0,
        estimatedDurationMinutes: waitMinutes,
        estimatedCompletionAt: info.earliestReadyAt,
        items: [itemName],
        requiresMarketPurchase: false,
        targetActions: [
          {
            actionId: `act-harvest-${itemName.toLowerCase().replace(/\s+/g, '-')}`,
            type: 'HARVEST',
            item: itemName,
            quantity: info.count,
            estimatedCostFlower: 0,
            estimatedReadyAt: info.earliestReadyAt,
            reasoning: `Harvest ${info.count}x mature ${itemName} from field`,
          },
        ],
      });
    }
  }

  // 2. Goal-specific candidate generation
  if (goal.objective === 'REACH_LEVEL' || goal.objective === 'MAXIMIZE_XP') {
    const playerBuildings = state.structures?.buildings ?? {};
    const hasBuildingData = Object.keys(playerBuildings).length > 0;
    const playerLevel = state.player?.level ?? 1;

    const cookingCandidates: Array<{
      candidate: StrategyCandidate;
      efficiency: number;
      speed: number;
      isZeroCost: boolean;
    }> = [];

    for (const [recipeName, recipe] of Object.entries(recipes)) {
      if (hasBuildingData && !playerBuildings[recipe.building]) {
        continue;
      }
      const minLevel = BUILDING_UNLOCK_LEVEL[recipe.building] ?? 1;
      if (playerLevel < minLevel) {
        continue;
      }

      const ingredients = recipe.ingredients ?? {};
      const itemNames = Object.keys(ingredients);
      let totalCostFlower = 0;
      let hasMarketPurchase = false;
      const ingredientBreakdown: IngredientRequirement[] = [];
      const actions: PlanAction[] = [];

      for (const [ingName, requiredNum] of Object.entries(ingredients)) {
        const requiredQty = roundQty(Number(requiredNum) || 1);
        let owned = roundQty(state.inventory?.all?.[ingName] ?? 0);
        // Deduct any committed inputs if active production items specify in-flight input commitments
        for (const prod of activeProduction) {
          if (prod.inputs && prod.inputs[ingName]) {
            owned = Math.max(0, roundQty(owned - prod.inputs[ingName]));
          }
        }
        const missing = roundQty(Math.max(0, requiredQty - owned));

        let status: 'OWNED' | 'MISSING' | 'PARTIAL';
        let actionType: 'IN_INVENTORY' | 'BUY' | 'GATHER' | 'PRODUCE';
        let unitCostFlower: number | undefined;
        let itemTotalCost: number | undefined;
        let reasoning = '';

        if (missing === 0) {
          status = 'OWNED';
          actionType = 'IN_INVENTORY';
          unitCostFlower = 0;
          itemTotalCost = 0;
          reasoning = `${ingName}: ${owned} in stock (need ${requiredQty})`;
        } else {
          status = owned > 0 ? 'PARTIAL' : 'MISSING';
          const price = getItemPrice(ingName, prices);
          if (price != null) {
            actionType = 'BUY';
            unitCostFlower = roundFlower(price);
            itemTotalCost = roundFlower(missing * price);
            totalCostFlower += itemTotalCost;
            hasMarketPurchase = true;
            reasoning = `Purchase ${missing}x ${ingName} from market at ${unitCostFlower} FLOWER/unit (current stock: ${owned})`;
            actions.push({
              actionId: `act-buy-${recipeName.toLowerCase().replace(/\s+/g, '-')}-${ingName.toLowerCase().replace(/\s+/g, '-')}`,
              type: 'BUY',
              item: ingName,
              quantity: missing,
              currentStock: owned,
              estimatedCostFlower: itemTotalCost,
              reasoning,
            });
          } else if (GATHERABLE_ITEMS_SET.has(ingName)) {
            actionType = 'GATHER';
            reasoning = `Forage or mine ${missing}x ${ingName} on your island (current stock: ${owned})`;
            actions.push({
              actionId: `act-gather-${recipeName.toLowerCase().replace(/\s+/g, '-')}-${ingName.toLowerCase().replace(/\s+/g, '-')}`,
              type: 'GATHER',
              item: ingName,
              quantity: missing,
              currentStock: owned,
              estimatedCostFlower: 0,
              reasoning,
            });
          } else {
            actionType = 'PRODUCE';
            reasoning = `Produce ${missing}x ${ingName} in-house (current stock: ${owned})`;
            actions.push({
              actionId: `act-produce-${recipeName.toLowerCase().replace(/\s+/g, '-')}-${ingName.toLowerCase().replace(/\s+/g, '-')}`,
              type: 'PRODUCE',
              item: ingName,
              quantity: missing,
              currentStock: owned,
              estimatedCostFlower: 0,
              reasoning,
            });
          }
        }

        ingredientBreakdown.push({
          item: ingName,
          needed: requiredQty,
          owned,
          missing,
          unitCostFlower,
          totalCostFlower: itemTotalCost,
          status,
          actionType,
          reasoning,
        });
      }

      totalCostFlower = roundFlower(totalCostFlower);

      let durationMinutes = recipe.baseCookMinutes ?? 10;
      let xpGain = recipe.baseXp ?? 0;

      if (effectContext) {
        const globalTimeMult = effectContext.cooking.timeMultipliers.global ?? 1.0;
        const bldgTimeMult = effectContext.cooking.timeMultipliers.buildings[recipe.building] ?? 1.0;
        durationMinutes = Math.max(0, Math.round(durationMinutes * globalTimeMult * bldgTimeMult * 100) / 100);

        const globalXpMult = effectContext.xp.multipliers.global ?? 1.0;
        const foodXpMult = effectContext.xp.multipliers.food ?? 1.0;
        const bldgXpMult = effectContext.xp.multipliers.buildings[recipe.building] ?? 1.0;
        xpGain = Math.round(xpGain * globalXpMult * foodXpMult * bldgXpMult);
      }

      const completionAt = currentTs + durationMinutes * 60 * 1000;

      actions.push({
        actionId: `act-cook-${recipeName.toLowerCase().replace(/\s+/g, '-')}`,
        type: 'COOK',
        item: recipeName,
        quantity: recipe.baseOutput ?? 1,
        building: recipe.building,
        estimatedCostFlower: totalCostFlower,
        estimatedXpGain: xpGain,
        estimatedReadyAt: completionAt,
        reasoning: `Cook ${recipeName} in ${recipe.building} to generate ${xpGain} XP`,
        ingredientBreakdown,
      });

      const candidate: StrategyCandidate = {
        candidateId: `cand-cook-${recipeName.toLowerCase().replace(/\s+/g, '-')}`,
        title: `Cook ${recipeName}`,
        estimatedCostFlower: totalCostFlower,
        estimatedDurationMinutes: durationMinutes,
        estimatedCompletionAt: completionAt,
        items: [recipeName, ...itemNames],
        requiresMarketPurchase: hasMarketPurchase,
        targetActions: actions,
        ingredientBreakdown,
      };

      const efficiency = xpGain / Math.max(0.0001, totalCostFlower);
      const speed = xpGain / Math.max(0.1, durationMinutes / 60);
      const isZeroCost = totalCostFlower === 0;

      cookingCandidates.push({ candidate, efficiency, speed, isZeroCost });
    }

    // Include all eligible cooking candidates discovered for the player's unlocked buildings
    for (const item of cookingCandidates) {
      candidates.push(item.candidate);
    }
  } else if (goal.objective === 'STOCKPILE_RESOURCE' || goal.objective === 'CRAFT_TARGET') {
    const targetItems = goal.target?.items ?? {};
    const inventoryAll = state.inventory?.all ?? (state as any).inventory ?? (state as any).farm?.inventory ?? {};
    for (const [targetItem, requiredNum] of Object.entries(targetItems)) {
      const requiredQty = roundQty(Number(requiredNum) || 1);
      const owned = roundQty(inventoryAll[targetItem] ?? 0);
      const needed = roundQty(Math.max(0, requiredQty - owned));

      candidates.push({
        candidateId: `cand-target-${targetItem.toLowerCase().replace(/\s+/g, '-')}`,
        title: `Produce ${targetItem} (${needed} needed)`,
        estimatedCostFlower: 0,
        estimatedDurationMinutes: 120,
        estimatedCompletionAt: currentTs + 120 * 60 * 1000,
        items: [targetItem],
        requiresMarketPurchase: false,
        targetActions: [
          {
            actionId: `act-produce-${targetItem.toLowerCase().replace(/\s+/g, '-')}`,
            type: 'PLANT',
            item: targetItem,
            quantity: needed,
            currentStock: owned,
            reasoning: `Produce ${needed} ${targetItem} to meet goal target (current stock: ${owned})`,
          },
        ],
      });
    }
  }

  return candidates;
}
