/**
 * server/core/simulation/forwardModel.ts
 * Slice 3 — the forward model: apply(state, action) -> { state', FarmDelta }.
 *
 * ARCHITECTURAL INVARIANTS (mirror server/core/index.ts):
 *  - Pure & deterministic: zero Express / Redis / BullMQ / PostgreSQL / LLM imports,
 *    no ambient clock (the sim clock is state.metadata.capturedAt / ctx.now), no RNG.
 *  - One FarmDelta, two directions: the emitted transition is the SAME `FarmDelta`
 *    the backward model produces (via `calculateStateDelta`), so a simulated day and a
 *    real day are scored by the same valuation.
 *  - Reuse, never re-derive: cook mechanics come from `calculateFoodXp`, boosts from
 *    `resolveEffectContext` — guaranteeing sim numbers match dashboard numbers.
 */

import type { NormalizedFarmState } from '../../domain/state.js';
import type { FarmDelta, ObservedEvent } from '../../domain/history.js';
import type { RecipeDefinition } from '../../domain/recipes.js';
import type { TimestampMs } from '../../domain/types.js';
import type { EffectContext } from '../effectEngine/effectTypes.js';

import { calculateFoodXp } from '../xpEngine/foodXp.js';
import { resolveEffectContext } from '../effectEngine/effectResolver.js';
import { calculateStateDelta, type DerivedDelta } from '../historyEngine/deltaCalculator.js';
import { getItemPrice } from '../economyEngine/cost.js';

/** Discrete forward-model actions (first cut). Fishing / greenhouse deferred. */
export type SimActionType =
  | 'cook'
  | 'sell'
  | 'buy'
  | 'harvest'
  | 'plant'
  | 'feed_animal'
  | 'gather';

export interface SimAction {
  type: SimActionType;
  /** Recipe name for `cook`; item/crop/resource for the others. */
  item: string;
  /** Batches (cook) or units (sell/buy/gather). Defaults to 1. */
  quantity?: number;
  building?: string;
  slotId?: string | number;
  meta?: Record<string, unknown>;
}

export interface SimContext {
  /** Sim clock for effect resolution; defaults to state.metadata.capturedAt. */
  now?: TimestampMs;
  /** Recipe catalog; when omitted the cook path cannot resolve unknown recipes. */
  recipes?: Record<string, RecipeDefinition>;
  /** Live prices (FLOWER unit) for economy actions. */
  prices?: Record<string, number>;
  /** Precomputed boosts; when omitted it is derived from the state deterministically. */
  effectContext?: EffectContext;
}

export interface ApplyActionResult {
  nextState: NormalizedFarmState;
  delta: FarmDelta;
  feasible: boolean;
  blocker?: string;
}

/** Map the backward model's DerivedDelta onto the shared FarmDelta shape. */
function toFarmDelta(d: DerivedDelta, observedEvents: ObservedEvent[]): FarmDelta {
  return {
    fromVersion: d.fromVersion,
    toVersion: d.toVersion,
    fromHash: d.fromHash,
    toHash: d.toHash,
    fromTimestamp: d.fromTimestamp,
    toTimestamp: d.toTimestamp,
    durationMs: d.durationMs,
    quality: d.quality,
    temporalAttribution: d.temporalAttribution,
    inventoryDiff: d.inventoryDiff,
    xpDiff: d.xpDiff,
    levelDiff: d.levelDiff,
    balanceDiff: d.balanceDiff,
    coinsDiff: d.coinsDiff,
    observedEvents,
    inferredEvents: [],
    events: observedEvents,
  };
}

/** An unchanged-state, zero-transition result carrying the blocker reason. */
function infeasible(state: NormalizedFarmState, blocker: string): ApplyActionResult {
  const same = calculateStateDelta(state, state, { fromVersion: 0, toVersion: 0 });
  return { nextState: state, delta: toFarmDelta(same, []), feasible: false, blocker };
}

/** Read the current FLOWER balance, preferring the numeric approximation. */
function flowerBalance(state: NormalizedFarmState): number {
  return state.economy.flowerApprox ?? parseFloat(state.economy.flower ?? '0');
}

/** Adjust the FLOWER balance in-place, keeping the three representations coherent. */
function adjustFlower(state: NormalizedFarmState, deltaFlower: number): void {
  const next = +(flowerBalance(state) + deltaFlower).toFixed(4);
  state.economy.flowerApprox = next;
  state.economy.sfl = next;
  state.economy.flower = String(next);
}

