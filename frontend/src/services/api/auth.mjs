// Auth: login / logout / password reset.
// Mirrors backend/routes/auth.js.

import { request } from './_client.mjs';

export const loginUser = async (credential, password, test = false) => {
  // Distinctive contract: returns `false` (not an error object) when
  // args are missing, because the Login page checks for that shape.
  if (!credential || !password) return false;
  return request('post', '/loginUser', {
    body: { credential, password, test },
  });
};

export const logoutUser = async () => request('post', '/logout');

// ============================================
// Password reset — public endpoints (no auth)
// ============================================

export const forgotPassword = async (email) => {
  // Always return success to prevent account-enumeration via
  // timing or response-shape differences. This is a deliberate
  // security contract, not a degraded-error path.
  try {
    return await request('post', '/forgot-password', { body: { email } });
  } catch {
    return {
      success: true,
      message: 'If that account exists, a reset link has been sent.',
    };
  }
};

export const validateResetToken = async (token) => {
  // Silent-failure: rendered on the ResetPassword page; any
  // network/server problem maps to "Invalid or expired token"
  // so the user sees a single coherent error.
  try {
    return await request('post', '/validate-reset-token', { body: { token } });
  } catch {
    return { success: false, error: 'Invalid or expired token' };
  }
};

export const resetPassword = async (token, password) =>
  request('post', '/reset-password', { body: { token, password } });
