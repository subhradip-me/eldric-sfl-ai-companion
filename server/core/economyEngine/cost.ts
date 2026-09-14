/**
 * server/core/economyEngine/cost.ts
 * Pure deterministic monetary calculations, market valuations, and buy vs farm ROI.
 * Invariant: Every calculation is reproducible from explicit inputs and preserves provenance.
 */

import type {
  CalculationResult,
  CostResult,
  MarketPrice,
  AnimalProductionEconomics,
  AnimalProduceTierEconomics,
  FarmAnimalSetupStatus,
  NormalizedFarmState,
} from '../../domain/index.js';
import { withProvenance } from '../provenance/index.js';

export const FISH_ITEMS_SET = new Set([
  'Anchovy', 'Tuna', 'Clownfish', 'Blowfish', 'Sea Bass', 'Halibut', 'Porgy',
  'Muskellunge', 'Trout', 'Napoleanfish', 'Tilapia', 'Surgeonfish', 'Walleye',
  'Rock Blackfish', 'Saw Shark', 'Hammerhead shark', 'Angelfish', 'Ray', 'Sunfish',
  'Blue Marlin', 'Olive Flounder', 'Horse Mackerel', 'Squid', 'Red Snapper', 'Butterflyfish',
]);

/**
 * Determine effective unit price in FLOWER for an item.
 * Pure deterministic function strictly evaluated against provided market prices.
 */
