/**
 * server/core/dependencyResolver/dependencyTree.ts
 * Pure deterministic multi-tier crafting & cooking dependency expansion.
 * Invariant: Every calculation is reproducible from explicit inputs and preserves provenance.
 */

import type { CalculationResult, RecipeDefinition } from '../../domain/index.js';
import { withProvenance } from '../provenance/index.js';

export type RecipesMap = Record<string, RecipeDefinition>;

export interface IntermediateStep {
  item: string;
  building: string;
  count: number;
  cookMinutes: number;
}

export interface DependencyTreeResult {
  targetItem: string;
  targetQuantity: number;
  baseResources: Record<string, number>;
  intermediateSteps: IntermediateStep[];
  totalIntermediateMinutes: number;
  missingDefinitions: string[];
}

export interface ResolveDependenciesInput {
  targetItem: string;
  quantity?: number;
  recipes: RecipesMap;
  farmId?: string;
  snapshotVersion?: number;
  computedAt?: number;
}

/**
 * Recursively resolve an item or recipe into its fundamental base resources.
 * Pure deterministic function with cycle detection (max depth 10).
 */
export function resolveDependencies(input: ResolveDependenciesInput): CalculationResult<DependencyTreeResult> {
  const { targetItem, recipes } = input;
  const quantity = input.quantity ?? 1;

  const baseResources: Record<string, number> = {};
  const intermediateSteps: IntermediateStep[] = [];
  const missingDefinitions: string[] = [];
  let totalIntermediateMinutes = 0;

  function recurse(itemName: string, reqQty: number, depth: number) {
    if (depth > 10) {
      throw new Error(`Dependency cycle detected while resolving: ${itemName}`);
    }

    const recipe = recipes[itemName];
    if (!recipe || !recipe.ingredients || Object.keys(recipe.ingredients).length === 0) {
      // Leaf raw resource
      baseResources[itemName] = (baseResources[itemName] ?? 0) + reqQty;
      return;
    }

    const outputPerCraft = recipe.baseOutput ?? 1;
    const craftsNeeded = reqQty / outputPerCraft;
    const stepMinutes = craftsNeeded * (recipe.baseCookMinutes ?? 0);

    intermediateSteps.push({
      item: itemName,
      building: recipe.building,
      count: craftsNeeded,
      cookMinutes: stepMinutes,
    });
    totalIntermediateMinutes += stepMinutes;

    for (const [subIngredient, baseQty] of Object.entries(recipe.ingredients)) {
      const subRequiredQty = baseQty * craftsNeeded;
      recurse(subIngredient, subRequiredQty, depth + 1);
    }
  }

  recurse(targetItem, quantity, 0);

  const result: DependencyTreeResult = {
    targetItem,
    targetQuantity: quantity,
    baseResources,
    intermediateSteps,
    totalIntermediateMinutes,
    missingDefinitions,
  };

  return withProvenance(result, {
    farmId: input.farmId,
    snapshotVersion: input.snapshotVersion,
    computedAt: input.computedAt,
  });
}

export interface MissingResourcesSummary {
  required: Record<string, number>;
  owned: Record<string, number>;
  missing: Record<string, number>;
  satisfiedPct: number;
  isFullySatisfied: boolean;
}

/**
 * Compare required resource quantities against owned inventory.
 * Pure function: calculates missing shortfall and satisfaction percentage.
 */
export function calculateMissingResources(
  required: Record<string, number>,
  owned: Record<string, number> = {}
): MissingResourcesSummary {
  const missing: Record<string, number> = {};
  let totalRequiredItems = 0;
  let totalSatisfiedItems = 0;

  for (const [item, reqQty] of Object.entries(required)) {
    if (reqQty <= 0) continue;
    totalRequiredItems += reqQty;
    const currentStock = owned[item] ?? 0;
    const covered = Math.min(currentStock, reqQty);
    totalSatisfiedItems += covered;

    const shortfall = reqQty - currentStock;
    if (shortfall > 0) {
      missing[item] = shortfall;
    }
  }

  const satisfiedPct = totalRequiredItems > 0
    ? (totalSatisfiedItems / totalRequiredItems) * 100
    : 100;

  return {
    required,
    owned,
    missing,
    satisfiedPct,
    isFullySatisfied: Object.keys(missing).length === 0,
  };
}
