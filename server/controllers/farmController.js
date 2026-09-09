import { getFarm, getPrices } from '../services/sunflower.js';
import { plan } from '../services/planner.js';
import { expand, cost, list_recipes } from '../services/recipes.js';
import { effective } from '../services/xpEngine.js';
import { diffActivity } from '../services/activity.js';
import { Snapshot } from '../models/Snapshot.js';
import { User } from '../models/User.js';
import recipes from '../data/recipes.json' with { type: 'json' };
import items from '../data/items.json' with { type: 'json' };
import modifiers from '../data/modifiers.json' with { type: 'json' };

const L100 = 24083905;

export const farmController = {
  /**
   * Get farm data for the authenticated user
   */
  async getFarmData(req, res) {
    try {
      // Get user to check if they have a farm ID
      const user = await User.findById(req.userId);
      
      if (!user || !user.farm_id) {
        return res.status(400).json({
          success: false,
          error: 'No farm ID associated with your account. Please set your farm ID in settings.',
        });
      }

      // Get farm data from Sunflower Land API
      const { canonical, stale } = await getFarm(user.farm_id);

      // Save snapshot asynchronously (don't wait for it)
      Snapshot.create({
        userId: req.userId,
        createdAt: Date.now(),
        xp: canonical.bumpkin?.xp || 0,
        flower: canonical.balance || '0',
        coins: canonical.inventory?.Coins || 0,
        stateHash: JSON.stringify(canonical).slice(0, 64),
        dataJson: canonical,
      }).catch((err) => console.warn('Failed to save snapshot:', err.message));

      return res.json({
        ...canonical,
        stale,
        target: {
          level: 100,
          xp: L100,
          remaining: Math.max(L100 - (canonical.bumpkin?.xp || 0), 0),
        },
      });
    } catch (error) {
      console.error('Get farm error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch farm data',
      });
    }
  },

  /**
   * Get market prices (no user association needed)
   */
  async getMarket(req, res) {
    try {
      const { prices, updatedAt, stale } = await getPrices();

      return res.json({
        prices,
        items,
        updatedAt,
        stale,
      });
    } catch (error) {
      console.error('Get market error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch market data',
      });
    }
  },

  /**
   * Get optimized planner recommendations
   */
  async getPlanner(req, res) {
    try {
      const user = await User.findById(req.userId);
      
      if (!user || !user.farm_id) {
        return res.status(400).json({
          success: false,
          error: 'No farm ID associated with your account',
        });
      }

      // Get farm and prices in parallel
      const [{ canonical }, { prices }] = await Promise.all([
        getFarm(user.farm_id),
        getPrices(),
      ]);

      const planResult = plan(canonical, prices, recipes, items, modifiers);

      return res.json(planResult);
    } catch (error) {
      console.error('Get planner error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate plan',
      });
    }
  },

  /**
   * Get activity comparison between latest snapshots
   */
  async getActivity(req, res) {
    try {
      const snapshots = await Snapshot.getLatest(req.userId, 2);

      if (snapshots.length < 2) {
        return res.json({
          note: 'Need at least 2 snapshots. Refresh your farm data a couple of times after playing.',
        });
      }

      // Snapshots are ordered DESC, so reverse for diffActivity
      const activity = diffActivity(snapshots[1].data_json, snapshots[0].data_json);

      return res.json(activity);
    } catch (error) {
      console.error('Get activity error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch activity data',
      });
    }
  },

  /**
   * Get XP progression chart data
   */
  async getXpProgression(req, res) {
    try {
      const days = parseInt(req.query.days) || 7;
      const progression = await Snapshot.getXpProgression(req.userId, days);

      return res.json({
        success: true,
        progression,
      });
    } catch (error) {
      console.error('Get XP progression error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch XP progression',
      });
    }
  },
  /**
   * Get all recipes for the farm's active buildings,
   * with skill-adjusted XP / cook time, FLOWER cost, and cookability.
   */
  async getRecipes(req, res) {
    try {
      const user = await User.findById(req.userId);
      if (!user || !user.farm_id) {
        return res.status(400).json({ success: false, error: 'No farm ID associated with your account' });
      }

      const [{ canonical }, { prices }] = await Promise.all([
        getFarm(user.farm_id),
        getPrices().catch(() => ({ prices: {} })),
      ]);

      const activeBuildings = Object.keys(canonical.buildings ?? {});
      const inventory = canonical.inventory ?? {};

      // Get all applicable recipes with cookability flags
      const listed = list_recipes(recipes, activeBuildings, inventory);

      // Enrich each with skill-effective values + FLOWER cost
      const enriched = listed.map((r) => {
        const base = recipes[r.name];
        if (!base) return r;

        // Apply skill modifiers (cook time, XP, output, ingredient multiplier)
        const eff = effective(r.name, base, canonical, modifiers);

        // Recompute cookability against EFFECTIVE ingredient quantities
        const effIngredients = eff.effectiveIngredients;
        const effMissing = {};
        let effCanCook = true;
        for (const [ing, qty] of Object.entries(effIngredients)) {
          const have = Number(inventory[ing] ?? 0);
          if (have < qty) {
            effCanCook = false;
            effMissing[ing] = { need: qty, have, short: qty - have };
          }
        }

        // Expand to base resources and compute FLOWER cost
        const dep = expand(r.name, recipes, 0, eff.ingredientMultiplier ?? 1);
        const c = dep ? cost(dep.base, prices, items, inventory) : { flower: 0, totalFlower: 0, buy: {}, mustProduce: {}, unpriced: [] };

        // Total FLOWER market value of the recipe (intrinsic ingredient valuation)
        const totalFlowerVal = c.totalFlower > 0 ? c.totalFlower : c.flower;

        // How many of this food the farm already has in inventory
        const alreadyCooked = Number(inventory[r.name] ?? 0);

        return {
          ...r,
          // Skill-adjusted stats
          effectiveXp: +eff.xpPerFood.toFixed(4),
          effectiveOutput: eff.output,
          effectiveCookMinutes: +eff.minutes.toFixed(2),
          batchXp: +eff.batchXp.toFixed(4),
          ingredientMultiplier: eff.ingredientMultiplier,
          effectiveIngredients: effIngredients,
          skillsApplied: eff.applied,
          boostBreakdown: eff.boostBreakdown ?? [],
          // Cookability re-evaluated with effective ingredients
          canCook: effCanCook,
          missingIngredients: effMissing,
          // Cost & inventory
          flowerCost: +totalFlowerVal.toFixed(5),
          flowerToBuy: +c.flower.toFixed(5),
          buy: c.buy,
          mustProduce: c.mustProduce,
          baseResources: dep?.base ?? {},
          alreadyCooked,
        };
      });

      // Sort low → high by effective XP (per unit, skill-adjusted)
      enriched.sort((a, b) => (a.effectiveXp ?? a.baseXp) - (b.effectiveXp ?? b.baseXp));

      // Group by building (order within group already sorted by XP)

      const byBuilding = {};
      for (const r of enriched) {
        if (!byBuilding[r.building]) byBuilding[r.building] = [];
        byBuilding[r.building].push(r);
      }

      return res.json({
        activeBuildings,
        byBuilding,
        totalRecipes: enriched.length,
        pricesUpdatedAt: (await getPrices().catch(() => ({}))).updatedAt ?? null,
      });
    } catch (error) {
      console.error('Get recipes error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch recipe data' });
    }
  },
};
