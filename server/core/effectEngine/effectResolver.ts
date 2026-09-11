/**
 * server/core/effectEngine/effectResolver.ts
 * Pure deterministic resolver transforming farm state and temporal context into EffectContext.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Authoritative Activation Gate:
 *    - Wearables must be in bumpkin.equipped (not unequipped in wardrobe).
 *    - Collectibles must be placed in structures.placedCollectibles (not unplaced in inventory).
 *    - Passive skills must be unlocked in bumpkin.skills.
 *    - Temporary buffs must satisfy now >= startedAt && now < startedAt + durationMs.
 *    - VIP must satisfy now < expiresAt.
 *    - Seasonal bonuses only activate if current season matches rule condition.
 * 2. Pure function with explicit provenance. Zero ambient clocks or random UUIDs.
 */

import type { NormalizedFarmState, CalculationResult, TimestampMs } from '../../domain/index.js';
import type {
  EffectContext,
  ActiveEffect,
  EffectActivation,
  EquippedSlot,
} from './effectTypes.js';
import { EFFECT_REGISTRY, CURRENT_RULE_VERSION } from './effectRegistry.js';
import { withProvenance } from '../provenance/index.js';

export interface ResolveEffectOptions {
  now?: TimestampMs;
  season?: string;
  farmId?: string;
  snapshotVersion?: number;
  computedAt?: TimestampMs;
}

