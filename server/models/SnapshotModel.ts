/**
 * SnapshotModel — database operations for the snapshots table.
 * For service-level snapshot logic (save with dedup), use SnapshotService.
 */
import { pool } from '../db/database.js';
import type { SnapshotRecord, CreateSnapshotInput } from '../types/index.js';

export class SnapshotModel {
  /** Insert a new snapshot record. */
  async create(data: CreateSnapshotInput): Promise<SnapshotRecord> {
    const { userId, createdAt, xp, flower, coins, stateHash, dataJson } = data;
    const result = await pool.query(
      `INSERT INTO snapshots (user_id, created_at, xp, flower, coins, state_hash, data_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, createdAt, xp, flower, coins, stateHash, dataJson]
    );
    return result.rows[0] as SnapshotRecord;
  }

  /** Get the N most recent snapshots for a user. */
  async getLatest(userId: number, limit = 10): Promise<SnapshotRecord[]> {
    const result = await pool.query(
      'SELECT * FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows as SnapshotRecord[];
  }

  /** Find a specific snapshot by ID (must be owned by user). */
  async findById(id: number, userId: number): Promise<SnapshotRecord | null> {
    const result = await pool.query(
      'SELECT * FROM snapshots WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return (result.rows[0] as SnapshotRecord) ?? null;
  }

  /** Get snapshots within a time range for a user. */
  async getByTimeRange(userId: number, startTime: number, endTime: number): Promise<SnapshotRecord[]> {
    const result = await pool.query(
      'SELECT * FROM snapshots WHERE user_id = $1 AND created_at BETWEEN $2 AND $3 ORDER BY created_at ASC',
      [userId, startTime, endTime]
    );
    return result.rows as SnapshotRecord[];
  }

  /** Check whether a state hash already exists for this user. */
  async existsByHash(userId: number, stateHash: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT id FROM snapshots WHERE user_id = $1 AND state_hash = $2',
      [userId, stateHash]
    );
    return result.rows.length > 0;
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

  /** Get XP time-series for the past N days. */
  async getXpProgression(userId: number, days = 7): Promise<{ created_at: number; xp: number }[]> {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const result = await pool.query(
      'SELECT created_at, xp FROM snapshots WHERE user_id = $1 AND created_at >= $2 ORDER BY created_at ASC',
      [userId, startTime]
    );
    return result.rows as { created_at: number; xp: number }[];
  }
}

/** Singleton for use across controllers. */
export const Snapshot = new SnapshotModel();
