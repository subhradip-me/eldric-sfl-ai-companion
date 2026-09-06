import { pool } from '../db/database.js';
import bcrypt from 'bcryptjs';

export const User = {
  /**
   * Create a new user
   */
  async create({ username, email, passwordHash, farmId = null }) {
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, farm_id, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, NOW(), NOW()) 
       RETURNING id, username, email, farm_id, created_at`,
      [username, email, passwordHash, farmId]
    );
    return result.rows[0];
  },

  /**
   * Find user by username or email
   */
  async findByUsernameOrEmail(identifier) {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [identifier]
    );
    return result.rows[0];
  },

  /**
   * Find user by ID
   */
  async findById(userId) {
    const result = await pool.query(
      'SELECT id, username, email, farm_id, created_at, updated_at, last_login FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0];
  },

  /**
   * Check if username or email exists
   */
  async existsByUsernameOrEmail(username, email) {
    const result = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    return result.rows.length > 0;
  },

  /**
   * Update user's last login timestamp
   */
  async updateLastLogin(userId) {
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [userId]
    );
  },

  /**
   * Update user's farm ID
   */
  async updateFarmId(userId, farmId) {
    const result = await pool.query(
      'UPDATE users SET farm_id = $1, updated_at = NOW() WHERE id = $2 RETURNING farm_id',
      [farmId, userId]
    );
    return result.rows[0];
  },

  /**
   * Update user's password
   */
  async updatePassword(userId, newPasswordHash) {
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, userId]
    );
  },

  /**
   * Verify password
   */
  async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  },

  /**
   * Hash password
   */
  async hashPassword(plainPassword) {
    return await bcrypt.hash(plainPassword, 10);
  },

  /**
   * Delete user (cascade deletes related data)
   */
  async delete(userId) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  },
};
