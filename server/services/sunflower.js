// Community API client + TTL cache with disk persistence and in-flight deduplication
import { toCanonical } from "./normalizer.js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "../data/.cache");
const CACHE_FILE = join(CACHE_DIR, "api-cache.json");

const TTL = { farm: 5 * 60_000, prices: 10 * 60_000 };

// ── In-memory cache (populated from disk on startup) ──────────────────────────
let memCache = {};

function loadDiskCache() {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const raw = readFileSync(CACHE_FILE, "utf8");
    memCache = JSON.parse(raw);
  } catch {
    memCache = {};
  }
}

function saveDiskCache() {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(memCache), "utf8");
  } catch (e) {
    console.warn("⚠️  Could not persist API cache:", e.message);
  }
}

loadDiskCache();

// ── In-flight deduplication: key -> Promise ───────────────────────────────────
const pending = new Map();

async function cached(key, ttl, fn) {
  const hit = memCache[key];
  if (hit && Date.now() - hit.at < ttl) {
    return { ...hit.data, stale: false, cached: true };
  }

  // If a fetch is already in-flight for this key, reuse it
  if (pending.has(key)) {
    return pending.get(key);
  }

  const promise = fn()
    .then((data) => {
      memCache[key] = { at: Date.now(), data };
      saveDiskCache();
      return { ...data, stale: false, cached: false };
    })
    .catch((e) => {
      if (hit) {
        // Return stale data rather than erroring — handles 429 gracefully
        console.warn(`⚠️  API error for "${key}", serving stale cache: ${e.message}`);
        return { ...hit.data, stale: true, error: String(e) };
      }
      throw e;
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, promise);
  return promise;
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (res.status === 401) throw new Error("401: Sunflower API key is invalid or expired.");
  if (res.status === 429) throw new Error("429: API rate limit reached. Please wait before refreshing.");
  if (!res.ok) throw new Error(`${res.status}: upstream error`);
  return res.json();
}

export function getFarm(farmId = null) {
  const { SUNFLOWER_API_URL, SUNFLOWER_FARM_ID, SUNFLOWER_API_KEY } = process.env;
  const targetFarmId = farmId || SUNFLOWER_FARM_ID;

  if (!targetFarmId) {
    throw new Error("No farm ID provided and SUNFLOWER_FARM_ID is not set");
  }

  return cached(`farm:${targetFarmId}`, TTL.farm, async () => {
    const raw = await get(
      `${SUNFLOWER_API_URL}/community/farms/${targetFarmId}`,
      SUNFLOWER_API_KEY ? { "x-api-key": SUNFLOWER_API_KEY } : {}
    );
    return { canonical: toCanonical(raw), raw };
  });
}

export function getPrices() {
  return cached("prices", TTL.prices, async () => {
    const j = await get(process.env.PRICES_API_URL);
    return { prices: j?.data?.p2p ?? {}, updatedAt: j?.updatedAt ?? null };
  });
}
