/**
 * UserModel — database operations for the users table.
 */
import { pool } from '../db/database.js';
import bcrypt from 'bcryptjs';
import type { UserRecord, CreateUserInput } from '../types/index.js';

export class UserModel {
  /** Insert a new user and return the created record. */
  async create(data: CreateUserInput): Promise<UserRecord> {
    const { username, email, passwordHash, farmId = null } = data;
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, farm_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, username, email, password_hash, farm_id, created_at, updated_at, last_login`,
      [username, email, passwordHash, farmId]
    );
    return result.rows[0] as UserRecord;
  }

  /** Find a user by username or email (used for login). */
  async findByUsernameOrEmail(identifier: string): Promise<UserRecord | null> {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [identifier]
    );
    return (result.rows[0] as UserRecord) ?? null;
  }

  /** Find a user by primary key. */
  async findById(userId: number): Promise<UserRecord | null> {
    const result = await pool.query(
      'SELECT id, username, email, password_hash, farm_id, created_at, updated_at, last_login FROM users WHERE id = $1',
      [userId]
    );
    return (result.rows[0] as UserRecord) ?? null;
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
