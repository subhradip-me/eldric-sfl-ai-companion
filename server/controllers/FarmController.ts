/**
 * FarmController — Express HTTP handlers for farm routes.
 * Composes SunflowerClient, PlannerService, RecipeService, XpEngine, SnapshotService, ActivityService.
 */
import type { Request, Response } from 'express';
import { sunflowerClient, snapshotService, activityService, farmNormalizer, dashboardService } from '../services/farm/index.js';
import { hotStore } from '../storage/index.js';
import { summarizeActiveProduction, calculateFoodXp, resolveEffectContext } from '../core/index.js';
import { plannerService, recipeService, xpEngine } from '../services/cooking/index.js';
import { UserModel } from '../models/UserModel.js';
import recipes from '../data/recipes.json' with { type: 'json' };
import items from '../data/items.json' with { type: 'json' };
import modifiers from '../data/modifiers.json' with { type: 'json' };

const L100 = 24_083_905;

type AuthReq = Request & { userId: number };

export class FarmController {
  private userModel = new UserModel();

  private resolveFarmId(req: Request, user: { username?: string; farm_id: string | null } | null): { farmId: string | null; isDevOverride: boolean } {
    const isDevUser = user?.username === 'dev';
    const devHeader = (req.headers['x-dev-farm-id'] as string | undefined)?.trim();
    if (isDevUser && devHeader) {
      return { farmId: devHeader, isDevOverride: true };
    }
    return { farmId: user?.farm_id ?? null, isDevOverride: false };
  }

  /** GET /api/farm — canonical farm state for the authenticated user (supports x-dev-farm-id override for dev account) */
  async getFarmData(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const user = await this.userModel.findById(userId);
      const { farmId, isDevOverride } = this.resolveFarmId(req, user);

      if (!farmId) {
        res.status(400).json({ success: false, error: 'No farm ID associated with your account. Please set your farm ID in settings.' });
        return;
      }

      const force = req.query['force'] === 'true';
      const { canonical, raw, stale } = await sunflowerClient.getFarm(farmId, force);

      // Phase 2: Loss-aware normalization & diagnostics
      const normResult = farmNormalizer.normalize(raw || canonical, {
        farmId,
        source: isDevOverride ? 'dev-override' : 'community-api',
      });

      // Phase 1: Deterministic active production yield summary
      const prodSummary = summarizeActiveProduction({
        items: normResult.normalizedState.production.active,
        now: Date.now(),
        farmId,
      });

      // Commit live farm state directly to Redis Hot Store
      const nowMs = Date.now();
      hotStore.commit({
        farmId,
        snapshotVersion: nowMs,
        state: normResult.normalizedState,
        updatedAt: nowMs,
        syncStatus: 'SUCCESS',
      }).catch((err) => console.warn('Failed to commit to hotStore:', (err as Error).message));

      if (raw) {
        hotStore.setRaw(farmId, raw).catch(() => {});
      }

      // Save snapshot only if not a dev override or if running under dev user
      if (!isDevOverride || user?.username === 'dev') {
        await snapshotService.save(raw || canonical, userId).catch((err) =>
          console.warn('Failed to save snapshot:', (err as Error).message)
        );
      }

      // Deterministic dashboard view model across all 6 categories
      const dashboard = dashboardService.build(
        normResult.normalizedState,
        canonical,
        prodSummary.value,
        normResult.rawHash
      );

      const L100 = 23073000;
      res.json({
        ...canonical,
        stale,
        isDevOverride,
        effectiveFarmId: farmId,
        normalized: normResult.normalizedState,
        rawHash: normResult.rawHash,
        diagnostics: normResult.diagnostics,
        production: normResult.normalizedState.production,
        activeProduction: prodSummary.value,
        provenance: prodSummary.provenance,
        dashboard,
        target: {
          level: 100,
          xp: L100,
          remaining: Math.max(L100 - (canonical.bumpkin?.xp || 0), 0),
        },
      });
    } catch (error) {
      console.error('Get farm data error:', error);
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

  /** GET /api/farm/planner — optimised per-building cooking plan (supports x-dev-farm-id override) */
  async getPlanner(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const user = await this.userModel.findById(userId);
      const { farmId } = this.resolveFarmId(req, user);

      if (!farmId) {
        res.status(400).json({ success: false, error: 'No farm ID associated with your account' });
        return;
      }

      const [{ canonical, raw }, { prices }] = await Promise.all([
        sunflowerClient.getFarm(farmId),
        sunflowerClient.getPrices(),
      ]);

      const normResult = farmNormalizer.normalize(raw || canonical, {
        farmId,
        source: 'community-api',
      });
      const effectRes = resolveEffectContext(normResult.normalizedState, {
        now: Date.now(),
        season: normResult.normalizedState.temporal?.season,
        farmId,
      });

      const planResult = plannerService.plan(canonical, prices, recipes, items, modifiers, effectRes.value);
      res.json(planResult);
    } catch (error) {
      console.error('Get planner error:', error);
      res.status(500).json({ success: false, error: 'Failed to generate plan' });
    }
  }

