/**
 * server/storage/redisHotStore.ts
 * Redis Hot Store client and in-memory test driver.
 * Fast current-state projection of PostgreSQL durable state.
 *
 * Invariants:
 *  - Atomic commit across farm:{farmId}:hot, farm:{farmId}:version, farm:{farmId}:snapshot.
 *  - Stale-write rejection (A6): Writes with version <= current version are rejected.
 *  - Consistency contract: state.snapshotVersion == version key always.
 *  - Redis loss != data loss (state can be recovered from PostgreSQL).
 */

import type { Redis as RedisClient } from 'ioredis';
import type { FarmId, SnapshotVersion, HotFarmCache } from '../domain/index.js';

export interface IRedisHotStore {
  get(farmId: FarmId): Promise<HotFarmCache | null>;
  getVersion(farmId: FarmId): Promise<SnapshotVersion | null>;
  commit(cache: HotFarmCache): Promise<{ committed: boolean; reason?: string }>;
  delete(farmId: FarmId): Promise<void>;
  flush(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * In-memory implementation of IRedisHotStore.
 * Guaranteed identical semantics to live Redis for testing and offline development.
 */
export class MemoryHotStore implements IRedisHotStore {
  private data = new Map<string, string>();

  public async get(farmId: FarmId): Promise<HotFarmCache | null> {
    const raw = this.data.get(`farm:${farmId}:hot`);
    if (!raw) return null;
    return JSON.parse(raw) as HotFarmCache;
  }

  public async getVersion(farmId: FarmId): Promise<SnapshotVersion | null> {
    const vStr = this.data.get(`farm:${farmId}:version`);
    if (!vStr) return null;
    return Number(vStr);
  }

  public async commit(cache: HotFarmCache): Promise<{ committed: boolean; reason?: string }> {
    const currentVersion = await this.getVersion(cache.farmId);

    // Stale-write rejection (A6)
    if (currentVersion !== null && cache.snapshotVersion <= currentVersion) {
      return {
        committed: false,
        reason: `STALE_VERSION: incoming version ${cache.snapshotVersion} <= current version ${currentVersion}`,
      };
    }

    // Atomic update simulation
    const serializedState = JSON.stringify(cache);
    const serializedSnapshot = JSON.stringify({
      farmId: cache.farmId,
      snapshotVersion: cache.snapshotVersion,
      updatedAt: cache.updatedAt,
      syncStatus: cache.syncStatus,
    });

    this.data.set(`farm:${cache.farmId}:hot`, serializedState);
    this.data.set(`farm:${cache.farmId}:version`, String(cache.snapshotVersion));
    this.data.set(`farm:${cache.farmId}:snapshot`, serializedSnapshot);

    return { committed: true };
  }

  public async delete(farmId: FarmId): Promise<void> {
    this.data.delete(`farm:${farmId}:hot`);
    this.data.delete(`farm:${farmId}:version`);
    this.data.delete(`farm:${farmId}:snapshot`);
  }

  public async flush(): Promise<void> {
    this.data.clear();
  }

  public async disconnect(): Promise<void> {
    // No-op for in-memory
  }
}

/**
 * Live Redis implementation of IRedisHotStore using ioredis.
 * Uses atomic MULTI/EXEC pipeline and monotonic version guard.
 */
export class RedisHotStore implements IRedisHotStore {
  constructor(private readonly redis: RedisClient) {}

  public async get(farmId: FarmId): Promise<HotFarmCache | null> {
    const raw = await this.redis.get(`farm:${farmId}:hot`);
    if (!raw) return null;
    return JSON.parse(raw) as HotFarmCache;
  }

  public async getVersion(farmId: FarmId): Promise<SnapshotVersion | null> {
    const vStr = await this.redis.get(`farm:${farmId}:version`);
    if (!vStr) return null;
    return Number(vStr);
  }

  public async commit(cache: HotFarmCache): Promise<{ committed: boolean; reason?: string }> {
    const currentVersion = await this.getVersion(cache.farmId);

    // Stale-write rejection (A6)
    if (currentVersion !== null && cache.snapshotVersion <= currentVersion) {
      return {
        committed: false,
        reason: `STALE_VERSION: incoming version ${cache.snapshotVersion} <= current version ${currentVersion}`,
      };
    }

    const serializedState = JSON.stringify(cache);
    const serializedSnapshot = JSON.stringify({
      farmId: cache.farmId,
      snapshotVersion: cache.snapshotVersion,
      updatedAt: cache.updatedAt,
      syncStatus: cache.syncStatus,
    });

    // Atomic multi pipeline execution
    const pipeline = this.redis.multi();
    pipeline.set(`farm:${cache.farmId}:hot`, serializedState);
    pipeline.set(`farm:${cache.farmId}:version`, String(cache.snapshotVersion));
    pipeline.set(`farm:${cache.farmId}:snapshot`, serializedSnapshot);

    const results = await pipeline.exec();
    if (!results || results.some(([err]) => err !== null)) {
      return { committed: false, reason: 'REDIS_TRANSACTION_FAILED' };
    }

    return { committed: true };
  }

  public async delete(farmId: FarmId): Promise<void> {
    await this.redis.del(`farm:${farmId}:hot`, `farm:${farmId}:version`, `farm:${farmId}:snapshot`);
  }

  public async flush(): Promise<void> {
    await this.redis.flushdb();
  }

  public async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * Factory creating hot store instance.
 */
export function createHotStore(redisClient?: RedisClient): IRedisHotStore {
  if (redisClient) {
    return new RedisHotStore(redisClient);
  }
  return new MemoryHotStore();
}
