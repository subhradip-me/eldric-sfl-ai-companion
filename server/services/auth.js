import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

export const authService = {
  /**
   * Register a new user
   */
  async register({ username, email, password, farmId = null }) {
    try {
      // Validate input
      if (!username || !email || !password) {
        throw new Error('Username, email, and password are required');
      }

      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
      }

      // Check if user already exists
      const existingUser = await db.query(
        'SELECT id FROM users WHERE username = $1 OR email = $2',
        [username, email]
      );

      if (existingUser.rows.length > 0) {
        throw new Error('Username or email already exists');
      }

      // Hash password
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Insert user
      const result = await db.query(
        `INSERT INTO users (username, email, password_hash, farm_id) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, username, email, farm_id, created_at`,
        [username, email, passwordHash, farmId]
      );

      const user = result.rows[0];

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          farmId: user.farm_id,
          createdAt: user.created_at,
        },
        token,
      };
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  },

  /**
   * Login user
   */
  async login({ username, password }) {
    try {
      // Validate input
      if (!username || !password) {
        throw new Error('Username and password are required');
      }

      // Find user
      const result = await db.query(
        'SELECT id, username, email, password_hash, farm_id FROM users WHERE username = $1 OR email = $1',
        [username]
      );

      if (result.rows.length === 0) {
        throw new Error('Invalid username or password');
      }

      const user = result.rows[0];

      // Verify password
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        throw new Error('Invalid username or password');
      }

      // Update last login
      await db.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          farmId: user.farm_id,
        },
        token,
      };
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  },

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return {
        success: true,
        userId: decoded.userId,
        username: decoded.username,
      };
    } catch (error) {
      return {
        success: false,
        error: 'Invalid or expired token',
      };
    }
  },

  /**
   * Get user by ID
   */
  async getUserById(userId) {
    try {
      const result = await db.query(
        'SELECT id, username, email, farm_id, created_at, last_login FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      return {
        success: true,
        user: result.rows[0],
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  /**
   * Update user farm ID
   */
  async updateFarmId(userId, farmId) {
    try {
      await db.query(
        'UPDATE users SET farm_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [farmId, userId]
      );

      return { success: true };
    } catch (error) {
      console.error('Update farm ID error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  },

  /**
   * Change password
   */
  async changePassword(userId, oldPassword, newPassword) {
    try {
      // Get current password hash
      const result = await db.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      // Verify old password
      const isValid = await bcrypt.compare(oldPassword, result.rows[0].password_hash);
      if (!isValid) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password
      const saltRounds = 10;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      await db.query(
        'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newPasswordHash, userId]
      );

      return { success: true };
    } catch (error) {
      console.error('Change password error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

/**
 * Middleware to protect routes
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const result = authService.verifyToken(token);
  if (!result.success) {
    return res.status(403).json({ error: result.error });
  }

  req.userId = result.userId;
  req.username = result.username;
  next();
}

/**
 * Optional authentication middleware (doesn't fail if no token)
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    const result = authService.verifyToken(token);
    if (result.success) {
      req.userId = result.userId;
      req.username = result.username;
    }
  }

  next();
}
