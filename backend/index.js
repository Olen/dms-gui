import { debugLog, errorLog, infoLog } from './backend.mjs';
import { env } from './env.mjs';

import { dbInit, refreshTokens } from './db.mjs';
import { parseCorsOrigins } from './corsConfig.mjs';

import { killContainer } from './settings.mjs';

import { cleanupExpiredTokens } from './passwordReset.mjs';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import * as crypto from 'crypto';
import express from 'express';
import multer from 'multer';
import cron from 'node-cron';

// Route modules
import authRoutes from './routes/auth.js';
import loginRoutes from './routes/logins.js';
import accountRoutes from './routes/accounts.js';
import aliasRoutes from './routes/aliases.js';
import settingRoutes from './routes/settings.js';
import domainRoutes from './routes/domains.js';
import serverRoutes from './routes/server.js';
import mailRoutes from './routes/mail.js';

import { apiLimiter, clientError, requireCsrf } from './middleware.js';

const app = express();

// Trust proxy headers (X-Forwarded-For/Proto/Host) when running behind
// a reverse proxy. Required for express-rate-limit and req.ip to see
// the real client IP, not the proxy's. Configurable via TRUST_PROXY
// env (true | false | <hop-count> | <CIDR>); default false because the
// header is forgeable when the app is reachable directly.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy !== undefined) {
  // Coerce numeric strings (hop count) to numbers; leave 'true'/'false'/
  // CIDR strings alone for express to interpret.
  const value = /^\d+$/.test(trustProxy)
    ? Number(trustProxy)
    : trustProxy === 'true'
      ? true
      : trustProxy === 'false'
        ? false
        : trustProxy;
  app.set('trust proxy', value);
  debugLog('trust proxy =', value);
}

// CORS_ORIGINS env: comma-separated allowed origins, or unset for
// same-origin only. Each entry must be a fully-qualified
// http:// or https:// origin (no trailing path). Wildcards (`*`),
// bare hostnames, and userinfo-laden origins are dropped and the
// dropped entry is logged via debugLog (visible when DEBUG=true).
// See corsConfig.mjs for the validation regex and the rationale.
//
// The origin field is a function rather than the array form so the
// allowlist check is an explicit comparison: CodeQL's
// js/cors-permissive-configuration query recognises function-based
// origin handlers as a sanitizer for the env-derived input, where
// the array form alone is still flagged as "permissive due to
// user-controlled value" even though the values are filtered.
debugLog('env.API_URL', env.API_URL);
debugLog('env.FRONTEND_URL', env.FRONTEND_URL);
const corsAllowlist = parseCorsOrigins(process.env.CORS_ORIGINS, debugLog);
const corsOriginHandler = corsAllowlist
  ? (requestOrigin, callback) => {
      // No Origin header → allow. This case mostly covers
      // non-browser clients (curl, server-to-server, IDE REST
      // consoles) plus a few same-origin navigations. It is NOT
      // a reliable "same-origin" signal — browsers do send Origin
      // on same-origin POST/fetch too — but the cors middleware's
      // array form behaves the same way for `undefined` origins,
      // so we mirror that to keep behaviour consistent and avoid
      // breaking non-browser API consumers.
      if (!requestOrigin) return callback(null, true);
      // Normalise to lowercase before comparison: parseCorsOrigins
      // stores lowercased entries; browsers send lowercase Origin
      // values too, but being explicit keeps the contract symmetric.
      callback(null, corsAllowlist.includes(requestOrigin.toLowerCase()));
    }
  : false;
const corsOptions = {
  origin: corsOriginHandler,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept-Language',
    'X-XSRF-TOKEN', // CSRF double-submit header; CORS preflight needs this listed
  ],
};

app.use(cookieParser());
app.use(cors(corsOptions));
app.use(express.json());

// Swagger UI: gated behind ENABLE_SWAGGER + auth chain. When
// disabled, there is no /docs route at all — anonymous probes get
// 404 from Express's default catch-all rather than the index page.
// See backend/swagger.mjs for the setup logic and the install-hint
// vs. setup-error discrimination.
if (env.ENABLE_SWAGGER) {
  const { setupSwaggerDocs } = await import('./swagger.mjs');
  await setupSwaggerDocs(app, env);
}

