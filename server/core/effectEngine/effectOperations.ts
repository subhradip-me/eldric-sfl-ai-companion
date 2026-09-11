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
