import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { env } from './env.mjs';
import { errorLog } from './backend.mjs';

// Domain validation
export const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
export const isValidDomain = (d) => typeof d === 'string' && d.length <= 253 && DOMAIN_RE.test(d);

// Generate access token
export const generateAccessToken = (user) => {
  return jwt.sign(
    user,
    env.JWT_SECRET,
    { expiresIn: env.ACCESS_TOKEN_EXPIRY }
  );
};

// Generate refresh token
export const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id, mailbox: user.mailbox }, // Only store minimal data
    env.JWT_SECRET_REFRESH, // Different secret!
    { expiresIn: env.REFRESH_TOKEN_EXPIRY }
  );
};

// authenticateToken middleware extracts JWT from cookie and adds req.user to every request
export const authenticateToken = (req, res, next) => {
  try {
    const accessToken = req.cookies.accessToken; // Assuming cookie name is 'token', provided by cookieParser

    if (!accessToken) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'NO_TOKEN'
      });
    }

    const decoded = jwt.verify(accessToken, env.JWT_SECRET);
    req.user = decoded; // Attach user data to request
    next();

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Session expired. Please login again.',
        code: 'TOKEN_EXPIRED'
      });
    }
    return res.status(403).json({
      error: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }
};

// requireAdmin middleware checks if req.user.isAdmin is true
export const requireAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({
      error: 'Admin access required',
      code: 'FORBIDDEN'
    });
  }
  next();
};

// Check if user is active
export const requireActive = (req, res, next) => {
  if (!req.user || !req.user.isActive) {
    return res.status(403).json({
      error: 'Account is inactive',
      code: 'ACCOUNT_INACTIVE'
    });
  }
  next();
};

// Validate containerName param
export const validateContainerName = (req, res, next, value) => {
  if (value && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    return res.status(400).json({ error: 'Invalid container name' });
  }
  next();
};

// Rate limiter for auth endpoints (login + refresh)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,                   // limit each IP to 15 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later' },
});

// Log full error details server-side but return only a generic message to clients
export const serverError = (res, context, error) => {
  errorLog(`${context}: ${error.message}`);
  res.status(500).json({ error: 'Internal server error' });
};
