/**
 * server/core/effectEngine/effectOperations.ts
 * Domain-specific deterministic calculation operations matching Sunflower Land official rules.
 *
 * ARCHITECTURAL INVARIANT:
 * Calculations follow official game code semantics per domain:
 * - Cooking Time: base * product(timeMultipliers)
 * - Food XP: base * product(xpMultipliers) + flatAdditions
 * - Resource Yield: base * product(multipliers) + additions
 * - Crop Yield: base * product(multipliers) + additions
 * - Crop Growth Time: base * product(growthTimeMultipliers)
 */

/**
 * Compute effective cooking time in minutes or seconds.
 */
export function calculateEffectiveCookTime(
  baseTime: number,
  multipliers: number[] = []
): number {
  let time = baseTime;
  for (const m of multipliers) {
    if (m > 0) time *= m;
  }
  // Clamp and round to 4 decimal places to prevent float precision drift
  return Math.max(0, Math.round(time * 10000) / 10000);
}

/**
 * Compute effective Bumpkin XP from consuming a food item.
 */
export function calculateEffectiveFoodXp(
  baseXp: number,
  multipliers: number[] = [],
  additions: number[] = []
): number {
  let xp = baseXp;
  for (const m of multipliers) {
    if (m > 0) xp *= m;
  }
  for (const a of additions) {
    xp += a;
  }
  // Clamp at 0 and round to 2 decimal places
  return Math.max(0, Math.round(xp * 100) / 100);
}

/**
 * Compute effective yield from harvesting a resource node (wood, stone, iron, gold).
 */
export function calculateEffectiveResourceYield(
  baseDrop: number,
  multipliers: number[] = [],
  additions: number[] = []
): number {
  let amount = baseDrop;
  for (const m of multipliers) {
    if (m > 0) amount *= m;
  }
  for (const a of additions) {
    amount += a;
  }
  return Math.max(0, Math.round(amount * 1000) / 1000);
}

/**
 * Compute effective crop yield from harvesting a plot crop.
 */
export function calculateEffectiveCropYield(
  baseYield: number,
  multipliers: number[] = [],
  additions: number[] = []
): number {
  let yieldAmount = baseYield;
  for (const m of multipliers) {
    if (m > 0) yieldAmount *= m;
  }
  for (const a of additions) {
    yieldAmount += a;
  }
  return Math.max(0, Math.round(yieldAmount * 1000) / 1000);
}

/**
 * Compute effective crop growth time in seconds or minutes.
 */
export function calculateEffectiveCropGrowthTime(
  baseTime: number,
  multipliers: number[] = []
): number {
  let time = baseTime;
  for (const m of multipliers) {
    if (m > 0) time *= m;
  }
  return Math.max(0, Math.round(time * 10000) / 10000);
}

/**
 * Compute effective aging shed processing time in minutes or seconds.
 */
export function calculateEffectiveAgingTime(
  baseTime: number,
  multipliers: number[] = []
): number {
  let time = baseTime;
  for (const m of multipliers) {
    if (m > 0) time *= m;
  }
  return Math.max(0, Math.round(time * 10000) / 10000);
}

/**
 * Compute effective output yield from Aging Shed processing (Aging, Fermentation, Spice).
 */
export function calculateEffectiveAgingYield(
  baseYield: number,
  outputMultiplier: number = 1.0,
  additions: number = 0
): number {
  const yieldAmount = (baseYield * (outputMultiplier > 0 ? outputMultiplier : 1.0)) + additions;
  return Math.max(0, Math.round(yieldAmount * 1000) / 1000);
}

/**
 * Compute effective input ingredient requirement for Aging Shed processing.
 */
export function calculateEffectiveAgingCost(
  baseCost: number,
  costMultiplier: number = 1.0
): number {
  const cost = baseCost * (costMultiplier > 0 ? costMultiplier : 1.0);
  return Math.max(0, Math.round(cost * 1000) / 1000);
}

/**
 * Compute effective prime aged fish probability.
 */
export function calculateEffectivePrimeAgedChance(
  baseChance: number,
  multiplier: number = 1.0
): number {
  const chance = baseChance * (multiplier > 0 ? multiplier : 1.0);
  return Math.min(1.0, Math.max(0, Math.round(chance * 10000) / 10000));
}

