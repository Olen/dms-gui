import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist env config so vi.mock factory can reference it.
const { mockEnv } = vi.hoisted(() => {
  const mockEnv = {
    isDEMO: false,
    timeout: 4,
    debug: false,
    LOG_COLORS: false,
  };
  return { mockEnv };
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
    this.setTimeout = vi.fn();
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
    expect(result.stderr).toMatch(/protocol.*host.*port.*Authorization/i);
  });

  it('uses targetDict.timeout when opts.timeout is not provided', async () => {
    const targetWithTimeout = { ...validTarget, timeout: 30 };

    await execAction('setup_email_list', {}, targetWithTimeout);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(body.timeout).toBe(30);
  });
});
