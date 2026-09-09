/**
 * SnapshotService — User-specific farm snapshot persistence with SHA-1 dedup (design §11).
 */
import crypto from 'node:crypto';
import type { CanonicalFarmState, SnapshotRecord } from '../../types/index.js';
import { pool } from '../../db/database.js';

export class SnapshotService {
  private hash(c: CanonicalFarmState): string {
    return crypto
      .createHash('sha1')
      .update(JSON.stringify([c.bumpkin.xp, c.farmActivity, c.inventory]))
      .digest('hex');
  }

  /** Persist a canonical farm state for a user, skipping duplicates. */
  async save(
    canonical: CanonicalFarmState,
    userId: number
  ): Promise<{ saved: boolean; reason?: string }> {
    if (!userId) {
      console.warn('No userId provided for snapshot save');
      return { saved: false, reason: 'no_user' };
    }

    const h = this.hash(canonical);
    const last = await pool.query(
      'SELECT state_hash FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    if (last.rows[0]?.state_hash === h) {
      return { saved: false, reason: 'unchanged' };
    }

    await pool.query(
      'INSERT INTO snapshots (user_id, created_at, xp, flower, coins, state_hash, data_json) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        userId,
        Date.now(),
        canonical.bumpkin.xp,
        canonical.currencies.flower,
        canonical.currencies.coins,
        h,
        canonical,
      ]
    );

    return { saved: true };
  }

  /** Get the N most recent snapshots for a user. */
  async latest(userId: number, n = 2): Promise<CanonicalFarmState[]> {
    if (!userId) {
      console.warn('No userId provided for latest snapshots');
      return [];
    }
    const r = await pool.query(
      'SELECT created_at, data_json FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, n]
    );
    return r.rows.map((row) => row.data_json as CanonicalFarmState);
  }

  /** Get all snapshots for a user, sorted newest first. */
  async getLatest(userId: number, limit = 10): Promise<SnapshotRecord[]> {
    const r = await pool.query(
      'SELECT * FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return r.rows as SnapshotRecord[];
  }

  /** Get XP time-series data for the past N days. */
  async getXpProgression(userId: number, days = 7): Promise<{ created_at: number; xp: number }[]> {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const r = await pool.query(
      'SELECT created_at, xp FROM snapshots WHERE user_id = $1 AND created_at >= $2 ORDER BY created_at ASC',
      [userId, startTime]
    );
    return r.rows as { created_at: number; xp: number }[];
  }

  /** Check whether a state hash already exists for this user. */
  async existsByHash(userId: number, stateHash: string): Promise<boolean> {
    const r = await pool.query(
      'SELECT id FROM snapshots WHERE user_id = $1 AND state_hash = $2',
      [userId, stateHash]
    );
    return r.rows.length > 0;
  }

  /** Prune old snapshots, keeping the latest N per user. */
  async deleteOld(userId: number, keepCount = 50): Promise<void> {
    await pool.query(
      `DELETE FROM snapshots
       WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
       )`,
      [userId, keepCount]
    );
  }
}

export const snapshotService = new SnapshotService();