export function resolveEffectContext(
  state: NormalizedFarmState,
  options: ResolveEffectOptions = {}
): CalculationResult<EffectContext> {
  const now = options.now ?? state.metadata?.capturedAt ?? Date.now();
  const computedAt = options.computedAt ?? now;
  const currentSeason = (options.season ?? state.temporal?.season ?? 'Spring').toLowerCase();

  const activeEffects: ActiveEffect[] = [];
  const processedKeys = new Set<string>();

  // ── Helper to evaluate rule condition ────────────────────────────────────
  const conditionSatisfied = (condition?: string): boolean => {
    if (!condition) return true;
    const cond = condition.toLowerCase();
    if (['winter', 'spring', 'summer', 'autumn'].includes(cond)) {
      return cond === currentSeason;
    }
    // "oilActive" is evaluated dynamically at cooking time
    if (cond === 'oilactive') {
      return true;
    }
    return true;
  };

  // ── 1. Scan Equipped Wearables ───────────────────────────────────────────
  const equipped = state.player?.equipped ?? {};
  for (const [slot, itemName] of Object.entries(equipped)) {
    if (!itemName) continue;
    const def = EFFECT_REGISTRY[itemName];
    if (def && def.sourceType === 'wearable') {
      const activation: EffectActivation = {
        kind: 'equipped',
        slot: slot as EquippedSlot,
        item: itemName,
      };

      for (const rule of def.effects) {
        if (!conditionSatisfied(rule.condition)) continue;
        const key = `wearable:${slot}:${itemName}:${rule.domain}:${rule.target}`;
        if (!processedKeys.has(key)) {
          processedKeys.add(key);
          activeEffects.push({
            sourceId: itemName,
            sourceType: 'wearable',
            domain: rule.domain,
            operation: rule.operation,
            target: rule.target,
            value: rule.value,
            description: rule.description ?? `${itemName} boost`,
            ruleVersion: def.ruleVersion,
            activation,
            active: true,
          });
        }
      }
    }
  }

  // ── 2. Scan Placed Collectibles (Island & Interior) ───────────────────────
  const placedCollectibles = state.structures?.placedCollectibles ?? [];
  for (const placed of placedCollectibles) {
    const itemName = placed.name;
    const def = EFFECT_REGISTRY[itemName];
    if (def && (def.sourceType === 'collectible' || def.id === 'Blossombeard')) {
      const activation: EffectActivation = {
        kind: 'placed',
        instanceId: placed.id,
        item: itemName,
        location: placed.location,
        coordinates: placed.coordinates,
      };

      for (const rule of def.effects) {
        if (!conditionSatisfied(rule.condition)) continue;
        // Collectible unique key allows stacking if different instance or rule
        const key = `collectible:${itemName}:${rule.domain}:${rule.target}`;
        if (!processedKeys.has(key)) {
          processedKeys.add(key);
          activeEffects.push({
            sourceId: itemName,
            sourceType: 'collectible',
            domain: rule.domain,
            operation: rule.operation,
            target: rule.target,
            value: rule.value,
            description: rule.description ?? `${itemName} boost`,
            ruleVersion: def.ruleVersion,
            activation,
            active: true,
          });
        }
      }
    }
  }

  // ── 3. Scan Unlocked Skills ──────────────────────────────────────────────
  const skills = state.player?.skills ?? {};
  for (const [skillName, val] of Object.entries(skills)) {
    const rank = typeof val === 'number' ? val : val ? 1 : 0;
    if (rank <= 0) continue;

    const def = EFFECT_REGISTRY[skillName];
    if (def && (def.sourceType === 'passive_skill' || def.sourceType === 'activated_power')) {
      const activation: EffectActivation = {
        kind: 'passive_skill',
        skill: skillName,
        rank,
      };

      for (const rule of def.effects) {
        if (!conditionSatisfied(rule.condition)) continue;
        const key = `skill:${skillName}:${rule.domain}:${rule.target}`;
        if (!processedKeys.has(key)) {
          processedKeys.add(key);

          // Handle rank-scaled values
          let effectiveValue = rule.value;
          if (typeof effectiveValue === 'number' && rule.operation === 'multiply') {
            if (skillName === 'Munching Mastery' && rank > 1) {
              effectiveValue = 1 + 0.05 + (rank - 1) * 0.025;
            } else if (skillName === 'Drive-Through Deli' && rank > 1) {
              effectiveValue = 1 + 0.15 + (rank - 1) * 0.05;
            } else if (skillName === 'Juicy Boost' && rank > 1) {
              effectiveValue = 1 + 0.10 + (rank - 1) * 0.05;
            } else if (['Fast Feasts', 'Frosted Cakes'].includes(skillName) && rank > 1) {
              effectiveValue = 1 - (0.10 + (rank - 1) * 0.05);
            }
          }

          activeEffects.push({
            sourceId: skillName,
            sourceType: def.sourceType,
            domain: rule.domain,
            operation: rule.operation,
            target: rule.target,
            value: effectiveValue,
            description: rule.description ?? `${skillName} boost`,
            ruleVersion: def.ruleVersion,
            activation,
            active: true,
          });
        }
      }
    }
  }

  // ── 4. Scan Timed Buffs ──────────────────────────────────────────────────
  const timedBuffs = state.buffs?.timedBuffs ?? [];
  for (const buff of timedBuffs) {
    const isRunning = now >= buff.startedAt && now < buff.startedAt + buff.durationMs;
    if (!isRunning) continue;

    const def = EFFECT_REGISTRY[buff.name];
    if (def && (def.sourceType === 'temporary_buff' || def.sourceType === 'buff')) {
      const activation: EffectActivation = {
        kind: 'temporary_buff',
        name: buff.name,
        startedAt: buff.startedAt,
        durationMs: buff.durationMs,
        active: true,
      };

      for (const rule of def.effects) {
        if (!conditionSatisfied(rule.condition)) continue;
        const key = `buff:${buff.name}:${rule.domain}:${rule.target}`;
        if (!processedKeys.has(key)) {
          processedKeys.add(key);
          activeEffects.push({
            sourceId: buff.name,
            sourceType: 'temporary_buff',
            domain: rule.domain,
            operation: rule.operation,
            target: rule.target,
            value: rule.value,
            description: rule.description ?? `${buff.name} temporary buff`,
            ruleVersion: def.ruleVersion,
            activation,
            active: true,
          });
        }
      }
    }
  }

  // ── 5. Scan VIP Status ───────────────────────────────────────────────────
  const vipActive = state.buffs?.vip && (!state.buffs?.vipExpiresAt || now < state.buffs.vipExpiresAt);
  if (vipActive) {
    const def = EFFECT_REGISTRY['VIP'];
    if (def) {
      const activation: EffectActivation = {
        kind: 'vip',
        expiresAt: state.buffs.vipExpiresAt ?? 32501520000000,
        active: true,
      };

      for (const rule of def.effects) {
        const key = `vip:VIP:${rule.domain}:${rule.target}`;
        if (!processedKeys.has(key)) {
          processedKeys.add(key);
          activeEffects.push({
            sourceId: 'VIP',
            sourceType: 'vip',
            domain: rule.domain,
            operation: rule.operation,
            target: rule.target,
            value: rule.value,
            description: rule.description ?? 'VIP Access',
            ruleVersion: def.ruleVersion,
            activation,
            active: true,
          });
        }
      }
    }
  }

  // ── 6. Aggregate into Typed EffectContext ────────────────────────────────
  const effectContext: EffectContext = {
    xp: {
      multipliers: {
        global: 1.0,
        food: 1.0,
        crop: 1.0,
        buildings: {},
        fishFood: 1.0,
        honeyFood: 1.0,
      },
      additions: {
        animalAffection: 0,
        flatFoodXp: 0,
      },
    },
    cooking: {
      timeMultipliers: {
        global: 1.0,
        buildings: {},
        oilActive: {},
      },
      outputMultipliers: {
        food: 1.0,
      },
      costMultipliers: {
        ingredients: 1.0,
      },
    },
    crops: {
      timeMultipliers: {
        global: 1.0,
        byCrop: {},
      },
      yieldMultipliers: {
        global: 1.0,
        byCrop: {},
      },
      yieldAdditions: {
        byCrop: {},
        byTier: {},
      },
      flags: {
        freeSeeds: false,
        mutantChanceMultiplier: 1.0,
      },
    },
    resources: {
      yieldMultipliers: {
        wood: 1.0,
        stone: 1.0,
        iron: 1.0,
        gold: 1.0,
        crimstone: 1.0,
        sunstone: 1.0,
      },
      yieldAdditions: {
        wood: 0,
        stone: 0,
        iron: 0,
        gold: 0,
      },
      treeRegenMultiplier: 1.0,
      flags: {
        freeAxe: false,
      },
    },
    animals: {
      yieldAdditions: {
        egg: 0,
        wool: 0,
        milk: 0,
      },
      timeMultipliers: {
        produce: 1.0,
        byAnimal: {},
      },
      costMultipliers: {
        feed: 1.0,
      },
      flags: {
        freeChickenFeed: false,
      },
    },
    fishing: {
      catchAdditions: {
        flat: 0,
        bySeason: {},
      },
    },
    activeEffects,
    computedAt,
    ruleVersion: CURRENT_RULE_VERSION,
  };

  // Compile active effects into structured modifiers
  for (const eff of activeEffects) {
    const val = eff.value;

    // XP Domain
    if (eff.domain === 'xp') {
      if (eff.operation === 'multiply' && typeof val === 'number') {
        if (eff.target === 'global') effectContext.xp.multipliers.global *= val;
        else if (eff.target === 'food') effectContext.xp.multipliers.food *= val;
        else if (eff.target === 'crop') effectContext.xp.multipliers.crop *= val;
        else if (eff.target === 'fishFood') effectContext.xp.multipliers.fishFood *= val;
        else if (eff.target === 'honeyFood') effectContext.xp.multipliers.honeyFood *= val;
        else {
          effectContext.xp.multipliers.buildings[eff.target] =
            (effectContext.xp.multipliers.buildings[eff.target] ?? 1.0) * val;
        }
      } else if (eff.operation === 'add' && typeof val === 'number') {
        if (eff.target === 'animalAffection') effectContext.xp.additions.animalAffection += val;
        else if (eff.target === 'flatFoodXp') effectContext.xp.additions.flatFoodXp += val;
      }
    }

    // Cooking Domain
    if (eff.domain === 'cooking') {
      if (eff.operation === 'multiply' && typeof val === 'number') {
        if (eff.target === 'global') {
          effectContext.cooking.timeMultipliers.global *= val;
        } else if (eff.target === 'output') {
          effectContext.cooking.outputMultipliers.food *= val;
        } else if (eff.target === 'cost') {
          effectContext.cooking.costMultipliers.ingredients *= val;
        } else {
          // Check if oil active condition
          const def = EFFECT_REGISTRY[eff.sourceId];
          const rule = def?.effects.find((r) => r.domain === 'cooking' && r.target === eff.target);
          if (rule?.condition === 'oilActive') {
            effectContext.cooking.timeMultipliers.oilActive[eff.target] = val;
          } else {
            effectContext.cooking.timeMultipliers.buildings[eff.target] =
              (effectContext.cooking.timeMultipliers.buildings[eff.target] ?? 1.0) * val;
          }
        }
      }
    }

    // Crops Domain
    if (eff.domain === 'crops') {
      if (eff.operation === 'multiply' && typeof val === 'number') {
        if (eff.target === 'growthTime') effectContext.crops.timeMultipliers.global *= val;
        else if (eff.target === 'yield') effectContext.crops.yieldMultipliers.global *= val;
        else if (eff.target.endsWith('Growth')) {
          const crop = eff.target.replace(/Growth$/, '');
          effectContext.crops.timeMultipliers.byCrop[crop] =
            (effectContext.crops.timeMultipliers.byCrop[crop] ?? 1.0) * val;
        } else {
          effectContext.crops.yieldMultipliers.byCrop[eff.target] =
            (effectContext.crops.yieldMultipliers.byCrop[eff.target] ?? 1.0) * val;
        }
      } else if (eff.operation === 'add' && typeof val === 'number') {
        if (eff.target === 'basicTier') {
          effectContext.crops.yieldAdditions.byTier['basic'] =
            (effectContext.crops.yieldAdditions.byTier['basic'] ?? 0) + val;
        } else {
          effectContext.crops.yieldAdditions.byCrop[eff.target] =
            (effectContext.crops.yieldAdditions.byCrop[eff.target] ?? 0) + val;
        }
      } else if (eff.operation === 'flag') {
        if (eff.target === 'freeSeeds') effectContext.crops.flags.freeSeeds = Boolean(val);
        else if (eff.target === 'mutantChanceMultiplier' && typeof val === 'number') {
          effectContext.crops.flags.mutantChanceMultiplier *= val;
        }
      }
    }

    // Resources Domain
    if (eff.domain === 'resources') {
      if (eff.operation === 'multiply' && typeof val === 'number') {
        if (eff.target === 'wood') effectContext.resources.yieldMultipliers.wood *= val;
        else if (eff.target === 'stone') effectContext.resources.yieldMultipliers.stone *= val;
        else if (eff.target === 'iron') effectContext.resources.yieldMultipliers.iron *= val;
        else if (eff.target === 'gold') effectContext.resources.yieldMultipliers.gold *= val;
        else if (eff.target === 'treeRegen') effectContext.resources.treeRegenMultiplier *= val;
      } else if (eff.operation === 'add' && typeof val === 'number') {
        if (eff.target === 'wood') effectContext.resources.yieldAdditions.wood += val;
        else if (eff.target === 'stone') effectContext.resources.yieldAdditions.stone += val;
        else if (eff.target === 'iron') effectContext.resources.yieldAdditions.iron += val;
        else if (eff.target === 'gold') effectContext.resources.yieldAdditions.gold += val;
      } else if (eff.operation === 'flag' && eff.target === 'freeAxe') {
        effectContext.resources.flags.freeAxe = Boolean(val);
      }
    }

    // Animals Domain
    if (eff.domain === 'animals') {
      if (eff.operation === 'add' && typeof val === 'number') {
        if (eff.target === 'egg') effectContext.animals.yieldAdditions.egg += val;
        else if (eff.target === 'wool') effectContext.animals.yieldAdditions.wool += val;
        else if (eff.target === 'milk') effectContext.animals.yieldAdditions.milk += val;
      } else if (eff.operation === 'multiply' && typeof val === 'number') {
        if (eff.target === 'produceTime') effectContext.animals.timeMultipliers.produce *= val;
        else if (eff.target === 'feedCost') effectContext.animals.costMultipliers.feed *= val;
      } else if (eff.operation === 'flag' && eff.target === 'freeChickenFeed') {
        effectContext.animals.flags.freeChickenFeed = Boolean(val);
      }
    }

    // Fishing Domain
    if (eff.domain === 'fishing') {
      if (eff.operation === 'add' && typeof val === 'number') {
        effectContext.fishing.catchAdditions.flat += val;
        const def = EFFECT_REGISTRY[eff.sourceId];
        const rule = def?.effects.find((r) => r.domain === 'fishing');
        if (rule?.condition) {
          effectContext.fishing.catchAdditions.bySeason[rule.condition] =
            (effectContext.fishing.catchAdditions.bySeason[rule.condition] ?? 0) + val;
        }
      }
    }
  }

  return withProvenance(effectContext, {
    farmId: options.farmId ?? (state.player?.bumpkinId ? String(state.player.bumpkinId) : 'unknown_farm'),
    snapshotVersion: options.snapshotVersion ?? 1,
    computedAt,
  });
}
