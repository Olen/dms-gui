import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist env config so vi.mock factory can reference it.
const { mockEnv, socketSetTimeoutSpy } = vi.hoisted(() => {
  const mockEnv = {
    isDEMO: false,
    timeout: 4,
    debug: false,
    LOG_COLORS: false,
  };
  // Captures the ms argument passed to socket.setTimeout in checkPort,
  // so the test can verify checkPort and the request body see the same
  // effective timeout (e.g. when opts.timeout overrides).
  const socketSetTimeoutSpy = vi.fn();
  return { mockEnv, socketSetTimeoutSpy };
});

vi.mock('./env.mjs', () => ({
  env: mockEnv,
}));

// Mock net to simulate an always-open port (checkPort resolves immediately).
// Must use a real constructor function — vi.fn() with arrow function won't work
// for `new net.Socket()` because arrow functions can't be constructors.
vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events');
  function MockSocket() {
    EventEmitter.call(this);
    this.setTimeout = (ms) => socketSetTimeoutSpy(ms);
    this.end = vi.fn();
    this.destroy = vi.fn();
    // Simulate a successful connection: call the connect callback synchronously.
    this.connect = vi.fn((_port, _host, cb) => {
      if (cb) cb();
    });
  }
  MockSocket.prototype = Object.create(EventEmitter.prototype);
  MockSocket.prototype.constructor = MockSocket;

  return {
    default: { Socket: MockSocket },
  };
});

import { execAction } from './backend.mjs';

describe('execAction', () => {
  let fetchSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.isDEMO = false;
    mockEnv.timeout = 4;

    // Spy on globalThis.fetch so we can capture what postJsonToApi sends.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ returncode: 0, stdout: 'ok', stderr: '' }),
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const validTarget = {
    protocol: 'http',
    host: '127.0.0.1',
    port: 8888,
    Authorization: 'Bearer test-key',
  };

  it('posts {action, args, timeout} body shape to the API', async () => {
    await execAction('setup_email_list', {}, validTarget);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(body).toEqual({
      action: 'setup_email_list',
      args: {},
      timeout: 4,
    });
  });

  it('returns {returncode, stdout, stderr} shape matching the legacy helpers', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        returncode: 0,
        stdout: 'user@example.com\n',
        stderr: '',
      }),
    });

    const result = await execAction('setup_email_list', {}, validTarget);

    expect(result).toEqual({
      returncode: 0,
      stdout: 'user@example.com\n',
      stderr: '',
    });
  });

  it('honours opts.timeout override over env.timeout', async () => {
    await execAction('setup_email_list', {}, validTarget, { timeout: 60 });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(body.timeout).toBe(60);
  });

  it('short-circuits with mock response in demo mode', async () => {
    mockEnv.isDEMO = true;

    const result = await execAction('setup_email_list', {}, validTarget);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      returncode: 0,
      stdout: 'mock response',
      stderr: '',
    });
  });

  it('returns returncode 99 when targetDict is missing required keys', async () => {
    const result = await execAction(
      'setup_email_list',
      {},
      {
        protocol: 'http',
        // missing host, port, Authorization
      }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.returncode).toBe(99);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/protocol.*host.*port.*Authorization/i);
  });

  it('uses targetDict.timeout when opts.timeout is not provided', async () => {
    const targetWithTimeout = { ...validTarget, timeout: 30 };

    await execAction('setup_email_list', {}, targetWithTimeout);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(body.timeout).toBe(30);
  });

  it('uses the same effective timeout for checkPort and the request body', async () => {
    // opts.timeout=60 should reach BOTH the socket setTimeout (used by
    // checkPort's TCP probe) AND the request body. Without this,
    // checkPort would still use targetDict.timeout — a long-running
    // action could fail the pre-flight TCP probe long before its own
    // timeout kicked in.
    await execAction('setup_email_list', {}, validTarget, { timeout: 60 });

    expect(socketSetTimeoutSpy).toHaveBeenCalledWith(60 * 1000);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.timeout).toBe(60);
  });

  it('falls back to env.timeout when opts.timeout is invalid (NaN, 0, negative, Infinity, non-numeric string)', async () => {
    for (const bad of [NaN, 0, -1, Infinity, 'not a number']) {
      fetchSpy.mockClear();
      socketSetTimeoutSpy.mockClear();
      await execAction('setup_email_list', {}, validTarget, { timeout: bad });
      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.timeout).toBe(4); // env.timeout fallback
    }
  });

  it('falls back to env.timeout when targetDict.timeout is invalid, ignoring opts.timeout', async () => {
    // If opts.timeout is absent but targetDict.timeout is invalid, should
    // fall through to env.timeout (4) rather than passing the bad value.
    const targetWithBadTimeout = { ...validTarget, timeout: -5 };
    await execAction('setup_email_list', {}, targetWithBadTimeout);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.timeout).toBe(4); // env.timeout fallback
  });

  it('passes explicit null args through to the body without coercion', async () => {
    // Contract: an explicit `null` from the caller is a programming error
    // that should surface as the rest-api interpreter's 400 ('args must
    // be an object'). The helper does NOT coerce null → {}; that would
    // mask the bug. This test guards against a future refactor silently
    // reintroducing the fallback.
    await execAction('setup_email_list', null, validTarget);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(body.args).toBeNull();
    expect(body).toEqual({
      action: 'setup_email_list',
      args: null,
      timeout: 4,
    });
  });
});
