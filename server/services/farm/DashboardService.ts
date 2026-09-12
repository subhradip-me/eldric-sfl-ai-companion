/**
 * server/services/farm/DashboardService.ts
 * Deterministic Dashboard View Model Builder.
 * Pre-computes category-specific structured data on the backend from NormalizedFarmState
 * so the React Dashboard UI remains a pure presentation layer.
 */

import type { NormalizedFarmState } from '../../domain/index.js';
import type { CanonicalFarmState } from '../../types/index.js';
import { resolveEffectContext, type EffectContext } from '../../core/effectEngine/index.js';

export interface DashboardViewModel {
  overview: {
    kpis: {
      level: number;
      xp: number;
      targetXp: number;
      remainingXp: number;
      pctComplete: number;
      flowerApprox: number;
      coins: number;
    };
    health: {
      activeCookingCount: number;
      activeCropsCount: number;
      animalsCount: number;
      placedCollectiblesCount: number;
      resourcesCount: number;
      totalBuildingsCount: number;
    };
    buildings: Array<{
      name: string;
      category: string;
      icon: string;
      oil: number;
      isBusy: boolean;
      readyAt: number | null;
      coordinates?: { x: number; y: number };
    }>;
  };
  cooking: {
    buildings: Array<{
      name: string;
      oil: number;
      oilBoost: string;
      isBusy: boolean;
      readyAt: number | null;
      crafting: Array<{ name: string; readyAt: number; amount: number }>;
    }>;
    foodInventory: Record<string, number>;
    totalMealsInStock: number;
  };
  crops: {
    activeCrops: Array<{
      id: string;
      item: string;
      quantity: number;
      expectedOutput: number;
      readyAt: number;
      isReady: boolean;
    }>;
    greenhouse: {
      activeCount: number;
      items: Array<{ item: string; readyAt: number }>;
    };
    seeds: Record<string, number>;
    produce: Record<string, number>;
    composters: Array<{
      name: string;
      oil?: number;
      readyAt: number | null;
      isReady: boolean;
    }>;
  };
  animals: {
    henHouse: {
      chickensCount: number;
      eggsInStock: number;
      specialChickens: Record<string, number>;
    };
    barn: {
      cowsCount: number;
      sheepCount: number;
      milkStock: number;
      woolStock: number;
      merinoWoolStock: number;
      leatherStock: number;
      featherStock: number;
    };
    feedInventory: Record<string, number>;
    careEquipment: Record<string, number>;
  };
  resources: {
    primary: {
      wood: number;
      stone: number;
      iron: number;
      gold: number;
      crimstone: number;
      sunstone: number;
      obsidian: number;
      oil: number;
    };
    tools: Record<string, number>;
    nodes: {
      trees: number;
      stoneRocks: number;
      ironRocks: number;
      goldRocks: number;
      crimstoneRocks: number;
      sunstoneRocks: number;
      oilReserves: number;
      waterWells: number;
    };
  };
  effects: {
    placedCollectiblesCount: number;
    placedCollectibles: Array<{
      id: string;
      name: string;
      location: string;
      coordinates: { x: number; y: number };
    }>;
    skills: Array<{ name: string; tier?: number }>;
    wearables: Record<string, string>;
    vip: {
      active: boolean;
      boosts: string[];
    };
    context?: EffectContext;
    diagnostics: {
      rawHash?: string;
      stale: boolean;
    };
  };
}

const COOKING_BUILDINGS = new Set(['Fire Pit', 'Kitchen', 'Bakery', 'Smoothie Shack', 'Deli']);
const COMPOSTING_BUILDINGS = new Set(['Compost Bin', 'Turbo Composter', 'Premium Composter']);

const FEED_ITEMS = new Set(['Wheat', 'Corn', 'Hay', 'Kernel Blend', 'NutriBarley', 'Mixed Grain', 'Barn Delight', 'Omnifeed']);
const CARE_TOOLS = new Set(['Petting Hand', 'Brush', 'Music Box', 'Cow Scratcher', 'Spinning Wheel']);
const SPECIAL_CHICKENS = new Set([
  'Speed Chicken', 'Fat Chicken', 'Rich Chicken', 'Rooster', 'Undead Rooster',
  'Alien Chicken', 'Banana Chicken', 'Knight Chicken', 'Crim Peckster', 'Chicken Coop',
]);

