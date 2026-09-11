/**
 * server/domain/recipes.ts
 * Recipe definitions, effective stats, and crafting metrics.
 */

export interface RecipeDefinition {
  building: string;
  baseXp?: number;
  baseCookMinutes?: number;
  baseOutput?: number;
  instantGems?: number;
  ingredients: Record<string, number>;
  verified?: boolean;
  xpIncludesSkills?: boolean;
}

export interface BoostBreakdownEntry {
  skill: string;
  rank: number;
  label: string;
}

export interface EffectiveRecipe {
  recipe: string;
  output: number;
  xpPerFood: number;
  minutes: number;
  batchXp: number;
  ingredientMultiplier: number;
  effectiveIngredients: Record<string, number>;
  applied: string[];
  boostBreakdown: BoostBreakdownEntry[];
}
