/**
 * server/core/simulation/candidates.ts
 * Slice 3 — pure candidate generation for the forward model.
 *
 * ARCHITECTURAL INVARIANTS (mirror forwardModel.ts):
 *  - Pure & deterministic: zero I/O, no ambient clock, no RNG. Iteration follows the
 *    recipe/inventory insertion order, so the emitted candidate list is reproducible.
 *  - "The engine decides what's candidates": this enumerates the LEGAL moves from a
 *    state (cook building-present recipes, sell priced stock, buy explicitly targeted
 *    items). The beam search decides which ordering serves the goal; `applyAction`
 *    re-checks feasibility, so a listed candidate is a possibility, not a guarantee.
 */

import type { NormalizedFarmState } from '../../domain/state.js';
import type { SimAction, SimContext } from './forwardModel.js';
import { getItemPrice } from '../economyEngine/cost.js';

export interface CandidateOptions {
  /** Items the goal explicitly wants to acquire on the market: item → target quantity. */
  buyItems?: Record<string, number>;
}

/**
 * Enumerate the legal SimActions available from `state` given the live context.
 *  - cook: one batch per recipe whose required building is present on the farm.
 *  - sell: the full current stock of each inventory item with a resolvable market price.
 *  - buy: only items named in `options.buyItems`, at their target quantity, when priced.
 */
export function generateSimCandidates(
  state: NormalizedFarmState,
  ctx: SimContext,
  options: CandidateOptions = {},
): SimAction[] {
  const candidates: SimAction[] = [];
  const buildings = state.structures.buildings ?? ({} as Record<string, unknown[]>);
  const prices = ctx.prices ?? {};

  // cook — building-present recipes (ingredient sufficiency is gated by applyAction)
  for (const [name, recipe] of Object.entries(ctx.recipes ?? {})) {
    const present = (buildings[recipe.building]?.length ?? 0) > 0;
    if (present) candidates.push({ type: 'cook', item: name, quantity: 1 });
  }

  // sell — full stock of each priced item
  for (const [item, qty] of Object.entries(state.inventory.all ?? {})) {
    if (qty > 0 && getItemPrice(item, prices) != null) {
      candidates.push({ type: 'sell', item, quantity: qty });
    }
  }

  // buy — only explicitly targeted, priced items
  for (const [item, qty] of Object.entries(options.buyItems ?? {})) {
    if (qty > 0 && getItemPrice(item, prices) != null) {
      candidates.push({ type: 'buy', item, quantity: qty });
    }
  }

  return candidates;
}
