/**
 * server/core/xpEngine/primitives.ts
 * Pure deterministic mathematics for XP, levels, and milestone progressions.
 * Zero external side-effects or network dependencies.
 */

import defaultLevels from '../../data/levels.json' with { type: 'json' };

export type LevelsTable = Record<string, number>;

/**
 * Derive Bumpkin level from cumulative XP.
 * Pure function: takes cumulative XP and optional levels mapping table.
 */
export function levelFromXp(xp: number, levelsTable: LevelsTable = defaultLevels): number {
  if (xp <= 0) return 1;
  let lvl = 1;
  for (const [levelStr, reqXp] of Object.entries(levelsTable)) {
    const l = Number(levelStr);
    if (!Number.isNaN(l) && typeof reqXp === 'number' && xp >= reqXp) {
      lvl = Math.max(lvl, l);
    }
  }
  return lvl;
}

/**
 * Get the cumulative XP required to reach a specific target level.
 */
export function xpRequiredForLevel(targetLevel: number, levelsTable: LevelsTable = defaultLevels): number {
  const req = levelsTable[String(targetLevel)];
  if (req !== undefined) return req;
  // If target level exceeds table, fallback to max or error
  return levelsTable['200'] ?? 244206000;
}

export interface LevelProgressInfo {
  currentLevel: number;
  currentXp: number;
  targetLevel: number;
  targetRequiredXp: number;
  remainingXp: number;
  progressFraction: number; // [0..1]
}

/**
 * Compute progress metrics from current XP toward a target level.
 */
export function calculateLevelProgress(
  currentXp: number,
  targetLevel: number,
  levelsTable: LevelsTable = defaultLevels
): LevelProgressInfo {
  const currentLevel = levelFromXp(currentXp, levelsTable);
  const targetRequiredXp = xpRequiredForLevel(targetLevel, levelsTable);
  const remainingXp = Math.max(0, targetRequiredXp - currentXp);
  const currentLevelBaseXp = xpRequiredForLevel(currentLevel, levelsTable);

  const denominator = targetRequiredXp - currentLevelBaseXp;
  const progressFraction = denominator > 0
    ? Math.min(1, Math.max(0, (currentXp - currentLevelBaseXp) / denominator))
    : (currentXp >= targetRequiredXp ? 1 : 0);

  return {
    currentLevel,
    currentXp,
    targetLevel,
    targetRequiredXp,
    remainingXp,
    progressFraction,
  };
}
