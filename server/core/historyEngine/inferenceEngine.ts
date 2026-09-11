/**
 * server/core/historyEngine/inferenceEngine.ts
 * Pure deterministic Event Inference Engine.
 *
 * Implements explicit hypothesis scoring and epistemic restraint:
 * - Evidence -> Candidates -> Uniqueness Check -> Confidence -> InferredEvent
 * - Never more confident than evidence.
 * - Competing hypotheses degrade confidence.
 * - Observation gaps cap confidence.
 *
 * Invariant: Pure calculation. Zero ambient clock, zero network, zero LLM calls.
 */

import type { NormalizedFarmState } from '../../domain/state.js';
import type { ConfidenceLevel, InferredEvent, InferenceCandidate } from '../../domain/history.js';
import type { RecipeDefinition } from '../../domain/recipes.js';
import type { DerivedDelta } from './deltaCalculator.js';

export interface InferenceEngineContext {
  recipes?: Record<string, RecipeDefinition>;
  marketPrices?: Record<string, number>;
}

/**
 * Evaluates candidates and infers events with explicit confidence and evidence chains.
 */
export function inferEventsFromDelta(
  fromState: NormalizedFarmState,
  toState: NormalizedFarmState,
  delta: DerivedDelta,
  context: InferenceEngineContext = {}
): InferredEvent[] {
  const candidates: InferenceCandidate[] = [];
  const sourceSnapshotVersion = delta.toVersion;
  const timestamp = delta.toTimestamp;
  const isGap = delta.quality.gapDetected;

  const recipes = context.recipes ?? {};
  const marketPrices = context.marketPrices ?? {};

  // Track which inventory keys are accounted for
  const accountedNegativeKeys = new Set<string>();

  // -------------------------------------------------------------------------
  // 1. HARVEST INFERENCE
  // -------------------------------------------------------------------------
  for (const [item, diff] of Object.entries(delta.inventoryDiff)) {
    if (diff <= 0) continue;
    // Cooked/crafted recipes are handled in section 2 below
    if (recipes[item]) continue;

    const hadCompletedPlot = delta.completedProductionItems.includes(item);

    if (hadCompletedPlot) {
      const evidence: string[] = [
        `${item} plot completed growth in previous state`,
        `inventory delta +${diff}`,
      ];

      if (delta.xpDiff > 0) {
        evidence.push(`farming XP gained (${delta.xpDiff})`);
      }

      let confidence: ConfidenceLevel;
      if (isGap) {
        confidence = 'MEDIUM';
        evidence.push('observation gap detected between snapshots');
      } else if (delta.xpDiff > 0) {
        confidence = 'HIGH';
      } else {
        confidence = 'MEDIUM';
      }

      candidates.push({
        type: 'HARVEST',
        item,
        quantity: diff,
        explanation: `Player harvested ${diff} ${item}`,
        evidence,
        confidence,
        inferenceMethod: 'CROP_COMPLETION_PLUS_INVENTORY_DELTA',
      });
    } else {
      // Inventory increased without any tracked plot in previous snapshot
      candidates.push({
        type: 'HARVEST',
        item,
        quantity: diff,
        explanation: `Inventory increased for ${item} without tracked plot completion`,
        evidence: [
          `inventory delta +${diff}`,
          'no active plot tracked in prior snapshot (possible offline cycle, gift, or untracked crop)',
        ],
        confidence: 'LOW',
        inferenceMethod: 'UNTRACKED_INVENTORY_INCREASE',
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. COOK / CRAFT INFERENCE
  // -------------------------------------------------------------------------
  for (const [recipeName, diff] of Object.entries(delta.inventoryDiff)) {
    if (diff <= 0) continue;

    const recipe = recipes[recipeName];
    if (!recipe) continue;

    // Check if required ingredients were consumed in matching ratios
    const ingredientEntries = Object.entries(recipe.ingredients);
    const matchesIngredients = ingredientEntries.every(([ing, requiredQty]) => {
      const consumed = Math.abs(delta.inventoryDiff[ing] ?? 0);
      return consumed >= requiredQty * diff;
    });

    if (matchesIngredients && ingredientEntries.length > 0) {
      ingredientEntries.forEach(([ing]) => accountedNegativeKeys.add(ing));

      // Check for competing recipes that use the exact same ingredients
      const competingRecipes = Object.entries(recipes)
        .filter(([rName, rDef]) => {
          if (rName === recipeName) return false;
          const rKeys = Object.keys(rDef.ingredients);
          const currentKeys = Object.keys(recipe.ingredients);
          return (
            rKeys.length === currentKeys.length &&
            rKeys.every((ing) => Object.prototype.hasOwnProperty.call(recipe.ingredients, ing))
          );
        })
        .map(([rName]) => rName);


      const evidence: string[] = [
        `consumed required ingredients for ${recipeName}`,
        `inventory output +${diff} ${recipeName}`,
      ];

      let confidence: ConfidenceLevel;
      if (competingRecipes.length > 0) {
        confidence = 'LOW';
        evidence.push(`competing candidate recipes share ingredients: ${competingRecipes.join(', ')}`);
      } else if (isGap) {
        confidence = 'MEDIUM';
        evidence.push('observation gap detected between snapshots');
      } else {
        confidence = 'HIGH';
      }

      candidates.push({
        type: 'COOK',
        item: recipeName,
        quantity: diff,
        explanation: `Player cooked/crafted ${diff} ${recipeName}`,
        evidence,
        confidence,
        inferenceMethod: 'RECIPE_STOICHIOMETRY_PLUS_INVENTORY_INCREASE',
        ...(competingRecipes.length > 0 ? { competingHypotheses: competingRecipes } : {}),
      });
    }
  }

  // Check for immediate consumption (ingredients consumed + XP gained, but cooked item eaten)
  for (const [recipeName, recipe] of Object.entries(recipes)) {
    if ((delta.inventoryDiff[recipeName] ?? 0) > 0) continue; // already handled above

    const ingredientEntries = Object.entries(recipe.ingredients);
    if (ingredientEntries.length === 0) continue;

    const allIngredientsConsumed = ingredientEntries.every(([ing, requiredQty]) => {
      if (accountedNegativeKeys.has(ing)) return false;
      const consumed = Math.abs(delta.inventoryDiff[ing] ?? 0);
      return consumed >= requiredQty;
    });

    if (allIngredientsConsumed && delta.xpDiff > 0) {
      ingredientEntries.forEach(([ing]) => accountedNegativeKeys.add(ing));

      candidates.push({
        type: 'COOK',
        item: recipeName,
        quantity: 1,
        explanation: `Ingredients consumed with food XP gain, likely eaten immediately`,
        evidence: [
          `consumed ingredients matching ${recipeName}`,
          `XP gained (${delta.xpDiff}) without inventory accumulation`,
        ],
        confidence: isGap ? 'LOW' : 'MEDIUM',
        inferenceMethod: 'INGREDIENTS_CONSUMED_PLUS_FOOD_XP',
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. TRADE / SELL INFERENCE
  // -------------------------------------------------------------------------
  if (delta.coinsDiff > 0) {
    const decreasedItems = Object.entries(delta.inventoryDiff)
      .filter(([item, diff]) => diff < 0 && !accountedNegativeKeys.has(item));

    if (decreasedItems.length === 1) {
      const [soldItem, negDiff] = decreasedItems[0];
      const qtySold = Math.abs(negDiff);
      const unitPrice = marketPrices[soldItem];

      if (unitPrice != null && Math.abs(delta.coinsDiff - qtySold * unitPrice) < 1e-4) {
        accountedNegativeKeys.add(soldItem);

        candidates.push({
          type: 'TRADE',
          item: soldItem,
          quantity: qtySold,
          explanation: `Sold ${qtySold} ${soldItem} for ${delta.coinsDiff} coins`,
          evidence: [
            `inventory delta -${qtySold} ${soldItem}`,
            `coins delta +${delta.coinsDiff} matches exact unit price (${unitPrice})`,
          ],
          confidence: isGap ? 'MEDIUM' : 'HIGH',
          inferenceMethod: 'COINS_DELTA_MATCHES_SELL_PRICE',
        });
      }
    } else if (decreasedItems.length > 1) {
      // Multiple items decreased alongside coin gain -> ambiguous competing candidates
      const itemNames = decreasedItems.map(([i]) => i);
      candidates.push({
        type: 'TRADE',
        explanation: `Coins increased (+${delta.coinsDiff}) alongside multiple decreased items`,
        evidence: [
          `multiple decreased candidates: ${itemNames.join(', ')}`,
          `cannot uniquely map coins delta to a single trade transaction`,
        ],
        confidence: 'LOW',
        inferenceMethod: 'AMBIGUOUS_MULTI_ITEM_SALE',
        competingHypotheses: itemNames,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. UNEXPLAINED INVENTORY DECREASES (EPISTEMIC RESTRAINT)
  // -------------------------------------------------------------------------
  for (const [item, diff] of Object.entries(delta.inventoryDiff)) {
    if (diff < 0 && !accountedNegativeKeys.has(item)) {
      const qty = Math.abs(diff);
      candidates.push({
        type: 'FEED',
        item,
        quantity: qty,
        explanation: `Unaccounted decrease of ${qty} ${item}`,
        evidence: [
          `unmatched inventory decrease of ${qty} ${item}`,
          'no corresponding recipe output, delivery, or exact price trade matched',
        ],
        confidence: 'LOW',
        inferenceMethod: 'UNMATCHED_INVENTORY_DECREASE',
      });
    }
  }

  // Convert candidates to validated InferredEvent objects
  return candidates.map((candidate, idx) => ({
    kind: 'INFERRED',
    id: `inf_${delta.toVersion}_${idx + 1}`,
    type: candidate.type,
    timestamp,
    item: candidate.item,
    quantity: candidate.quantity,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
    sourceSnapshotVersion,
    inferenceMethod: candidate.inferenceMethod,
  }));
}