const PRODUCIBLE_CROPS = new Set([
  'Sunflower', 'Potato', 'Pumpkin', 'Carrot', 'Cabbage', 'Beetroot', 'Cauliflower',
  'Parsnip', 'Radish', 'Wheat', 'Kale', 'Apple', 'Blueberry', 'Orange', 'Eggplant',
  'Corn', 'Banana', 'Soybean', 'Grape', 'Rice', 'Olive', 'Tomato', 'Lemon',
  'Barley', 'Rhubarb', 'Zucchini', 'Yam', 'Broccoli', 'Pepper', 'Onion', 'Turnip', 'Artichoke',
]);

export const BUILDING_TAXONOMY: Record<string, { category: string; icon: string }> = {
  'Fire Pit': { category: 'Cooking', icon: '🔥' },
  'Kitchen': { category: 'Cooking', icon: '🍳' },
  'Bakery': { category: 'Cooking', icon: '🎂' },
  'Smoothie Shack': { category: 'Cooking', icon: '🥤' },
  'Deli': { category: 'Cooking', icon: '🧀' },
  'Water Well': { category: 'Agriculture', icon: '💧' },
  'Compost Bin': { category: 'Soil Nutrition', icon: '🪱' },
  'Turbo Composter': { category: 'Soil Nutrition', icon: '🪱' },
  'Premium Composter': { category: 'Soil Nutrition', icon: '🪱' },
  'Greenhouse': { category: 'Agriculture', icon: '🏡' },
  'Barn': { category: 'Livestock', icon: '🐄' },
  'Hen House': { category: 'Livestock', icon: '🐔' },
  'Workbench': { category: 'Crafting', icon: '🔨' },
  'Toolshed': { category: 'Storage', icon: '🛠️' },
  'Crafting Box': { category: 'Crafting', icon: '📦' },
  'Aging Shed': { category: 'Processing', icon: '🏚️' },
  'Fish Market': { category: 'Commerce', icon: '🐟' },
  'Market': { category: 'Commerce', icon: '🏪' },
  'Manor': { category: 'Estate', icon: '🏛️' },
  'Mansion': { category: 'Estate', icon: '🏛️' },
};

