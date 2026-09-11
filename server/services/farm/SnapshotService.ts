/**
 * SnapshotService — User-specific farm snapshot persistence with SHA-1 dedup (design §11).
 */
import crypto from 'node:crypto';
import type { CanonicalFarmState, SnapshotRecord } from '../../types/index.js';
import { pool } from '../../db/database.js';

export class SnapshotService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hash(c: any): string {
    const xp = c?.bumpkin?.xp ?? c?.bumpkin?.experience ?? c?.farm?.bumpkin?.experience ?? 0;
    const farmAct = c?.farmActivity ?? c?.farm?.farmActivity ?? {};
    const inv = c?.inventory ?? c?.farm?.inventory ?? {};
    return crypto
      .createHash('sha1')
      .update(JSON.stringify([xp, farmAct, inv]))
      .digest('hex');
  }

  /** Persist a farm state snapshot for a user, skipping duplicates. */
  async save(
    payload: unknown,
    userId: number
  ): Promise<{ saved: boolean; reason?: string }> {
    if (!userId) {
      console.warn('No userId provided for snapshot save');
      return { saved: false, reason: 'no_user' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = payload as any;
    const h = this.hash(c);
    const last = await pool.query(
      'SELECT state_hash FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    if (last.rows[0]?.state_hash === h) {
      return { saved: false, reason: 'unchanged' };
    }

    const xp = c?.bumpkin?.xp ?? c?.bumpkin?.experience ?? c?.farm?.bumpkin?.experience ?? 0;
    const flower = c?.currencies?.flower ?? c?.farm?.balance ?? c?.balance ?? '0';
    const coins = c?.currencies?.coins ?? c?.farm?.coins ?? c?.coins ?? 0;

    await pool.query(
      'INSERT INTO snapshots (user_id, created_at, xp, flower, coins, state_hash, data_json) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        userId,
        Date.now(),
        xp,
        flower,
        coins,
        h,
        payload,
      ]
    );

    return { saved: true };
  }

  /** Get the N most recent snapshots for a user. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async latest(userId: number, n = 2): Promise<any[]> {
    if (!userId) {
      console.warn('No userId provided for latest snapshots');
      return [];
    }
    const r = await pool.query(
      'SELECT created_at, data_json FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, n]
    );
    return r.rows.map((row) => row.data_json);
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
