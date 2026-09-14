/**
 * SunflowerClient — Community API client with TTL in-memory+disk cache
 * and in-flight Promise deduplication to avoid 429s (design §10).
 */
import type { CanonicalFarmState, MarketResponse, RawFarmResponse } from '../../types/index.js';
import { farmNormalizer } from './FarmNormalizer.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../../data/.cache');
const CACHE_FILE = join(CACHE_DIR, 'api-cache.json');

interface CacheEntry {
  at: number;
  data: unknown;
}

const TTL = {
  farm: 5 * 60_000,
  prices: 10 * 60_000,
} as const;

export class SunflowerClient {
  private memCache: Record<string, CacheEntry> = {};
  private pending = new Map<string, Promise<unknown>>();

  constructor() {
    this.loadDiskCache();
  }

  private loadDiskCache(): void {
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      const raw = readFileSync(CACHE_FILE, 'utf8');
      this.memCache = JSON.parse(raw) as Record<string, CacheEntry>;
    } catch {
      this.memCache = {};
    }
  }

  private saveDiskCache(): void {
    try {
      writeFileSync(CACHE_FILE, JSON.stringify(this.memCache), 'utf8');
    } catch (e) {
      console.warn('⚠️  Could not persist API cache:', (e as Error).message);
    }
  }

  private async get<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(url, { headers });
    if (res.status === 401) throw new Error('401: Sunflower API key is invalid or expired.');
    if (res.status === 429) throw new Error('429: API rate limit reached. Please wait before refreshing.');
    if (!res.ok) throw new Error(`${res.status}: upstream error`);
    return res.json() as Promise<T>;
  }

  private async cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T & { stale: boolean; cached: boolean }> {
    const hit = this.memCache[key];
    if (hit && Date.now() - hit.at < ttl) {
      return { ...(hit.data as T), stale: false, cached: true };
    }

    // In-flight dedup: return existing promise if already fetching
    if (this.pending.has(key)) {
      return this.pending.get(key) as Promise<T & { stale: boolean; cached: boolean }>;
    }

    const promise = fn()
      .then((data) => {
        this.memCache[key] = { at: Date.now(), data };
        this.saveDiskCache();
        return { ...data, stale: false, cached: false };
      })
      .catch((e) => {
        if (hit) {
          console.warn(`⚠️  API error for "${key}", serving stale cache: ${(e as Error).message}`);
          return { ...(hit.data as T), stale: true, error: String(e), cached: true };
        }
        throw e;
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, promise);
    return promise as Promise<T & { stale: boolean; cached: boolean }>;
  }

  /** Fetch canonical farm state for a given farm ID. Caches 5 min. */
  getFarm(farmId?: string | null): Promise<RawFarmResponse & { stale: boolean; cached: boolean }> {
    const { SUNFLOWER_API_URL, SUNFLOWER_FARM_ID, SUNFLOWER_API_KEY } = process.env;
    const targetFarmId = farmId || SUNFLOWER_FARM_ID;
    if (!targetFarmId) throw new Error('No farm ID provided and SUNFLOWER_FARM_ID is not set');

    return this.cached<{ canonical: CanonicalFarmState; raw: unknown }>(
      `farm:${targetFarmId}`,
      TTL.farm,
      async () => {
        const raw = await this.get<unknown>(
          `${SUNFLOWER_API_URL}/community/farms/${targetFarmId}`,
          SUNFLOWER_API_KEY ? { 'x-api-key': SUNFLOWER_API_KEY } : {}
        );
        return { canonical: farmNormalizer.toCanonical(raw), raw };
      }
    ) as Promise<RawFarmResponse & { stale: boolean; cached: boolean }>;
  }

  /** Fetch live P2P market prices. Caches 10 min. */
  getPrices(): Promise<MarketResponse & { stale: boolean; cached: boolean }> {
    const defaultPrices: Record<string, number> = {
      Wood: 0.0019,
      Stone: 0.002,
      Iron: 0.005,
      Gold: 0.01,
      Sunflower: 0.0001,
      Potato: 0.0002,
      Pumpkin: 0.0004,
      Carrot: 0.0008,
      Cabbage: 0.0015,
      Beetroot: 0.0025,
      Cauliflower: 0.004,
      Parsnip: 0.0065,
      Eggplant: 0.01,
      Corn: 0.015,
      Radish: 0.02,
      Wheat: 0.035,
      Artichoke: 0.05,
      Honey: 0.02,
      Egg: 0.01,
      Milk: 0.03,
      Wool: 0.024,
      Leather: 0.15,
      Feather: 0.01,
      'Merino Wool': 0.05,
      'Kernel Blend': 0.015,
      Hay: 0.013,
      NutriBarley: 0.016,
      'Mixed Grain': 0.044,
      Barley: 0.012,
    };

    if (!process.env.PRICES_API_URL) {
      return Promise.resolve({
        prices: defaultPrices,
        updatedAt: new Date().toISOString(),
        stale: false,
        cached: true,
      });
    }

    return this.cached<{ prices: Record<string, number>; updatedAt: string | null }>(
      'prices',
      TTL.prices,
      async () => {
        try {
          const j = await this.get<{ data?: { p2p?: Record<string, number> }; updatedAt?: string }>(
            process.env.PRICES_API_URL!
          );
          return { prices: j?.data?.p2p ?? defaultPrices, updatedAt: j?.updatedAt ?? null };
        } catch {
          return { prices: defaultPrices, updatedAt: null };
        }
      }
    ) as Promise<MarketResponse & { stale: boolean; cached: boolean }>;
  }
}

export const sunflowerClient = new SunflowerClient();
