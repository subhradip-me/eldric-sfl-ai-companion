// Community API client + TTL cache (design §10)
import { toCanonical } from "./normalizer.js";

const cache = new Map(); // key -> {at, data}
const TTL = { farm: 5 * 60_000, prices: 10 * 60_000 };

async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return { ...hit.data, stale: false, cached: true };
  try {
    const data = await fn();
    cache.set(key, { at: Date.now(), data });
    return { ...data, stale: false, cached: false };
  } catch (e) {
    if (hit) return { ...hit.data, stale: true, error: String(e) };
    throw e;
  }
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (res.status === 401) throw new Error("401: Sunflower API key is invalid or expired.");
  if (res.status === 429) throw new Error("429: API rate limit reached. Please wait before refreshing.");
  if (!res.ok) throw new Error(`${res.status}: upstream error`);
  return res.json();
}

export function getFarm() {
  const { SUNFLOWER_API_URL, SUNFLOWER_FARM_ID, SUNFLOWER_API_KEY } = process.env;
  return cached("farm", TTL.farm, async () => {
    const raw = await get(
      `${SUNFLOWER_API_URL}/community/farms/${SUNFLOWER_FARM_ID}`,
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
