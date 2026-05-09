import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import http from 'http';

import { mailserverRESTAPI } from '../env.mjs';

const HAS_PYTHON3 =
  spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;

const describeIfPython = HAS_PYTHON3 ? describe : describe.skip;

describeIfPython('rest-api.py smoke (Sprint A)', () => {
  let tmpDir;
  let serverProc;
  const PORT = 18888 + Math.floor(Math.random() * 1000);
  const API_KEY = 'smoke-test-key';

  // Two synthetic actions exercising both single argv and pipeline shapes.
  const SYNTHETIC_MANIFEST = [
    {
      id: 'echo_arg',
      argv: ['echo', '{message}'],
      validate: { message: { string: { minlen: 1, maxlen: 64 } } },
    },
    {
      id: 'tail_via_pipe',
      pipeline: [
        { argv: ['printf', 'a\\nb\\nc\\n'] },
        { argv: ['tail', '-n', '{lines}'] },
      ],
      validate: { lines: { int: { min: 1, max: 100 } } },
    },
  ];

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dms-gui-rest-api-smoke-'));
    const pyPath = join(tmpDir, 'rest-api.py');
    const manifestPath = join(tmpDir, 'manifest.json');

    const py = mailserverRESTAPI.dms.api.content.replace(
      '{DMSGUI_VERSION}',
      'smoke-test'
    );
    writeFileSync(pyPath, py);
    writeFileSync(manifestPath, JSON.stringify(SYNTHETIC_MANIFEST));

    serverProc = spawn('python3', [pyPath], {
      env: {
        ...process.env,
        DMS_API_HOST: '127.0.0.1',
        DMS_API_PORT: String(PORT),
        DMS_API_KEY: API_KEY,
        DMS_API_MANIFEST: manifestPath,
        DMS_API_SIZE: '2048',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for the server to be listening (poll with short retries).
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        await new Promise((resolve, reject) => {
          const r = http.request(
            { host: '127.0.0.1', port: PORT, method: 'POST', path: '/' },
            (res) => {
              res.resume();
              res.on('end', resolve);
            }
          );
          r.on('error', reject);
          r.end();
        });
        return; // server is up
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('rest-api.py did not start in time');
  }, 15000);

  afterAll(() => {
    if (serverProc) serverProc.kill('SIGTERM');
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  const post = (body) =>
    new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port: PORT,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            Authorization: API_KEY,
          },
        },
        (res) => {
          let chunks = '';
          res.on('data', (c) => (chunks += c));
          res.on('end', () =>
            resolve({ status: res.statusCode, body: JSON.parse(chunks) })
          );
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });

  it('echoes the message arg literally (token-level substitution)', async () => {
    const r = await post({ action: 'echo_arg', args: { message: 'hello' } });
    expect(r.status).toBe(200);
    expect(r.body.returncode).toBe(0);
    expect(r.body.stdout.trim()).toBe('hello');
  });

  it('treats shell metacharacters in args as literal (no shell injection)', async () => {
    // The whole point: a value containing '; rm -rf /' must come out
    // of echo verbatim, not be interpreted by a shell.
    const r = await post({
      action: 'echo_arg',
      args: { message: '; rm -rf /' },
    });
    expect(r.status).toBe(200);
    expect(r.body.returncode).toBe(0);
    expect(r.body.stdout.trim()).toBe('; rm -rf /');
  });

  it('rejects unknown action ids with HTTP 403', async () => {
    const r = await post({ action: 'nonexistent' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/unknown action/);
  });

  it('rejects undeclared args (validation gates)', async () => {
    const r = await post({
      action: 'echo_arg',
      args: { message: 'ok', extra: 'nope' },
    });
    expect(r.body.returncode).toBe(1);
    expect(r.body.stderr).toMatch(/undeclared arg 'extra'/);
  });

  it('rejects regex/length/range violations', async () => {
    // message: '' is too short (minlen: 1)
    const r = await post({ action: 'echo_arg', args: { message: '' } });
    expect(r.body.returncode).toBe(1);
    expect(r.body.stderr).toMatch(/validation failed for 'message'/);
  });

  it('runs pipelines stage-by-stage with template substitution', async () => {
    const r = await post({
      action: 'tail_via_pipe',
      args: { lines: 2 },
    });
    expect(r.status).toBe(200);
    expect(r.body.returncode).toBe(0);
    expect(r.body.stdout.trim()).toBe('b\nc');
  });

  it('legacy {command:} path still works during the migration', async () => {
    const r = await post({ command: 'echo legacy-still-here' });
    expect(r.status).toBe(200);
    expect(r.body.returncode).toBe(0);
    expect(r.body.stdout.trim()).toBe('legacy-still-here');
  });
});
