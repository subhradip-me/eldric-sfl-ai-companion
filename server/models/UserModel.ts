/**
 * UserModel — database operations for the users table.
 */
import { pool } from '../db/database.js';
import bcrypt from 'bcryptjs';
import type { UserRecord, CreateUserInput } from '../types/index.js';

export class UserModel {
  /** Insert a new user and return the created record. */
  async create(data: CreateUserInput): Promise<UserRecord> {
    const {
      username,
      email,
      passwordHash,
      farmId = null,
      registrationIp = null,
      role = 'USER',
      initialCredits = Number(process.env.INITIAL_AI_CREDITS) || 50,
    } = data;
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, farm_id, registration_ip, role, ai_credits, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, username, email, password_hash, farm_id, registration_ip, role, ai_credits, ai_credits_used, created_at, updated_at, last_login`,
      [username, email, passwordHash, farmId, registrationIp, role, initialCredits]
    );
    return result.rows[0] as UserRecord;
  }

  /** Find a user by username or email (used for login). */
  async findByUsernameOrEmail(identifier: string): Promise<UserRecord | null> {
    const result = await pool.query(
      'SELECT id, username, email, password_hash, farm_id, registration_ip, role, ai_credits, ai_credits_used, created_at, updated_at, last_login FROM users WHERE username = $1 OR email = $1',
      [identifier]
    );
    return (result.rows[0] as UserRecord) ?? null;
  }

  /** Find a user by primary key. */
  async findById(userId: number): Promise<UserRecord | null> {
    const result = await pool.query(
      'SELECT id, username, email, password_hash, farm_id, registration_ip, role, ai_credits, ai_credits_used, created_at, updated_at, last_login FROM users WHERE id = $1',
      [userId]
    );
    return (result.rows[0] as UserRecord) ?? null;
  }

  /** Find an existing non-developer user with the given registration IP. */
  async findByRegistrationIp(ip: string): Promise<UserRecord | null> {
    const result = await pool.query(
      `SELECT id, username, email, password_hash, farm_id, registration_ip, role, ai_credits, ai_credits_used, created_at, updated_at, last_login
       FROM users
       WHERE registration_ip = $1 AND role != 'DEVELOPER' AND username != 'dev'
       LIMIT 1`,
      [ip]
    );
    return (result.rows[0] as UserRecord) ?? null;
  }

  /**
   * Conditional atomic AI credit deduction.
   * Only succeeds if ai_credits >= amount. Returns null if insufficient credits.
   */
  async deductAiCredit(userId: number, amount = 1): Promise<{ ai_credits: number; ai_credits_used: number } | null> {
    const result = await pool.query(
      `UPDATE users
       SET ai_credits = ai_credits - $2,
           ai_credits_used = ai_credits_used + $2,
           updated_at = NOW()
       WHERE id = $1 AND ai_credits >= $2
       RETURNING ai_credits, ai_credits_used`,
      [userId, amount]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0] as { ai_credits: number; ai_credits_used: number };
  }

  /** Add or refund AI credits for a user. */
  async addAiCredits(userId: number, amount: number): Promise<{ ai_credits: number } | null> {
    const result = await pool.query(
      `UPDATE users
       SET ai_credits = ai_credits + $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ai_credits`,
      [userId, amount]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0] as { ai_credits: number };
  }

  /** Return true if either username or email is already taken. */
  async existsByUsernameOrEmail(username: string, email: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    return result.rows.length > 0;
  }

  /** Set the farm_id for a user and bump updated_at. */
  async updateFarmId(userId: number, farmId: string): Promise<Partial<UserRecord>> {
    const result = await pool.query(
      'UPDATE users SET farm_id = $1, updated_at = NOW() WHERE id = $2 RETURNING farm_id',
      [farmId, userId]
    );
    return result.rows[0] as Partial<UserRecord>;
  }

  /** Replace the password hash for a user. */
  async updatePassword(userId: number, newPasswordHash: string): Promise<void> {
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, userId]
    );
  }

  /** Record the current timestamp as last_login. */
  async updateLastLogin(userId: number): Promise<void> {
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [userId]);
  }

  /** Verify a plaintext password against a stored bcrypt hash. */
  async verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  /** Hash a plaintext password with bcrypt (10 rounds). */
  async hashPassword(plainPassword: string): Promise<string> {
    return bcrypt.hash(plainPassword, 10);
  }

  /** Hard-delete a user (cascades in the DB). */
  async delete(userId: number): Promise<void> {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
}

/** Singleton for use across controllers. */
export const User = new UserModel();
