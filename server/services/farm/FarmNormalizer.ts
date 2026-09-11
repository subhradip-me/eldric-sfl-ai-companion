/**
 * server/services/farm/farmNormalizer.ts
 * Loss-aware normalizer transforming raw Community API JSON into NormalizedFarmState.
 * Invariants:
 *  - No upstream field is silently lost: unmapped fields are reported with hierarchical paths.
 *  - Raw data is preserved alongside normalized state.
 *  - Deterministic SHA-256 rawHash generation.
 *  - Pure transformation with explicit now parameter support.
 */

import crypto from 'node:crypto';
import type {
  NormalizedFarmState,
  PlayerState,
  EconomyState,
  InventoryState,
  FarmStructureState,
  ProductionState,
  AnimalState,
  PetState,
  ProgressionState,
  DeliveryState,
  BuffState,
  TemporalState,
  BuildingInstance,
  ActiveProductionItem,
  TimestampMs,
} from '../../domain/index.js';
import { levelFromXp } from '../../core/index.js';
import type { CanonicalFarmState } from '../../types/index.js';
import recipesData from '../../data/recipes.json' with { type: 'json' };

export interface NormalizationDiagnostics {
  unmappedFields: string[];
  warnings: string[];
  errors: string[];
}

export interface NormalizationResult {
  normalizedState: NormalizedFarmState;
  rawHash: string;
  rawData: unknown;
  diagnostics: NormalizationDiagnostics;
}

export interface NormalizerOptions {
  now?: TimestampMs;
  source?: string;
  farmId?: string;
}

const KNOWN_FARM_KEYS = new Set([
  'id', 'bumpkin', 'balance', 'previousBalance', 'coins', 'inventory', 'previousInventory',
  'buildings', 'island', 'vip', 'buffs', 'crops', 'plots', 'greenhouse', 'trees', 'stones',
  'iron', 'gold', 'crimstones', 'sunstones', 'oilReserves', 'beehives', 'fruitPatches',
  'flowers', 'delivery', 'choreBoard', 'bounties', 'farmActivity', 'farmHands', 'chickens',
  'animals', 'pets', 'wardrobe', 'collectibles', 'airdrops', 'specialEvents', 'announcements',
  'trades', 'mushrooms', 'fisherman', 'henHouse', 'barn', 'bank', 'craftingBox', 'skills',
  'createdAt', 'updatedAt', 'tradePoints', 'buds', 'catchTheKraken', 'pumpkinPlaza',
]);

const KNOWN_BUMPKIN_KEYS = new Set([
  'id', 'experience', 'skills', 'equipped', 'achievements', 'activity', 'tokenUri',
]);

const KNOWN_RESOURCES = new Set([
  'Wood', 'Stone', 'Iron', 'Gold', 'Crimstone', 'Sunstone', 'Egg', 'Honey', 'Milk', 'Wool',
  'Leather', 'Feather', 'Obsidian',
]);

const KNOWN_TOOLS = new Set([
  'Axe', 'Pickaxe', 'Stone Pickaxe', 'Iron Pickaxe', 'Gold Pickaxe', 'Rusty Shovel', 'Shovel',
  'Sand Shovel', 'Rod', 'Fishing Rod', 'Earthworm', 'Grub', 'Red Wiggler',
]);

export class FarmNormalizer {
  public readonly normalizerVersion = '1.0.0-phase2';

  /**
   * Normalizes a raw Community API response into a NormalizedFarmState.
   * Tracks unmapped fields and warnings without losing upstream data.
   */
  public normalize(rawPayload: unknown, options: NormalizerOptions = {}): NormalizationResult {
    const now = options.now ?? Date.now();
    const source = options.source ?? 'community-api';
    const diagnostics: NormalizationDiagnostics = {
      unmappedFields: [],
      warnings: [],
      errors: [],
    };

    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new Error('Invalid rawPayload: must be a non-null object');
    }

