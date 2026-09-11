/**
 * server/core/planner/candidateGenerator.ts
 * Pure deterministic candidate strategy generation for goals.
 *
 * ARCHITECTURAL INVARIANT:
 * Discovers possible strategies and actions from recipes, crops, and dependencies
 * BEFORE passing candidates to the hard feasibility gate and utility scorer.
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

  // 1. If active crops or items in production are ready or nearly ready, generate harvest candidate
  if (activeProduction.length > 0) {
    for (const prod of activeProduction) {
      const waitMs = Math.max(0, prod.readyAt - currentTs);
      const waitMinutes = Math.ceil(waitMs / (60 * 1000));
      candidates.push({
        candidateId: `cand-harvest-${prod.item.toLowerCase().replace(/\s+/g, '-')}`,
        title: `Harvest ${prod.item}`,
        estimatedCostFlower: 0,
        estimatedDurationMinutes: waitMinutes,
        estimatedCompletionAt: prod.readyAt,
        items: [prod.item],
        requiresMarketPurchase: false,
        targetActions: [
          {
            actionId: `act-harvest-${prod.item.toLowerCase()}`,
            type: 'HARVEST',
            item: prod.item,
            quantity: 1,
            estimatedCostFlower: 0,
            estimatedReadyAt: prod.readyAt,
            reasoning: `Harvest mature ${prod.item} from field`,
          },
        ],
      });
    }
  }

  // 2. Goal-specific candidate generation
  if (goal.objective === 'REACH_LEVEL' || goal.objective === 'MAXIMIZE_XP') {
    // Generate cooking candidates for recipes matched with farm buildings or general
    for (const [recipeName, recipe] of Object.entries(recipes)) {
      const ingredients = recipe.ingredients ?? {};
      const itemNames = Object.keys(ingredients);
      let totalCostFlower = 0;
      let requiresMarket = false;

      for (const [ingName, requiredQty] of Object.entries(ingredients)) {
        const owned = state.inventory.all[ingName] ?? 0;
        const inProd = activeProduction
          .filter((p: any) => p.item === ingName && (p.status === 'READY' || p.status === 'ACTIVE'))
          .length;
        const available = owned + inProd;

        if (available < requiredQty) {
          requiresMarket = true;
          const missing = requiredQty - available;
          const unitPrice = getItemPrice(ingName, prices) ?? 0.1;
          totalCostFlower += missing * unitPrice;
        }
      }

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

      const actions: PlanAction[] = [];
      if (requiresMarket) {
        actions.push({
          actionId: `act-buy-${recipeName.toLowerCase()}`,
          type: 'BUY',
          item: `${recipeName} ingredients`,
          quantity: 1,
          estimatedCostFlower: totalCostFlower,
          reasoning: `Purchase missing ingredients for ${recipeName}`,
        });
      }
      actions.push({
        actionId: `act-cook-${recipeName.toLowerCase()}`,
        type: 'COOK',
        item: recipeName,
        quantity: recipe.baseOutput ?? 1,
        building: recipe.building,
        estimatedCostFlower: totalCostFlower,
        estimatedXpGain: xpGain,
        estimatedReadyAt: completionAt,
        reasoning: `Cook ${recipeName} to generate ${xpGain} XP`,
      });

      candidates.push({
        candidateId: `cand-cook-${recipeName.toLowerCase().replace(/\s+/g, '-')}`,
        title: `Cook ${recipeName}`,
        estimatedCostFlower: totalCostFlower,
        estimatedDurationMinutes: durationMinutes,
        estimatedCompletionAt: completionAt,
        items: [recipeName, ...itemNames],
        requiresMarketPurchase: requiresMarket,
        targetActions: actions,
      });
    }
  } else if (goal.objective === 'STOCKPILE_RESOURCE' || goal.objective === 'CRAFT_TARGET') {
    const targetItems = goal.target?.items ?? {};
    const inventoryAll = state.inventory?.all ?? (state as any).inventory ?? (state as any).farm?.inventory ?? {};
    for (const [targetItem, requiredQty] of Object.entries(targetItems)) {
      const owned = inventoryAll[targetItem] ?? 0;
      const needed = Math.max(0, requiredQty - owned);

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
            actionId: `act-produce-${targetItem.toLowerCase()}`,
            type: 'PLANT',
            item: targetItem,
            quantity: needed,
            reasoning: `Produce ${needed} ${targetItem} to meet goal target`,
          },
        ],
      });
    }
  }

  return candidates;
}
