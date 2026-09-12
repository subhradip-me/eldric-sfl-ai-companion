/**
 * server/core/effectEngine/effectTypes.ts
 * Core types for the deterministic Effect Resolution Engine.
 *
 * ARCHITECTURAL INVARIANT:
 * Typed modifiers (multipliers, additions, flags) categorize every game effect.
 * Effects track activation provenance (equipped, placed, passive_skill, temporary_buff, vip, seasonal).
 */

import type { TimestampMs } from '../../domain/types.js';

export type EquippedSlot =
  | 'body'
  | 'hair'
  | 'shirt'
  | 'pants'
  | 'shoes'
  | 'tool'
  | 'secondaryTool'
  | 'hat'
  | 'necklace'
  | 'wings'
  | 'aura'
  | 'onesie'
  | 'beard'
  | 'background'
  | 'coat'
  | 'dress'
  | 'suit';

export type EffectDomain = 'xp' | 'cooking' | 'crops' | 'resources' | 'animals' | 'fishing' | 'processing';
export type EffectOperation = 'multiply' | 'add' | 'flag';

export type EffectActivation =
  | { kind: 'equipped'; slot: EquippedSlot; item: string }
  | { kind: 'placed'; instanceId: string; item: string; location: string; coordinates: { x: number; y: number } }
  | { kind: 'passive_skill'; skill: string; rank: number }
  | { kind: 'activated_power'; power: string; lastUsedAt: number; active: boolean }
  | { kind: 'temporary_buff'; name: string; startedAt: number; durationMs: number; active: boolean }
  | { kind: 'vip'; expiresAt: number; active: boolean }
  | { kind: 'seasonal'; season: string; active: boolean };

export interface ActiveEffect {
  sourceId: string;
  sourceType: 'wearable' | 'collectible' | 'passive_skill' | 'activated_power' | 'temporary_buff' | 'vip' | 'seasonal';
  domain: EffectDomain;
  operation: EffectOperation;
  target: string;
  value: number | boolean;
  description: string;
  ruleVersion: string;
  activation: EffectActivation;
  active: boolean;
}

export interface EffectRule {
  domain: EffectDomain;
  operation: EffectOperation;
  target: string;
  value: number | boolean;
  condition?: string;
  description?: string;
}

export interface EffectDefinition {
  id: string;
  sourceType: 'wearable' | 'collectible' | 'passive_skill' | 'activated_power' | 'buff' | 'temporary_buff' | 'vip' | 'seasonal';
  effects: EffectRule[];
  ruleVersion: string;
  sourceRef?: string;
}

export interface EffectContext {
  xp: {
    multipliers: {
      global: number;
      food: number;
      crop: number;
      buildings: Record<string, number>;
      fishFood: number;
      honeyFood: number;
    };
    additions: {
      animalAffection: number;
      flatFoodXp: number;
    };
  };

  cooking: {
    timeMultipliers: {
      global: number;
      buildings: Record<string, number>;
      oilActive: Record<string, number>;
    };
    outputMultipliers: {
      food: number;
    };
    costMultipliers: {
      ingredients: number;
    };
  };

  crops: {
    timeMultipliers: {
      global: number;
      byCrop: Record<string, number>;
    };
    yieldMultipliers: {
      global: number;
      byCrop: Record<string, number>;
    };
    yieldAdditions: {
      byCrop: Record<string, number>;
      byTier: Record<string, number>;
    };
    flags: {
      freeSeeds: boolean;
      mutantChanceMultiplier: number;
    };
  };

  resources: {
    yieldMultipliers: {
      wood: number;
      stone: number;
      iron: number;
      gold: number;
      crimstone: number;
      sunstone: number;
    };
    yieldAdditions: {
      wood: number;
      stone: number;
      iron: number;
      gold: number;
    };
    treeRegenMultiplier: number;
    flags: {
      freeAxe: boolean;
    };
  };

  animals: {
    yieldAdditions: {
      egg: number;
      wool: number;
      milk: number;
    };
    timeMultipliers: {
      produce: number;
      byAnimal: Record<string, number>;
    };
    costMultipliers: {
      feed: number;
    };
    flags: {
      freeChickenFeed: boolean;
    };
  };

  fishing: {
    catchAdditions: {
      flat: number;
      bySeason: Record<string, number>;
    };
  };

  processing: {
    agingTimeMultipliers: {
      global: number;
      fishAging: number;
    };
    agingYieldMultipliers: {
      output: number;
      ingredientCost: number;
    };
    primeAgedChanceMultiplier: number;
    fermentationYieldAdditions: number;
    saltBonus: {
      refinedSaltChance: number;
      saltPerHarvest: number;
      chargeReplenishTimeMultiplier: number;
      rakeCostMultiplier: number;
      restore1ChargeChance: number;
      saltSurgeUnlocked: boolean;
    };
    compostTimeMultiplier: number;
    compostYieldAdditions: {
      worm: number;
      fertiliser: number;
    };
  };

  activeEffects: ActiveEffect[];
  computedAt: TimestampMs;
  ruleVersion: string;
}
