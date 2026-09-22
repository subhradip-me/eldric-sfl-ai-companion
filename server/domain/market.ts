/**
 * server/domain/market.ts
 * Market prices, valuations, and cost domain models.
 */

export type MarketPrice = Record<string, number>;

export interface CostResult {
  flower: number;       // out-of-pocket FLOWER to buy missing items
  totalFlower: number;  // full FLOWER market valuation
  buy: Record<string, number>;
  mustProduce: Record<string, number>;
  unpriced: string[];
}

export interface MarketResponse {
  prices: MarketPrice;
  updatedAt: string | null;
  stale: boolean;
}

export interface AnimalProduceTierEconomics {
  levelRange: string;
  fromLevel: number;
  toLevel: number;
  feedItem: string;
  feedQuantity: number;
  feedUnitPriceFlower: number | null;
  feedCostFlower: number | null;
  produceYield: number;
  unitCostFlower: number | null;
  secondaryProduce?: {
    item: string;
    quantity: number;
  };
}

export interface AnimalProductionEconomics {
  animalType: 'Chicken' | 'Cow' | 'Sheep';
  produce: string;
  currentLevel: number;
  activeTier: AnimalProduceTierEconomics;
  allTiers: AnimalProduceTierEconomics[];
  feedOnHand: number;
  hasEnoughFeedForCycle: boolean;
  effectiveYield: number;
  unitProduceCostFlower: number | null;
  cycleFeedCostFlower: number | null;
  secondaryProduce?: {
    item: string;
    quantity: number;
  };
  boostsApplied: {
    feedCostMultiplier: number;
    freeFeed: boolean;
    yieldBonus: number;
  };
}

export interface FarmAnimalSetupStatus {
  buildingName: 'Barn' | 'Hen House';
  buildingUnlockLevel: number;
  playerLevel: number;
  levelMet: boolean;
  buildingOwned: boolean;
  buildingLevel: number;
  animalName: 'Chicken' | 'Cow' | 'Sheep';
  animalCount: number;
  animalPurchaseCoins: number;
  canProduceNow: boolean;
  missingRequirements: string[];
  highestAnimalLevel?: number;
  animalsSummary?: string;
  initialSetupCost: {
    coins: number;
    resources: Record<string, number>;
    p2pCostSfl?: number;
  };
}

export interface BuyVsFarmResult {
  item: string;
  category: 'ANIMAL_PRODUCE' | 'CROP' | 'COOKING_RECIPE' | 'RESOURCE' | 'UNKNOWN';
  marketPriceFlower: number | null;
  unitProduceCostFlower: number | null;
  costDifferenceFlower: number | null;
  percentSavings: number | null;
  recommendation: 'BUY_FROM_MARKET' | 'FARM_IN_HOUSE' | 'NEUTRAL' | 'UNPRICED';
  animalEconomics?: AnimalProductionEconomics;
  setupStatus?: FarmAnimalSetupStatus;
  summary: string;
}

/** A single ranked sell candidate produced by resolve_sell_plan. */
export interface SellCandidate {
  item: string;
  qtyToSell: number;
  unitPriceFlower: number;
  totalFlower: number;
}

/** An inventory item excluded from selling, with a machine-readable reason. */
export interface SellExclusion {
  item: string;
  reason:
    | 'NOT_SELLABLE'          // placed node / untradable item (e.g. Crimstone Rock)
    | 'RESERVED_FOR_RECIPE'   // hard reserve from the resource ledger
    | 'PRESERVED_BY_REQUEST'  // soft preference the player asked to keep
    | 'NO_MARKET_PRICE';      // tradable but currently unpriced on the P2P market
  detail: string;
}

/**
 * Deterministic sell-plan result. Every figure traces to live prices + inventory;
 * no number originates in the LLM. See design §4.3.
 */
export interface SellPlanResult {
  gapFlower: number;
  candidates: SellCandidate[];
  excluded: SellExclusion[];
  gapFilled: boolean;
  proceedsFlower: number;         // sum of candidate totalFlower
  shortfallFlower: number;        // > 0 if inventory can't cover the gap
  summary: string;
}

