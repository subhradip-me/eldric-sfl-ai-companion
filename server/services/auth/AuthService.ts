/**
 * AuthService — authentication business logic: register, login, token, password.
 * Owns the JWT_SECRET and bcrypt operations. Does NOT handle HTTP (see AuthController).
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AuthResult, JwtPayload } from '../../types/index.js';
import { pool } from '../../db/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

export class AuthService {
  /** Hash a plaintext password with bcrypt (10 rounds). */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  /** Compare a plaintext password against a stored bcrypt hash. */
  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** Sign and return a JWT for the given user. */
  generateToken(userId: number, username: string): string {
    return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }

  /** Verify a JWT and return the decoded payload or throw. */
  verifyToken(token: string): JwtPayload {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  }

  /** Register a new user and return a JWT on success. */
  async register(data: {
    username: string;
    email: string;
    password: string;
    farmId?: string | null;
  }): Promise<AuthResult> {
    const { username, email, password, farmId = null } = data;
    try {
      if (!username || !email || !password) throw new Error('Username, email, and password are required');
      if (password.length < 6) throw new Error('Password must be at least 6 characters long');

      const exists = await pool.query(
        'SELECT id FROM users WHERE username = $1 OR email = $2',
        [username, email]
      );
      if (exists.rows.length > 0) throw new Error('Username or email already exists');

      const passwordHash = await this.hashPassword(password);
      const result = await pool.query(
        `INSERT INTO users (username, email, password_hash, farm_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, email, farm_id, created_at`,
        [username, email, passwordHash, farmId]
      );
      const user = result.rows[0] as { id: number; username: string; email: string; farm_id: string | null; created_at: number };
      const token = this.generateToken(user.id, user.username);

      return {
        success: true,
        user: { id: user.id, username: user.username, email: user.email, farm_id: user.farm_id, created_at: user.created_at },
        token,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** Authenticate a user by username/email + password, return JWT on success. */
  async login(data: { username: string; password: string }): Promise<AuthResult> {
    const { username, password } = data;
    try {
      if (!username || !password) throw new Error('Username and password are required');

      const result = await pool.query(
        'SELECT id, username, email, password_hash, farm_id FROM users WHERE username = $1 OR email = $1',
        [username]
      );
      if (result.rows.length === 0) throw new Error('Invalid username or password');

      const user = result.rows[0] as { id: number; username: string; email: string; password_hash: string; farm_id: string | null };
      const valid = await this.verifyPassword(password, user.password_hash);
      if (!valid) throw new Error('Invalid username or password');

      await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

      const token = this.generateToken(user.id, user.username);
      return {
        success: true,
        user: { id: user.id, username: user.username, email: user.email, farm_id: user.farm_id },
        token,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** Fetch a user record by primary key. */
  async getUserById(userId: number): Promise<AuthResult> {
    try {
      const result = await pool.query(
        'SELECT id, username, email, farm_id, created_at, last_login FROM users WHERE id = $1',
        [userId]
      );
      if (result.rows.length === 0) throw new Error('User not found');
      return { success: true, user: result.rows[0] as AuthResult['user'] };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** Update the farm ID associated with a user account. */
  async updateFarmId(userId: number, farmId: string): Promise<AuthResult> {
    try {
      await pool.query(
        'UPDATE users SET farm_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [farmId, userId]
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** Change a user's password after verifying the current one. */
  async changePassword(userId: number, oldPassword: string, newPassword: string): Promise<AuthResult> {
    try {
      const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) throw new Error('User not found');

      const valid = await this.verifyPassword(oldPassword, (result.rows[0] as { password_hash: string }).password_hash);
      if (!valid) throw new Error('Current password is incorrect');

      const newHash = await this.hashPassword(newPassword);
      await pool.query(
        'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newHash, userId]
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}

export const authService = new AuthService();
