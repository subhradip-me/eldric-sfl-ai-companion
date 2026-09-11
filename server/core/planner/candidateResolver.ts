/**
 * server/core/planner/candidateResolver.ts
 * Deterministic resolution of user action intent into authoritative StrategyCandidate.
 *
 * ARCHITECTURAL INVARIANT:
 * Anti-Hallucination Gate: The LLM identifies user intent (e.g. "cook Pancakes"),
 * but deterministic code resolves true ingredients, duration, and FLOWER cost.
 * The LLM CANNOT manufacture or fabricate candidate parameters.
 */

import type {
  NormalizedFarmState,
  StrategyCandidate,
  RecipeDefinition,
  MarketPrice,
  GameTime,
  PlanAction,
  EffectContext,
} from '../../domain/index.js';
import { getItemPrice } from '../economyEngine/cost.js';

export interface ResolveCandidateIntentParams {
  intent?: 'RECIPE' | 'CROP' | 'TARGET_GOAL' | 'NAMED_STRATEGY';
  target: string; // e.g. 'Pancakes', 'Artichoke', 'Fast Push'
  quantity?: number;
  state: NormalizedFarmState;
  recipes?: Record<string, RecipeDefinition>;
  prices?: MarketPrice;
  gameTime?: GameTime;
  strategyPresets?: Record<string, StrategyCandidate>;
  effectContext?: EffectContext;
}

const DEFAULT_KNOWN_RECIPES: Record<string, RecipeDefinition> = {
  'Pancakes': {
    building: 'Bakery',
    baseOutput: 1,
    baseXp: 4000,
    baseCookMinutes: 20,
    ingredients: { Wheat: 50, Honey: 2 },
  },
  'Pizza Margherita': {
    building: 'Fire Pit',
    baseOutput: 1,
    baseXp: 25000,
    baseCookMinutes: 1200,
    ingredients: { Tomato: 30, Cheese: 5, Wheat: 20 },
  },
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
  'Roast Veggies': {
    building: 'Fire Pit',
    baseOutput: 1,
    baseXp: 1200,
    baseCookMinutes: 120,
    ingredients: { Cauliflower: 15, Carrot: 10 },
  },
};

export const DEFAULT_STRATEGY_PRESETS: Record<string, StrategyCandidate> = {
  'Strategy A: Fast Push': {
    candidateId: 'cand-strategy-fast-push',
    title: 'Strategy A: Fast Push',
    estimatedCostFlower: 55000,
    estimatedDurationMinutes: 17280,
    items: ['Wheat', 'Cabbage', 'Iron'],
    requiresMarketPurchase: true,
  },
  'Strategy B: Balanced Push': {
    candidateId: 'cand-strategy-balanced-push',
    title: 'Strategy B: Balanced Push',
    estimatedCostFlower: 35000,
    estimatedDurationMinutes: 25920,
    items: ['Wheat', 'Cabbage'],
    requiresMarketPurchase: true,
  },
  'Strategy C: Conservative Economy': {
    candidateId: 'cand-strategy-conservative-economy',
    title: 'Strategy C: Conservative Economy',
    estimatedCostFlower: 15000,
    estimatedDurationMinutes: 36000,
    items: ['Sunflower', 'Potato'],
    requiresMarketPurchase: false,
  },
};

/**
 * Deterministically resolve a user intent into an authoritative StrategyCandidate.
 */
