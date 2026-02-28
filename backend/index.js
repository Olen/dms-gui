import {
  debugLog,
  errorLog,
  infoLog,
} from './backend.mjs';
import {
  env,
} from './env.mjs';

import {
  dbInit,
  refreshTokens,
} from './db.mjs';

import {
  killContainer,
} from './settings.mjs';

import {
  cleanupExpiredTokens,
} from './passwordReset.mjs';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import * as crypto from 'crypto';
import express from 'express';
import multer from 'multer';
import cron from 'node-cron';
import qs from 'qs';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

// Route modules
import authRoutes from './routes/auth.js';
import loginRoutes from './routes/logins.js';
import accountRoutes from './routes/accounts.js';
import aliasRoutes from './routes/aliases.js';
import settingRoutes from './routes/settings.js';
import domainRoutes from './routes/domains.js';
import serverRoutes from './routes/server.js';
import mailRoutes from './routes/mail.js';

const app = express();

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    version: env.DMSGUI_VERSION,
    title: 'dms-gui-backend',
    description: env.DMSGUI_DESCRIPTION,
  },
};

const options = {
  swaggerDefinition,
  // Paths to files containing OpenAPI definitions
  apis: ['./*.js', './routes/*.js'],
};
const oasDefinition = swaggerJsdoc(options);


// CORS_ORIGINS env: comma-separated allowed origins, or unset for same-origin only
debugLog('env.API_URL',env.API_URL)
debugLog('env.FRONTEND_URL',env.FRONTEND_URL)
const corsOriginsList = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : null;
const corsOptions = {
  origin: corsOriginsList && corsOriginsList.length ? corsOriginsList : false,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language']
};

app.use(cookieParser());
app.use(cors(corsOptions));
app.use(express.json());
app.use('/docs', swaggerUi.serve, swaggerUi.setup(oasDefinition));

// Parser
// https://www.codemzy.com/blog/parse-booleans-express-query-params
app.set('query parser', function (str) {
  return qs.parse(str, {
    decoder: function (str, defaultDecoder, charset, type) {
      let bools = {
        true: true,
        false: false,
      };
      if (type === 'value' && typeof bools[str] === "boolean") {
        return bools[str];
      } else {
        return defaultDecoder(str);
      }
    }
  })
});

// Mount route modules
app.use('/api', authRoutes);
app.use('/api', loginRoutes);
app.use('/api', accountRoutes);
app.use('/api', aliasRoutes);
app.use('/api', settingRoutes);
app.use('/api', domainRoutes);
app.use('/api', serverRoutes);
app.use('/api', mailRoutes);


// ============================================
// MULTER ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 2 MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes('Only image files are allowed')) {
    return res.status(415).json({ error: err.message });
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
    error: 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    ...(isDevelopment && { message: err.message, stack: err.stack })
  });
});


app.listen(env.PORT_NODEJS, async () => {
  infoLog(`dms-gui-backend ${env.DMSGUI_VERSION} Server ${process.version} running on port ${env.PORT_NODEJS}`);
  debugLog('🐞 debug mode is ENABLED');

  // https://github.com/ncb000gt/node-cron    // internal crontan
  // node-cron uses 6 fields: second minute hour day month weekday
  // Prevent reboot storms when seconds field is wildcard (e.g. "* 1 23 * * *" fires 60 times)
  debugLog('DMSGUI_CRON',env.DMSGUI_CRON)
  if (env.DMSGUI_CRON) {
    let cronExpr = env.DMSGUI_CRON;
    const fields = cronExpr.trim().split(/\s+/);
    if (fields.length === 6 && fields[0] === '*') {
      fields[0] = '0';
      cronExpr = fields.join(' ');
      debugLog(`DMSGUI_CRON: seconds field was *, defaulting to 0: ${cronExpr}`);
    }
    cron.schedule(cronExpr, () => {
        killContainer('dms-gui', 'dms-gui', 'dms-gui');    // no await
    });
  };

  // await dbInit(true);         // reset db
  await dbInit();         // apply patches etc
  await refreshTokens();  // delete all user's refreshToken as the secret has changed after a restart

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
