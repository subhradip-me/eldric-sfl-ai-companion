/**
 * AuthController — Express HTTP handlers for auth routes.
 * Delegates all business logic to AuthService; owns only request/response shaping.
 */
import type { Request, Response } from 'express';
import { authService } from '../services/auth/index.js';
import { sunflowerClient } from '../services/farm/index.js';
import { UserModel } from '../models/UserModel.js';

export class AuthController {
  /** POST /api/auth/register */
  async register(req: Request, res: Response): Promise<void> {
    try {
      const { username, email, password, farmId } = req.body as {
        username?: string;
        email?: string;
        password?: string;
        farmId?: string;
      };

      if (!username || !email || !password) {
        res.status(400).json({ success: false, error: 'Username, email, and password are required' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ success: false, error: 'Password must be at least 6 characters long' });
        return;
      }

      const result = await authService.register({ username, email, password, farmId });
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      res.status(201).json(result);
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
    }
  }

  /** POST /api/auth/login */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password } = req.body as { username?: string; password?: string };

      if (!username || !password) {
        res.status(400).json({ success: false, error: 'Username and password are required' });
        return;
      }

      const result = await authService.login({ username, password });
      if (!result.success) {
        res.status(401).json(result);
        return;
      }
      res.json(result);
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
    }
  }

  /** GET /api/auth/me */
  async me(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as Request & { userId: number }).userId;
      const user = await userModel.findById(userId);

      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      res.json({
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
      res.status(500).json({ success: false, error: 'Failed to get user information' });
    }
  }

  /** PUT /api/auth/farm — validate farm ID against SFL API before saving */
  async updateFarmId(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as Request & { userId: number }).userId;
      const { farmId } = req.body as { farmId?: string };

      if (!farmId) {
        res.status(400).json({ success: false, error: 'Farm ID is required' });
        return;
      }

      const id = Number(farmId);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ success: false, error: 'Farm ID must be a positive integer' });
        return;
      }

      try {
        await sunflowerClient.getFarm(String(id));
      } catch {
        res.status(400).json({ success: false, error: `Farm #${id} not found on Sunflower Land. Double-check your Farm ID.` });
        return;
      }

      await userModel.updateFarmId(userId, String(id));
      res.json({ success: true, message: 'Farm ID updated successfully', farmId: String(id) });
    } catch (error) {
      console.error('Update farm ID error:', error);
      res.status(500).json({ success: false, error: 'Failed to update farm ID' });
    }
  }

  /** PUT /api/auth/password */
  async changePassword(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as Request & { userId: number }).userId;
      const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };

      if (!oldPassword || !newPassword) {
        res.status(400).json({ success: false, error: 'Old and new passwords are required' });
        return;
      }
      if (newPassword.length < 6) {
        res.status(400).json({ success: false, error: 'New password must be at least 6 characters long' });
        return;
      }

      const result = await authService.changePassword(userId, oldPassword, newPassword);
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ success: false, error: 'Failed to change password' });
    }
  }
}

const userModel = new UserModel();
export const authController = new AuthController();
