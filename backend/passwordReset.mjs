import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

import {
  debugLog,
  errorLog,
  infoLog,
  warnLog,
} from './backend.mjs';
import {
  changePassword,
  dbGet,
  dbRun,
  sql,
} from './db.mjs';
import { env } from './env.mjs';
import { getLogin } from './logins.mjs';

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 3;

let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
  }
  return transporter;
};

const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const requestPasswordReset = async (email, origin) => {
  const genericResponse = { success: true, message: 'If that account exists, a reset link has been sent.' };

  try {
    if (!email || typeof email !== 'string') return genericResponse;

    const login = await getLogin({ mailbox: email });
    if (!login.success || !login.message) {
      debugLog(`Password reset requested for unknown mailbox: ${email}`);
      return genericResponse;
    }

    const loginId = login.message.id;
    const now = Date.now();

    // Rate limit: max RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW_MS per mailbox
    const recentResult = dbGet(sql.password_resets.select.countRecent, {}, loginId, now - RATE_LIMIT_WINDOW_MS);
    if (recentResult.success && recentResult.message && recentResult.message.count >= RATE_LIMIT_MAX) {
      debugLog(`Password reset rate limited for ${email}`);
      return genericResponse; // silent rate limit — same response
    }

    // Generate token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = now + TOKEN_EXPIRY_MS;

    // Store hash in DB
    dbRun(sql.password_resets.insert.token, {}, loginId, tokenHash, expiresAt, now);

    // Build reset link using the Origin header from the request
    const resetUrl = `${origin}/reset-password?token=${rawToken}`;
    const domain = email.split('@')[1];
    const fromAddress = `noreply@${domain}`;

    // Send email
    try {
      await getTransporter().sendMail({
        from: fromAddress,
        to: email,
        subject: 'Password Reset Request',
        text: [
          `A password reset was requested for your account.`,
          ``,
          `Click the link below to reset your password (valid for 1 hour):`,
          `${resetUrl}`,
          ``,
          `If you did not request this, you can safely ignore this email.`,
        ].join('\n'),
      });
      infoLog(`Password reset email sent to ${email}`);
    } catch (mailError) {
      errorLog(`Failed to send password reset email to ${email}: ${mailError.message}`);
    }

    return genericResponse;

  } catch (error) {
    errorLog(`requestPasswordReset error: ${error.message}`);
    return genericResponse; // never reveal errors
  }
};

export const validateResetToken = (token) => {
  try {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'Invalid token' };
    }

    const tokenHash = hashToken(token);
    const now = Date.now();

    const result = dbGet(sql.password_resets.select.byTokenHash, {}, tokenHash, now);
    if (!result.success || !result.message) {
      return { success: false, error: 'Invalid or expired token' };
    }

    return { success: true, mailbox: result.message.mailbox };

  } catch (error) {
    errorLog(`validateResetToken error: ${error.message}`);
    return { success: false, error: 'Invalid or expired token' };
  }
};

export const executePasswordReset = async (token, password) => {
  try {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'Invalid token' };
    }
    if (!password || password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters' };
    }

    const tokenHash = hashToken(token);
    const now = Date.now();

    const result = dbGet(sql.password_resets.select.byTokenHash, {}, tokenHash, now);
    if (!result.success || !result.message) {
      return { success: false, error: 'Invalid or expired token' };
    }

    const { id: resetId, loginId } = result.message;

    // Change the password using existing flow
    const changeResult = await changePassword('logins', loginId, password);
    if (!changeResult.success) {
      return { success: false, error: 'Failed to reset password' };
    }

    // Mark token as used
    dbRun(sql.password_resets.update.markUsed, {}, now, resetId);

    infoLog(`Password reset completed for login ID ${loginId}`);
    return { success: true, message: 'Password has been reset successfully' };

  } catch (error) {
    errorLog(`executePasswordReset error: ${error.message}`);
    return { success: false, error: 'Failed to reset password' };
  }
};

export const cleanupExpiredTokens = () => {
  try {
    const now = Date.now();
    dbRun(sql.password_resets.delete.expired, {}, now);
    debugLog('Cleaned up expired password reset tokens');
  } catch (error) {
    errorLog(`cleanupExpiredTokens error: ${error.message}`);
  }
};
