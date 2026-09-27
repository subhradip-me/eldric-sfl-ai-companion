/**
 * server/services/farm/ActivityService.ts
 * Farm activity deltas between two snapshots or canonical states (design §12).
 * Observed = exact farmActivity counter changes; Inferred = inventory movements.
 * Includes FLOWER valuation (live P2P prices) and daily production summaries.
 */
import type { ActivityDiff } from '../../types/index.js';
import { levelFromXp } from '../../core/index.js';

// ── Extended types ────────────────────────────────────────────────────────────

export interface ValuatedActivityDiff extends ActivityDiff {
  valuation: {
    /** FLOWER value of each produced/gained item (positive deltas only) */
    producedPerItem: Record<string, number>;
    /** FLOWER cost of each spent/consumed item (negative deltas valued as cost) */
    spentPerItem: Record<string, number>;
    /** Gross FLOWER value produced (inflow) */
    producedFlower: number;
    /** Gross FLOWER value spent/consumed (outflow) */
    spentFlower: number;
    /** Net FLOWER balance = producedFlower - spentFlower */
    netFlower: number;

    /** Backward-compatibility aliases */
    perItem: Record<string, number>;
    totalFlower: number;
    pricesUsed: Record<string, number>;
  };
}

export interface DailyProductionBucket {
  /** ISO date string e.g. "2026-09-17" */
  date: string;
  /** Unix ms of the first snapshot in this bucket */
  fromMs: number;
  /** Unix ms of the last snapshot in this bucket */
  toMs: number;

  /** Net inventory gains (positive delta items only) */
  produced: Record<string, number>;
  /** FLOWER value of each produced item */
  valuedProduced: Record<string, number>;
  /** Total gross FLOWER earned/produced in this day window */
  producedFlower: number;

  /** Net inventory losses (negative delta items, positive quantities spent) */
  spent: Record<string, number>;
  /** FLOWER value/cost of each spent item */
  valuedSpent: Record<string, number>;
  /** Total FLOWER spent/consumed in this day window */
  spentFlower: number;

  /** Net FLOWER balance = producedFlower - spentFlower */
  netFlower: number;

  /** Backward-compatibility aliases */
  totalFlower: number;
  valuedItems: Record<string, number>;

  /** XP gained in this window */
  xpGained: number;
  /** Number of snapshots that contributed to this bucket */
  snapshotCount: number;
}

export interface DailyProductionSummary {
  days: DailyProductionBucket[];
  /** Aggregate over the whole period */
  totals: {
    totalProducedFlower: number;
    totalSpentFlower: number;
    netFlower: number;
    profitMarginPct: number;
    /** Backward compatibility alias for totalProducedFlower */
    totalFlower: number;
    totalXp: number;
    /** Top items produced by FLOWER value */
    topProduced: Array<{ item: string; quantity: number; flower: number }>;
    /** Top items spent/consumed by FLOWER cost */
    topSpent: Array<{ item: string; quantity: number; flower: number }>;
    /** Backward compatibility alias for topProduced */
    topItems: Array<{ item: string; quantity: number; flower: number }>;
  };
  pricesUsed: Record<string, number>;
  generatedAt: number;
}

/**
 * Resolves live or derived FLOWER valuation for any item in Sunflower Land.
 * Handles crops, resources, foods, seeds (derived from crop price ~40%),
 * crafted tools (derived from component recipes), and animal feed.
 */
