import { Router } from 'express';
import {
  apiLimiter,
  authenticateToken,
  authLimiter,
  clientError,
  generateAccessToken,
  generateCsrfToken,
  generateRefreshToken,
  requireCsrf,
  serverError,
} from '../middleware.js';
import { loginUser } from '../logins.mjs';
import { sql, dbGet, updateDB } from '../db.mjs';
import {
  requestPasswordReset,
  validateResetToken,
  executePasswordReset,
} from '../passwordReset.mjs';
import { env } from '../env.mjs';
import { errorLog } from '../backend.mjs';
import { parseExpiryToMs } from '../../common.mjs';
import jwt from 'jsonwebtoken';

// Cookie maxAge derived from the same env vars the JWT signer uses, so
// the cookie can never expire before (or long after) the JWT inside it.
// Falls back to 1h / 7d if the env value can't be parsed.
const ACCESS_COOKIE_MAX_AGE = parseExpiryToMs(
  env.ACCESS_TOKEN_EXPIRY,
  3_600_000
);
const REFRESH_COOKIE_MAX_AGE = parseExpiryToMs(
  env.REFRESH_TOKEN_EXPIRY,
  7 * 86_400_000
);

const router = Router();

// Per-IP rate limit for forgot-password to prevent email flooding
const forgotPasswordLimits = new Map();
const FORGOT_IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const FORGOT_IP_MAX = 10; // max 10 requests per IP per window
const FORGOT_IP_MAP_MAX = 10000; // max tracked IPs to prevent memory exhaustion

// Cleanup stale IP rate limit entries every hour
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of forgotPasswordLimits) {
      if (now - entry.start >= FORGOT_IP_WINDOW_MS)
        forgotPasswordLimits.delete(ip);
    }
  },
  60 * 60 * 1000
);

// Password reset endpoints — public (no auth required)
router.post('/forgot-password', async (req, res) => {
  try {
    // Per-IP rate limiting
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const ipEntry = forgotPasswordLimits.get(ip);
    if (ipEntry && now - ipEntry.start < FORGOT_IP_WINDOW_MS) {
      if (ipEntry.count >= FORGOT_IP_MAX) {
        return res.json({
          success: true,
          message: 'If that account exists, a reset link has been sent.',
        });
      }
      ipEntry.count++;
    } else {
      if (forgotPasswordLimits.size >= FORGOT_IP_MAP_MAX)
        forgotPasswordLimits.clear();
      forgotPasswordLimits.set(ip, { count: 1, start: now });
    }

    const { email } = req.body;
    // RESET_BASE_URL must be set explicitly. Deriving from headers is unsafe:
    // X-Forwarded-Host is attacker-controllable in the absence of strict proxy
    // hardening, so a poisoned header would point reset emails at attacker.com.
    if (!env.RESET_BASE_URL) {
      errorLog(
        'POST /api/forgot-password: RESET_BASE_URL is not set in env. Refusing to send reset email. Set RESET_BASE_URL=https://<your-public-host> in .dms-gui.env.'
      );
      // Generic response to avoid leaking whether the account exists.
      return res.json({
        success: true,
        message: 'If that account exists, a reset link has been sent.',
      });
    }
    const result = await requestPasswordReset(email, env.RESET_BASE_URL);
    res.json(result);
  } catch (error) {
    errorLog(`POST /api/forgot-password: ${error.message}`);
    res.json({
      success: true,
      message: 'If that account exists, a reset link has been sent.',
    });
  }
});

router.post('/validate-reset-token', authLimiter, async (req, res) => {
  try {
    const { token } = req.body;
    const result = validateResetToken(token);
    res.json(result);
  } catch (error) {
    errorLog(`POST /api/validate-reset-token: ${error.message}`);
    res.json({ success: false, error: 'Invalid or expired token' });
  }
});

router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!password || password.length < 8) {
      return clientError(res, 400, 'Password must be at least 8 characters');
    }
    const result = await executePasswordReset(token, password);
    res.json(result);
  } catch (error) {
    errorLog(`POST /api/reset-password: ${error.message}`);
    res.json({ success: false, error: 'Failed to reset password' });
  }
});

/**
 * @swagger
 * /api/loginUser:
 *   post:
 *     summary: check credentials
 *     description: check credentials to log a user in
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               credential:
 *                 type: string
 *                 description: Login username or mailbox
 *               password:
 *                 type: string
 *                 description: Password
 *               test:
 *                 type: boolean
 *                 description: test login or not
 *     responses:
 *       200:
 *         description: credentials valid
 *       400:
 *         description: Something is missing
 *       401:
 *         description: login denied
 *       500:
 *         description: Unable to validate credentials
 */