export function resolveCandidateIntent(params: ResolveCandidateIntentParams): StrategyCandidate {
  const {
    target,
    quantity = 1,
    state,
    recipes = DEFAULT_KNOWN_RECIPES,
    prices = {},
    gameTime,
    strategyPresets = DEFAULT_STRATEGY_PRESETS,
  } = params;

  const currentTs = (gameTime as any)?.currentTimestampMs ?? 1700000000000;

  // 1. Check named strategy presets first (e.g. from fixture scenarios)
  for (const [presetName, presetCandidate] of Object.entries(strategyPresets)) {
    if (
      presetName.toLowerCase() === target.toLowerCase() ||
      presetName.toLowerCase().includes(target.toLowerCase()) ||
      target.toLowerCase().includes(presetName.toLowerCase())
    ) {
      return presetCandidate;
    }
  }

  // 2. Check cooking recipes
  const matchedRecipeEntry = Object.entries(recipes).find(
    ([name]) => name.toLowerCase() === target.toLowerCase()
  );

  if (matchedRecipeEntry) {
    const [recipeName, recipe] = matchedRecipeEntry;
    const ingredients = recipe.ingredients ?? {};
    let totalCostFlower = 0;
    let requiresMarket = false;

    const inventoryAll = state.inventory?.all ?? (state as any).inventory ?? (state as any).farm?.inventory ?? {};
    const activeProd = state.production?.active ?? (state as any).activeProduction ?? [];

    for (const [ingName, baseQty] of Object.entries(ingredients)) {
      const requiredQty = baseQty * quantity;
      const owned = inventoryAll[ingName] ?? 0;
      const inProd = activeProd
        .filter((p: any) => p.item === ingName && p.status !== 'CANCELLED')
        .reduce((sum: number, p: any) => sum + (p.expectedOutput ?? p.quantity ?? 1), 0);
      const available = owned + inProd;

      if (available < requiredQty) {
        requiresMarket = true;
        const missing = requiredQty - available;
        const unitPrice = getItemPrice(ingName, prices) ?? 0.1;
        totalCostFlower += missing * unitPrice;
      }
    }

    let durationMinutes = (recipe.baseCookMinutes ?? 10) * quantity;
    let xpGain = (recipe.baseXp ?? 0) * quantity;

    if (params.effectContext) {
      const globalTimeMult = params.effectContext.cooking.timeMultipliers.global ?? 1.0;
      const bldgTimeMult = params.effectContext.cooking.timeMultipliers.buildings[recipe.building] ?? 1.0;
      durationMinutes = Math.max(0, Math.round(durationMinutes * globalTimeMult * bldgTimeMult * 100) / 100);

      const globalXpMult = params.effectContext.xp.multipliers.global ?? 1.0;
      const foodXpMult = params.effectContext.xp.multipliers.food ?? 1.0;
      const bldgXpMult = params.effectContext.xp.multipliers.buildings[recipe.building] ?? 1.0;
      xpGain = Math.round(xpGain * globalXpMult * foodXpMult * bldgXpMult);
    }

    const completionAt = currentTs + durationMinutes * 60 * 1000;

    const targetActions: PlanAction[] = [];
    if (requiresMarket) {
      targetActions.push({
        actionId: `act-buy-${recipeName.toLowerCase()}`,
        type: 'BUY',
        item: `${recipeName} ingredients`,
        quantity,
        estimatedCostFlower: totalCostFlower,
        reasoning: `Purchase missing ingredients for ${quantity}x ${recipeName}`,
      });
    }
    targetActions.push({
      actionId: `act-cook-${recipeName.toLowerCase()}`,
      type: 'COOK',
      item: recipeName,
      quantity: (recipe.baseOutput ?? 1) * quantity,
      building: recipe.building,
      estimatedCostFlower: totalCostFlower,
      estimatedXpGain: xpGain,
      estimatedReadyAt: completionAt,
      reasoning: `Cook ${quantity}x ${recipeName}`,
    });

    return {
      candidateId: `cand-cook-${recipeName.toLowerCase().replace(/\s+/g, '-')}`,
      title: `Cook ${recipeName}`,
      estimatedCostFlower: totalCostFlower,
      estimatedDurationMinutes: durationMinutes,
      estimatedCompletionAt: completionAt,
      items: [recipeName, ...Object.keys(ingredients)],
      requiresMarketPurchase: requiresMarket,
      targetActions,
    };
  }

  // 3. Fallback: Generic crop/action candidate with deterministic defaults
  const durationMinutes = 120 * quantity;
  const completionAt = currentTs + durationMinutes * 60 * 1000;

  return {
    candidateId: `cand-action-${target.toLowerCase().replace(/\s+/g, '-')}`,
    title: `Produce ${target}`,
    estimatedCostFlower: 0,
    estimatedDurationMinutes: durationMinutes,
    estimatedCompletionAt: completionAt,
    items: [target],
    requiresMarketPurchase: false,
    targetActions: [
      {
        actionId: `act-produce-${target.toLowerCase()}`,
        type: 'PLANT',
        item: target,
        quantity,
        estimatedCostFlower: 0,
        estimatedReadyAt: completionAt,
        reasoning: `Produce ${quantity}x ${target}`,
      },
    ],
  };
}
