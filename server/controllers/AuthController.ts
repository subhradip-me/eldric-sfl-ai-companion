/**
 * server/controllers/AuthController.ts
 * Express HTTP handlers for authentication, sessions, and user management.
 */
import type { Request, Response } from 'express';
import { authService } from '../services/auth/index.js';
import { sunflowerClient } from '../services/farm/index.js';
import { UserModel } from '../models/UserModel.js';
import type { DeviceType } from '../types/index.js';

export function getDeviceType(userAgent: string | undefined): DeviceType {
  if (!userAgent) return 'desktop';
  const isMobile = /mobile|android|iphone|ipad|ipod|blackberry|opera mini|iemobile|wpdesktop/i.test(userAgent);
  return isMobile ? 'mobile' : 'desktop';
}

export class AuthController {
  private userModel = new UserModel();

  /** POST /api/auth/register */
  async register(req: Request, res: Response): Promise<void> {
    try {
      const { username, email, password, farmId, role } = req.body as {
        username?: string;
        email?: string;
        password?: string;
        farmId?: string;
        role?: string;
      };

      if (!username || !email || !password) {
        res.status(400).json({ success: false, error: 'Username, email, and password are required' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ success: false, error: 'Password must be at least 6 characters long' });
        return;
      }

      // Relies on trust proxy hop count; req.ip is extracted directly
      const clientIp = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress;

      const result = await authService.register({
        username,
        email,
        password,
        farmId,
        registrationIp: clientIp,
        role,
      });

      if (!result.success) {
        // Return 409 Conflict if registration IP gate hit, 400 for other validation errors
        const status = result.error?.includes('Account registration limit') ? 409 : 400;
        res.status(status).json(result);
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
      const { username, password, forceDisconnect, deviceType: reqDeviceType } = req.body as {
        username?: string;
        password?: string;
        forceDisconnect?: boolean;
        deviceType?: DeviceType;
      };

      if (!username || !password) {
        res.status(400).json({ success: false, error: 'Username and password are required' });
        return;
      }

      const deviceType: DeviceType = reqDeviceType || getDeviceType(req.headers['user-agent']);
      const result = await authService.login(username, password, deviceType, forceDisconnect === true);

      if (!result.success && result.conflict) {
        res.status(409).json({
          success: false,
          error: 'SESSION_CONFLICT',
          deviceType: result.deviceType,
          message: result.error,
        });
        return;
      }

      if (!result.success) {
        res.status(401).json({ success: false, error: result.error });
        return;
      }

      res.json(result);
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
    }
  }

  /** POST /api/auth/refresh — renew access token */
  async refresh(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (!refreshToken) {
        res.status(400).json({ success: false, error: 'Refresh token is required' });
        return;
      }

      const result = await authService.refreshAccessToken(refreshToken);
      if (!result.success) {
        res.status(401).json(result);
        return;
      }
      res.json(result);
    } catch (error) {
      console.error('Refresh error:', error);
      res.status(500).json({ success: false, error: 'Failed to refresh token' });
    }
  }

  /** POST /api/auth/logout — terminate device session */
  async logout(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as Request & { userId?: number }).userId;
      const deviceType = ((req.body as any)?.deviceType as DeviceType) || getDeviceType(req.headers['user-agent']);
      if (userId) {
        await authService.logout(userId, deviceType);
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ success: false, error: 'Failed to log out' });
    }
  }

  /** GET /api/auth/me */
  async me(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as Request & { userId: number }).userId;
      const user = await this.userModel.findById(userId);

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
          role: user.role,
          aiCredits: user.ai_credits,
          aiCreditsUsed: user.ai_credits_used,
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

      const trimmed = farmId.trim();
      try {
        await sunflowerClient.getFarm(trimmed);
      } catch (err: any) {
        res.status(400).json({
          success: false,
          error: `Invalid Sunflower Land Farm ID: ${err?.message ?? 'Farm not found'}`,
        });
        return;
      }

      const result = await authService.updateFarmId(userId, trimmed);
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      res.json({ success: true, farmId: trimmed });
    } catch (error) {
      console.error('Update farm ID error:', error);
      res.status(500).json({ success: false, error: 'Failed to update farm ID' });
    }
  }

  /** PUT /api/auth/password — change password */
  async changePassword(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as Request & { userId: number }).userId;
      const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };

      if (!oldPassword || !newPassword) {
        res.status(400).json({ success: false, error: 'Old password and new password are required' });
        return;
      }

      const result = await authService.changePassword(userId, oldPassword, newPassword);
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ success: false, error: 'Failed to change password' });
    }
  }
}

export const authController = new AuthController();
