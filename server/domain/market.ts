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
