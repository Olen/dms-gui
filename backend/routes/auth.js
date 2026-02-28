import { Router } from 'express';
import { authenticateToken, authLimiter, generateAccessToken, generateRefreshToken, serverError } from '../middleware.js';
import { loginUser } from '../logins.mjs';
import { sql, dbGet, updateDB } from '../db.mjs';
import { requestPasswordReset, validateResetToken, executePasswordReset } from '../passwordReset.mjs';
import { env } from '../env.mjs';
import { errorLog } from '../backend.mjs';
import jwt from 'jsonwebtoken';

const router = Router();

// Per-IP rate limit for forgot-password to prevent email flooding
const forgotPasswordLimits = new Map();
const FORGOT_IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const FORGOT_IP_MAX = 10; // max 10 requests per IP per window

// Cleanup stale IP rate limit entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of forgotPasswordLimits) {
    if (now - entry.start >= FORGOT_IP_WINDOW_MS) forgotPasswordLimits.delete(ip);
  }
}, 60 * 60 * 1000);


// Password reset endpoints — public (no auth required)
router.post('/forgot-password', async (req, res) => {
  try {
    // Per-IP rate limiting
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const ipEntry = forgotPasswordLimits.get(ip);
    if (ipEntry && now - ipEntry.start < FORGOT_IP_WINDOW_MS) {
      if (ipEntry.count >= FORGOT_IP_MAX) {
        return res.json({ success: true, message: 'If that account exists, a reset link has been sent.' });
      }
      ipEntry.count++;
    } else {
      forgotPasswordLimits.set(ip, { count: 1, start: now });
    }

    const { email } = req.body;
    // Derive base URL from env var or reverse proxy headers (not client Origin — prevents phishing)
    const baseUrl = env.RESET_BASE_URL
      || `${req.get('x-forwarded-proto') || 'https'}://${req.get('x-forwarded-host') || req.get('host')}`;
    const result = await requestPasswordReset(email, baseUrl);
    res.json(result);
  } catch (error) {
    errorLog(`POST /api/forgot-password: ${error.message}`);
    res.json({ success: true, message: 'If that account exists, a reset link has been sent.' });
  }
});


router.post('/validate-reset-token', async (req, res) => {
  try {
    const { token } = req.body;
    const result = validateResetToken(token);
    res.json(result);
  } catch (error) {
    errorLog(`POST /api/validate-reset-token: ${error.message}`);
    res.json({ success: false, error: 'Invalid or expired token' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
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
    if (!credential)  return res.status(400).json({ error: 'credential is missing' });
    if (!password)    return res.status(400).json({ error: 'password is missing' });

    const user = await loginUser(credential, password);
    if (env.isDEMO) user.isDEMO = true;
    if (env.debug) user.debug = true;

    if (user.success) {
      if (env.isDEMO) user.message.isDEMO = true;
      if (test) {
        res.json({success: true, isDEMO:env.isDEMO});  // just return true, not real login

      } else {
        // Generate tokens
        const accessToken = generateAccessToken(user.message);
        const refreshToken = generateRefreshToken(user.message);

        // Store refresh token in database
        updateDB('logins', user.message.id, {refreshToken:refreshToken});

        // HTTP-Only Cookies (for Refresh Tokens):
        res.cookie('accessToken', accessToken, {
          httpOnly: true,
          secure: env.NODE_ENV === 'production',        // Use secure in production
          sameSite: 'Strict',                           // 'None' or 'Lax' or 'Strict' (for CSRF protection)
          maxAge: 3600000                               // 1h
        });

        res.cookie('refreshToken', refreshToken, {
          httpOnly: true,
          secure: env.NODE_ENV === 'production',
          sameSite: 'Strict',
          maxAge: 7 * 24 * 60 * 60 * 1000               // 7 days
        });

        // and we indeed send user's information with isAdmin, roles etc
        res.json(user);
      }

    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }

  } catch (error) {
    serverError(res, 'index POST /api/loginUser', error);
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
      return res.status(401).json({
        error: 'Refresh token required',
        code: 'NO_REFRESH_TOKEN'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, env.JWT_SECRET_REFRESH);

    // Check if refresh token exists in database
    const result = dbGet(sql.logins.select.refreshToken, decoded.id, {refreshToken:refreshToken});
    const user = (result.success) ? result.message : null;

    if (!user) {
      return res.status(403).json({
        error: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user);

    // Set new access token cookie
    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    res.json({
      success: true,
      message: 'Token refreshed'
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Refresh token expired. Please login again.',
        code: 'REFRESH_TOKEN_EXPIRED'
      });
    }
    console.error('Refresh error:', error);
    res.status(403).json({
      error: 'Failed to refresh token',
      code: 'REFRESH_ERROR'
    });
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
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Remove refresh token from database
    updateDB('logins', req.user.id, {refreshToken:"null"});

    // Clear cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: 'Logout failed',
      code: 'LOGOUT_ERROR'
    });
  }
});

export default router;
