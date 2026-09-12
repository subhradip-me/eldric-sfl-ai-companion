/**
 * server/tests/effectEngine.test.ts
 * Golden test suite for the Effect Resolution Engine.
 *
 * Verifies all frozen contracts and user invariants:
 * 1. Authoritative Activation Gate:
 *    - Unplaced collectibles in inventory produce NO effect.
 *    - Unequipped wearables produce NO effect.
 *    - Placed collectibles on island/interior produce active effects.
 *    - Equipped wearables produce active effects.
 * 2. Multi-Farm Divergence:
 *    - Farm A (Blossombeard + Desert Gnome) calculates boosted XP and faster cooking.
 *    - Farm B (Clean baseline) calculates standard base XP and normal cooking.
 * 3. Seasonal condition evaluation (e.g. Super Star in Winter vs Spring).
 * 4. Timed buffs temporal window evaluation (before, during, and after expiry).
 * 5. Domain-specific mathematical order of operations.
 * 6. Pure determinism and provenance encapsulation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEffectContext,
  calculateEffectiveCookTime,
  calculateEffectiveFoodXp,
  calculateEffectiveResourceYield,
  calculateEffectiveCropYield,
  calculateEffectiveAgingTime,
  calculateEffectiveAgingYield,
  calculateEffectiveAgingCost,
  calculateEffectivePrimeAgedChance,
  EFFECT_REGISTRY,
} from '../core/effectEngine/index.js';
import { FarmNormalizer } from '../services/farm/FarmNormalizer.js';
import { calculateFoodXp } from '../core/xpEngine/foodXp.js';
import { generateCandidates } from '../core/planner/candidateGenerator.js';
import { resolveCandidateIntent } from '../core/planner/candidateResolver.js';
import recipesData from '../data/recipes.json' with { type: 'json' };

describe('Phase 7: Pure Deterministic Effect Resolution Engine', () => {
  const normalizer = new FarmNormalizer();

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Authoritative Activation Gate: Placed vs Inventory
  // ─────────────────────────────────────────────────────────────────────────
  describe('Authoritative Activation Gate: Placed Collectibles vs Inventory', () => {
    it('unplaced collectible in inventory produces ZERO active effect', () => {
      // Farm holds Desert Gnome in inventory, but it is NOT placed on island or interior
      const rawFarm = {
        id: 1001,
        inventory: {
          'Desert Gnome': 1,
          Wood: 100,
        },
        collectibles: {}, // Empty island collectibles
        interior: { ground: { collectibles: {} } },
      };

      const normalized = normalizer.normalize(rawFarm, { farmId: '1001' }).normalizedState;
      const effectRes = resolveEffectContext(normalized, { now: 1700000000000 });

      assert.equal(effectRes.value.activeEffects.length, 0);
      assert.equal(effectRes.value.cooking.timeMultipliers.global, 1.0);
    });

    it('placed collectible on island with coordinates and instance ID activates boost', () => {
      // Farm has Desert Gnome placed on the island
      const rawFarm = {
        id: 1002,
        inventory: {
          'Desert Gnome': 1,
        },
        collectibles: {
          'Desert Gnome': [
            {
              id: 'gnome-island-1',
              coordinates: { x: 4, y: -2 },
              createdAt: 1690000000000,
            },
          ],
        },
      };

      const normalized = normalizer.normalize(rawFarm, { farmId: '1002' }).normalizedState;
      assert.equal(normalized.structures.placedCollectibles.length, 1);
      assert.equal(normalized.structures.placedCollectibles[0].name, 'Desert Gnome');
      assert.equal(normalized.structures.placedCollectibles[0].location, 'island');

      const effectRes = resolveEffectContext(normalized, { now: 1700000000000 });
      assert.equal(effectRes.value.activeEffects.length, 1);
      assert.equal(effectRes.value.activeEffects[0].sourceId, 'Desert Gnome');
      assert.equal(effectRes.value.activeEffects[0].activation.kind, 'placed');
      assert.equal(effectRes.value.cooking.timeMultipliers.global, 0.9); // -10% cooking time
    });

    it('placed collectible inside house interior activates boost', () => {
      // Farm has Desert Gnome placed in the home interior
      const rawFarm = {
        id: 1003,
        inventory: { 'Desert Gnome': 1 },
        interior: {
          ground: {
            collectibles: {
              'Desert Gnome': [
                {
                  id: 'gnome-interior-1',
                  coordinates: { x: 1, y: 1 },
                  createdAt: 1690000000000,
                },
              ],
            },
          },
        },
      };

      const normalized = normalizer.normalize(rawFarm, { farmId: '1003' }).normalizedState;
      assert.equal(normalized.structures.placedCollectibles.length, 1);
      assert.equal(normalized.structures.placedCollectibles[0].location, 'interior_ground');

      const effectRes = resolveEffectContext(normalized, { now: 1700000000000 });
      assert.equal(effectRes.value.cooking.timeMultipliers.global, 0.9);
    });

    it('removed collectible (removedAt present) produces ZERO effect', () => {
      const rawFarm = {
        id: 1004,
        collectibles: {
          'Desert Gnome': [
            {
              id: 'gnome-removed-1',
              coordinates: { x: 2, y: 3 },
              createdAt: 1690000000000,
              removedAt: 1695000000000, // Picked up/removed
            },
          ],
        },
      };

      const normalized = normalizer.normalize(rawFarm, { farmId: '1004' }).normalizedState;
      assert.equal(normalized.structures.placedCollectibles.length, 0);

      const effectRes = resolveEffectContext(normalized, { now: 1700000000000 });
      assert.equal(effectRes.value.activeEffects.length, 0);
      assert.equal(effectRes.value.cooking.timeMultipliers.global, 1.0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Authoritative Activation Gate: Wearables
  // ─────────────────────────────────────────────────────────────────────────
  describe('Authoritative Activation Gate: Wearables in Wardrobe vs Equipped', () => {
    it('wearable owned in wardrobe/inventory but not equipped produces ZERO effect', () => {
      const rawFarm = {
        id: 2001,
        inventory: { Blossombeard: 1 },
        wardrobe: { Blossombeard: 1 },
        bumpkin: {
          id: 501,
          equipped: { hat: 'Farmer Hat' }, // Blossombeard is NOT equipped
        },
      };

      const normalized = normalizer.normalize(rawFarm, { farmId: '2001' }).normalizedState;
      const effectRes = resolveEffectContext(normalized, { now: 1700000000000 });

      assert.equal(effectRes.value.activeEffects.length, 0);
      assert.equal(effectRes.value.xp.multipliers.food, 1.0);
    });

    it('wearable actively worn in bumpkin.equipped produces active boost', () => {
      const rawFarm = {
        id: 2002,
        bumpkin: {
          id: 502,
          equipped: {
            hat: 'Blossombeard',
          },
        },
      };

      const normalized = normalizer.normalize(rawFarm, { farmId: '2002' }).normalizedState;
      const effectRes = resolveEffectContext(normalized, { now: 1700000000000 });

      assert.equal(effectRes.value.activeEffects.length, 1);
      assert.equal(effectRes.value.activeEffects[0].sourceId, 'Blossombeard');
      assert.equal(effectRes.value.activeEffects[0].activation.kind, 'equipped');
      assert.equal(effectRes.value.xp.multipliers.food, 1.1); // +10% food XP
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Multi-Farm Divergence (The user's canonical case)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Multi-Farm Divergence: Farm A vs Farm B', () => {
    it('calculates divergent cooking time and XP for identical Pancakes recipe across Farm A and Farm B', () => {
      // Farm A: Blossombeard equipped (Food XP +10%) + Desert Gnome placed (Cooking time -10%)
      const farmA = normalizer.normalize(
        {
          id: 'farm-A',
          bumpkin: {
            id: 101,
            level: 30,
            experience: 100000,
            equipped: { hat: 'Blossombeard' },
          },
          collectibles: {
            'Desert Gnome': [{ id: 'dg-1', coordinates: { x: 1, y: 1 } }],
          },
        },
        { farmId: 'farm-A' }
      ).normalizedState;

      // Farm B: Clean baseline (No Blossombeard, no Desert Gnome)
      const farmB = normalizer.normalize(
        {
          id: 'farm-B',
          bumpkin: {
            id: 102,
            level: 30,
            experience: 100000,
            equipped: { hat: 'Farmer Hat' },
          },
          collectibles: {},
        },
        { farmId: 'farm-B' }
      ).normalizedState;

      const effectCtxA = resolveEffectContext(farmA, { now: 1700000000000, farmId: 'farm-A' }).value;
      const effectCtxB = resolveEffectContext(farmB, { now: 1700000000000, farmId: 'farm-B' }).value;

      // Base recipe: Pancakes (Base cook time = 20 mins, Base XP = 4000)
      const pancakesRecipe = recipesData['Pancakes'];
      assert.ok(pancakesRecipe, 'Pancakes recipe exists in recipesData');

      const xpResultA = calculateFoodXp({
        recipeName: 'Pancakes',
        recipe: pancakesRecipe,
        skills: farmA.player.skills,
        isVip: farmA.buffs.vip,
        effectContext: effectCtxA,
      });

      const xpResultB = calculateFoodXp({
        recipeName: 'Pancakes',
        recipe: pancakesRecipe,
        skills: farmB.player.skills,
        isVip: farmB.buffs.vip,
        effectContext: effectCtxB,
      });

      // Assert Farm A boosted metrics:
      // Cook time: 60 mins * 0.9 = 54 mins
      // XP: 1000 * 1.1 = 1100 XP
      assert.equal(xpResultA.value.minutes, 54);
      assert.equal(xpResultA.value.xpPerFood, 1100);

      // Assert Farm B baseline metrics:
      // Cook time: 60 mins
      // XP: 1000 XP
      assert.equal(xpResultB.value.minutes, 60);
      assert.equal(xpResultB.value.xpPerFood, 1000);

      // Complete isolation: Farm A metrics do NOT bleed into Farm B
      assert.notEqual(xpResultA.value.minutes, xpResultB.value.minutes);
      assert.notEqual(xpResultA.value.xpPerFood, xpResultB.value.xpPerFood);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Timed Buffs Window Evaluation
  // ─────────────────────────────────────────────────────────────────────────
  describe('Timed Buffs Window Evaluation', () => {
    it('buff is active strictly inside [startedAt, startedAt + durationMs)', () => {
      const startedAt = 1700000000000;
      const durationMs = 3600000; // 1 hour

      const rawFarm = {
        id: 3001,
        buffs: {
          'Power hour': {
            startedAt,
            durationMS: durationMs,
          },
        },
      };

      const normalized = normalizer.normalize(rawFarm, { farmId: '3001' }).normalizedState;

      // Case 1: Before start (now < startedAt) -> inactive
      const beforeRes = resolveEffectContext(normalized, { now: startedAt - 1000 }).value;
      assert.equal(beforeRes.cooking.timeMultipliers.global, 1.0);

      // Case 2: During window (now = startedAt + 1000) -> active (0.5x cooking time)
      const duringRes = resolveEffectContext(normalized, { now: startedAt + 1000 }).value;
      assert.equal(duringRes.cooking.timeMultipliers.global, 0.5);
      assert.equal(duringRes.activeEffects[0].sourceId, 'Power hour');

      // Case 3: After window (now >= startedAt + durationMs) -> expired/inactive
      const afterRes = resolveEffectContext(normalized, { now: startedAt + durationMs + 1000 }).value;
      assert.equal(afterRes.cooking.timeMultipliers.global, 1.0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Seasonal Condition Gate
  // ─────────────────────────────────────────────────────────────────────────
  describe('Seasonal Condition Gate', () => {
    it('Super Star collectible activates +1 Fish catch ONLY during Winter', () => {
      const rawFarm = {
        id: 4001,
        collectibles: {
          'Super Star': [{ id: 'star-1', coordinates: { x: 0, y: 0 } }],
        },
      };

      const normalized = normalizer.normalize(rawFarm, { farmId: '4001' }).normalizedState;

      assert.equal(normalized.structures.placedCollectibles.length, 1);

      // Spring: Not winter -> boost NOT active
      const springRes = resolveEffectContext(normalized, { now: 1700000000000, season: 'Spring' }).value;
      assert.equal(springRes.activeEffects.length, 0);
      assert.equal(springRes.fishing.catchAdditions.flat, 0);

      // Winter: Active -> +1 Fish catch
      const winterRes = resolveEffectContext(normalized, { now: 1700000000000, season: 'Winter' }).value;
      assert.equal(winterRes.activeEffects.length, 1);
      const eff = winterRes.activeEffects[0];
      assert.equal(eff.sourceId, 'Super Star');
      assert.equal(eff.domain, 'fishing');
      assert.equal(eff.operation, 'add');
      assert.equal(eff.target, 'catch');
      assert.equal(eff.value, 1);
      assert.equal(winterRes.fishing.catchAdditions.flat, 1);
      assert.equal(winterRes.fishing.catchAdditions.bySeason['Winter'], 1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Domain-Specific Mathematical Order of Operations
  // ─────────────────────────────────────────────────────────────────────────
  describe('Domain-Specific Mathematical Order of Operations', () => {
    it('calculates cooking time via base * product(multipliers)', () => {
      // 20 mins * 0.9 (Desert Gnome) * 0.85 (Swift Sizzle) = 15.3 mins
      const time = calculateEffectiveCookTime(20, [0.9, 0.85]);
      assert.equal(time, 15.3);
    });

    it('calculates food XP via base * product(multipliers) + additions', () => {
      // 1000 base * 1.1 (Blossombeard) * 1.05 (Munching Mastery) + 100 flat = 1255 XP
      const xp = calculateEffectiveFoodXp(1000, [1.1, 1.05], [100]);
      assert.equal(xp, 1255);
    });

    it('calculates resource yield via base * product(multipliers) + additions', () => {
      // 5 wood * 1.2 (Woody Beaver) + 0.1 (Tiki Totem) = 6.1 wood
      const wood = calculateEffectiveResourceYield(5, [1.2], [0.1]);
      assert.equal(wood, 6.1);
    });

    it('calculates crop yield via base * product(multipliers) + additions', () => {
      // 1 cauliflower * 2.0 (Golden Cauliflower) + 0.25 (Victoria Sisters) = 2.25
      const yieldAmt = calculateEffectiveCropYield(1, [2.0], [0.25]);
      assert.equal(yieldAmt, 2.25);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Planner Sensitivity: Strategic Candidate Generation & Resolution
  // ─────────────────────────────────────────────────────────────────────────
  describe('Planner Sensitivity: Candidate Generation & Resolution', () => {
    it('generateCandidates produces boosted duration and XP for Farm A', () => {
      const farmA = normalizer.normalize(
        {
          id: 'farm-planner-A',
          bumpkin: {
            id: 801,
            level: 30,
            experience: 100000,
            equipped: { hat: 'Blossombeard' },
          },
          collectibles: {
            'Desert Gnome': [{ id: 'gnome-p-1', coordinates: { x: 0, y: 0 } }],
          },
          inventory: {
            Wheat: 50,
            Honey: 20,
            Egg: 20,
          },
          buildings: {
            Kitchen: [{ readyAt: null, crafting: [] }],
          },
        },
        { farmId: 'farm-planner-A' }
      ).normalizedState;

      const effectCtxA = resolveEffectContext(farmA, { now: 1700000000000 }).value;

      const candidates = generateCandidates({
        goal: {
          goalId: 'goal-p1',
          farmId: 'farm-planner-A',
          status: 'ACTIVE',
          objective: 'MAXIMIZE_XP',
          target: {},
          constraints: {},
          preferences: {},
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
        state: farmA,
        recipes: recipesData as unknown as Record<string, import('../domain/index.js').RecipeDefinition>,
        effectContext: effectCtxA,
      });

      const pancakesCand = candidates.find((c) => c.title.includes('Pancakes'));
      assert.ok(pancakesCand, 'Found Pancakes candidate in generated candidates');
      assert.equal(pancakesCand.estimatedDurationMinutes, 54, 'Pancakes duration is boosted to 54 mins (-10%)');
      const cookAction = pancakesCand.targetActions?.find((a) => a.type === 'COOK');
      assert.equal(cookAction?.estimatedXpGain, 1100, 'Pancakes XP is boosted to 1100 (+10%)');
    });

    it('resolveCandidateIntent accurately resolves boosted parameters under effectContext', () => {
      const farmA = normalizer.normalize(
        {
          id: 'farm-cand-A',
          bumpkin: { id: 802, level: 30, experience: 100000, equipped: { hat: 'Blossombeard' } },
          collectibles: { 'Desert Gnome': [{ id: 'dg-2', coordinates: { x: 1, y: 1 } }] },
          inventory: { Wheat: 100, Honey: 50, Egg: 50 },
          buildings: { Kitchen: [{ readyAt: null, crafting: [] }] },
        },
        { farmId: 'farm-cand-A' }
      ).normalizedState;

      const effectCtxA = resolveEffectContext(farmA, { now: 1700000000000 }).value;

      const candidate = resolveCandidateIntent({
        target: 'Pancakes',
        quantity: 2,
        intent: 'RECIPE',
        state: farmA,
        recipes: recipesData as unknown as Record<string, import('../domain/index.js').RecipeDefinition>,
        prices: { Wheat: 0.1, Honey: 0.5, Egg: 0.3 },
        effectContext: effectCtxA,
      });

      assert.equal(candidate.estimatedDurationMinutes, 108, '2 Pancakes take 108 mins (54m each)');
      const cookAction = candidate.targetActions?.find((a) => a.type === 'COOK');
      assert.equal(cookAction?.estimatedXpGain, 2200, '2 Pancakes yield 2200 XP (1100 each)');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Pure Determinism and Provenance
  // ─────────────────────────────────────────────────────────────────────────
  describe('Pure Determinism and Provenance', () => {
    it('produces identical EffectContext across multiple calls with identical inputs', () => {
      const farm = normalizer.normalize(
        {
          id: 'farm-det-1',
          bumpkin: { id: 99, level: 20, experience: 20000, equipped: { hat: 'Blossombeard' } },
          collectibles: { 'Desert Gnome': [{ id: 'gnome-det', coordinates: { x: 0, y: 0 } }] },
        },
        { farmId: 'farm-det-1' }
      ).normalizedState;

      const fixedTime = 1700000000000;
      const res1 = resolveEffectContext(farm, { now: fixedTime, farmId: 'farm-det-1' });
      const res2 = resolveEffectContext(farm, { now: fixedTime, farmId: 'farm-det-1' });

      assert.deepEqual(res1.value, res2.value);
      assert.deepEqual(res1.provenance, res2.provenance);
      assert.equal(res1.provenance.farmId, 'farm-det-1');
      assert.equal(res1.provenance.computedAt, fixedTime);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Aging Shed & Processing Effects Resolution
  // ─────────────────────────────────────────────────────────────────────────
  describe('Aging Shed & Processing Effects Resolution', () => {
    it('resolves default neutral processing context when no aging skills or buffs are active', () => {
      const farm = normalizer.normalize(
        {
          id: 'farm-aging-baseline',
          bumpkin: { id: 1, level: 1, experience: 0, skills: {} },
        },
        { farmId: 'farm-aging-baseline' }
      ).normalizedState;

      const effectRes = resolveEffectContext(farm);
      const proc = effectRes.value.processing;

      assert.equal(proc.agingTimeMultipliers.fishAging, 1.0);
      assert.equal(proc.agingTimeMultipliers.global, 1.0);
      assert.equal(proc.agingYieldMultipliers.output, 1.0);
      assert.equal(proc.agingYieldMultipliers.ingredientCost, 1.0);
      assert.equal(proc.primeAgedChanceMultiplier, 1.0);
      assert.equal(proc.fermentationYieldAdditions, 0);
      assert.equal(proc.saltBonus.refinedSaltChance, 0);
      assert.equal(proc.saltBonus.saltPerHarvest, 0);
      assert.equal(proc.saltBonus.chargeReplenishTimeMultiplier, 1.0);
      assert.equal(proc.saltBonus.rakeCostMultiplier, 1.0);
      assert.equal(proc.saltBonus.restore1ChargeChance, 0);
      assert.equal(proc.saltBonus.saltSurgeUnlocked, false);
      assert.equal(proc.compostTimeMultiplier, 1.0);
      assert.equal(proc.compostYieldAdditions.worm, 0);
      assert.equal(proc.compostYieldAdditions.fertiliser, 0);
    });

    it('resolves Speedy Aging, Fish Smoking, and Bacalhau passive skills', () => {
      const farm = normalizer.normalize(
        {
          id: 'farm-aging-skills',
          bumpkin: {
            id: 2,
            level: 30,
            experience: 50000,
            skills: {
              'Speedy Aging': 1,
              'Fish Smoking': 1,
              'Bacalhau': 1,
            },
          },
        },
        { farmId: 'farm-aging-skills' }
      ).normalizedState;

      const effectRes = resolveEffectContext(farm);
      const proc = effectRes.value.processing;

      assert.equal(proc.agingTimeMultipliers.fishAging, 0.9, 'Speedy Aging should reduce fish aging time to 0.9x');
      assert.equal(proc.primeAgedChanceMultiplier, 2.0, 'Fish Smoking should double prime aged chance to 2.0x');
      assert.equal(proc.fermentationYieldAdditions, 1, 'Bacalhau should add +1 to fermentation yield');

      // Verify calculation operations
      const baseMinutes = 80;
      const effectiveMinutes = calculateEffectiveAgingTime(baseMinutes, [proc.agingTimeMultipliers.fishAging]);
      assert.equal(effectiveMinutes, 72, '80 minutes * 0.9 = 72 minutes');

      const effectivePrimeChance = calculateEffectivePrimeAgedChance(0.15, proc.primeAgedChanceMultiplier);
      assert.equal(effectivePrimeChance, 0.30, '15% chance * 2.0 = 30% chance');

      const effectiveFermYield = calculateEffectiveAgingYield(1, 1.0, proc.fermentationYieldAdditions);
      assert.equal(effectiveFermYield, 2, '1 base yield + 1 Bacalhau bonus = 2 output');
    });

    it('resolves Ager skill with 2x output multiplier and 2x ingredient cost multiplier', () => {
      const farm = normalizer.normalize(
        {
          id: 'farm-ager',
          bumpkin: {
            id: 3,
            level: 40,
            experience: 100000,
            skills: {
              'Ager': 1,
            },
          },
        },
        { farmId: 'farm-ager' }
      ).normalizedState;

      const effectRes = resolveEffectContext(farm);
      const proc = effectRes.value.processing;

      assert.equal(proc.agingYieldMultipliers.output, 2.0, 'Ager should double aging output');
      assert.equal(proc.agingYieldMultipliers.ingredientCost, 2.0, 'Ager should double aging ingredient cost');

      const baseFishOutput = 1;
      const baseSaltRequired = 12;
      const boostedOutput = calculateEffectiveAgingYield(baseFishOutput, proc.agingYieldMultipliers.output);
      const boostedCost = calculateEffectiveAgingCost(baseSaltRequired, proc.agingYieldMultipliers.ingredientCost);

      assert.equal(boostedOutput, 2, '1 fish * 2 = 2 fish');
      assert.equal(boostedCost, 24, '12 salt * 2 = 24 salt');
    });

    it('resolves Salt bonuses (Refiner, Wide Rakes, Salty Seas, Cheap Rakes, Sea Blessed, Salt Surge)', () => {
      const farm = normalizer.normalize(
        {
          id: 'farm-salt-master',
          bumpkin: {
            id: 4,
            level: 50,
            experience: 200000,
            skills: {
              'Refiner': 1,
              'Wide Rakes': 1,
              'Salty Seas': 1,
              'Cheap Rakes': 1,
              'Sea Blessed': 1,
              'Salt Surge': 1,
            },
          },
        },
        { farmId: 'farm-salt-master' }
      ).normalizedState;

      const effectRes = resolveEffectContext(farm);
      const salt = effectRes.value.processing.saltBonus;

      assert.equal(salt.refinedSaltChance, 0.15, 'Refiner gives 15% refined salt chance');
      assert.equal(salt.saltPerHarvest, 2, 'Wide Rakes gives +2 salt per harvest');
      assert.equal(salt.chargeReplenishTimeMultiplier, 0.90, 'Salty Seas gives -10% replenish time');
      assert.equal(salt.rakeCostMultiplier, 0.80, 'Cheap Rakes gives -20% coin cost');
      assert.equal(salt.restore1ChargeChance, 0.05, 'Sea Blessed gives 5% chance');
      assert.equal(salt.saltSurgeUnlocked, true, 'Salt Surge unlocks max node recharge');
    });

    it('placed Salt Sculpture activates aging time reduction and salt per harvest bonus', () => {
      const farm = normalizer.normalize(
        {
          id: 'farm-salt-sculpture',
          bumpkin: { id: 5, level: 10, experience: 5000, skills: {} },
          collectibles: {
            'Salt Sculpture': [
              { id: 'salt-sculpt-1', coordinates: { x: 2, y: 1 } },
            ],
          },
        },
        { farmId: 'farm-salt-sculpture' }
      ).normalizedState;

      const effectRes = resolveEffectContext(farm);
      const proc = effectRes.value.processing;

      assert.equal(proc.agingTimeMultipliers.fishAging, 0.95, 'Placed Salt Sculpture provides 0.95x aging time');
      assert.equal(proc.saltBonus.saltPerHarvest, 1, 'Placed Salt Sculpture provides +1 salt per harvest');
    });

    it('unplaced Salt Sculpture in inventory produces ZERO processing effect', () => {
      const farm = normalizer.normalize(
        {
          id: 'farm-salt-sculpture-inventory',
          bumpkin: { id: 6, level: 10, experience: 5000, skills: {} },
          inventory: { 'Salt Sculpture': 1 },
          collectibles: {},
        },
        { farmId: 'farm-salt-sculpture-inventory' }
      ).normalizedState;

      const effectRes = resolveEffectContext(farm);
      const proc = effectRes.value.processing;

      assert.equal(proc.agingTimeMultipliers.fishAging, 1.0, 'Unplaced Salt Sculpture produces no aging boost');
      assert.equal(proc.saltBonus.saltPerHarvest, 0, 'Unplaced Salt Sculpture produces no salt harvest boost');
    });
  });
});
