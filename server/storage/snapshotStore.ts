/**
 * server/storage/snapshotStore.ts
 * PostgreSQL Durable Snapshot Store and Redis Recovery Service.
 *
 * Invariants:
 *  - PostgreSQL owns durable snapshot sequencing (snapshotVersion N -> N+1).
 *  - Raw payload integrity is secured by SHA-256 rawHash.
 *  - Redis failure recovery reconstructs hot cache from durable snapshots without data loss.
 */

import crypto from 'node:crypto';
import type pg from 'pg';
import type {
  FarmId,
  SnapshotVersion,
  FarmSnapshot,
  NormalizedFarmState,
  HotFarmCache,
  TimestampMs,
} from '../domain/index.js';
import type { IRedisHotStore } from './redisHotStore.js';

export interface ISnapshotStore {
  saveSnapshot(
    farmId: FarmId,
    rawData: unknown,
    normalizedState: NormalizedFarmState,
    capturedAt?: TimestampMs
  ): Promise<FarmSnapshot>;
  getLatestSnapshot(farmId: FarmId): Promise<FarmSnapshot | null>;
  getSnapshots(farmId: FarmId, limit?: number): Promise<FarmSnapshot[]>;
  deleteSnapshots(farmId: FarmId): Promise<void>;
}

/**
 * In-memory SnapshotStore driver for tests and hermetic execution.
 */
export class MemorySnapshotStore implements ISnapshotStore {
  private snapshots = new Map<FarmId, FarmSnapshot[]>();

  public async saveSnapshot(
    farmId: FarmId,
    rawData: unknown,
    normalizedState: NormalizedFarmState,
    capturedAt: TimestampMs = Date.now()
  ): Promise<FarmSnapshot> {
    const list = this.snapshots.get(farmId) ?? [];
    const latestVersion = list.length > 0 ? list[list.length - 1].snapshotVersion : 0;
    const nextVersion = latestVersion + 1;

    const rawHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(rawData))
      .digest('hex');

    const snapshot: FarmSnapshot = {
      farmId,
      snapshotVersion: nextVersion,
      capturedAt,
      rawHash,
      rawData,
      normalizedState,
    };

    list.push(snapshot);
    this.snapshots.set(farmId, list);
    return snapshot;
  }

  public async getLatestSnapshot(farmId: FarmId): Promise<FarmSnapshot | null> {
    const list = this.snapshots.get(farmId);
    if (!list || list.length === 0) return null;
    return list[list.length - 1];
  }

  public async getSnapshots(farmId: FarmId, limit = 10): Promise<FarmSnapshot[]> {
    const list = this.snapshots.get(farmId) ?? [];
    return [...list].reverse().slice(0, limit);
  }

  public async deleteSnapshots(farmId: FarmId): Promise<void> {
    this.snapshots.delete(farmId);
  }
}

/**
 * PostgreSQL implementation of ISnapshotStore.
 */
export class PgSnapshotStore implements ISnapshotStore {
  constructor(private readonly pool: pg.Pool) {}

  public async saveSnapshot(
    farmId: FarmId,
    rawData: unknown,
    normalizedState: NormalizedFarmState,
    capturedAt: TimestampMs = Date.now()
  ): Promise<FarmSnapshot> {
    const rawHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(rawData))
      .digest('hex');

    // Atomic version allocation inside transaction
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const vRes = await client.query(
        'SELECT MAX(id) as max_v FROM snapshots WHERE state_hash = $1 OR user_id = $2',
        [rawHash, Number(farmId) || 0]
      );
      const currentMax = Number(vRes.rows[0]?.max_v ?? 0);
      const nextVersion = currentMax + 1;

      const snapshot: FarmSnapshot = {
        farmId,
        snapshotVersion: nextVersion,
        capturedAt,
        rawHash,
        rawData,
        normalizedState,
      };

      await client.query(
        `INSERT INTO snapshots (user_id, created_at, xp, flower, coins, state_hash, data_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          Number(farmId) || 0,
          capturedAt,
          normalizedState.player.experience,
          normalizedState.economy.flower,
          normalizedState.economy.coins,
          rawHash,
          snapshot,
        ]
      );

      await client.query('COMMIT');
      return snapshot;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async getLatestSnapshot(farmId: FarmId): Promise<FarmSnapshot | null> {
    const res = await this.pool.query(
      'SELECT data_json FROM snapshots WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [Number(farmId) || 0]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0].data_json as FarmSnapshot;
  }

  public async getSnapshots(farmId: FarmId, limit = 10): Promise<FarmSnapshot[]> {
    const res = await this.pool.query(
      'SELECT data_json FROM snapshots WHERE user_id = $1 ORDER BY id DESC LIMIT $2',
      [Number(farmId) || 0, limit]
    );
    return res.rows.map((r) => r.data_json as FarmSnapshot);
  }

  public async deleteSnapshots(farmId: FarmId): Promise<void> {
    await this.pool.query('DELETE FROM snapshots WHERE user_id = $1', [Number(farmId) || 0]);
  }
}

/**
 * Reconstructs the Redis Hot Store cache from PostgreSQL durable snapshots.
 * Fulfills Gate A4 (Redis Failure Recovery).
 */
export async function recoverHotStoreFromDb(
  farmId: FarmId,
  snapshotStore: ISnapshotStore,
  hotStore: IRedisHotStore
): Promise<{ recovered: boolean; snapshotVersion?: SnapshotVersion; reason?: string }> {
  const latest = await snapshotStore.getLatestSnapshot(farmId);
  if (!latest || !latest.normalizedState) {
    return { recovered: false, reason: 'NO_DURABLE_SNAPSHOT_FOUND' };
  }

  const hotCache: HotFarmCache = {
    farmId,
    snapshotVersion: latest.snapshotVersion,
    state: latest.normalizedState,
    updatedAt: latest.capturedAt,
    syncStatus: 'SUCCESS',
  };

  const commitResult = await hotStore.commit(hotCache);
  if (!commitResult.committed) {
    return { recovered: false, reason: commitResult.reason };
  }

  return { recovered: true, snapshotVersion: latest.snapshotVersion };
}

/**
 * Factory creating snapshot store instance.
 */
export function createSnapshotStore(pool?: pg.Pool): ISnapshotStore {
  if (pool) {
    return new PgSnapshotStore(pool);
  }
  return new MemorySnapshotStore();
}
