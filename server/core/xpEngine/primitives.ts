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

export const CHICKEN_LEVEL_XP: Record<number, number> = {
  1: 60,
  2: 120,
  3: 240,
  4: 360,
  5: 480,
  6: 660,
  7: 840,
  8: 1020,
  9: 1200,
  10: 1440,
  11: 1680,
  12: 1920,
  13: 2160,
  14: 2400,
  15: 2720,
};

export const COW_LEVEL_XP: Record<number, number> = {
  1: 180,
  2: 360,
  3: 720,
  4: 1080,
  5: 1440,
  6: 1980,
  7: 2520,
  8: 3060,
  9: 3600,
  10: 4320,
  11: 5040,
  12: 5760,
  13: 6480,
  14: 7200,
  15: 8160,
};

export const SHEEP_LEVEL_XP: Record<number, number> = {
  1: 120,
  2: 240,
  3: 480,
  4: 720,
  5: 960,
  6: 1320,
  7: 1680,
  8: 2040,
  9: 2400,
  10: 2880,
  11: 3360,
  12: 3840,
  13: 4320,
  14: 4800,
  15: 5440,
};

/**
 * Derive animal level from cumulative XP based on metadata/animal_rules.json production rules.
 */
export function animalLevelFromXp(
  animalType: 'chicken' | 'cow' | 'sheep' | 'Chicken' | 'Cow' | 'Sheep',
  xp: number
): number {
  if (xp <= 0) return 0;
  const key = animalType.toLowerCase();
  const table = key === 'cow' ? COW_LEVEL_XP : key === 'sheep' ? SHEEP_LEVEL_XP : CHICKEN_LEVEL_XP;
  let lvl = 0;
  for (const [levelStr, reqXp] of Object.entries(table)) {
    const l = Number(levelStr);
    if (xp >= reqXp) {
      lvl = Math.max(lvl, l);
    }
  }
  return lvl;
}

