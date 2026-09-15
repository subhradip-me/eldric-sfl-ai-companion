import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Middleware to authenticate requests using JWT
 * Requires a valid token in Authorization header
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      success: false,
      error: 'Access token required' 
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (error) {
    return res.status(403).json({ 
      success: false,
      error: 'Invalid or expired token' 
    });
  }
}

/**
 * Optional authentication middleware
 * Doesn't fail if no token, but sets userId if valid token exists
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
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
export function requireAuth(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ 
      success: false,
      error: 'Authentication required' 
    });
  }
  next();
}