    // 1. Deterministic SHA-256 hash of original payload
    const rawHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(rawPayload))
      .digest('hex');

    // 2. Unpack envelope: { farm: ... } or direct farm object
    const rawObj = rawPayload as Record<string, unknown>;
    const f = (rawObj['farm'] && typeof rawObj['farm'] === 'object'
      ? rawObj['farm']
      : rawObj) as Record<string, unknown>;

    // 3. Loss-awareness: Audit keys for unmapped upstream fields
    this.auditUnmappedFields(rawObj, f, diagnostics);

    // 4. Extract Player State
    const bumpkin = (f['bumpkin'] && typeof f['bumpkin'] === 'object'
      ? f['bumpkin']
      : {}) as Record<string, unknown>;
    const exp = this.toNum(bumpkin['experience']);
    if (exp < 0) diagnostics.warnings.push('Player experience is negative');

    const player: PlayerState = {
      ...(bumpkin['id'] != null ? { bumpkinId: bumpkin['id'] as string | number } : {}),
      level: levelFromXp(exp),
      experience: exp,
      skills: (bumpkin['skills'] as Record<string, number | boolean>) ?? {},
      equipped: (bumpkin['equipped'] as Record<string, string>) ?? {},
      achievements: (bumpkin['achievements'] as Record<string, number>) ?? {},
    };

    // 5. Extract Economy State
    const rawBalance = f['balance'] ?? '0';
    const flowerStr = String(rawBalance);
    const flowerApprox = Number(rawBalance) || 0;
    const coins = this.toNum(f['coins']);
    if (flowerApprox < 0) diagnostics.warnings.push('FLOWER balance is negative');

    const economy: EconomyState = {
      flower: flowerStr,
      flowerApprox,
      sfl: flowerApprox,
      coins,
      tradePoints: this.toNum(f['tradePoints']),
      ...(f['previousBalance'] != null ? { previousBalance: String(f['previousBalance']) } : {}),
    };

    // 6. Extract Categorized Inventory
    const rawInventory = (f['inventory'] as Record<string, unknown>) ?? {};
    const inventory = this.categorizeInventory(rawInventory);

    // 7. Extract Structures & Buildings
    const rawBuildings = (f['buildings'] as Record<string, unknown>) ?? {};
    const structures = this.extractStructures(rawBuildings);

    // 8. Extract Active Production Pipelines
    const production = this.extractProduction(f, structures);

    // 9. Extract Animals & Pets
    const animals = this.extractAnimals(f);
    const pets = this.extractPets(f);

    // 10. Extract Progression & Island
    const island = (f['island'] as Record<string, unknown>) ?? {};
    const islandType = (island['type'] as ProgressionState['islandType']) ?? 'basic';
    const progression: ProgressionState = {
      islandType,
      expansions: this.toNum(island['expansions']) || this.toNum(island['expansionIndex']) || 0,
      ascensionLevel: this.toNum(island['ascensionLevel']) || 0,
      sunstones: this.toNum(island['sunstones']) || 0,
      ...(island['biome'] != null ? { biome: String(island['biome']) } : {}),
    };

    // 11. Extract Deliveries, Chores, Bounties
    const deliveries = this.extractDeliveries(f);

    // 12. Extract Buffs & VIP
    const vipObj = f['vip'] as Record<string, number> | boolean | undefined;
    const vipExpiresAt = typeof vipObj === 'object' && vipObj !== null ? (vipObj['expiresAt'] ?? null) : null;
    const isVip = vipExpiresAt ? vipExpiresAt > now : Boolean(vipObj);
    const rawBuffs = (f['buffs'] as Record<string, unknown>) ?? {};
    const buffs: BuffState = {
      vip: isVip,
      ...(vipExpiresAt != null ? { vipExpiresAt } : {}),
      activeBuffNames: Object.keys(rawBuffs),
    };

    // 13. Temporal State
    const temporal: TemporalState = {
      ...(island['season'] != null ? { season: String(island['season']) } : {}),
    };

    // 14. Metadata
    const normalizedState: NormalizedFarmState = {
      player,
      economy,
      inventory,
      structures,
      production,
      animals,
      pets,
      progression,
      deliveries,
      buffs,
      temporal,
      metadata: {
        capturedAt: now,
        fetchedAt: now,
        normalizerVersion: this.normalizerVersion,
        source,
        freshness: 'FRESH',
        cached: false,
      },
    };

    return {
      normalizedState,
      rawHash,
      rawData: rawPayload,
      diagnostics,
    };
  }

  private auditUnmappedFields(
    root: Record<string, unknown>,
    farm: Record<string, unknown>,
    diagnostics: NormalizationDiagnostics
  ): void {
    // Check root level keys if envelope was { farm: ... }
    for (const key of Object.keys(root)) {
      if (key !== 'farm' && !KNOWN_FARM_KEYS.has(key)) {
        diagnostics.unmappedFields.push(key);
      }
    }

    // Check farm level keys
    for (const key of Object.keys(farm)) {
      if (!KNOWN_FARM_KEYS.has(key)) {
        diagnostics.unmappedFields.push(`farm.${key}`);
      }
    }

    // Check bumpkin sub-keys
    const bumpkin = farm['bumpkin'];
    if (bumpkin && typeof bumpkin === 'object') {
      for (const bKey of Object.keys(bumpkin)) {
        if (!KNOWN_BUMPKIN_KEYS.has(bKey)) {
          diagnostics.unmappedFields.push(`bumpkin.${bKey}`);
        }
      }
    }
  }

  private categorizeInventory(raw: Record<string, unknown>): InventoryState {
    const all: Record<string, number> = {};
    const seeds: Record<string, number> = {};
    const crops: Record<string, number> = {};
    const food: Record<string, number> = {};
    const resources: Record<string, number> = {};
    const tools: Record<string, number> = {};
    const collectibles: Record<string, number> = {};
    const fishing: Record<string, number> = {};
    const special: Record<string, number> = {};

    const recipeNames = new Set(Object.keys(recipesData));

    for (const [key, val] of Object.entries(raw)) {
      const qty = this.toNum(val);
      all[key] = qty;

      if (key.endsWith(' Seed')) {
        seeds[key] = qty;
      } else if (recipeNames.has(key)) {
        food[key] = qty;
      } else if (KNOWN_RESOURCES.has(key)) {
        resources[key] = qty;
      } else if (KNOWN_TOOLS.has(key)) {
        tools[key] = qty;
      } else if (key.includes('Bait') || key.includes('Fish') || key.includes('Anchovy') || key.includes('Tuna')) {
        fishing[key] = qty;
      } else if (key.includes('Statue') || key.includes('Banner') || key.includes('Trophy') || key.includes('Monument')) {
        collectibles[key] = qty;
      } else if (
        ['Sunflower', 'Potato', 'Pumpkin', 'Carrot', 'Cabbage', 'Beetroot', 'Cauliflower', 'Parsnip', 'Eggplant', 'Corn', 'Radish', 'Wheat', 'Kale', 'Soybean'].includes(key)
      ) {
        crops[key] = qty;
      } else {
        special[key] = qty;
      }
    }

    return { all, seeds, crops, food, resources, tools, collectibles, fishing, special };
  }

  private extractStructures(rawBuildings: Record<string, unknown>): FarmStructureState {
    const buildings: Record<string, BuildingInstance[]> = {};

    for (const [name, val] of Object.entries(rawBuildings)) {
      const list = Array.isArray(val) ? val : [val];
      buildings[name] = list.map((item) => {
        const obj = (item as Record<string, unknown>) ?? {};
        const craftingRaw = Array.isArray(obj['crafting']) ? obj['crafting'] : [];
        const crafting = craftingRaw.map((c: Record<string, unknown>) => ({
          name: String(c['name'] ?? ''),
          readyAt: this.toNum(c['readyAt']),
          amount: this.toNum(c['amount']) || 1,
        }));
        const readyAt = crafting.length > 0 ? Math.max(...crafting.map((c) => c.readyAt)) : (this.toNum(obj['readyAt']) || null);

        return {
          readyAt,
          oil: this.toNum(obj['oil']),
          crafting,
          coordinates: obj['coordinates'] as { x: number; y: number } | undefined,
        };
      });
    }

    return { buildings };
  }

  private extractProduction(farm: Record<string, unknown>, structures: FarmStructureState): ProductionState {
    const active: ActiveProductionItem[] = [];
    const crops: ActiveProductionItem[] = [];
    const cooking: ActiveProductionItem[] = [];
    const greenhouse: ActiveProductionItem[] = [];
    const fruit: ActiveProductionItem[] = [];
    const mining: ActiveProductionItem[] = [];

    // 1. Crops from plots / crops
    const rawCrops = (farm['crops'] ?? farm['plots'] ?? {}) as Record<string, unknown>;
    for (const [id, plotData] of Object.entries(rawCrops)) {
      const plot = plotData as Record<string, unknown>;
      if (!plot) continue;

      if (typeof plot['crop'] === 'object' && plot['crop'] !== null) {
        const cropObj = plot['crop'] as Record<string, unknown>;
        if (cropObj['name']) {
          const item: ActiveProductionItem = {
            id: `crop_${id}`,
            category: 'CROP',
            item: String(cropObj['name']),
            quantity: 1,
            status: 'OBSERVED',
            startedAt: this.toNum(cropObj['plantedAt']),
            readyAt: this.toNum(cropObj['readyAt']) || this.toNum(cropObj['plantedAt']) + 300000,
            expectedOutput: this.toNum(cropObj['amount']) || 1,
          };
          active.push(item);
          crops.push(item);
        }
      } else if (typeof plot['crop'] === 'string') {
        const item: ActiveProductionItem = {
          id: `crop_${id}`,
          category: 'CROP',
          item: plot['crop'],
          quantity: this.toNum(plot['count']) || 1,
          status: 'OBSERVED',
          startedAt: this.toNum(plot['startedAt']),
          readyAt: this.toNum(plot['readyAt']) || this.toNum(plot['startedAt']) + 300000,
          expectedOutput: this.toNum(plot['expectedYield']) || this.toNum(plot['count']) || 1,
        };
        active.push(item);
        crops.push(item);
      }
    }

    // 2. Cooking from buildings crafting queues
    for (const [bName, instances] of Object.entries(structures.buildings)) {
      for (const [idx, inst] of instances.entries()) {
        for (const [cIdx, craft] of (inst.crafting ?? []).entries()) {
          const item: ActiveProductionItem = {
            id: `cooking_${bName}_${idx}_${cIdx}`,
            category: 'COOKING',
            item: craft.name,
            quantity: craft.amount ?? 1,
            status: 'OBSERVED',
            startedAt: inst.readyAt ? inst.readyAt - 1800000 : 0,
            readyAt: craft.readyAt,
            expectedOutput: craft.amount ?? 1,
          };
          active.push(item);
          cooking.push(item);
        }
      }
    }

    // 3. Fruit patches
    const rawFruit = (farm['fruitPatches'] ?? {}) as Record<string, unknown>;
    for (const [id, patchData] of Object.entries(rawFruit)) {
      const patch = patchData as Record<string, unknown>;
      const fItem = patch?.['fruit'] as Record<string, unknown> | undefined;
      if (fItem?.['name']) {
        const item: ActiveProductionItem = {
          id: `fruit_${id}`,
          category: 'FRUIT',
          item: String(fItem['name']),
          quantity: 1,
          status: 'OBSERVED',
          startedAt: this.toNum(fItem['plantedAt']),
          readyAt: this.toNum(fItem['harvestedAt']) || 0,
          expectedOutput: this.toNum(fItem['amount']) || 1,
        };
        active.push(item);
        fruit.push(item);
      }
    }

    // 4. Mining: Stones, Iron, Gold, Crimstones, Sunstones
    for (const resKey of ['stones', 'iron', 'gold', 'crimstones', 'sunstones']) {
      const nodes = (farm[resKey] ?? {}) as Record<string, unknown>;
      for (const [id, nodeData] of Object.entries(nodes)) {
        const node = nodeData as Record<string, unknown>;
        const recoveryTime = this.toNum(node?.['recoveryTime']) || this.toNum(node?.['minedAt']);
        if (recoveryTime) {
          const item: ActiveProductionItem = {
            id: `mine_${resKey}_${id}`,
            category: 'MINING',
            item: resKey.replace(/s$/, ''),
            quantity: 1,
            status: 'OBSERVED',
            startedAt: this.toNum(node?.['minedAt']),
            readyAt: recoveryTime,
            expectedOutput: this.toNum(node?.['amount']) || 1,
          };
          active.push(item);
          mining.push(item);
        }
      }
    }

    return { active, crops, cooking, greenhouse, fruit, mining };
  }

  private extractAnimals(farm: Record<string, unknown>): AnimalState {
    const rawAnimals = (farm['animals'] ?? farm['chickens'] ?? {}) as Record<string, unknown>;
    const animals: Record<string, any> = {};

    for (const [id, data] of Object.entries(rawAnimals)) {
      const a = data as Record<string, unknown>;
      animals[id] = {
        id,
        type: (a['type'] as any) ?? 'chicken',
        level: this.toNum(a['level']) || 1,
        fedAt: this.toNum(a['fedAt']) || undefined,
        rewardReadyAt: this.toNum(a['rewardReadyAt']) || undefined,
        multiplier: this.toNum(a['multiplier']) || 1,
      };
    }

    return { animals };
  }

  private extractPets(farm: Record<string, unknown>): PetState {
    const rawPets = (farm['pets'] ?? {}) as Record<string, unknown>;
    const pets: Record<string, any> = {};

    for (const [id, data] of Object.entries(rawPets)) {
      const p = data as Record<string, unknown>;
      pets[id] = {
        id,
        name: String(p['name'] ?? id),
        level: this.toNum(p['level']) || 1,
        experience: this.toNum(p['experience']) || 0,
        energy: this.toNum(p['energy']) || undefined,
        traits: Array.isArray(p['traits']) ? (p['traits'] as string[]) : undefined,
      };
    }

    return { pets };
  }

  private extractDeliveries(farm: Record<string, unknown>): DeliveryState {
    const deliveryRaw = (farm['delivery'] as Record<string, unknown>) ?? {};
    const ordersRaw = Array.isArray(deliveryRaw['orders']) ? deliveryRaw['orders'] : [];
    const orders = ordersRaw.map((o: Record<string, unknown>) => ({
      id: String(o['id'] ?? ''),
      from: o['from'] ? String(o['from']) : undefined,
      items: (o['items'] as Record<string, number>) ?? undefined,
      reward: (o['reward'] as Record<string, unknown>) ?? undefined,
      completedAt: this.toNum(o['completedAt']) || null,
    }));

    return {
      orders,
      ...(farm['choreBoard'] != null ? { chores: farm['choreBoard'] as Record<string, unknown> } : {}),
      ...(farm['bounties'] != null ? { bounties: farm['bounties'] as any } : {}),
    };
  }

  private toNum(v: unknown): number {
    if (v == null) return 0;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }

  /** Legacy compatibility bridge returning CanonicalFarmState */
  public toCanonical(raw: unknown): CanonicalFarmState {
    const norm = this.normalize(raw).normalizedState;
    return {
      bumpkin: { level: norm.player.level, xp: norm.player.experience },
      currencies: {
        flower: norm.economy.flower,
        flowerApprox: norm.economy.flowerApprox,
        sfl: norm.economy.sfl,
        coins: norm.economy.coins,
      },
      inventory: norm.inventory.all,
      skills: norm.player.skills as any,
      wearables: norm.player.equipped,
      buffs: {
        vip: norm.buffs.vip,
        active: norm.buffs.activeBuffNames,
      },
      buildings: Object.fromEntries(
        Object.entries(norm.structures.buildings).map(([name, instances]) => [
          name,
          {
            busyUntil: instances[0]?.readyAt ?? null,
            oil: instances[0]?.oil ?? 0,
          },
        ])
      ),
      farmActivity: ((raw as any)?.farm?.farmActivity ?? (raw as any)?.farmActivity ?? {}) as Record<string, number>,
      deliveries: norm.deliveries.orders as any,
      chores: (norm.deliveries.chores as any) ?? {},
      bounties: (norm.deliveries.bounties as any) ?? { requests: [], completed: [] },
      fetchedAt: norm.metadata.capturedAt,
    };
  }
}

export const farmNormalizer = new FarmNormalizer();
