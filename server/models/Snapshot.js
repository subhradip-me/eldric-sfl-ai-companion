import { pool } from '../db/database.js';

export const Snapshot = {
  /**
   * Create a new farm snapshot (user-specific)
   */
  async create({ userId, createdAt, xp, flower, coins, stateHash, dataJson }) {
    const result = await pool.query(
      `INSERT INTO snapshots (user_id, created_at, xp, flower, coins, state_hash, data_json) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [userId, createdAt, xp, flower, coins, stateHash, dataJson]
    );
    return result.rows[0];
  },

  /**
   * Get latest N snapshots for a user
   */
  async getLatest(userId, limit = 10) {
    const result = await pool.query(
      `SELECT * FROM snapshots 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  },

  /**
   * Get snapshot by ID (user must own it)
   */
  async findById(id, userId) {
    const result = await pool.query(
      'SELECT * FROM snapshots WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return result.rows[0];
  },

  /**
   * Get snapshots within a time range for a user
   */
  async getByTimeRange(userId, startTime, endTime) {
    const result = await pool.query(
      `SELECT * FROM snapshots 
       WHERE user_id = $1 AND created_at BETWEEN $2 AND $3 
       ORDER BY created_at ASC`,
      [userId, startTime, endTime]
    );
    return result.rows;
  },

  /**
   * Check if snapshot with hash already exists for user
   */
  async existsByHash(userId, stateHash) {
    const result = await pool.query(
      'SELECT id FROM snapshots WHERE user_id = $1 AND state_hash = $2',
      [userId, stateHash]
    );
    return result.rows.length > 0;
  },

  /**
   * Delete old snapshots (keep last N for each user)
   */
  async deleteOldSnapshots(userId, keepCount = 50) {
    await pool.query(
      `DELETE FROM snapshots 
       WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM snapshots 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2
       )`,
      [userId, keepCount]
    );
  },

  /**
   * Get XP progression for a user
   */
  async getXpProgression(userId, days = 7) {
    const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const result = await pool.query(
      `SELECT created_at, xp 
       FROM snapshots 
       WHERE user_id = $1 AND created_at >= $2 
       ORDER BY created_at ASC`,
      [userId, startTime]
    );
    return result.rows;
  },
};
