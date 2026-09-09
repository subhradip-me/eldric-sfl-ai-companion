import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { getFarm } from '../services/sunflower.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

/**
 * Generate JWT token
 */
function generateToken(userId, username) {
  return jwt.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export const authController = {
  /**
   * Register a new user
   */
  async register(req, res) {
    try {
      const { username, email, password, farmId } = req.body;

      // Validate input
      if (!username || !email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username, email, and password are required',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters long',
        });
      }

      // Check if user already exists
      const exists = await User.existsByUsernameOrEmail(username, email);
      if (exists) {
        return res.status(400).json({
          success: false,
          error: 'Username or email already exists',
        });
      }

      // Hash password and create user
      const passwordHash = await User.hashPassword(password);
      const user = await User.create({
        username,
        email,
        passwordHash,
        farmId: farmId || null,
      });

      // Generate token
      const token = generateToken(user.id, user.username);

      return res.status(201).json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          farmId: user.farm_id,
          createdAt: user.created_at,
        },
        token,
      });
    } catch (error) {
      console.error('Registration error:', error);
      return res.status(500).json({
        success: false,
        error: 'Registration failed. Please try again.',
      });
    }
  },

  /**
   * Login user
   */
  async login(req, res) {
    try {
      const { username, password } = req.body;

      // Validate input
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required',
        });
      }

      // Find user
      const user = await User.findByUsernameOrEmail(username);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Invalid username or password',
        });
      }

      // Verify password
      const isValid = await User.verifyPassword(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid username or password',
        });
      }

      // Update last login
      await User.updateLastLogin(user.id);

      // Generate token
      const token = generateToken(user.id, user.username);

      return res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          farmId: user.farm_id,
        },
        token,
      });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({
        success: false,
        error: 'Login failed. Please try again.',
      });
    }
  },

  /**
   * Get current user info
   */
  async me(req, res) {
    try {
      const user = await User.findById(req.userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      return res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          farmId: user.farm_id,
          createdAt: user.created_at,
          lastLogin: user.last_login,
        },
      });
    } catch (error) {
      console.error('Get user error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get user information',
      });
    }
  },

  /**
   * Update user's farm ID — validates that the farm actually exists first
   */
  async updateFarmId(req, res) {
    try {
      const { farmId } = req.body;

      if (!farmId) {
        return res.status(400).json({
          success: false,
          error: 'Farm ID is required',
        });
      }

      // Must be a valid integer
      const id = Number(farmId);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Farm ID must be a positive integer',
        });
      }

      // Verify the farm actually exists on the Sunflower Land API
      try {
        await getFarm(String(id));
      } catch (err) {
        return res.status(400).json({
          success: false,
          error: `Farm #${id} not found on Sunflower Land. Double-check your Farm ID.`,
        });
      }

      await User.updateFarmId(req.userId, String(id));

      return res.json({
        success: true,
        message: 'Farm ID updated successfully',
        farmId: String(id),
      });
    } catch (error) {
      console.error('Update farm ID error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update farm ID',
      });
    }
  },

  /**
   * Change user password
   */
  async changePassword(req, res) {
    try {
      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Old and new passwords are required',
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters long',
        });
      }

      // Get user
      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      // Verify old password
      const isValid = await User.verifyPassword(oldPassword, user.password_hash);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          error: 'Current password is incorrect',
        });
      }

      // Hash and update new password
      const newPasswordHash = await User.hashPassword(newPassword);
      await User.updatePassword(req.userId, newPasswordHash);

      return res.json({
        success: true,
        message: 'Password changed successfully',
      });
    } catch (error) {
      console.error('Change password error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to change password',
      });
    }
  },
};