  /** GET /api/farm/activity — diff between the last two snapshots, with live FLOWER valuation */
  async getActivity(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const snapshots = await snapshotService.getLatest(userId, 2);

      // Always return structured data, even with insufficient snapshots
      if (snapshots.length < 2) {
        res.json({
          success: true,
          hasEnoughData: false,
          note: 'Need at least 2 snapshots. Visit your farm tab to capture your first snapshot, then return after playing.',
          observed: {},
          inferred: {},
          xpDelta: 0,
          valuation: { perItem: {}, totalFlower: 0, pricesUsed: {} },
        });
        return;
      }

      // Snapshots are DESC; snapshots[1] = older, snapshots[0] = newer
      const diff = activityService.diff(snapshots[1], snapshots[0]);

      // Attach live FLOWER valuation
      let prices: Record<string, number> = {};
      try {
        const market = await sunflowerClient.getPrices();
        prices = market.prices ?? {};
      } catch {
        // Fall through — valuation will use zero prices
      }

      const valued = activityService.valuate(diff, prices);
      res.json({ success: true, hasEnoughData: true, ...valued });
    } catch (error) {
      console.error('Get activity error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch activity data' });
    }
  }

  /** GET /api/farm/activity/daily?days=7 — daily production summary with live FLOWER valuation */
  async getDailyProduction(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const days = Math.min(parseInt((req.query['days'] as string) || '7', 10) || 7, 30);

      // Fetch enough snapshots to cover the requested window (up to 100)
      const snapshots = await snapshotService.getLatest(userId, 100);

      if (snapshots.length < 2) {
        res.json({
          success: true,
          hasEnoughData: false,
          note: 'Capture at least 2 farm snapshots to see daily production trends.',
          days: [],
          totals: { totalFlower: 0, totalXp: 0, topItems: [] },
        });
        return;
      }

      // Filter to the requested day window
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const inWindow = snapshots.filter((s) => Number(s.created_at) >= cutoff);
      // Always include at least the 2 most recent to allow diffing
      const toProcess = inWindow.length >= 2 ? inWindow : snapshots.slice(0, 2);

      // Fetch live prices, fall back gracefully
      let prices: Record<string, number> = {};
      try {
        const market = await sunflowerClient.getPrices();
        prices = market.prices ?? {};
      } catch {
        // Zero prices — valuation will show 0 but structure is intact
      }

      const summary = activityService.dailySummary(toProcess, prices);
      res.json({ success: true, hasEnoughData: true, ...summary });
    } catch (error) {
      console.error('Get daily production error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch daily production data' });
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

  /** GET /api/farm/recipes — all recipes with skill-adjusted stats and FLOWER cost (supports x-dev-farm-id override) */
  async getRecipes(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const user = await this.userModel.findById(userId);
      const { farmId } = this.resolveFarmId(req, user);

      if (!farmId) {
        res.status(400).json({ success: false, error: 'No farm ID associated with your account' });
        return;
      }

      const [{ canonical, raw }, { prices, updatedAt: pricesUpdatedAt }] = await Promise.all([
        sunflowerClient.getFarm(farmId),
        sunflowerClient.getPrices().catch(() => ({ prices: {} as Record<string, number>, updatedAt: null, stale: false })),
      ]);

      const activeBuildings = Object.keys(canonical.buildings ?? {});
      const inventory = canonical.inventory ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listed = recipeService.listRecipes(recipes as any, activeBuildings, inventory);

      // Phase 2: Loss-aware normalization
      const normResult = farmNormalizer.normalize(raw || canonical, {
        farmId,
        source: 'community-api',
      });
      const normState = normResult.normalizedState;

      // Phase 7: Authoritative Effect Context resolution (placed collectibles, equipped wearables, skills, timed buffs, VIP)
      const effectRes = resolveEffectContext(normState, {
        now: Date.now(),
        season: normState.temporal?.season,
        farmId,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enriched: any[] = listed.map((r) => {
        const base = (recipes as Record<string, unknown>)[r.name] as import('../types/index.js').RecipeDefinition | undefined;
        if (!base) return r;

        const bldOil = normState.structures.buildings[r.building]?.[0]?.oil ?? (canonical.buildings?.[r.building]?.oil ?? 0);

        const foodXpResult = calculateFoodXp({
          recipeName: r.name,
          recipe: base,
          skills: normState.player.skills,
          isVip: normState.buffs.vip,
          buildingOil: bldOil,
          effectContext: effectRes.value,
          farmId: farmId ?? undefined,
        });
        const eff = foodXpResult.value;
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

      res.json({ activeBuildings, byBuilding, totalRecipes: enriched.length, pricesUpdatedAt: pricesUpdatedAt ?? null });
    } catch (error) {
      console.error('Get recipes error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch recipe data' });
    }
  }
}

export const farmController = new FarmController();
