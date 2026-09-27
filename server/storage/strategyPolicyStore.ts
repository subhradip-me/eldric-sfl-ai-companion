/**
 * server/storage/strategyPolicyStore.ts
 * Slice 3 — the StrategyPolicy hot cache: interface + in-memory test driver + live Redis
 * driver + factory + singleton, mirroring redisHotStore.ts.
 *
 * The background forward-model planner writes the provenance-stamped StrategyPolicy here; the
 * get_best_plan tool and the Explainer read it back without recomputing ("the engine decides
 * what's true; the reader never re-derives").
 *
 * Invariants:
 *  - Keyed `strategy:{farmId}:{goalId|DEFAULT}` — a named goal is isolated from the farm's
 *    open-ended DEFAULT policy.
 *  - Schema boundary: every put is validated through StrategyPolicySchema before storage; a
 *    malformed policy is rejected (throws), never cached.
 *  - Monotonic stale-write rejection: a policy whose computedAt is <= the stored one's is
 *    rejected, so a slower/older planning cycle can never clobber a fresher plan (the
 *    computedAt analog of the hot store's snapshotVersion guard, A6).
 *  - Redis loss != data loss: the policy is reproducible by re-running the planner.
 */

import Redis, { type Redis as RedisClient } from 'ioredis';
import type { FarmId, GoalId } from '../domain/types.js';
import type { StrategyPolicy } from '../domain/strategy.js';
import { StrategyPolicySchema } from '../schemas/strategySchema.js';

/** goalId defaults to the farm's open-ended DEFAULT policy slot. */
export type PolicyGoalKey = GoalId | 'DEFAULT';

const TTL_SEC = 604800; // 7 days, matching the hot store

function keyFor(farmId: FarmId, goalId: PolicyGoalKey = 'DEFAULT'): string {
  return `strategy:${farmId}:${goalId}`;
}

export interface IStrategyPolicyStore {
  get(farmId: FarmId, goalId?: PolicyGoalKey): Promise<StrategyPolicy | null>;
  /** Validates + caches; rejects a stale (computedAt <= current) or malformed policy. */
  put(policy: StrategyPolicy): Promise<{ committed: boolean; reason?: string }>;
  delete(farmId: FarmId, goalId?: PolicyGoalKey): Promise<void>;
  flush(): Promise<void>;
  disconnect(): Promise<void>;
}

/** STALE_POLICY reason string — shared so both drivers report it identically. */
function staleReason(incoming: number, current: number): string {
  return `STALE_POLICY: incoming computedAt ${incoming} <= current computedAt ${current}`;
}

/**
 * In-memory implementation of IStrategyPolicyStore.
 * Guaranteed-identical semantics to live Redis for testing and offline development.
 */
export class MemoryStrategyPolicyStore implements IStrategyPolicyStore {
  private data = new Map<string, string>();

  public async get(farmId: FarmId, goalId: PolicyGoalKey = 'DEFAULT'): Promise<StrategyPolicy | null> {
    const raw = this.data.get(keyFor(farmId, goalId));
    if (!raw) return null;
    return JSON.parse(raw) as StrategyPolicy;
  }

  public async put(policy: StrategyPolicy): Promise<{ committed: boolean; reason?: string }> {
    // Schema boundary: throws on a malformed policy, before anything is stored.
    const validated = StrategyPolicySchema.parse(policy) as StrategyPolicy;
    const key = keyFor(validated.farmId, validated.goalId);

    const currentRaw = this.data.get(key);
    if (currentRaw) {
      const current = JSON.parse(currentRaw) as StrategyPolicy;
      if (validated.computedAt <= current.computedAt) {
        return { committed: false, reason: staleReason(validated.computedAt, current.computedAt) };
      }
    }

    this.data.set(key, JSON.stringify(validated));
    return { committed: true };
  }

  public async delete(farmId: FarmId, goalId: PolicyGoalKey = 'DEFAULT'): Promise<void> {
    this.data.delete(keyFor(farmId, goalId));
  }

  public async flush(): Promise<void> {
    this.data.clear();
  }

  public async disconnect(): Promise<void> {
    // No-op for in-memory
  }
}

/**
 * Live Redis implementation of IStrategyPolicyStore using ioredis, with a monotonic
 * computedAt guard, a 7-day TTL, and a transparent in-memory fallback.
 */
export class RedisStrategyPolicyStore implements IStrategyPolicyStore {
  private fallback = new MemoryStrategyPolicyStore();

  constructor(private readonly redis: RedisClient) {}

  public async get(farmId: FarmId, goalId: PolicyGoalKey = 'DEFAULT'): Promise<StrategyPolicy | null> {
    try {
      const raw = await this.redis.get(keyFor(farmId, goalId));
      if (!raw) return this.fallback.get(farmId, goalId);
      return JSON.parse(raw) as StrategyPolicy;
    } catch {
      return this.fallback.get(farmId, goalId);
    }
  }

  public async put(policy: StrategyPolicy): Promise<{ committed: boolean; reason?: string }> {
    // Validate BEFORE touching either store — a malformed policy throws and is never cached.
    const validated = StrategyPolicySchema.parse(policy) as StrategyPolicy;
    // Keep the in-memory mirror warm for zero downtime / fallback.
    this.fallback.put(validated).catch(() => {});

    const key = keyFor(validated.farmId, validated.goalId);
    try {
      const currentRaw = await this.redis.get(key);
      if (currentRaw) {
        const current = JSON.parse(currentRaw) as StrategyPolicy;
        if (validated.computedAt <= current.computedAt) {
          return { committed: false, reason: staleReason(validated.computedAt, current.computedAt) };
        }
      }

      await this.redis.set(key, JSON.stringify(validated), 'EX', TTL_SEC);
      return { committed: true };
    } catch {
      return { committed: false, reason: 'REDIS_ERROR: exception during put; in-memory fallback committed' };
    }
  }

  public async delete(farmId: FarmId, goalId: PolicyGoalKey = 'DEFAULT'): Promise<void> {
    this.fallback.delete(farmId, goalId).catch(() => {});
    try {
      await this.redis.del(keyFor(farmId, goalId));
    } catch {}
  }

  public async flush(): Promise<void> {
    this.fallback.flush().catch(() => {});
    try {
      await this.redis.flushdb();
    } catch {}
  }

  public async disconnect(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {}
  }
}

/**
 * Factory creating a strategy policy store instance.
 */
export function createStrategyPolicyStore(redisClient?: RedisClient): IStrategyPolicyStore {
  if (redisClient) {
    return new RedisStrategyPolicyStore(redisClient);
  }
  return new MemoryStrategyPolicyStore();
}

/**
 * Shared singleton initialized with process.env.REDIS_URL.
 * Gracefully falls back to MemoryStrategyPolicyStore if Redis is unavailable.
 */
function initializeDefaultStrategyPolicyStore(): IStrategyPolicyStore {
  const url = process.env.REDIS_URL;
  if (!url) {
    return new MemoryStrategyPolicyStore();
  }

  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 1000);
      },
    });

    client.on('error', () => {
      // Suppress noisy uncaught errors when Redis is not running locally
    });

    client.connect().catch(() => {});

    return new RedisStrategyPolicyStore(client);
  } catch {
    return new MemoryStrategyPolicyStore();
  }
}

export const strategyPolicyStore: IStrategyPolicyStore = initializeDefaultStrategyPolicyStore();
