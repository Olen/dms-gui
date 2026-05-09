import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { env } from './env.mjs';
import { errorLog } from './backend.mjs';

// Domain validation
export const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
export const isValidDomain = (d) =>
  typeof d === 'string' && d.length <= 253 && DOMAIN_RE.test(d);

// Generate access token
export const generateAccessToken = (user) => {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_EXPIRY });
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
        code: 'NO_TOKEN',
      });
    }

    const decoded = jwt.verify(accessToken, env.JWT_SECRET);
    req.user = decoded; // Attach user data to request
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Session expired. Please login again.',
        code: 'TOKEN_EXPIRED',
      });
    }
    return res.status(403).json({
      error: 'Invalid token',
      code: 'INVALID_TOKEN',
    });
  }
};

// requireAdmin middleware checks if req.user.isAdmin is true
export const requireAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({
      error: 'Admin access required',
      code: 'FORBIDDEN',
    });
  }
  next();
};

// Check if user is active
export const requireActive = (req, res, next) => {
  if (!req.user || !req.user.isActive) {
    return res.status(403).json({
      error: 'Account is inactive',
      code: 'ACCOUNT_INACTIVE',
    });
  }
  next();
};

// Generate a CSRF token (32 bytes, hex). Used by routes that issue
// the xsrfToken cookie alongside the auth cookie (login, refresh).
// 32 bytes / 64 hex chars is well above the recommended 128-bit
// entropy floor for CSRF tokens.
export const generateCsrfToken = () => crypto.randomBytes(32).toString('hex');

// CSRF protection via the double-submit-cookie pattern (#40). On
// state-changing requests (POST/PUT/PATCH/DELETE), the request must
// include `X-XSRF-TOKEN` header whose value matches the value of the
// xsrfToken cookie. Both are issued at login (and rotated on
// /refresh); the cookie is non-httpOnly so axios can read it and
// forward it as the header. An attacker MITM'ing or CSRF'ing without
// the ability to read cookies (the standard browser-CSRF threat
// model) cannot forge the header to match the cookie.
//
// Read methods (GET/HEAD/OPTIONS) pass through without checking —
// they don't change state, so CSRF doesn't apply. Routes that
// establish or rotate the session (login, refresh, password reset
// flow) opt out at the route level; they don't authenticate via the
// auth cookie so the CSRF threat shape doesn't apply to them.
export const requireCsrf = (req, res, next) => {
  if (
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS'
  ) {
    return next();
  }
  const headerToken = req.get('X-XSRF-TOKEN');
  const cookieToken = req.cookies && req.cookies.xsrfToken;
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return res.status(403).json({
      error: 'CSRF token missing or invalid',
      code: 'CSRF_INVALID',
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
  max: 15, // limit each IP to 15 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts, please try again later',
  },
});

// Log full error details server-side but return only a generic message to clients
export const serverError = (res, context, error) => {
  errorLog(`${context}: ${error.message}`);
  res.status(500).json({ error: 'Internal server error' });
};

// Standard "permission denied" reply: HTTP 403 with the canonical
// {success:false, error:...} body shape. Use this from route handlers
// instead of returning a {success:false, message:'Permission denied'}
// payload (which gets forwarded with HTTP 200 and is silently treated
// as success by frontend code that only checks the status code).
export const denyPermission = (res, message = 'Permission denied') =>
  res.status(403).json({ success: false, error: message });