function applyCook(
  state: NormalizedFarmState,
  action: SimAction,
  ctx: SimContext,
): ApplyActionResult {
  const recipeName = action.item;
  const batches = action.quantity ?? 1;
  const recipe = ctx.recipes?.[recipeName];
  if (!recipe) return infeasible(state, `unknown recipe: ${recipeName}`);

  const buildingInstances = state.structures.buildings?.[recipe.building];
  if (!buildingInstances || buildingInstances.length === 0) {
    return infeasible(state, `missing building: ${recipe.building}`);
  }

  const now = ctx.now ?? state.metadata.capturedAt;
  const effectContext = ctx.effectContext ?? resolveEffectContext(state, { now }).value;
  const buildingOil = state.structures.buildings?.[recipe.building]?.[0]?.oil ?? 0;

  const eff = calculateFoodXp({
    recipeName,
    recipe,
    skills: state.player.skills,
    isVip: state.buffs.vip,
    buildingOil,
    effectContext,
  }).value;

  const inventory = state.inventory.all;
  for (const [ing, perBatch] of Object.entries(eff.effectiveIngredients)) {
    const required = perBatch * batches;
    if ((inventory[ing] ?? 0) < required) {
      return infeasible(
        state,
        `insufficient ${ing}: need ${required}, have ${inventory[ing] ?? 0}`,
      );
    }
  }

  const nextState = structuredClone(state);
  const inv = nextState.inventory.all;
  for (const [ing, perBatch] of Object.entries(eff.effectiveIngredients)) {
    inv[ing] = (inv[ing] ?? 0) - perBatch * batches;
  }
  inv[recipeName] = (inv[recipeName] ?? 0) + eff.output * batches;
  nextState.player.experience += eff.batchXp * batches;

  const durationMs = Math.round(eff.minutes * 60000) * batches;
  nextState.metadata = { ...nextState.metadata, capturedAt: state.metadata.capturedAt + durationMs };

  const derived = calculateStateDelta(state, nextState, { fromVersion: 0, toVersion: 1 });
  const event: ObservedEvent = {
    kind: 'OBSERVED',
    id: `sim:cook:${recipeName}`,
    type: 'COOK',
    timestamp: nextState.metadata.capturedAt,
    item: recipeName,
    quantity: eff.output * batches,
  };

  return { nextState, delta: toFarmDelta(derived, [event]), feasible: true };
}

/**
 * Sell units of an inventory item at the live market unit price (FLOWER).
 * Never overdraws inventory; rejects items with no resolvable market price.
 */
function applySell(
  state: NormalizedFarmState,
  action: SimAction,
  ctx: SimContext,
): ApplyActionResult {
  const item = action.item;
  const qty = action.quantity ?? 1;
  if (qty <= 0) return infeasible(state, `invalid quantity: ${qty}`);

  const unitPrice = getItemPrice(item, ctx.prices ?? {});
  if (unitPrice == null) return infeasible(state, `no market price for ${item}`);

  const have = state.inventory.all[item] ?? 0;
  if (have < qty) {
    return infeasible(state, `insufficient ${item}: need ${qty}, have ${have}`);
  }

  const nextState = structuredClone(state);
  nextState.inventory.all[item] = have - qty;
  adjustFlower(nextState, qty * unitPrice);

  const derived = calculateStateDelta(state, nextState, { fromVersion: 0, toVersion: 1 });
  const event: ObservedEvent = {
    kind: 'OBSERVED',
    id: `sim:sell:${item}`,
    type: 'TRADE',
    timestamp: nextState.metadata.capturedAt,
    item,
    quantity: qty,
    metadata: { tradeType: 'SELL', unitPrice },
  };

  return { nextState, delta: toFarmDelta(derived, [event]), feasible: true };
}

/**
 * Buy units of an item at the live market unit price (FLOWER).
 * Rejects unpriced items and purchases the FLOWER balance cannot cover.
 */
function applyBuy(
  state: NormalizedFarmState,
  action: SimAction,
  ctx: SimContext,
): ApplyActionResult {
  const item = action.item;
  const qty = action.quantity ?? 1;
  if (qty <= 0) return infeasible(state, `invalid quantity: ${qty}`);

  const unitPrice = getItemPrice(item, ctx.prices ?? {});
  if (unitPrice == null) return infeasible(state, `no market price for ${item}`);

  const cost = qty * unitPrice;
  const balance = flowerBalance(state);
  if (cost > balance) {
    return infeasible(state, `insufficient FLOWER: need ${cost}, have ${balance}`);
  }

  const nextState = structuredClone(state);
  nextState.inventory.all[item] = (nextState.inventory.all[item] ?? 0) + qty;
  adjustFlower(nextState, -cost);

  const derived = calculateStateDelta(state, nextState, { fromVersion: 0, toVersion: 1 });
  const event: ObservedEvent = {
    kind: 'OBSERVED',
    id: `sim:buy:${item}`,
    type: 'TRADE',
    timestamp: nextState.metadata.capturedAt,
    item,
    quantity: qty,
    metadata: { tradeType: 'BUY', unitPrice },
  };

  return { nextState, delta: toFarmDelta(derived, [event]), feasible: true };
}
export function applyAction(
  state: NormalizedFarmState,
  action: SimAction,
  ctx: SimContext = {},
): ApplyActionResult {
  switch (action.type) {
    case 'cook':
      return applyCook(state, action, ctx);
    case 'sell':
      return applySell(state, action, ctx);
    case 'buy':
      return applyBuy(state, action, ctx);
    default:
      return infeasible(state, `unsupported action: ${action.type}`);
  }
}
