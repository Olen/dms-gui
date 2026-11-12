import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

import { debugLog, errorLog, infoLog } from './backend.mjs';
import { changePassword, dbAll, dbGet, dbRun, sql } from './db.mjs';
import { env } from './env.mjs';
import { getLogin } from './logins.mjs';

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 3;

let transporter = null;

// Pure helper exported for test coverage of the TLS hardening.
// Keeps getTransporter() trivially testable without standing up the
// whole module's mock graph.
export const buildSmtpTransportConfig = (smtpEnv) => ({
  host: smtpEnv.SMTP_HOST,
  port: smtpEnv.SMTP_PORT,
  // HELO name: mail servers reject a bare container hostname like 'dms-gui'
  name: new URL(smtpEnv.RESET_BASE_URL).hostname,
  secure: false,
  // requireTLS forces STARTTLS upgrade — without it, an attacker
  // who can MITM the SMTP path could strip the upgrade and trick
  // us into sending the reset link in plaintext.
  requireTLS: true,
  // rejectUnauthorized: see env.mjs for the SMTP_TLS_VERIFY default
  // resolution rules. Override via SMTP_TLS_VERIFY=false in
  // .dms-gui.env when the SMTP target uses a self-signed cert whose
  // CN doesn't match the host we connect to (common with internal
  // Docker container names like 'mailserver').
  tls: { rejectUnauthorized: smtpEnv.SMTP_TLS_VERIFY },
});

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport(buildSmtpTransportConfig(env));
  }
  return transporter;
};

const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// The reset link goes to the address stored on the login, never to what was
// typed into the form: local logins (like the initial admin) have a
// placeholder mailbox and their real address in `email`.
export const resetRecipient = (login) => {
  if (login.email) return login.email;
  return login.mailbox;
};

export const resetFromAddress = (smtpEnv) => {
  if (smtpEnv.SMTP_FROM) return smtpEnv.SMTP_FROM;
  return `noreply@${new URL(smtpEnv.RESET_BASE_URL).hostname}`;
};

const isFoundLogin = (result) =>
  result.success && result.message && typeof result.message !== 'string';

// Finds the login for what the user typed: username or mailbox, then the
// stored email address, then a mail alias of a mailbox. Returns null when
// nothing (or more than one login) matches.
export const findLoginForReset = async (identifier) => {
  const direct = await getLogin(identifier, true);
  if (isFoundLogin(direct)) return direct.message;

  const byEmail = dbAll(sql.logins.select.loginsByEmail, { email: identifier });
  if (byEmail.success && byEmail.message?.length === 1) {
    return byEmail.message[0];
  }
  if (byEmail.success && byEmail.message?.length > 1) {
    errorLog(
      `Password reset: ${byEmail.message.length} logins have the stored address ${identifier}; not sending`
    );
    return null;
  }

  const aliasResult = dbAll(
    `SELECT DISTINCT a.destination FROM aliases a
     JOIN configs c ON c.id = a.configID
     WHERE c.plugin = 'mailserver' AND a.source = ?`,
    {},
    identifier
  );
  if (aliasResult.success && aliasResult.message?.length) {
    // Use the first destination mailbox
    const byAlias = await getLogin(aliasResult.message[0].destination, true);
    if (isFoundLogin(byAlias)) return byAlias.message;
  }
  return null;
};

export const requestPasswordReset = async (identifier, origin) => {
  const genericResponse = {
    success: true,
    message: 'If that account exists, a reset link has been sent.',
  };

  try {
    if (!identifier || typeof identifier !== 'string') return genericResponse;

    const login = await findLoginForReset(identifier);
    if (!login) {
      debugLog(`Password reset requested for unknown login: ${identifier}`);
      return genericResponse;
    }

    const loginId = login.id;
    const now = Date.now();

    // Rate limit: max RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW_MS per mailbox
    const recentResult = dbGet(
      sql.password_resets.select.countRecent,
      {},
      loginId,
      now - RATE_LIMIT_WINDOW_MS
    );
    if (
      recentResult.success &&
      recentResult.message &&
      recentResult.message.count >= RATE_LIMIT_MAX
    ) {
      debugLog(`Password reset rate limited for ${identifier}`);
      return genericResponse; // silent rate limit — same response
    }

    // Generate token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = now + TOKEN_EXPIRY_MS;

    // Store hash in DB
    dbRun(
      sql.password_resets.insert.token,
      {},
      loginId,
      tokenHash,
      expiresAt,
      now
    );

    // origin is RESET_BASE_URL (the route refuses to run without it)
    const resetUrl = `${origin}/reset-password?token=${rawToken}`;
    const recipient = resetRecipient(login);

    // Send email
    try {
      await getTransporter().sendMail({
        from: resetFromAddress(env),
        to: recipient,
        subject: 'Password Reset Request',
        text: [
          `A password reset was requested for the login "${login.username}".`,
          ``,
          `Click the link below to reset your password (valid for 1 hour):`,
          `${resetUrl}`,
          ``,
          `If you did not request this, you can safely ignore this email.`,
        ].join('\n'),
      });
      infoLog(
        `Password reset email for login ${login.username} sent to ${recipient}`
      );
    } catch (mailError) {
      errorLog(
        `Failed to send password reset email for login ${login.username} to ${recipient}: ${mailError.message}`
      );
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

    const result = dbGet(
      sql.password_resets.select.byTokenHash,
      {},
      tokenHash,
      now
    );
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
      return {
        success: false,
        error: 'Password must be at least 8 characters',
      };
    }

    const tokenHash = hashToken(token);
    const now = Date.now();

    const result = dbGet(
      sql.password_resets.select.byTokenHash,
      {},
      tokenHash,
      now
    );
    if (!result.success || !result.message) {
      return { success: false, error: 'Invalid or expired token' };
    }

    const {
      id: resetId,
      loginId,
      mailbox,
      isAccount,
      mailserver,
    } = result.message;

    // Atomically claim the token (prevents concurrent use via race condition)
    const claimed = dbRun(
      sql.password_resets.update.markUsed,
      {},
      now,
      resetId
    );
    if (!claimed.success || !claimed.message?.changes) {
      return { success: false, error: 'Invalid or expired token' };
    }

    // Change the password using the appropriate flow
    let changeResult;
    if (isAccount && mailserver) {
      // DMS account: change password in the actual mail server (Dovecot) via setup.sh
      changeResult = await changePassword(
        'accounts',
        mailbox,
        password,
        null,
        mailserver
      );
    } else {
      // GUI-only login: change password hash in the logins table
      changeResult = await changePassword('logins', loginId, password);
    }
    if (!changeResult.success) {
      errorLog(
        `Password change failed for login ${loginId}: ${changeResult.error}`
      );
      return { success: false, error: 'Failed to reset password' };
    }

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