export function getItemPrice(item: string, prices: MarketPrice = {}): number | null {
  if (prices[item] != null && prices[item] > 0) return prices[item];

  const woodPrice = prices['Wood'];
  const stonePrice = prices['Stone'];
  if (woodPrice != null && stonePrice != null) {
    const rodCost = 3 * woodPrice + 1 * stonePrice;
    if (FISH_ITEMS_SET.has(item)) return rodCost;
    if (['Fish Stick', 'Fish Flake', 'Fish Oil', 'Crab Stick', 'Crab', 'Seaweed'].includes(item)) return rodCost;
  }

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

export interface AnimalProduceCostInput {
  produceItem: string;
  animalLevel?: number;
  prices?: MarketPrice;
  inventory?: Record<string, number>;
  feedCostMultiplier?: number;
  freeChickenFeed?: boolean;
  yieldAddition?: number;
}

export const ANIMAL_PRODUCE_MAP: Record<string, { animalType: 'Chicken' | 'Cow' | 'Sheep'; isPrimary: boolean; secondaryItem?: string }> = {
  Egg: { animalType: 'Chicken', isPrimary: true, secondaryItem: 'Feather' },
  Feather: { animalType: 'Chicken', isPrimary: false },
  Milk: { animalType: 'Cow', isPrimary: true, secondaryItem: 'Leather' },
  Leather: { animalType: 'Cow', isPrimary: false },
  Wool: { animalType: 'Sheep', isPrimary: true, secondaryItem: 'Merino Wool' },
  'Merino Wool': { animalType: 'Sheep', isPrimary: false },
};

export const ANIMAL_BUILDING_TIERS = {
  'Hen House': {
    unlockLevel: 6,
    levels: {
      1: { capacity: 10, coins: 100, resources: { Wood: 30, Iron: 5, Gold: 5 }, p2pCostSfl: 2.28 },
      2: { capacity: 15, coins: 7500, resources: { Wood: 500, Stone: 50, Iron: 40, Gold: 10 }, p2pCostSfl: 33.58 },
      3: { capacity: 20, coins: 50000, resources: { Wood: 2500, Stone: 150, Iron: 100, Gold: 50, Oil: 100 }, p2pCostSfl: 150.33 },
    },
  },
  Barn: {
    unlockLevel: 30,
    levels: {
      1: { capacity: 10, coins: 200, resources: { Wood: 150, Iron: 10, Gold: 10 }, p2pCostSfl: 5.64 },
      2: { capacity: 15, coins: 10000, resources: { Wood: 1000, Stone: 100, Iron: 75, Gold: 30 }, p2pCostSfl: 69.90 },
      3: { capacity: 20, coins: 75000, resources: { Wood: 5000, Stone: 300, Iron: 200, Crimstone: 125, Oil: 250 }, p2pCostSfl: 309.47 },
    },
  },
};

export const ANIMAL_PURCHASE_RULES = {
  Chicken: { coins: 50, requiredLevel: 6, building: 'Hen House' as const },
  Cow: { coins: 100, requiredLevel: 14, building: 'Barn' as const },
  Sheep: { coins: 120, requiredLevel: 18, building: 'Barn' as const },
};

/**
 * Pure deterministic calculation of animal produce unit economics across levels.
 * Invariant: Production cost equals (feed required * feed price * multipliers) / produce yield.
 */
export function calculateAnimalProduceCost(input: AnimalProduceCostInput): AnimalProductionEconomics | null {
  const meta = ANIMAL_PRODUCE_MAP[input.produceItem];
  if (!meta) return null;

  const animalType = meta.animalType;
  const prices = input.prices ?? {};
  const inventory = input.inventory ?? {};
  const feedCostMultiplier = input.feedCostMultiplier ?? 1.0;
  const freeFeed = Boolean(animalType === 'Chicken' && input.freeChickenFeed);
  const yieldBonus = input.yieldAddition ?? 0;
  const animalLevel = input.animalLevel ?? 0;

  // Authoritative progression tiers from sfl.world/info/animals
  const tierConfigs = [
    {
      levelRange: 'Levels 0–3',
      fromLevel: 0,
      toLevel: 3,
      feedItem: 'Kernel Blend',
      feedQty: animalType === 'Cow' ? 5 : animalType === 'Sheep' ? 3 : 1,
      baseProduceYield: 1,
      secondaryItem: animalType === 'Cow' ? 'Leather' : animalType === 'Sheep' ? 'Merino Wool' : 'Feather',
      secondaryYield: animalType === 'Cow' ? 1 : animalType === 'Sheep' ? 1 : (animalLevel >= 2 ? 1 : 0),
    },
    {
      levelRange: 'Levels 3–6',
      fromLevel: 3,
      toLevel: 6,
      feedItem: 'Hay',
      feedQty: animalType === 'Cow' ? 5 : animalType === 'Sheep' ? 3 : 1,
      baseProduceYield: 2,
      secondaryItem: animalType === 'Cow' ? 'Leather' : animalType === 'Sheep' ? 'Merino Wool' : 'Feather',
      secondaryYield: animalType === 'Cow' ? 1.5 : animalType === 'Sheep' ? 1.5 : 1,
    },
    {
      levelRange: 'Levels 6–10',
      fromLevel: 6,
      toLevel: 10,
      feedItem: 'NutriBarley',
      feedQty: animalType === 'Cow' ? 5 : animalType === 'Sheep' ? 3 : 1,
      baseProduceYield: animalType === 'Cow' ? 2.75 : animalType === 'Sheep' ? 2.75 : 2.75,
      secondaryItem: animalType === 'Cow' ? 'Leather' : animalType === 'Sheep' ? 'Merino Wool' : 'Feather',
      secondaryYield: animalType === 'Cow' ? 2.5 : animalType === 'Sheep' ? 2.5 : 1.5,
    },
    {
      levelRange: 'Levels 10–15',
      fromLevel: 10,
      toLevel: 15,
      feedItem: 'Mixed Grain',
      feedQty: animalType === 'Cow' ? 5 : animalType === 'Sheep' ? 3 : 1,
      baseProduceYield: animalType === 'Cow' ? 3.25 : animalType === 'Sheep' ? 3.25 : 4,
      secondaryItem: animalType === 'Cow' ? 'Leather' : animalType === 'Sheep' ? 'Merino Wool' : 'Feather',
      secondaryYield: animalType === 'Cow' ? 3.25 : animalType === 'Sheep' ? 3.25 : 2.25,
    },
  ];

  const allTiers: AnimalProduceTierEconomics[] = tierConfigs.map((tc) => {
    const feedUnitPrice = getItemPrice(tc.feedItem, prices);
    const rawFeedCost = feedUnitPrice != null ? tc.feedQty * feedUnitPrice : null;
    const feedCostFlower = freeFeed ? 0 : rawFeedCost != null ? rawFeedCost * feedCostMultiplier : null;
    const effectiveProduceYield = tc.baseProduceYield + yieldBonus;
    const unitCostFlower = (feedCostFlower != null && effectiveProduceYield > 0)
      ? feedCostFlower / effectiveProduceYield
      : null;

    return {
      levelRange: tc.levelRange,
      fromLevel: tc.fromLevel,
      toLevel: tc.toLevel,
      feedItem: tc.feedItem,
      feedQuantity: tc.feedQty,
      feedUnitPriceFlower: feedUnitPrice != null ? Number(feedUnitPrice.toFixed(5)) : null,
      feedCostFlower: feedCostFlower != null ? Number(feedCostFlower.toFixed(5)) : null,
      produceYield: Number(effectiveProduceYield.toFixed(2)),
      unitCostFlower: unitCostFlower != null ? Number(unitCostFlower.toFixed(5)) : null,
      secondaryProduce: {
        item: tc.secondaryItem,
        quantity: Number(tc.secondaryYield.toFixed(2)),
      },
    };
  });

  const activeTier = allTiers.find((t) => animalLevel >= t.fromLevel && animalLevel < t.toLevel) ?? allTiers[0];
  const feedOnHand = Number(inventory[activeTier.feedItem] ?? 0);
  const hasEnoughFeedForCycle = feedOnHand >= activeTier.feedQuantity;

  return {
    animalType,
    produce: input.produceItem,
    currentLevel: animalLevel,
    activeTier,
    allTiers,
    feedOnHand,
    hasEnoughFeedForCycle,
    effectiveYield: activeTier.produceYield,
    unitProduceCostFlower: activeTier.unitCostFlower,
    cycleFeedCostFlower: activeTier.feedCostFlower,
    secondaryProduce: activeTier.secondaryProduce,
    boostsApplied: {
      feedCostMultiplier,
      freeFeed,
      yieldBonus,
    },
  };
}

/**
 * Deterministically evaluate whether a farm is equipped to produce an animal good,
 * and calculate missing capital requirements (building, level, animal purchase).
 */
export function getFarmAnimalSetupStatus(
  animalType: 'Chicken' | 'Cow' | 'Sheep',
  farmState: NormalizedFarmState
): FarmAnimalSetupStatus {
  const purchaseRule = ANIMAL_PURCHASE_RULES[animalType];
  const buildingName = purchaseRule.building;
  const buildingTier = ANIMAL_BUILDING_TIERS[buildingName];
  const playerLevel = farmState.player?.level ?? 1;
  const levelMet = playerLevel >= buildingTier.unlockLevel;

  const farmBuildings = farmState.structures?.buildings ?? {};
  const buildingRecord = farmBuildings[buildingName];
  const buildingOwned = Boolean(
    buildingRecord && (Array.isArray(buildingRecord) ? buildingRecord.length > 0 : true)
  );

  let buildingLevel = 0;
  if (buildingOwned) {
    if (Array.isArray(buildingRecord) && buildingRecord[0]?.level) {
      buildingLevel = buildingRecord[0].level;
    } else {
      buildingLevel = 1;
    }
  }

  const allAnimals = Object.values(farmState.animals?.animals ?? {});
  const typeKey = animalType.toLowerCase() as 'chicken' | 'cow' | 'sheep';
  const matchingAnimals = allAnimals.filter((a) => (a.type || 'chicken').toLowerCase() === typeKey);
  const normCount = matchingAnimals.length;
  const invCount = Number(
    farmState.inventory?.all?.[animalType] ?? farmState.inventory?.all?.[`Baby ${animalType}`] ?? 0
  );
  const animalCount = Math.max(normCount, invCount);
  const highestLevel = matchingAnimals.length > 0
    ? Math.max(...matchingAnimals.map((a) => a.level || 0))
    : 0;

  const canProduceNow = buildingOwned && animalCount > 0;
  const missingRequirements: string[] = [];

  if (!levelMet) {
    missingRequirements.push(`Requires Bumpkin Level ${buildingTier.unlockLevel} (currently Lv ${playerLevel})`);
  }
  if (!buildingOwned) {
    const bldResList = Object.entries(buildingTier.levels[1].resources)
      .map(([res, amt]) => `${amt} ${res}`)
      .join(', ');
    missingRequirements.push(
      `Build ${buildingName} (Unlock Lv ${buildingTier.unlockLevel}, Cost: ${buildingTier.levels[1].coins} Coins, ${bldResList})`
    );
  }
  if (animalCount === 0) {
    missingRequirements.push(`Purchase ${animalType} (${purchaseRule.coins} Coins at ${buildingName})`);
  }

  return {
    buildingName,
    buildingUnlockLevel: buildingTier.unlockLevel,
    playerLevel,
    levelMet,
    buildingOwned,
    buildingLevel,
    animalName: animalType,
    animalCount,
    animalPurchaseCoins: purchaseRule.coins,
    canProduceNow,
    missingRequirements,
    highestAnimalLevel: highestLevel,
    animalsSummary: animalCount > 0 ? `${animalCount} ${animalType}${animalCount > 1 ? 's' : ''} (highest Level ${highestLevel})` : undefined,
    initialSetupCost: {
      coins: buildingTier.levels[1].coins + purchaseRule.coins,
      resources: buildingTier.levels[1].resources,
      p2pCostSfl: buildingTier.levels[1].p2pCostSfl,
    },
  };
}
