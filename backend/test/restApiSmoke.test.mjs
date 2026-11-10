import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import http from 'http';
import { createServer } from 'net';

// Defensive — env.mjs dereferences process.env.DMSGUI_VERSION at module
// load. Hoisted so it runs before the env.mjs import below.
vi.hoisted(() => {
  process.env.DMSGUI_VERSION = process.env.DMSGUI_VERSION || 'smoke-test';
});

import { mailserverRESTAPI } from '../env.mjs';

const HAS_PYTHON3 =
  spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;

const describeIfPython = HAS_PYTHON3 ? describe : describe.skip;

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

// Reserve a free port via the OS; close the reservation immediately
// and let Python bind to the same port. There's a small TOCTOU race
// (~ms) but it's strictly better than a random-pick-and-pray.
const reserveFreePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });

const waitForServer = async (port) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const r = http.request(
          { host: '127.0.0.1', port: port, method: 'POST', path: '/' },
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
};

// Start rest-api.py from the real template with the synthetic manifest.
// `env` overrides the defaults; a value of undefined removes the variable.
// Returns { proc, port, tmpDir, output() } where output() is everything the
// server printed so far.
const startRestApi = async (env) => {
  const port = await reserveFreePort();
  const tmpDir = mkdtempSync(join(tmpdir(), 'dms-gui-rest-api-smoke-'));
  const pyPath = join(tmpDir, 'rest-api.py');
  const manifestPath = join(tmpDir, 'manifest.json');

  const py = mailserverRESTAPI.dms.api.content.replace(
    '{DMSGUI_VERSION}',
    'smoke-test'
  );
  writeFileSync(pyPath, py);
  writeFileSync(manifestPath, JSON.stringify(SYNTHETIC_MANIFEST));

  const childEnv = {
    ...process.env,
    DMS_API_HOST: '127.0.0.1',
    DMS_API_PORT: String(port),
    DMS_API_KEY: API_KEY,
    DMS_API_MANIFEST: manifestPath,
    DMS_API_SIZE: '2048',
    LOG_LEVEL: 'info',
    PYTHONUNBUFFERED: '1',
    ...env,
  };
  for (const [name, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[name];
  }

  let output = '';
  const proc = spawn('python3', [pyPath], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (chunk) => (output += chunk));
  proc.stderr.on('data', (chunk) => (output += chunk));

  await waitForServer(port);
  return { proc, port, tmpDir, output: () => output };
};

const stopRestApi = async (server) => {
  if (!server) return;
  const { proc, tmpDir } = server;
  await new Promise((resolve) => {
    // If the process already exited, resolve immediately. Otherwise
    // attach listener BEFORE sending the signal so we don't miss the
    // exit event in the race window between check and listener attach.
    if (proc.exitCode !== null) return resolve();
    proc.once('exit', resolve);
    // Trigger the exit if not already in progress.
    if (!proc.killed) proc.kill('SIGTERM');
    // Hard ceiling — if SIGTERM is ignored, force-kill and resolve.
    // Resolve unconditionally on timeout so afterAll never hangs.
    const killTimer = setTimeout(() => {
      try {
        if (proc.exitCode === null) proc.kill('SIGKILL');
      } catch {
        /* process may already be gone */
      }
      resolve();
    }, 2000);
    killTimer.unref();
  });
  rmSync(tmpDir, { recursive: true, force: true });
};

// POST a JSON body. `authorization` of null sends no Authorization header.
const postTo = (port, body, authorization = API_KEY) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    };
    if (authorization !== null) headers.Authorization = authorization;
    const req = http.request(
      { host: '127.0.0.1', port: port, method: 'POST', path: '/', headers },
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

describeIfPython('rest-api.py smoke', () => {
  let server;
  const post = (body) => postTo(server.port, body);

  beforeAll(async () => {
    server = await startRestApi({});
  }, 15000);

  afterAll(async () => {
    await stopRestApi(server);
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

  it('rejects legacy {command:} bodies with 400 (action protocol is mandatory)', async () => {
    const r = await post({ command: 'echo legacy-gone' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/missing 'action'/);
  });

  it('rejects a request without an Authorization header', async () => {
    const r = await postTo(
      server.port,
      { action: 'echo_arg', args: { message: 'hello' } },
      null
    );
    expect(r.body.error).toBe('Missing api_key: api_miss');
    expect(r.body.stdout).toBeUndefined();
  });

  it('rejects a wrong key', async () => {
    const r = await postTo(
      server.port,
      { action: 'echo_arg', args: { message: 'hello' } },
      'wrong-key'
    );
    expect(r.body.error).toMatch(/^Invalid api_key: api_match/);
    expect(r.body.stdout).toBeUndefined();
  });
});

describeIfPython('rest-api.py without DMS_API_KEY', () => {
  let server;

  beforeAll(async () => {
    server = await startRestApi({ DMS_API_KEY: undefined });
  }, 15000);

  afterAll(async () => {
    await stopRestApi(server);
  });

  it('rejects a request without an Authorization header', async () => {
    const r = await postTo(
      server.port,
      { action: 'echo_arg', args: { message: 'hello' } },
      null
    );
    expect(r.body.error).toBe('DMS api_key unset: api_unset');
    expect(r.body.stdout).toBeUndefined();
  });

  it("rejects the old 'missing' default as a key", async () => {
    const r = await postTo(
      server.port,
      { action: 'echo_arg', args: { message: 'hello' } },
      'missing'
    );
    expect(r.body.error).toBe('DMS api_key unset: api_unset');
    expect(r.body.stdout).toBeUndefined();
  });

  it('warns at startup that every request will be rejected', () => {
    expect(server.output()).toMatch(/DMS_API_KEY is not set/);
  });
});

describeIfPython('rest-api.py debug logging', () => {
  let server;

  beforeAll(async () => {
    server = await startRestApi({ LOG_LEVEL: 'debug' });
  }, 15000);

  afterAll(async () => {
    await stopRestApi(server);
  });

  it('logs argument names but never their values', async () => {
    const secret = 'S3cret-Passw0rd-value';
    const r = await postTo(server.port, {
      action: 'echo_arg',
      args: { message: secret },
    });
    expect(r.body.stdout.trim()).toBe(secret);
    expect(server.output()).toMatch(/Received arg names: message/);
    expect(server.output()).not.toContain(secret);
  });
});
