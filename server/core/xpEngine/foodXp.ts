/**
 * server/core/xpEngine/foodXp.ts
 * Pure deterministic calculation of food XP and effective recipe stats.
 * Invariant: Every calculation is reproducible from explicit inputs and preserves provenance.
 */

import type { EffectiveRecipe, RecipeDefinition, SkillMap, CalculationResult } from '../../domain/index.js';
import { withProvenance } from '../provenance/index.js';

export const FISH_ITEMS = new Set([
  'Anchovy', 'Tuna', 'Clownfish', 'Blowfish', 'Sea Bass', 'Halibut', 'Porgy',
  'Muskellunge', 'Trout', 'Napoleanfish', 'Tilapia', 'Surgeonfish', 'Walleye',
  'Rock Blackfish', 'Saw Shark', 'Hammerhead shark', 'Angelfish', 'Ray', 'Sunfish',
  'Blue Marlin', 'Olive Flounder', 'Fish Stick', 'Fish Flake', 'Fish Oil', 'Crab Stick', 'Crab',
]);

export interface CalculateFoodXpInput {
  recipeName: string;
  recipe: RecipeDefinition;
  skills?: SkillMap;
  isVip?: boolean;
  buildingOil?: number;
  customModifiers?: Record<string, unknown>;
  farmId?: string;
  snapshotVersion?: number;
  computedAt?: number;
}

/**
 * Compute effective recipe metrics: output, xpPerFood, batchXp, cook minutes, and effective ingredients.
 * Pure function: takes explicit inputs and produces CalculationResult with full provenance.
 */