export class DashboardService {
  /**
   * Builds the structured DashboardViewModel consumed directly by client selectors.
   */
  public build(
    normState: NormalizedFarmState,
    canonical: CanonicalFarmState,
    _prodSummary?: unknown,
    rawHash?: string
  ): DashboardViewModel {
    const now = Date.now();
    const inventory = canonical?.inventory ?? normState?.inventory?.all ?? {};
    const rawBuildings =
      (normState?.structures?.buildings && Object.keys(normState.structures.buildings).length > 0)
        ? normState.structures.buildings
        : (canonical?.buildings ?? (canonical as any)?.farm?.buildings ?? {});

    // ── 1. Overview & KPIs ───────────────────────────────────────────────────
    const bumpkinLvl = canonical?.bumpkin?.level ?? normState?.player?.level ?? 1;
    const bumpkinXp = canonical?.bumpkin?.xp ?? normState?.player?.experience ?? 0;
    const targetXp = 24_083_905; // Level 100 milestone
    const remainingXp = Math.max(targetXp - bumpkinXp, 0);
    const pctComplete = Math.min((bumpkinXp / targetXp) * 100, 100);

    const flowerVal = Number(canonical?.currencies?.flowerApprox ?? normState?.economy?.flowerApprox ?? (canonical as any)?.flower ?? (canonical as any)?.balance ?? 0);
    const coinsVal = Number(canonical?.currencies?.coins ?? normState?.economy?.coins ?? (canonical as any)?.coins ?? 0);

    // ── All Island Infrastructure Buildings ──────────────────────────────────
    const allBuildingsList: DashboardViewModel['overview']['buildings'] = [];

    for (const [bName, rawInst] of Object.entries(rawBuildings)) {
      if (!rawInst) continue;
      const instances = Array.isArray(rawInst) ? rawInst : [rawInst];
      for (const inst of instances) {
        const crafting = (inst as any)?.crafting ?? [];
        const readyAtVal = (inst as any)?.readyAt ?? (inst as any)?.busyUntil ?? null;
        const isBusy = (readyAtVal != null && readyAtVal > now) || crafting.some((c: any) => (c?.readyAt ?? 0) > now);
        const meta = BUILDING_TAXONOMY[bName] || { category: 'Infrastructure', icon: '🏠' };

        allBuildingsList.push({
          name: bName,
          category: meta.category,
          icon: meta.icon,
          oil: Number((inst as any)?.oil ?? 0),
          isBusy,
          readyAt: readyAtVal,
          coordinates: (inst as any)?.coordinates,
        });
      }
    }

    // Sort buildings by category priority
    const catOrder: Record<string, number> = { Cooking: 1, Agriculture: 2, 'Soil Nutrition': 3, Livestock: 4, Crafting: 5, Processing: 6, Storage: 7, Commerce: 8, Estate: 9 };
    allBuildingsList.sort((a, b) => (catOrder[a.category] || 99) - (catOrder[b.category] || 99) || a.name.localeCompare(b.name));

    // ── 2. Cooking Facilities ────────────────────────────────────────────────
    const cookingBuildingsList: DashboardViewModel['cooking']['buildings'] = [];
    let activeCookingJobsCount = 0;

    for (const bName of COOKING_BUILDINGS) {
      const rawInst = (rawBuildings as any)[bName];
      if (!rawInst) continue;
      const instances = Array.isArray(rawInst) ? rawInst : [rawInst];
      for (const inst of instances) {
        const crafting = (inst as any)?.crafting ?? [];
        const readyAtVal = (inst as any)?.readyAt ?? (inst as any)?.busyUntil ?? null;
        const isBusy = (readyAtVal != null && readyAtVal > now) || crafting.some((c: any) => (c?.readyAt ?? 0) > now);
        if (isBusy) activeCookingJobsCount += (crafting.length || 1);

        const oilAmt = Number((inst as any)?.oil ?? 0);
        const oilBoost = oilAmt > 0 ? '+20% Speed' : 'Base Speed';

        cookingBuildingsList.push({
          name: bName,
          oil: oilAmt,
          oilBoost,
          isBusy,
          readyAt: readyAtVal,
          crafting: crafting.map((c: any) => ({
            name: String(c.name ?? ''),
            readyAt: Number(c.readyAt ?? 0),
            amount: Number(c.amount ?? 1),
          })),
        });
      }
    }

    const foodInventory: Record<string, number> = {};
    let totalMealsInStock = 0;
    for (const [item, qty] of Object.entries(normState?.inventory?.food ?? {})) {
      if (qty > 0) {
        foodInventory[item] = qty;
        totalMealsInStock += qty;
      }
    }

    // ── 3. Crops & Greenhouse ────────────────────────────────────────────────
    const activeCropsList: DashboardViewModel['crops']['activeCrops'] = [];
    for (const prod of (normState?.production?.active ?? [])) {
      if (prod.category === 'CROP' || prod.category === 'FRUIT') {
        activeCropsList.push({
          id: prod.id,
          item: prod.item,
          quantity: prod.quantity,
          expectedOutput: prod.expectedOutput,
          readyAt: prod.readyAt,
          isReady: prod.readyAt <= now,
        });
      }
    }

    const seedsInventory: Record<string, number> = {};
    const produceInventory: Record<string, number> = {};

    for (const [key, val] of Object.entries(inventory)) {
      const qty = Number(val);
      if (qty > 0) {
        if (key.endsWith(' Seed') || key.endsWith(' Plant')) {
          seedsInventory[key] = qty;
        } else if (PRODUCIBLE_CROPS.has(key)) {
          produceInventory[key] = qty;
        }
      }
    }

    const compostersList: DashboardViewModel['crops']['composters'] = [];
    for (const cName of COMPOSTING_BUILDINGS) {
      const rawInst = (rawBuildings as any)[cName];
      if (!rawInst) continue;
      const instances = Array.isArray(rawInst) ? rawInst : [rawInst];
      for (const inst of instances) {
        const readyAt = (inst as any)?.readyAt ?? (inst as any)?.busyUntil ?? null;
        compostersList.push({
          name: cName,
          oil: (inst as any)?.oil,
          readyAt,
          isReady: readyAt !== null && readyAt <= now,
        });
      }
    }

    // ── 4. Animals & Barn ────────────────────────────────────────────────────
    const normAnimals = Object.values(normState?.animals?.animals ?? {});
    const normChickensCount = normAnimals.filter((a: any) => !a.type || a.type === 'chicken').length;
    const rawChickensCount = Object.keys((canonical as any)?.chickens ?? {}).length;
    const invChickensCount = Number(inventory['Chicken'] ?? 0) + (canonical?.inventory?.['Chicken'] ? Number(canonical.inventory['Chicken']) : 0);
    const chickensCount = Math.max(normChickensCount, rawChickensCount, invChickensCount);

    const eggStock = Number(inventory['Egg'] ?? 0);
    const specialChickensDict: Record<string, number> = {};
    for (const sc of SPECIAL_CHICKENS) {
      const count = Number(inventory[sc] ?? 0);
      if (count > 0) specialChickensDict[sc] = count;
    }

    const normCowsCount = normAnimals.filter((a: any) => a.type === 'cow').length;
    const invCowsCount = Number(inventory['Cow'] ?? inventory['Baby Cow'] ?? 0);
    const cowsCount = Math.max(normCowsCount, invCowsCount);

    const normSheepCount = normAnimals.filter((a: any) => a.type === 'sheep').length;
    const invSheepCount = Number(inventory['Sheep'] ?? inventory['Baby Sheep'] ?? 0);
    const sheepCount = Math.max(normSheepCount, invSheepCount);
    const milkStock = Number(inventory['Milk'] ?? 0);
    const woolStock = Number(inventory['Wool'] ?? 0);
    const merinoWoolStock = Number(inventory['Merino Wool'] ?? 0);
    const leatherStock = Number(inventory['Leather'] ?? 0);
    const featherStock = Number(inventory['Feather'] ?? 0);

    const feedInventory: Record<string, number> = {};
    for (const f of FEED_ITEMS) {
      const count = Number(inventory[f] ?? 0);
      if (count > 0) feedInventory[f] = count;
    }

    const careEquipment: Record<string, number> = {};
    for (const c of CARE_TOOLS) {
      const count = Number(inventory[c] ?? 0);
      if (count > 0) careEquipment[c] = count;
    }

    // ── 5. Mining & Resources ────────────────────────────────────────────────
    const primaryResources = {
      wood: Number(inventory['Wood'] ?? 0),
      stone: Number(inventory['Stone'] ?? 0),
      iron: Number(inventory['Iron'] ?? 0),
      gold: Number(inventory['Gold'] ?? 0),
      crimstone: Number(inventory['Crimstone'] ?? 0),
      sunstone: Number(inventory['Sunstone'] ?? 0),
      obsidian: Number(inventory['Obsidian'] ?? 0),
      oil: Number(inventory['Oil'] ?? 0),
    };

    const toolsStock: Record<string, number> = {};
    for (const [key, val] of Object.entries(normState?.inventory?.tools ?? {})) {
      if (Number(val) > 0) toolsStock[key] = Number(val);
    }
    // Also check standard tools in inventory
    const standardTools = ['Axe', 'Pickaxe', 'Stone Pickaxe', 'Iron Pickaxe', 'Gold Pickaxe', 'Oil Drill', 'Rod', 'Sand Shovel', 'Sand Drill'];
    for (const t of standardTools) {
      const cnt = Number(inventory[t] ?? 0);
      if (cnt > 0 && !toolsStock[t]) toolsStock[t] = cnt;
    }

    const nodeCounts = {
      trees: Number(inventory['Tree'] ?? 0),
      stoneRocks: Number(inventory['Stone Rock'] ?? 0),
      ironRocks: Number(inventory['Iron Rock'] ?? 0),
      goldRocks: Number(inventory['Gold Rock'] ?? 0),
      crimstoneRocks: Number(inventory['Crimstone Rock'] ?? 0),
      sunstoneRocks: Number(inventory['Sunstone Rock'] ?? 0),
      oilReserves: Number(inventory['Oil Reserve'] ?? 0),
      waterWells: Number(inventory['Water Well'] ?? 0),
    };

    // ── 6. Collectibles & Buffs ──────────────────────────────────────────────
    const placedCollectiblesRaw = normState?.structures?.placedCollectibles ?? [];
    const placedCollectibles = placedCollectiblesRaw.map((p) => ({
      id: p.id,
      name: p.name,
      location: p.location,
      coordinates: p.coordinates,
    }));

    const skillsList: Array<{ name: string; tier?: number }> = [];
    const rawSkills = normState?.player?.skills ?? canonical?.skills ?? {};
    for (const [sName, sVal] of Object.entries(rawSkills)) {
      if (sVal) {
        skillsList.push({ name: sName, tier: typeof sVal === 'number' ? sVal : 1 });
      }
    }

    const wearables = normState?.player?.equipped ?? canonical?.wearables ?? {};
    const vip = {
      active: Boolean(normState?.buffs?.vip ?? (canonical?.buffs as any)?.vip),
      boosts: normState?.buffs?.activeBuffNames ?? (canonical?.buffs as any)?.active ?? [],
    };

    return {
      overview: {
        kpis: {
          level: bumpkinLvl,
          xp: bumpkinXp,
          targetXp,
          remainingXp,
          pctComplete: +pctComplete.toFixed(1),
          flowerApprox: +flowerVal.toFixed(2),
          coins: +coinsVal.toFixed(1),
        },
        health: {
          activeCookingCount: activeCookingJobsCount,
          activeCropsCount: activeCropsList.length,
          animalsCount: chickensCount + cowsCount + sheepCount,
          placedCollectiblesCount: placedCollectibles.length,
          resourcesCount: Object.values(primaryResources).filter((v) => v > 0).length,
          totalBuildingsCount: allBuildingsList.length,
        },
        buildings: allBuildingsList,
      },
      cooking: {
        buildings: cookingBuildingsList,
        foodInventory,
        totalMealsInStock,
      },
      crops: {
        activeCrops: activeCropsList,
        greenhouse: {
          activeCount: (normState?.production?.greenhouse ?? []).length,
          items: (normState?.production?.greenhouse ?? []).map((g) => ({
            item: g.item,
            readyAt: g.readyAt,
          })),
        },
        seeds: seedsInventory,
        produce: produceInventory,
        composters: compostersList,
      },
      animals: {
        henHouse: {
          chickensCount,
          eggsInStock: eggStock,
          specialChickens: specialChickensDict,
        },
        barn: {
          cowsCount,
          sheepCount,
          milkStock,
          woolStock,
          merinoWoolStock,
          leatherStock,
          featherStock,
        },
        feedInventory,
        careEquipment,
      },
      resources: {
        primary: primaryResources,
        tools: toolsStock,
        nodes: nodeCounts,
      },
      effects: {
        placedCollectiblesCount: placedCollectibles.length,
        placedCollectibles,
        skills: skillsList,
        wearables,
        vip,
        context: normState
          ? (() => {
              try {
                return resolveEffectContext(normState, {
                  now,
                  season: normState.temporal?.season,
                  farmId: normState.player?.bumpkinId ? String(normState.player.bumpkinId) : undefined,
                }).value;
              } catch {
                return undefined;
              }
            })()
          : undefined,
        diagnostics: {
          rawHash,
          stale: Boolean(canonical?.stale),
        },
      },
    };
  }
}

export const dashboardService = new DashboardService();
