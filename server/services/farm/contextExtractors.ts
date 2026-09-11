/**
 * server/services/farm/contextExtractors.ts
 * Context Extraction Layer.
 * Bridges NormalizedFarmState to Phase 1 deterministic calculation engines
 * by synthesizing explicit input structures without coupling core engines
 * to the full application state tree.
 */

import type {
  NormalizedFarmState,
  FarmId,
  SnapshotVersion,
  TimestampMs,
  RecipeDefinition,
} from '../../domain/index.js';
import type {
  CalculateFoodXpInput,
  NormalizeActiveProductionInput,
  ResolveDependenciesInput,
  CalculateCostInput,
} from '../../core/index.js';

export interface ContextExtractorOptions {
  farmId?: FarmId;
  snapshotVersion?: SnapshotVersion;
  computedAt?: TimestampMs;
}

/**
 * Extracts explicit CalculateFoodXpInput from NormalizedFarmState.
 */
export function extractFoodXpContext(
  state: NormalizedFarmState,
  recipeName: string,
  recipe: RecipeDefinition,
  options: ContextExtractorOptions & { quantity?: number; oilActive?: boolean } = {}
): CalculateFoodXpInput {
  return {
    recipeName,
    recipe,
    skills: state.player.skills,
    isVip: state.buffs.vip,
    buildingOil: options.oilActive ? 1 : 0,
    farmId: options.farmId,
    snapshotVersion: options.snapshotVersion,
    computedAt: options.computedAt,
  };
}

/**
 * Extracts explicit NormalizeActiveProductionInput from NormalizedFarmState.
 */
export function extractProductionContext(
  state: NormalizedFarmState,
  now: TimestampMs,
  options: ContextExtractorOptions = {}
): NormalizeActiveProductionInput {
  return {
    items: state.production.active,
    now,
    farmId: options.farmId,
    snapshotVersion: options.snapshotVersion,
    computedAt: options.computedAt,
  };
}

/**
 * Extracts explicit ResolveDependenciesInput from NormalizedFarmState.
 */
export function extractDependencyContext(
  targetItem: string,
  recipes: Record<string, RecipeDefinition>,
  options: ContextExtractorOptions & { quantity?: number } = {}
): ResolveDependenciesInput {
  return {
    targetItem,
    quantity: options.quantity ?? 1,
    recipes,
    farmId: options.farmId,
    snapshotVersion: options.snapshotVersion,
    computedAt: options.computedAt,
  };
}

/**
 * Extracts explicit CalculateCostInput using NormalizedFarmState's owned inventory.
 */
export function extractCostContext(
  state: NormalizedFarmState,
  requiredResources: Record<string, number>,
  prices: Record<string, number> = {},
  itemsMeta: Record<string, { tradable?: boolean }> = {},
  options: ContextExtractorOptions = {}
): CalculateCostInput {
  return {
    requiredResources,
    inventory: state.inventory.all,
    prices,
    itemsMeta,
    farmId: options.farmId,
    snapshotVersion: options.snapshotVersion,
  };
}
