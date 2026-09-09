/**
 * FarmController — Express HTTP handlers for farm routes.
 * Composes SunflowerClient, PlannerService, RecipeService, XpEngine, SnapshotService, ActivityService.
 */
import type { Request, Response } from 'express';
import { sunflowerClient, snapshotService, activityService } from '../services/farm/index.js';
import { plannerService, recipeService, xpEngine } from '../services/cooking/index.js';
import { UserModel } from '../models/UserModel.js';
import recipes from '../data/recipes.json' with { type: 'json' };
import items from '../data/items.json' with { type: 'json' };
import modifiers from '../data/modifiers.json' with { type: 'json' };

const L100 = 24_083_905;

type AuthReq = Request & { userId: number };

export class FarmController {
  private userModel = new UserModel();

  /** GET /api/farm — canonical farm state for the authenticated user */
  async getFarmData(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const user = await this.userModel.findById(userId);

      if (!user || !user.farm_id) {
        res.status(400).json({ success: false, error: 'No farm ID associated with your account. Please set your farm ID in settings.' });
        return;
      }

      const { canonical, stale } = await sunflowerClient.getFarm(user.farm_id);

      // Save snapshot asynchronously (fire-and-forget)
      snapshotService.save(canonical, userId).catch((err) =>
        console.warn('Failed to save snapshot:', (err as Error).message)
      );

      res.json({
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
      res.status(500).json({ success: false, error: 'Failed to fetch farm data' });
    }
  }

  /** GET /api/farm/market — live P2P market prices */
  async getMarket(_req: Request, res: Response): Promise<void> {
    try {
      const { prices, updatedAt, stale } = await sunflowerClient.getPrices();
      res.json({ prices, items, updatedAt, stale });
    } catch (error) {
      console.error('Get market error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch market data' });
    }
  }

  /** GET /api/farm/planner — optimised per-building cooking plan */
  async getPlanner(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const user = await this.userModel.findById(userId);

      if (!user || !user.farm_id) {
        res.status(400).json({ success: false, error: 'No farm ID associated with your account' });
        return;
      }

      const [{ canonical }, { prices }] = await Promise.all([
        sunflowerClient.getFarm(user.farm_id),
        sunflowerClient.getPrices(),
      ]);

      const planResult = plannerService.plan(canonical, prices, recipes, items, modifiers);
      res.json(planResult);
    } catch (error) {
      console.error('Get planner error:', error);
      res.status(500).json({ success: false, error: 'Failed to generate plan' });
    }
  }

  /** GET /api/farm/activity — diff between the last two snapshots */
  async getActivity(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const snapshots = await snapshotService.getLatest(userId, 2);

      if (snapshots.length < 2) {
        res.json({ note: 'Need at least 2 snapshots. Refresh your farm data a couple of times after playing.' });
        return;
      }

      // Snapshots are DESC; reverse for diffActivity (prev, curr)
      const activity = activityService.diff(snapshots[1].data_json, snapshots[0].data_json);
      res.json(activity);
    } catch (error) {
      console.error('Get activity error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch activity data' });
    }
  }

  /** GET /api/farm/xp?days=N — XP progression time-series */
  async getXpProgression(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const days = parseInt((req.query['days'] as string) || '7', 10) || 7;
      const progression = await snapshotService.getXpProgression(userId, days);
      res.json({ success: true, progression });
    } catch (error) {
      console.error('Get XP progression error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch XP progression' });
    }
  }

  /** GET /api/farm/recipes — all recipes with skill-adjusted stats and FLOWER cost */
  async getRecipes(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const user = await this.userModel.findById(userId);

      if (!user || !user.farm_id) {
        res.status(400).json({ success: false, error: 'No farm ID associated with your account' });
        return;
      }

      const [{ canonical }, { prices }] = await Promise.all([
        sunflowerClient.getFarm(user.farm_id),
        sunflowerClient.getPrices().catch(() => ({ prices: {} as Record<string, number>, updatedAt: null, stale: false })),
      ]);

      const activeBuildings = Object.keys(canonical.buildings ?? {});
      const inventory = canonical.inventory ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listed = recipeService.listRecipes(recipes as any, activeBuildings, inventory);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enriched: any[] = listed.map((r) => {
        const base = (recipes as Record<string, unknown>)[r.name] as import('../types/index.js').RecipeDefinition | undefined;
        if (!base) return r;

        const eff = xpEngine.effective(r.name, base, canonical, modifiers);
        const dep = recipeService.expand(r.name, recipes as unknown as Parameters<typeof recipeService.expand>[1], 0, eff.ingredientMultiplier ?? 1);
        const c = recipeService.cost(dep.base, prices, items as Parameters<typeof recipeService.cost>[2], inventory);
        const totalFlowerVal = c.totalFlower > 0 ? c.totalFlower : c.flower;

        const effMissing: Record<string, { need: number; have: number; short: number }> = {};
        let effCanCook = true;
        for (const [ing, qty] of Object.entries(eff.effectiveIngredients)) {
          const have = Number(inventory[ing] ?? 0);
          if (have < qty) {
            effCanCook = false;
            effMissing[ing] = { need: qty, have, short: qty - have };
          }
        }

        return {
          ...r,
          effectiveXp: +eff.xpPerFood.toFixed(4),
          effectiveOutput: eff.output,
          effectiveCookMinutes: +eff.minutes.toFixed(2),
          batchXp: +eff.batchXp.toFixed(4),
          ingredientMultiplier: eff.ingredientMultiplier,
          effectiveIngredients: eff.effectiveIngredients,
          skillsApplied: eff.applied,
          boostBreakdown: eff.boostBreakdown ?? [],
          canCook: effCanCook,
          missingIngredients: effMissing,
          flowerCost: +totalFlowerVal.toFixed(5),
          flowerToBuy: +c.flower.toFixed(5),
          buy: c.buy,
          mustProduce: c.mustProduce,
          baseResources: dep?.base ?? {},
          alreadyCooked: Number(inventory[r.name] ?? 0),
        };
      });

      enriched.sort((a, b) => (Number(a.effectiveXp ?? a.baseXp ?? 0)) - (Number(b.effectiveXp ?? b.baseXp ?? 0)));

      const byBuilding: Record<string, typeof enriched> = {};
      for (const r of enriched) {
        if (!byBuilding[r.building]) byBuilding[r.building] = [];
        byBuilding[r.building].push(r);
      }

      const pricesUpdatedAt = await sunflowerClient.getPrices().catch(() => ({ updatedAt: null }));
      res.json({ activeBuildings, byBuilding, totalRecipes: enriched.length, pricesUpdatedAt: pricesUpdatedAt.updatedAt ?? null });
    } catch (error) {
      console.error('Get recipes error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch recipe data' });
    }
  }
}

export const farmController = new FarmController();