export function calculateFoodXp(input: CalculateFoodXpInput): CalculationResult<EffectiveRecipe> {
  const { recipeName, recipe } = input;
  const skills = input.skills ?? {};
  const isVip = input.isVip ?? false;
  const buildingOil = input.buildingOil ?? 0;
  const oilActive = buildingOil > 0;
  const customModifiers = input.customModifiers ?? {};

  let output = recipe.baseOutput ?? 1;
  let xpPerFood = recipe.baseXp ?? 0;
  let minutes = recipe.baseCookMinutes ?? 0;
  let ingredientMultiplier = 1;

  const applied: string[] = [];
  const boostBreakdown: EffectiveRecipe['boostBreakdown'] = [];

  const hasSkill = (name: string) => !!skills[name];
  const getRank = (name: string) => (typeof skills[name] === 'number' ? (skills[name] as number) : 1);

  const hasFish = Object.keys(recipe.ingredients ?? {}).some((ing) => FISH_ITEMS.has(ing));
  const hasHoney = !!(recipe.ingredients?.['Honey']);

  // ── 1. XP Multipliers ──────────────────────────────────────────────────
  if (isVip && !recipe.xpIncludesSkills) {
    xpPerFood *= 1.1;
    applied.push('VIP Access');
    boostBreakdown.push({ skill: 'VIP Access', rank: 1, label: '+10% VIP Access' });
  }

  if (hasSkill('Munching Mastery') && !recipe.xpIncludesSkills) {
    const rank = getRank('Munching Mastery');
    const mult = 1 + 0.05 + (rank - 1) * 0.025;
    xpPerFood *= mult;
    applied.push('Munching Mastery');
    boostBreakdown.push({ skill: 'Munching Mastery', rank, label: `+${((mult - 1) * 100).toFixed(1).replace(/\.0$/, '')}% XP` });
  }

  if (recipe.building === 'Deli' && hasSkill('Drive-Through Deli') && !recipe.xpIncludesSkills) {
    const rank = getRank('Drive-Through Deli');
    const mult = 1 + 0.15 + (rank - 1) * 0.05;
    xpPerFood *= mult;
    applied.push('Drive-Through Deli');
    boostBreakdown.push({ skill: 'Drive-Through Deli', rank, label: `+${((mult - 1) * 100).toFixed(0)}% Deli XP` });
  }

  if (recipe.building === 'Smoothie Shack' && hasSkill('Juicy Boost') && !recipe.xpIncludesSkills) {
    const rank = getRank('Juicy Boost');
    const mult = 1 + 0.10 + (rank - 1) * 0.05;
    xpPerFood *= mult;
    applied.push('Juicy Boost');
    boostBreakdown.push({ skill: 'Juicy Boost', rank, label: `+${((mult - 1) * 100).toFixed(0)}% Smoothie XP` });
  }

  if (hasFish && hasSkill('Fishy Feast') && !recipe.xpIncludesSkills) {
    xpPerFood *= 1.2;
    applied.push('Fishy Feast');
    boostBreakdown.push({ skill: 'Fishy Feast', rank: 1, label: '+20% Fish Food XP' });
  }

  if (hasHoney && hasSkill('Buzzworthy Treats') && !recipe.xpIncludesSkills) {
    xpPerFood *= 1.1;
    applied.push('Buzzworthy Treats');
    boostBreakdown.push({ skill: 'Buzzworthy Treats', rank: 1, label: '+10% Honey Food XP' });
  }

  // ── 2. Cook Time Multipliers ───────────────────────────────────────────
  if (['Fire Pit', 'Kitchen'].includes(recipe.building) && hasSkill('Fast Feasts')) {
    const rank = getRank('Fast Feasts');
    const mult = 1 - (0.10 + (rank - 1) * 0.05);
    minutes *= mult;
    applied.push('Fast Feasts');
    boostBreakdown.push({ skill: 'Fast Feasts', rank, label: `-${((1 - mult) * 100).toFixed(0)}% Cook Time` });
  }

  if (recipe.building === 'Bakery' && hasSkill('Frosted Cakes')) {
    const rank = getRank('Frosted Cakes');
    const mult = 1 - (0.10 + (rank - 1) * 0.05);
    minutes *= mult;
    applied.push('Frosted Cakes');
    boostBreakdown.push({ skill: 'Frosted Cakes', rank, label: `-${((1 - mult) * 100).toFixed(0)}% Cook Time` });
  }

  if (recipe.building === 'Fire Pit' && hasSkill('Swift Sizzle') && oilActive) {
    minutes *= 0.6;
    applied.push('Swift Sizzle');
    boostBreakdown.push({ skill: 'Swift Sizzle', rank: 1, label: '-40% Oil Cook Time' });
  }

  if (recipe.building === 'Kitchen' && hasSkill('Turbo Fry') && oilActive) {
    minutes *= 0.5;
    applied.push('Turbo Fry');
    boostBreakdown.push({ skill: 'Turbo Fry', rank: 1, label: '-50% Oil Cook Time' });
  }

  if (recipe.building === 'Deli' && hasSkill('Fry Frenzy') && oilActive) {
    minutes *= 0.4;
    applied.push('Fry Frenzy');
    boostBreakdown.push({ skill: 'Fry Frenzy', rank: 1, label: '-60% Oil Cook Time' });
  }

  // ── 3. Output & Ingredient Multipliers ────────────────────────────────
  if (hasSkill('Double Nom')) {
    output *= 2;
    ingredientMultiplier *= 2;
    applied.push('Double Nom');
    boostBreakdown.push({ skill: 'Double Nom', rank: 1, label: '2x Output & Ingredients' });
  }

  // ── 4. Custom Modifiers fallback ──────────────────────────────────────
  if (customModifiers && typeof customModifiers === 'object') {
    for (const [name, mod] of Object.entries(customModifiers)) {
      if (name.startsWith('_') || !skills[name] || applied.includes(name)) continue;
      const m = mod as Record<string, unknown>;
      const scope = m['appliesTo'];
      const inScope = scope === 'food' || (Array.isArray(scope) && scope.includes(recipe.building));
      if (!inScope) continue;
      if (m['condition'] === 'fishIngredient' && !hasFish) continue;
      if (m['condition'] === 'honeyIngredient' && !hasHoney) continue;
      if (m['condition'] === 'oilActive' && !oilActive) continue;

      let matched = false;
      if (m['effect'] === 'outputMultiplier') { output *= m['value'] as number; matched = true; }
      if (m['effect'] === 'cookTimeMultiplier') { minutes *= m['value'] as number; matched = true; }
      if (m['effect'] === 'xpMultiplier' && !recipe.xpIncludesSkills) { xpPerFood *= m['value'] as number; matched = true; }
      if (m['ingredientCostMultiplier']) { ingredientMultiplier *= m['ingredientCostMultiplier'] as number; matched = true; }
      if (matched && !applied.includes(name)) {
        applied.push(name);
        boostBreakdown.push({ skill: name, rank: getRank(name), label: (m['label'] as string) ?? name });
      }
    }
  }

  const effectiveIngredients: Record<string, number> = {};
  for (const [ing, qty] of Object.entries(recipe.ingredients ?? {})) {
    effectiveIngredients[ing] = qty * ingredientMultiplier;
  }

  const effectiveRecipe: EffectiveRecipe = {
    recipe: recipeName,
    output,
    xpPerFood,
    minutes,
    batchXp: output * xpPerFood,
    ingredientMultiplier,
    effectiveIngredients,
    applied,
    boostBreakdown,
  };

  return withProvenance(effectiveRecipe, {
    farmId: input.farmId,
    snapshotVersion: input.snapshotVersion,
    computedAt: input.computedAt,
  });
}