router.post('/loginUser', authLimiter, async (req, res, next) => {
  try {
    const { credential, password, test } = req.body;
    if (!credential) return clientError(res, 400, 'credential is missing');
    if (!password) return clientError(res, 400, 'password is missing');

    const user = await loginUser(credential, password);
    if (env.isDEMO) user.isDEMO = true;
    if (env.debug) user.debug = true;

    if (user.success) {
      if (env.isDEMO) user.message.isDEMO = true;
      if (test) {
        res.json({ success: true, isDEMO: env.isDEMO }); // just return true, not real login
      } else {
        // Generate tokens
        const accessToken = generateAccessToken(user.message);
        const refreshToken = generateRefreshToken(user.message);

        // Store refresh token in database
        await updateDB('logins', user.message.id, {
          refreshToken: refreshToken,
        });

        // HTTP-Only Cookies. maxAge is derived from the same env vars the
        // JWT signer uses (ACCESS_TOKEN_EXPIRY / REFRESH_TOKEN_EXPIRY) so
        // the cookie expires in lockstep with the token inside it.
        res.cookie('accessToken', accessToken, {
          httpOnly: true,
          secure: env.NODE_ENV === 'production',
          sameSite: 'Strict',
          maxAge: ACCESS_COOKIE_MAX_AGE,
        });

        res.cookie('refreshToken', refreshToken, {
          httpOnly: true,
          secure: env.NODE_ENV === 'production',
          sameSite: 'Strict',
          maxAge: REFRESH_COOKIE_MAX_AGE,
        });

        // CSRF double-submit cookie. Issued non-httpOnly so axios
        // can read it client-side and forward it as the X-XSRF-TOKEN
        // header on every state-changing request. Server validates
        // header == cookie via requireCsrf middleware.
        res.cookie('xsrfToken', generateCsrfToken(), {
          httpOnly: false,
          secure: env.NODE_ENV === 'production',
          sameSite: 'Strict',
          maxAge: ACCESS_COOKIE_MAX_AGE,
        });

        // and we indeed send user's information with isAdmin, roles etc
        res.json(user);
      }
    } else {
      clientError(res, 401, 'Invalid credentials');
    }
  } catch (error) {
    serverError(res, 'POST /api/loginUser', error);
  }
});

/**
 * @swagger
 * /api/refresh:
 *   post:
 *     summary: refresh token
 *     description: refresh token
 *     responses:
 *       200:
 *         description: token refreshed
 *       401:
 *         description: token expired or missing
 *       403:
 *         description: token invalid or hack attempt
 */
router.post('/refresh', authLimiter, async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return clientError(
        res,
        401,
        'Refresh token required',
        'NO_REFRESH_TOKEN'
      );
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, env.JWT_SECRET_REFRESH);

    // Check if refresh token exists in database
    const result = dbGet(sql.logins.select.refreshToken, decoded.id, {
      refreshToken: refreshToken,
    });
    const user = result.success ? result.message : null;

    if (!user) {
      return clientError(
        res,
        403,
        'Invalid refresh token',
        'INVALID_REFRESH_TOKEN'
      );
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user);

    // Set new access token cookie. Use the same derived maxAge as /loginUser
    // so the cookie's lifetime matches the JWT's expiresIn — previously this
    // was hardcoded to 15 minutes regardless of ACCESS_TOKEN_EXPIRY.
    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: ACCESS_COOKIE_MAX_AGE,
    });

    // Rotate the CSRF token alongside the access token so its
    // lifetime stays in lockstep with the auth session.
    res.cookie('xsrfToken', generateCsrfToken(), {
      httpOnly: false,
      secure: env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: ACCESS_COOKIE_MAX_AGE,
    });

    res.json({
      success: true,
      message: 'Token refreshed',
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return clientError(
        res,
        401,
        'Refresh token expired. Please login again.',
        'REFRESH_TOKEN_EXPIRED'
      );
    }
    errorLog(`POST /api/refresh: ${error.message}`);
    clientError(res, 403, 'Failed to refresh token', 'REFRESH_ERROR');
  }
});

/**
 * @swagger
 * /api/logout:
 *   post:
 *     summary: logout
 *     description: logout and clear cookie
 *     requestBody:
 *       required: false
 *     responses:
 *       200:
 *         description: logout valid
 *       400:
 *         description: Something is wrong
 *       500:
 *         description: Unable to logout
 */
// /logout is the only auth-router endpoint that applies CSRF: it's
// authenticated via the cookie, so a CSRF-logout would be possible
// without protection. Login/refresh/password-reset don't authenticate
// via the existing session cookie, so the CSRF threat shape doesn't
// apply to them.
//
// Middleware ordering invariants:
//   apiLimiter        — runs first; rate limits apply regardless of auth
//   authenticateToken — runs before requireCsrf so anonymous requests
//                       receive a 401 NO_TOKEN, not a misleading 403
//                       CSRF_INVALID
//   requireCsrf       — runs after authentication; doubles as a no-op
//                       for anonymous requests via its own short-circuit
router.post(
  '/logout',
  apiLimiter,
  authenticateToken,
  requireCsrf,
  async (req, res) => {
    try {
      // Remove refresh token from database
      await updateDB('logins', req.user.id, { refreshToken: 'null' });

      // Clear cookies
      res.clearCookie('accessToken');
      res.clearCookie('refreshToken');
      res.clearCookie('xsrfToken');

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      errorLog(`POST /api/logout: ${error.message}`);
      clientError(res, 500, 'Logout failed', 'LOGOUT_ERROR');
    }
  }
);

export default router;
