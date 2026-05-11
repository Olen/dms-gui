import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { env } from './env.mjs';
import { errorLog } from './backend.mjs';

// Canonical client-error reply: HTTP 4xx with the canonical
// {success:false, error, code?} body shape. Use this from route
// handlers and middleware for any 4xx response that isn't a
// permission denial (use denyPermission for 403).
//
// The optional code is a stable machine-readable identifier the
// frontend axios interceptor can pattern-match (see frontend
// services/api.mjs's error switch — codes like TOKEN_EXPIRED,
// CSRF_INVALID, etc. land there). For most validation 400s the
// message alone is sufficient and code can be omitted.
export const clientError = (res, status, message, code) => {
  const body = { success: false, error: message };
  if (code) body.code = code;
  return res.status(status).json(body);
};

// Log full error details server-side but return only a generic
// message to clients. Uses clientError so the body matches the
// canonical {success:false, error, code} shape — frontend handlers
// can treat client- and server-side errors the same way.
export const serverError = (res, context, error) => {
  errorLog(`${context}: ${error.message}`);
  return clientError(res, 500, 'Internal server error', 'SERVER_ERROR');
};

// Standard "permission denied" reply: HTTP 403 with the canonical
// {success:false, error:...} body shape. Use this from route handlers
// instead of returning a {success:false, message:'Permission denied'}
// payload (which gets forwarded with HTTP 200 and is silently treated
// as success by frontend code that only checks the status code).
export const denyPermission = (res, message = 'Permission denied') =>
  clientError(res, 403, message);

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
    const accessToken = req.cookies.accessToken;

    if (!accessToken) {
      return clientError(res, 401, 'Authentication required', 'NO_TOKEN');
    }

    const decoded = jwt.verify(accessToken, env.JWT_SECRET);
    req.user = decoded; // Attach user data to request
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return clientError(
        res,
        401,
        'Session expired. Please login again.',
        'TOKEN_EXPIRED'
      );
    }
    return clientError(res, 403, 'Invalid token', 'INVALID_TOKEN');
  }
};

// requireAdmin middleware checks if req.user.isAdmin is true
export const requireAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return clientError(res, 403, 'Admin access required', 'FORBIDDEN');
  }
  next();
};

// Check if user is active
export const requireActive = (req, res, next) => {
  if (!req.user || !req.user.isActive) {
    return clientError(res, 403, 'Account is inactive', 'ACCOUNT_INACTIVE');
  }
  next();
};

// Generate a CSRF token (32 bytes, hex). Used by routes that issue
// the xsrfToken cookie alongside the auth cookie (login, refresh).
// 32 bytes / 64 hex chars is well above the recommended 128-bit
// entropy floor for CSRF tokens.
export const generateCsrfToken = () => crypto.randomBytes(32).toString('hex');

// CSRF protection via the double-submit-cookie pattern. On
// state-changing requests (POST/PUT/PATCH/DELETE), the request must
// include `X-XSRF-TOKEN` header whose value matches the value of the
// xsrfToken cookie. Both are issued at login (and rotated on
// /refresh); the cookie is non-httpOnly so axios can read it and
// forward it as the header. An attacker MITM'ing or CSRF'ing without
// the ability to read cookies (the standard browser-CSRF threat
// model) cannot forge the header to match the cookie.
//
// Pass-through cases:
//   - Read methods (GET/HEAD/OPTIONS): no state change, no CSRF.
//   - No `accessToken` cookie present: the request is unauthenticated.
//     `authenticateToken` (downstream) will produce the canonical 401.
//     Running CSRF before auth would mask that with a 403 about
//     CSRF, which is a behaviour change clients shouldn't see.
//
// Routes that establish or rotate the session (login, refresh,
// password reset flow) opt out at the route level; they don't
// authenticate via the auth cookie so the CSRF threat shape doesn't
// apply to them.
export const requireCsrf = (req, res, next) => {
  if (
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS'
  ) {
    return next();
  }
  // Skip if the request isn't authenticated via the session cookie —
  // CSRF only applies to requests the browser auto-authenticates,
  // and `authenticateToken` will reject anonymous traffic with 401
  // immediately downstream.
  if (!req.cookies || !req.cookies.accessToken) {
    return next();
  }
  const headerToken = req.get('X-XSRF-TOKEN');
  const cookieToken = req.cookies.xsrfToken;
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return clientError(
      res,
      403,
      'CSRF token missing or invalid',
      'CSRF_INVALID'
    );
  }
  next();
};

// Validate the :containerName route param. Both the missing/empty
// and the bad-shape cases get rejected here so handlers can assume
// req.params.containerName is non-empty and well-formed by the time
// they run. The empty-value check replaces ~38 hand-written
// `if (!containerName) return res.status(400)…` guards across the
// route files.
export const validateContainerName = (req, res, next, value) => {
  if (!value) {
    return clientError(res, 400, 'containerName is required');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    return clientError(res, 400, 'Invalid container name');
  }
  next();
};

// Rate-limiter tuning lives next to the limiters themselves, exported
// so the values can be unit-tested without poking at express-rate-limit's
// internals (which it doesn't expose on the returned middleware).
export const AUTH_LIMITER_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const AUTH_LIMITER_MAX = 15;
export const API_LIMITER_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const API_LIMITER_MAX = 600;

// Rate limiter for auth endpoints (login + refresh)
export const authLimiter = rateLimit({
  windowMs: AUTH_LIMITER_WINDOW_MS,
  max: AUTH_LIMITER_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts, please try again later',
  },
});

// Rate limiter for authenticated API traffic. Looser than
// authLimiter — applied at the router level for every authenticated
// router so both existing and future routes inherit it. Sized for the
// dashboard auto-refresh pattern (~5 req per 30s × 15 min ≈ 150
// req/window from a single user just sitting on the dashboard, plus
// browsing bursts) with comfortable headroom for multi-user NAT'd
// deployments. The threat model is "leaked session cookie pumped
// against the API" — at 600/15min ≈ 40/min sustained, an attacker is
// throttled below useful enumeration speed while normal usage stays
// well under the cap.
export const apiLimiter = rateLimit({
  windowMs: API_LIMITER_WINDOW_MS,
  max: API_LIMITER_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});