export function resolveItemPrice(item: string, prices: Record<string, number>): number {
  if (!item) return 0;

  // 1. Direct price in market P2P prices
  if (prices[item] != null && prices[item] > 0) {
    return prices[item];
  }

  // 2. Direct FLOWER currency movements
  if (item === 'FLOWER' || item === 'FLOWER (Direct)') {
    return 1.0;
  }

  // 3. Seeds and Seedlings (~40% of crop market price in Sunflower Land economics)
  if (item.endsWith(' Seed')) {
    const crop = item.slice(0, -5).trim();
    const cropPrice = resolveItemPrice(crop, prices);
    if (cropPrice > 0) {
      return +(cropPrice * 0.4).toFixed(6);
    }
  }
  if (item.endsWith(' Plant')) {
    const crop = item.slice(0, -6).trim();
    const cropPrice = resolveItemPrice(crop, prices);
    if (cropPrice > 0) {
      return +(cropPrice * 0.4).toFixed(6);
    }
  }

  // 4. Common basic tools crafted with resources at the workbench
  const woodPrice = prices['Wood'] ?? 0.0019;
  const stonePrice = prices['Stone'] ?? 0.002;
  const ironPrice = prices['Iron'] ?? 0.005;
  const goldPrice = prices['Gold'] ?? 0.01;

  if (item === 'Axe') return +(5 * woodPrice + 1 * stonePrice).toFixed(6);
  if (item === 'Pickaxe') return +(5 * woodPrice + 2 * stonePrice).toFixed(6);
  if (item === 'Stone Pickaxe') return +(3 * stonePrice + 5 * woodPrice).toFixed(6);
  if (item === 'Iron Pickaxe') return +(5 * ironPrice + 5 * woodPrice).toFixed(6);
  if (item === 'Gold Pickaxe') return +(5 * goldPrice + 5 * woodPrice).toFixed(6);
  if (item === 'Rod') return +(5 * woodPrice).toFixed(6);
  if (item === 'Sand Shovel') return +(2 * woodPrice + 1 * stonePrice).toFixed(6);
  if (item === 'Sand Drill') return +(5 * woodPrice + 1 * ironPrice).toFixed(6);
  if (item === 'Oil Drill') return +(5 * woodPrice + 5 * ironPrice).toFixed(6);

  // 5. Animal Feed Fallbacks
  const wheatPrice = prices['Wheat'] ?? 0.035;
  const cornPrice = prices['Corn'] ?? 0.015;
  const barleyPrice = prices['Barley'] ?? 0.012;

  if (item === 'Hay') return +(3 * wheatPrice).toFixed(6);
  if (item === 'Kernel Blend') return +(3 * cornPrice).toFixed(6);
  if (item === 'NutriBarley') return +(3 * barleyPrice).toFixed(6);
  if (item === 'Mixed Grain') return +(2 * wheatPrice + 2 * cornPrice + 1 * barleyPrice).toFixed(6);
  if (item === 'Omnifeed') return 0.05;

  return 0;
}

