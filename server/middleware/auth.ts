import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET environment variable is not set in production. Refusing to start.');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Middleware to authenticate requests using JWT
 * Requires a valid token in Authorization header
 */
export function authenticateToken(req: Request & { userId?: number; username?: string }, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ 
      success: false,
      error: 'Access token required' 
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (error) {
    res.status(403).json({ 
      success: false,
      error: 'Invalid or expired token' 
    });
  }
}

/**
 * Optional authentication middleware
 * Doesn't fail if no token, but sets userId if valid token exists
 */
export function optionalAuth(req: Request & { userId?: number | null; username?: string }, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
      req.userId = decoded.userId;
      req.username = decoded.username;
    } catch (error) {
      // Token invalid, but we don't fail - just continue without userId
      req.userId = null;
    }
  }

  next();
}

/**
 * Middleware to require authentication (no optional)
 */
export function requireAuth(req: Request & { userId?: number | null }, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ 
      success: false,
      error: 'Authentication required' 
    });
    return;
  }
  next();
}