// Use Express's default query parser (extended/qs). Values arrive as
// strings; routes that accept boolean-like query params already coerce
// via `=== true || === 'true' || === '1'` checks, so a custom
// string-to-boolean decoder is unnecessary.

// Mount route modules. CSRF protection is applied to every
// non-auth router via requireCsrf — those routers all rely on the
// authenticateToken cookie and are therefore reachable via CSRF
// without it. The auth router applies its own per-route CSRF policy
// (skipped on login/refresh/password-reset, applied on logout) since
// session-establishing routes don't authenticate via the existing
// cookie and thus aren't a CSRF surface.
//
// Middleware ordering invariants for authenticated routes:
//   apiLimiter  — runs FIRST so rate limiting applies to all requests,
//                 including those that will later fail CSRF validation.
//                 Without this ordering, an attacker could flood the
//                 API with malformed-CSRF requests at unlimited rate.
//   requireCsrf — runs after apiLimiter; rejects requests with an
//                 invalid or missing CSRF token.
// Auth routes keep their own (stricter) authLimiter applied per-route
// inside routes/auth.js.
app.use('/api', authRoutes);
app.use('/api', apiLimiter, requireCsrf, loginRoutes);
app.use('/api', apiLimiter, requireCsrf, accountRoutes);
app.use('/api', apiLimiter, requireCsrf, aliasRoutes);
app.use('/api', apiLimiter, requireCsrf, settingRoutes);
app.use('/api', apiLimiter, requireCsrf, domainRoutes);
app.use('/api', apiLimiter, requireCsrf, serverRoutes);
app.use('/api', apiLimiter, requireCsrf, mailRoutes);

// ============================================
// MULTER ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return clientError(res, 413, 'File too large. Maximum size is 2 MB.');
    }
    return clientError(res, 400, err.message);
  }
  if (err.message && err.message.includes('Only image files are allowed')) {
    return clientError(res, 415, err.message);
  }
  next(err);
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  const isDevelopment = env.NODE_ENV === 'development';

  res.status(err.status || 500).json({
    success: false,
    error: 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    ...(isDevelopment && { message: err.message, stack: err.stack }),
  });
});

app.listen(env.PORT_NODEJS, async () => {
  infoLog(
    `dms-gui-backend ${env.DMSGUI_VERSION} Server ${process.version} running on port ${env.PORT_NODEJS}`
  );
  debugLog('🐞 debug mode is ENABLED');

  // https://github.com/ncb000gt/node-cron    // internal crontan
  // node-cron uses 6 fields: second minute hour day month weekday
  // Prevent reboot storms when seconds field is wildcard (e.g. "* 1 23 * * *" fires 60 times)
  debugLog('DMSGUI_CRON', env.DMSGUI_CRON);
  if (env.DMSGUI_CRON) {
    let cronExpr = env.DMSGUI_CRON;
    const fields = cronExpr.trim().split(/\s+/);
    if (fields.length === 6 && fields[0] === '*') {
      fields[0] = '0';
      cronExpr = fields.join(' ');
      debugLog(
        `DMSGUI_CRON: seconds field was *, defaulting to 0: ${cronExpr}`
      );
    }
    cron.schedule(cronExpr, () => {
      killContainer('dms-gui', 'dms-gui', 'dms-gui'); // no await
    });
  }

  // await dbInit(true);         // reset db
  await dbInit(); // apply patches etc
  await refreshTokens(); // delete all user's refreshToken as the secret has changed after a restart

  // Cleanup expired password reset tokens on startup and daily
  cleanupExpiredTokens();
  cron.schedule('0 3 * * *', () => cleanupExpiredTokens());

  if (env.AES_SECRET === 'changeme') {
    errorLog(`

    AES_SECRET has not been set. Example to create it: "openssl rand -hex 32"
    *******************************************************************************
    * AES_SECRET you could use in .dms-gui.env:                                   *
    * AES_SECRET=${crypto.randomBytes(32).toString('hex')} *
    *******************************************************************************
    `);
    process.exit(1);
  }
});