export interface UnpackedFarmSnapshot {
  inventory: Record<string, number>;
  farmActivity: Record<string, number>;
  xp: number;
  level: number;
  flower: number;
  coins: number;
  timestamp: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class ActivityService {
  /**
   * Robustly unpack any farm snapshot or payload into a standardized,
   * numeric-clean snapshot representation. Handles:
   * - PostgreSQL SnapshotRecord ({ id, created_at, xp, data_json, ... })
   * - Raw Sunflower Land Community API responses ({ farm: { inventory, bumpkin: { experience } } })
   * - Direct farm objects ({ inventory, farmActivity, bumpkin: { experience } })
   * - CanonicalFarmState ({ bumpkin: { xp }, inventory, currencies, fetchedAt })
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unpack(input: any): UnpackedFarmSnapshot {
    if (!input || typeof input !== 'object') {
      return {
        inventory: {},
        farmActivity: {},
        xp: 0,
        level: 1,
        flower: 0,
        coins: 0,
        timestamp: Date.now(),
      };
    }

    // 1. Unwrap database record envelope if present
    const root = (input.data_json != null ? input.data_json : input) as Record<string, any>;
    // 2. Unwrap raw API { farm: { ... } } wrapper if present
    const f = (root?.farm && typeof root.farm === 'object' ? root.farm : root) as Record<string, any>;

    // 3. Extract and parse inventory (converting string amounts like "78.0" to clean numbers)
    const rawInv = (f?.inventory ?? root?.inventory ?? {}) as Record<string, any>;
    const inventory: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawInv)) {
      const num = Number(v);
      if (!isNaN(num) && isFinite(num)) {
        inventory[k] = num;
      }
    }

    // 4. Extract and parse farmActivity (exact action counters like "Sunflower Harvested")
    const rawAct = (f?.farmActivity ?? root?.farmActivity ?? {}) as Record<string, any>;
    const farmActivity: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawAct)) {
      const num = Number(v);
      if (!isNaN(num) && isFinite(num)) {
        farmActivity[k] = num;
      }
    }

    // 5. Extract Bumpkin XP across all possible naming conventions
    const xpCandidates = [
      input.xp,
      f?.bumpkin?.experience,
      root?.bumpkin?.experience,
      f?.bumpkin?.xp,
      root?.bumpkin?.xp,
      root?.player?.experience,
      f?.experience,
      root?.experience,
    ];
    let xp = 0;
    for (const cand of xpCandidates) {
      if (cand != null && !isNaN(Number(cand))) {
        xp = Number(cand);
        break;
      }
    }

    // 6. Extract Timestamp
    const tsCandidates = [
      input.created_at,
      root?.fetchedAt,
      f?.updatedAt,
      f?.createdAt,
      root?.createdAt,
    ];
    let timestamp = Date.now();
    for (const cand of tsCandidates) {
      if (cand != null && !isNaN(Number(cand)) && Number(cand) > 1000000000) {
        timestamp = Number(cand);
        break;
      }
    }

    // 7. Extract FLOWER balance
    const flowerCandidates = [
      input.flower,
      root?.currencies?.flowerApprox,
      f?.balance,
      root?.balance,
      f?.flower,
      root?.flower,
    ];
    let flower = 0;
    for (const cand of flowerCandidates) {
      if (cand != null && !isNaN(Number(cand))) {
        flower = Number(cand);
        break;
      }
    }

    // 8. Extract Coins
    const coinCandidates = [
      input.coins,
      root?.currencies?.coins,
      f?.coins,
      root?.coins,
    ];
    let coins = 0;
    for (const cand of coinCandidates) {
      if (cand != null && !isNaN(Number(cand))) {
        coins = Number(cand);
        break;
      }
    }

    // 9. Extract Bumpkin Level (or derive from cumulative XP)
    const levelCandidates = [
      f?.bumpkin?.level,
      root?.bumpkin?.level,
      root?.player?.level,
      f?.level,
      root?.level,
    ];
    let level = 0;
    for (const cand of levelCandidates) {
      if (cand != null && !isNaN(Number(cand)) && Number(cand) > 0) {
        level = Number(cand);
        break;
      }
    }
    if (level === 0) {
      level = levelFromXp(xp);
    }

    return {
      inventory,
      farmActivity,
      xp,
      level,
      flower,
      coins,
      timestamp,
    };
  }

  /**
   * Compute the diff between two consecutive farm snapshots or states.
   * Tolerates any combination of raw SFL objects, DB records, or canonical states.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diff(prevInput: any, currInput: any): ActivityDiff {
    const p = this.unpack(prevInput);
    const c = this.unpack(currInput);

    // 1. Observed counter changes (exact actions recorded by Sunflower Land)
    const observed: Record<string, number> = {};
    const actKeys = new Set([...Object.keys(p.farmActivity), ...Object.keys(c.farmActivity)]);
    for (const k of actKeys) {
      const d = (c.farmActivity[k] ?? 0) - (p.farmActivity[k] ?? 0);
      if (d !== 0) observed[k] = d;
    }

    // 2. Inferred net inventory fluctuations
    const inferred: Record<string, number> = {};
    const invKeys = new Set([...Object.keys(p.inventory), ...Object.keys(c.inventory)]);
    for (const k of invKeys) {
      const d = (c.inventory[k] ?? 0) - (p.inventory[k] ?? 0);
      if (Math.abs(d) > 1e-6) {
        inferred[k] = +d.toFixed(4);
      }
    }

    // Direct FLOWER currency delta (wallet/vault movements)
    const flowerDelta = (c.flower ?? 0) - (p.flower ?? 0);
    if (Math.abs(flowerDelta) > 1e-6) {
      inferred['FLOWER (Direct)'] = +flowerDelta.toFixed(4);
    }

    // 3. XP delta with anomaly guard
    let xpDelta = c.xp - p.xp;
    // In Sunflower Land, XP cannot decrease. If negative due to an uninitialized/corrupt snapshot, clamp to 0.
    if (xpDelta < 0) {
      xpDelta = 0;
    }

    return {
      observed,
      inferred,
      xpDelta,
      from: p.timestamp,
      to: c.timestamp,
    };
  }

  /**
   * Attach FLOWER valuation to a raw ActivityDiff using live P2P prices and smart item resolution.
   * Accurately distinguishes Produced (gains > 0) vs Spent/Consumed (losses < 0)
   * and derives the net FLOWER economic impact.
   */
  valuate(
    diff: ActivityDiff,
    prices: Record<string, number>
  ): ValuatedActivityDiff {
    const producedPerItem: Record<string, number> = {};
    const spentPerItem: Record<string, number> = {};
    let producedFlower = 0;
    let spentFlower = 0;

    for (const [item, delta] of Object.entries(diff.inferred)) {
      if (item === 'Coins (Direct)') continue; // Don't conflate in-game coins with FLOWER

      const price = resolveItemPrice(item, prices);
      if (delta > 0) {
        const value = +(delta * price).toFixed(6);
        if (value > 0) {
          producedPerItem[item] = value;
          producedFlower += value;
        }
      } else if (delta < 0) {
        const qtySpent = Math.abs(delta);
        const cost = +(qtySpent * price).toFixed(6);
        if (cost > 0) {
          spentPerItem[item] = cost;
          spentFlower += cost;
        }
      }
    }

    const netFlower = +(producedFlower - spentFlower).toFixed(6);

    return {
      ...diff,
      valuation: {
        producedPerItem,
        spentPerItem,
        producedFlower: +producedFlower.toFixed(6),
        spentFlower: +spentFlower.toFixed(6),
        netFlower,
        perItem: producedPerItem,
        totalFlower: +producedFlower.toFixed(6),
        pricesUsed: prices,
      },
    };
  }

  /**
   * Compute daily production summary across multiple snapshots.
   * Groups consecutive snapshots into calendar-day buckets and valuates
   * each bucket's production using live P2P prices and smart resolution.
   *
   * @param snapshots  SnapshotRecord[] ordered DESC by created_at (newest first)
   * @param prices     Live P2P FLOWER prices per item
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dailySummary(snapshots: any[], prices: Record<string, number>): DailyProductionSummary {
    if (snapshots.length < 2) {
      return {
        days: [],
        totals: {
          totalProducedFlower: 0,
          totalSpentFlower: 0,
          netFlower: 0,
          profitMarginPct: 0,
          totalFlower: 0,
          totalXp: 0,
          topProduced: [],
          topSpent: [],
          topItems: [],
        },
        pricesUsed: prices,
        generatedAt: Date.now(),
      };
    }

    // Sort ascending (oldest first) for sequential diffing
    const sorted = [...snapshots].sort((a, b) => {
      const tsA = Number(a.created_at ?? this.unpack(a).timestamp);
      const tsB = Number(b.created_at ?? this.unpack(b).timestamp);
      return tsA - tsB;
    });

    // Map to date-keyed buckets
    const buckets = new Map<string, DailyProductionBucket>();

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];

      const d = this.diff(prev, curr);
      const valued = this.valuate(d, prices);

      // Key by the calendar date of the LATER snapshot (production "happened by" that date)
      const ts = Number(curr.created_at ?? d.to ?? Date.now());
      const date = new Date(ts).toISOString().slice(0, 10); // "YYYY-MM-DD"

      if (!buckets.has(date)) {
        buckets.set(date, {
          date,
          fromMs: Number(prev.created_at ?? d.from ?? ts),
          toMs: ts,
          produced: {},
          valuedProduced: {},
          producedFlower: 0,
          spent: {},
          valuedSpent: {},
          spentFlower: 0,
          netFlower: 0,
          totalFlower: 0,
          valuedItems: {},
          xpGained: 0,
          snapshotCount: 0,
        });
      }

      const bucket = buckets.get(date)!;
      bucket.toMs = Math.max(bucket.toMs, ts);
      bucket.snapshotCount++;
      bucket.xpGained += Math.max(0, valued.xpDelta ?? 0);
      bucket.producedFlower += valued.valuation.producedFlower;
      bucket.spentFlower += valued.valuation.spentFlower;
      bucket.netFlower = +(bucket.producedFlower - bucket.spentFlower).toFixed(6);
      bucket.totalFlower = bucket.producedFlower;

      // Merge inventory movements: positive = produced, negative = spent
      for (const [item, delta] of Object.entries(valued.inferred)) {
        if (item === 'Coins (Direct)') continue;
        if (delta > 0) {
          bucket.produced[item] = (bucket.produced[item] ?? 0) + delta;
        } else if (delta < 0) {
          const qty = Math.abs(delta);
          bucket.spent[item] = (bucket.spent[item] ?? 0) + qty;
        }
      }

      for (const [item, value] of Object.entries(valued.valuation.producedPerItem)) {
        bucket.valuedProduced[item] = (bucket.valuedProduced[item] ?? 0) + value;
      }
      for (const [item, cost] of Object.entries(valued.valuation.spentPerItem)) {
        bucket.valuedSpent[item] = (bucket.valuedSpent[item] ?? 0) + cost;
      }
      bucket.valuedItems = bucket.valuedProduced;
    }

    const days = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));

    // Aggregate totals
    let totalProducedFlower = 0;
    let totalSpentFlower = 0;
    let totalXp = 0;
    const producedTotals: Record<string, { quantity: number; flower: number }> = {};
    const spentTotals: Record<string, { quantity: number; flower: number }> = {};

    for (const day of days) {
      totalProducedFlower += day.producedFlower;
      totalSpentFlower += day.spentFlower;
      totalXp += day.xpGained;

      day.producedFlower = +day.producedFlower.toFixed(6);
      day.spentFlower = +day.spentFlower.toFixed(6);
      day.netFlower = +(day.producedFlower - day.spentFlower).toFixed(6);
      day.totalFlower = day.producedFlower;

      for (const [item, qty] of Object.entries(day.produced)) {
        if (!producedTotals[item]) producedTotals[item] = { quantity: 0, flower: 0 };
        producedTotals[item].quantity += qty;
        producedTotals[item].flower += day.valuedProduced[item] ?? 0;
      }

      for (const [item, qty] of Object.entries(day.spent)) {
        if (!spentTotals[item]) spentTotals[item] = { quantity: 0, flower: 0 };
        spentTotals[item].quantity += qty;
        spentTotals[item].flower += day.valuedSpent[item] ?? 0;
      }
    }

    const buildRankedList = (map: Record<string, { quantity: number; flower: number }>) => {
      return Object.entries(map)
        .map(([item, { quantity, flower }]) => ({
          item,
          quantity: +quantity.toFixed(4),
          flower: +flower.toFixed(6),
        }))
        .sort((a, b) => {
          // Sort primarily by FLOWER value/cost, secondarily by quantity
          if (Math.abs(b.flower - a.flower) > 1e-6) {
            return b.flower - a.flower;
          }
          return b.quantity - a.quantity;
        })
        .slice(0, 10);
    };

    const topProduced = buildRankedList(producedTotals);
    const topSpent = buildRankedList(spentTotals);

    const profitMarginPct = totalProducedFlower > 0
      ? +(((totalProducedFlower - totalSpentFlower) / totalProducedFlower) * 100).toFixed(1)
      : 0;

    return {
      days,
      totals: {
        totalProducedFlower: +totalProducedFlower.toFixed(6),
        totalSpentFlower: +totalSpentFlower.toFixed(6),
        netFlower: +(totalProducedFlower - totalSpentFlower).toFixed(6),
        profitMarginPct,
        totalFlower: +totalProducedFlower.toFixed(6),
        totalXp: Math.round(totalXp),
        topProduced,
        topSpent,
        topItems: topProduced,
      },
      pricesUsed: prices,
      generatedAt: Date.now(),
    };
  }

  /** Alias for backward compatibility */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diffActivity(prev: any, curr: any): ActivityDiff {
    return this.diff(prev, curr);
  }
}

export const activityService = new ActivityService();
export const diffActivity = (prev: any, curr: any) => activityService.diff(prev, curr);
