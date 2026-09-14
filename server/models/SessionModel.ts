/**
 * server/models/SessionModel.ts
 * Database operations for active_sessions table (concurrent device cap: 1 desktop + 1 mobile).
 */
import crypto from 'crypto';
import { db } from '../db/database.js';
import type { DeviceType, ActiveSession } from '../types/index.js';

export class SessionModel {
  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  static async findByUserAndDevice(
    userId: number,
    deviceType: DeviceType
  ): Promise<ActiveSession | null> {
    const result = await db.query(
      `SELECT * FROM active_sessions WHERE user_id = $1 AND device_type = $2`,
      [userId, deviceType]
    );
    return (result.rows[0] as ActiveSession) ?? null;
  }

  /**
   * Plain insert, not upsert — a conflicting row must be deleted explicitly
   * (via deleteByUserAndDevice, on confirmed disconnect) before a new one
   * can be created. Catches the 23505 unique-violation as a race-safety net
   * for two logins landing at the same instant.
   */
  static async create(
    userId: number,
    deviceType: DeviceType,
    refreshToken: string
  ): Promise<ActiveSession | null> {
    const tokenHash = this.hashToken(refreshToken);
    try {
      const result = await db.query(
        `INSERT INTO active_sessions (user_id, device_type, refresh_token_hash)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [userId, deviceType, tokenHash]
      );
      return result.rows[0] as ActiveSession;
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') return null; // slot taken by a concurrent request
      throw err;
    }
  }

  static async deleteByUserAndDevice(userId: number, deviceType: DeviceType): Promise<void> {
    await db.query(
      `DELETE FROM active_sessions WHERE user_id = $1 AND device_type = $2`,
      [userId, deviceType]
    );
  }

  static async validateRefreshToken(
    userId: number,
    deviceType: DeviceType,
    refreshToken: string
  ): Promise<boolean> {
    const tokenHash = this.hashToken(refreshToken);
    const result = await db.query(
      `SELECT 1 FROM active_sessions WHERE user_id = $1 AND device_type = $2 AND refresh_token_hash = $3`,
      [userId, deviceType, tokenHash]
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async touchLastActive(userId: number, deviceType: DeviceType): Promise<void> {
    await db.query(
      `UPDATE active_sessions SET last_active_at = now() WHERE user_id = $1 AND device_type = $2`,
      [userId, deviceType]
    );
  }
}
