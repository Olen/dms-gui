// Unit tests for setupSwaggerDocs — exercises the three branches:
//   1. happy path: packages import, /docs mounts, infoLog emitted
//   2. ERR_MODULE_NOT_FOUND: install-hint errorLog, no /docs mount
//   3. other setup error (e.g. invalid OpenAPI/JSDoc): generic
//      "Failed to enable Swagger docs" errorLog WITHOUT the misleading
//      "npm install" hint
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockErrorLog, mockInfoLog } = vi.hoisted(() => ({
  mockErrorLog: vi.fn(),
  mockInfoLog: vi.fn(),
}));

vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: mockErrorLog,
  infoLog: mockInfoLog,
  successLog: vi.fn(),
  warnLog: vi.fn(),
}));

vi.mock('./middleware.js', () => ({
  apiLimiter: (req, res, next) => next(),
  authenticateToken: (req, res, next) => next(),
  requireActive: (req, res, next) => next(),
  requireAdmin: (req, res, next) => next(),
}));

import { setupSwaggerDocs } from './swagger.mjs';
import express from 'express';

const fakeEnv = { DMSGUI_VERSION: 'test', DMSGUI_DESCRIPTION: 'unit-test' };

describe('setupSwaggerDocs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mounts /docs and infoLogs on the happy path', async () => {
    const app = express();
    const fakeSwaggerJsdoc = vi.fn(() => ({ openapi: '3.0.0' }));
    const fakeSwaggerUi = {
      serve: [(req, res, next) => next()],
      setup: vi.fn(() => (req, res) => res.status(200).send('docs')),
    };
    const importer = vi.fn(async (name) => {
      if (name === 'swagger-jsdoc') return { default: fakeSwaggerJsdoc };
      if (name === 'swagger-ui-express') return { default: fakeSwaggerUi };
      throw new Error(`unexpected import: ${name}`);
    });

    const result = await setupSwaggerDocs(app, fakeEnv, importer);

    expect(result.success).toBe(true);
    expect(importer).toHaveBeenCalledWith('swagger-jsdoc');
    expect(importer).toHaveBeenCalledWith('swagger-ui-express');
    expect(fakeSwaggerJsdoc).toHaveBeenCalledOnce();
    expect(fakeSwaggerUi.setup).toHaveBeenCalledOnce();
    expect(mockInfoLog).toHaveBeenCalledWith(expect.stringContaining('/docs'));
    expect(mockErrorLog).not.toHaveBeenCalled();
  });

  it('emits the install-hint errorLog on ERR_MODULE_NOT_FOUND and skips /docs mount', async () => {
    const app = express();
    const useSpy = vi.spyOn(app, 'use');
    const moduleNotFound = new Error('Cannot find package swagger-jsdoc');
    moduleNotFound.code = 'ERR_MODULE_NOT_FOUND';
    const importer = vi.fn(async () => {
      throw moduleNotFound;
    });

    const result = await setupSwaggerDocs(app, fakeEnv, importer);

    expect(result.success).toBe(false);
    expect(result.error).toBe(moduleNotFound);
    expect(mockErrorLog).toHaveBeenCalledWith(
      expect.stringContaining('npm install swagger-jsdoc swagger-ui-express')
    );
    expect(mockInfoLog).not.toHaveBeenCalled();
    expect(useSpy).not.toHaveBeenCalled();
  });

  it('emits a generic errorLog (not the install-hint) for non-import errors', async () => {
    // swaggerJsdoc() throwing on a malformed OpenAPI annotation is the
    // canonical non-ENOENT failure mode this branch handles.
    const app = express();
    const useSpy = vi.spyOn(app, 'use');
    const setupError = new Error('Invalid OpenAPI definition: bad apis path');
    // No error.code — typical of a runtime swaggerJsdoc failure
    const fakeSwaggerJsdoc = vi.fn(() => {
      throw setupError;
    });
    const fakeSwaggerUi = { serve: [], setup: vi.fn() };
    const importer = vi.fn(async (name) => {
      if (name === 'swagger-jsdoc') return { default: fakeSwaggerJsdoc };
      if (name === 'swagger-ui-express') return { default: fakeSwaggerUi };
    });

    const result = await setupSwaggerDocs(app, fakeEnv, importer);

    expect(result.success).toBe(false);
    expect(result.error).toBe(setupError);
    expect(mockErrorLog).toHaveBeenCalledWith(
      expect.stringContaining('Failed to enable Swagger docs')
    );
    // The install-hint message MUST NOT appear here — that's the bug
    // Copilot caught: a non-import error would have been misreported
    // as "packages missing".
    const errorMessages = mockErrorLog.mock.calls.map((c) => c.join(' '));
    expect(errorMessages.join('\n')).not.toContain('npm install swagger-jsdoc');
    expect(mockInfoLog).not.toHaveBeenCalled();
    expect(useSpy).not.toHaveBeenCalled();
  });
});
