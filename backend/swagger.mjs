import {
  apiLimiter,
  authenticateToken,
  requireActive,
  requireAdmin,
} from './middleware.js';
import { errorLog, infoLog } from './backend.mjs';

// Default dynamic-importer. Indirected through this parameter so tests
// can inject a fake that throws specific errors (ERR_MODULE_NOT_FOUND,
// runtime/JSDoc failures from swaggerJsdoc, etc.).
const defaultImporter = (specifier) => import(specifier);

/**
 * Mount the swagger /docs route on the given Express app.
 *
 * The swagger packages are kept as devDependencies so the production
 * runtime can skip the ~12 MB swagger-ui-dist payload by default.
 * They're loaded lazily here; a missing package is a clearly messaged
 * setup error rather than a crash.
 *
 * @param {import('express').Application} app
 * @param {object} env - the resolved env config (uses DMSGUI_VERSION + DMSGUI_DESCRIPTION)
 * @param {(s: string) => Promise<*>} [importer=defaultImporter]
 * @returns {Promise<{success: boolean, error?: Error}>}
 */
export const setupSwaggerDocs = async (
  app,
  env,
  importer = defaultImporter
) => {
  try {
    const [{ default: swaggerJsdoc }, { default: swaggerUi }] =
      await Promise.all([
        importer('swagger-jsdoc'),
        importer('swagger-ui-express'),
      ]);
    const oasDefinition = swaggerJsdoc({
      swaggerDefinition: {
        openapi: '3.0.0',
        info: {
          version: env.DMSGUI_VERSION,
          title: 'dms-gui-backend',
          description: env.DMSGUI_DESCRIPTION,
        },
      },
      apis: ['./*.js', './routes/*.js'],
    });
    app.use(
      '/docs',
      apiLimiter,
      authenticateToken,
      requireActive,
      requireAdmin,
      swaggerUi.serve,
      swaggerUi.setup(oasDefinition)
    );
    infoLog('Swagger docs enabled at /docs (admin-only)');
    return { success: true };
  } catch (error) {
    // Discriminate the "swagger packages aren't installed" case from
    // genuine setup errors (invalid JSDoc annotations, swagger-ui-express
    // runtime failure, etc.) — otherwise an operator with a real config
    // bug would chase a non-existent install problem.
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      errorLog(
        'ENABLE_SWAGGER=true but swagger packages are not installed. ' +
          'Install with: npm install swagger-jsdoc swagger-ui-express. ' +
          `Original error: ${error.message}`
      );
    } else {
      errorLog(`Failed to enable Swagger docs: ${error.message}`);
      if (error.stack) errorLog(error.stack);
    }
    return { success: false, error };
  }
};
