/**
 * server/core/economyEngine/cost.ts
 * Pure deterministic monetary calculations, market valuations, and buy vs farm ROI.
 * Invariant: Every calculation is reproducible from explicit inputs and preserves provenance.
 */

import type { CalculationResult, CostResult, MarketPrice } from '../../domain/index.js';
import { withProvenance } from '../provenance/index.js';

export const FISH_ITEMS_SET = new Set([
  'Anchovy', 'Tuna', 'Clownfish', 'Blowfish', 'Sea Bass', 'Halibut', 'Porgy',
  'Muskellunge', 'Trout', 'Napoleanfish', 'Tilapia', 'Surgeonfish', 'Walleye',
  'Rock Blackfish', 'Saw Shark', 'Hammerhead shark', 'Angelfish', 'Ray', 'Sunfish',
  'Blue Marlin', 'Olive Flounder', 'Horse Mackerel', 'Squid', 'Red Snapper', 'Butterflyfish',
]);

/**
 * Determine effective unit price in FLOWER for an item.
 * Pure deterministic function with authoritative fallback values.
 */
export function getItemPrice(item: string, prices: MarketPrice = {}): number | null {
  if (prices[item] != null && prices[item] > 0) return prices[item];

  const woodPrice = prices['Wood'] ?? 0.0019;
  const stonePrice = prices['Stone'] ?? 0.002;
  const rodCost = 3 * woodPrice + 1 * stonePrice;

  if (FISH_ITEMS_SET.has(item)) return rodCost;
  if (['Fish Stick', 'Fish Flake', 'Fish Oil', 'Crab Stick', 'Crab', 'Seaweed'].includes(item)) return rodCost;
  if (item === 'Magic Mushroom') return 0.008;
  if (item === 'Wild Mushroom') return 0.003;

  return null;
}

export interface CalculateCostInput {
  requiredResources: Record<string, number>;
  inventory?: Record<string, number>;
  prices?: MarketPrice;
  itemsMeta?: Record<string, { tradable?: boolean }>;
  farmId?: string;
  snapshotVersion?: number;
  computedAt?: number;
}

/**
 * Compute the total FLOWER market valuation and out-of-pocket acquisition cost.
 * Distinguishes between items that can be bought on the market vs items that must be produced.
 */
export function calculateCostBreakdown(input: CalculateCostInput): CalculationResult<CostResult> {
  const { requiredResources } = input;
  const inventory = input.inventory ?? {};
  const prices = input.prices ?? {};
  const itemsMeta = input.itemsMeta ?? {};

  let flower = 0;
  let totalFlower = 0;
  const buy: Record<string, number> = {};
  const mustProduce: Record<string, number> = {};
  const unpriced: string[] = [];

  for (const [item, qty] of Object.entries(requiredResources)) {
    if (qty <= 0) continue;
    const unitPrice = getItemPrice(item, prices);

    if (unitPrice != null) {
      totalFlower += qty * unitPrice;
    } else {
      unpriced.push(item);
    }

    const currentStock = inventory[item] ?? 0;
    const toBuy = Math.max(0, qty - currentStock);
    if (toBuy === 0) continue;

    const meta = itemsMeta[item];
    const isUntradable = meta?.tradable === false;

    if (isUntradable || unitPrice == null) {
      mustProduce[item] = toBuy;
    } else {
      buy[item] = toBuy;
      flower += toBuy * unitPrice;
    }
  }

  const result: CostResult = {
    flower,
    totalFlower,
    buy,
    mustProduce,
    unpriced,
  };

  return withProvenance(result, {
    farmId: input.farmId,
    snapshotVersion: input.snapshotVersion,
    computedAt: input.computedAt,
  });
}

export interface BuyVsFarmEvaluation {
  item: string;
  unitProduceCostFlower: number;
  marketPriceFlower: number;
  costDifferenceFlower: number;
  percentSavings: number;
  recommendation: 'BUY_FROM_MARKET' | 'FARM_IN_HOUSE' | 'NEUTRAL';
}

/**
 * Compare in-house farming/crafting cost against current market price.
 * Pure deterministic function.
 */
export function evaluateBuyVsFarm(
  item: string,
  unitProduceCostFlower: number,
  marketPriceFlower: number
): BuyVsFarmEvaluation {
  const costDiff = unitProduceCostFlower - marketPriceFlower;
  const percentSavings = marketPriceFlower > 0
    ? ((unitProduceCostFlower - marketPriceFlower) / marketPriceFlower) * 100
    : 0;

  let recommendation: BuyVsFarmEvaluation['recommendation'] = 'NEUTRAL';
  if (costDiff > 0.0001) {
    // Market is cheaper than farming cost
    recommendation = 'BUY_FROM_MARKET';
  } else if (costDiff < -0.0001) {
    // In-house production is cheaper than market purchase
    recommendation = 'FARM_IN_HOUSE';
  }

  return {
    item,
    unitProduceCostFlower,
    marketPriceFlower,
    costDifferenceFlower: costDiff,
    percentSavings,
    recommendation,
  };
}
