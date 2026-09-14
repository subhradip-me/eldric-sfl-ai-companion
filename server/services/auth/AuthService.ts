/**
 * server/services/auth/AuthService.ts
 * Authentication business logic: register, login, session cap, tokens, IP gating.
 * Owns JWT operations, bcrypt, and coordinates with SessionModel.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AuthResult, JwtPayload, DeviceType, UserRecord } from '../../types/index.js';
import { pool } from '../../db/database.js';
import { SessionModel } from '../../models/SessionModel.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const ACCESS_TOKEN_TTL = (process.env.ACCESS_TOKEN_TTL || '15m') as `${number}${'s'|'m'|'h'|'d'}`;
const REFRESH_TOKEN_TTL = (process.env.REFRESH_TOKEN_TTL || '30d') as `${number}${'s'|'m'|'h'|'d'}`;

export class AuthService {
  /** Hash a plaintext password with bcrypt (10 rounds). */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  /** Compare a plaintext password against a stored bcrypt hash. */
  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** Sign and return a short-lived access token JWT for the given user. */
  generateToken(userId: number, username: string): string {
    return this.issueAccessToken({ id: userId, username });
  }

  /** Issue short-lived access token (ACCESS_TOKEN_TTL). */
  issueAccessToken(user: { id: number; username?: string }): string {
    return jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL }
    );
  }

  /** Issue long-lived refresh token carrying { userId, deviceType, jti } (REFRESH_TOKEN_TTL). */
  issueRefreshToken(user: { id: number; username?: string }, deviceType: DeviceType): string {
    const jti = crypto.randomUUID();
    return jwt.sign(
      { userId: user.id, username: user.username, deviceType, jti },
      JWT_SECRET,
      { expiresIn: REFRESH_TOKEN_TTL }
    );
  }

  /** Verify a JWT and return the decoded payload or throw. */
  verifyToken(token: string): JwtPayload {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  }

  /** Verify a refresh token and return claims or throw. */
  verifyRefreshToken(token: string): { userId: number; username: string; deviceType: DeviceType; jti: string } {
    return jwt.verify(token, JWT_SECRET) as { userId: number; username: string; deviceType: DeviceType; jti: string };
  }

  /**
   * Register a new user with 1-account-per-IP enforcement (developer accounts exempted).
   * Note: This check runs ONLY on register(), never on login().
   */
  async register(data: {
    username: string;
    email: string;
    password: string;
    farmId?: string | null;
    registrationIp?: string | null;
    role?: string;
  }): Promise<AuthResult> {
    const {
      username,
      email,
      password,
      farmId = null,
      registrationIp = null,
      role = username === 'dev' ? 'DEVELOPER' : 'USER',
    } = data;

    try {
      if (!username || !email || !password) throw new Error('Username, email, and password are required');
      if (password.length < 6) throw new Error('Password must be at least 6 characters long');

      // 1. One account per IP constraint (Developer accounts exempted)
      if (role !== 'DEVELOPER' && username !== 'dev' && registrationIp) {
        const ipExists = await pool.query(
          `SELECT id FROM users WHERE registration_ip = $1 AND role != 'DEVELOPER' AND username != 'dev'`,
          [registrationIp]
        );
        if (ipExists.rows.length > 0) {
          return {
            success: false,
            error: 'Account registration limit reached. Only one account per IP address is permitted.',
          };
        }
      }

      // 2. Check if username or email is already taken
      const exists = await pool.query(
        'SELECT id FROM users WHERE username = $1 OR email = $2',
        [username, email]
      );
      if (exists.rows.length > 0) throw new Error('Username or email already exists');

      const initialCredits = role === 'DEVELOPER' ? 999999 : Number(process.env.INITIAL_AI_CREDITS) || 50;
      const passwordHash = await this.hashPassword(password);

      const result = await pool.query(
        `INSERT INTO users (username, email, password_hash, farm_id, registration_ip, role, ai_credits, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING id, username, email, farm_id, registration_ip, role, ai_credits, ai_credits_used, created_at`,
        [username, email, passwordHash, farmId, registrationIp, role, initialCredits]
      );

      const user = result.rows[0] as UserRecord;
      const accessToken = this.issueAccessToken(user);

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          farm_id: user.farm_id,
          farmId: user.farm_id,
          role: user.role,
          ai_credits: user.ai_credits,
          aiCredits: user.ai_credits,
          ai_credits_used: user.ai_credits_used,
          aiCreditsUsed: user.ai_credits_used,
          created_at: user.created_at,
        },
        token: accessToken,
        accessToken,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Authenticate user with device-specific concurrent session cap (1 desktop + 1 mobile).
   * If a slot is occupied and forceDisconnect is false, returns conflict for user confirmation.
   */
  async login(
    username: string,
    password: string,
    deviceType: DeviceType = 'desktop',
    forceDisconnect = false
  ): Promise<AuthResult> {
    try {
      if (!username || !password) throw new Error('Username and password are required');

      const result = await pool.query(
        'SELECT id, username, email, password_hash, farm_id, role, ai_credits, ai_credits_used FROM users WHERE username = $1 OR email = $1',
        [username]
      );
      if (result.rows.length === 0) throw new Error('Invalid username or password');

      const user = result.rows[0] as UserRecord;
      const valid = await this.verifyPassword(password, user.password_hash);
      if (!valid) throw new Error('Invalid username or password');

      // Check concurrent session cap for this device type
      const existingSession = await SessionModel.findByUserAndDevice(user.id, deviceType);
      if (existingSession && !forceDisconnect) {
        return {
          success: false,
          conflict: true,
          deviceType,
          error: `You're already logged in on ${deviceType}. Disconnect that session to continue here.`,
        };
      }

      if (existingSession && forceDisconnect) {
        await SessionModel.deleteByUserAndDevice(user.id, deviceType);
      }

      const accessToken = this.issueAccessToken(user);
      const refreshToken = this.issueRefreshToken(user, deviceType);

      const session = await SessionModel.create(user.id, deviceType, refreshToken);
      if (!session) {
        // Lost a race to a concurrent login for the same device type
        return {
          success: false,
          conflict: true,
          deviceType,
          error: `You're already logged in on ${deviceType}. Disconnect that session to continue here.`,
        };
      }

      await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          farm_id: user.farm_id,
          farmId: user.farm_id,
          role: user.role,
          ai_credits: user.ai_credits,
          aiCredits: user.ai_credits,
          ai_credits_used: user.ai_credits_used,
          aiCreditsUsed: user.ai_credits_used,
        },
        token: accessToken,
        accessToken,
        refreshToken,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Renew access token using refresh token, checking hash against active_sessions.
   * If session was revoked or disconnected via force-login elsewhere, rejects with 401.
   */
  async refreshAccessToken(refreshToken: string): Promise<{ success: boolean; accessToken?: string; error?: string }> {
    try {
      const claims = this.verifyRefreshToken(refreshToken);
      const valid = await SessionModel.validateRefreshToken(claims.userId, claims.deviceType, refreshToken);
      if (!valid) {
        return { success: false, error: 'Session disconnected. Please log in again.' };
      }

      await SessionModel.touchLastActive(claims.userId, claims.deviceType);
      const accessToken = this.issueAccessToken({ id: claims.userId, username: claims.username });
      return { success: true, accessToken };
    } catch (err) {
      return { success: false, error: (err as Error).message || 'Invalid or expired refresh token' };
    }
  }

  /** Terminate session for given user and device type. */
  async logout(userId: number, deviceType: DeviceType): Promise<{ success: boolean }> {
    await SessionModel.deleteByUserAndDevice(userId, deviceType);
    return { success: true };
  }

  /** Fetch a user record by primary key. */
  async getUserById(userId: number): Promise<AuthResult> {
    try {
      const result = await pool.query(
        'SELECT id, username, email, farm_id, role, ai_credits, ai_credits_used, created_at, last_login FROM users WHERE id = $1',
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
      return { success: true, user: { farm_id: farmId } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** Change password for an authenticated user after verifying old password. */
  async changePassword(userId: number, oldPass: string, newPass: string): Promise<AuthResult> {
    try {
      if (newPass.length < 6) throw new Error('New password must be at least 6 characters long');

      const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) throw new Error('User not found');

      const valid = await this.verifyPassword(oldPass, result.rows[0].password_hash);
      if (!valid) throw new Error('Incorrect current password');

      const newHash = await this.hashPassword(newPass);
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
