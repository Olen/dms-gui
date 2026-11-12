import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMail = vi.fn();
const getLogin = vi.fn();
const dbAll = vi.fn();
const dbGet = vi.fn();

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));
vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  infoLog: vi.fn(),
}));
vi.mock('./db.mjs', () => ({
  changePassword: vi.fn(),
  dbAll: (...args) => dbAll(...args),
  dbGet: (...args) => dbGet(...args),
  dbRun: vi.fn(() => ({ success: true })),
  // Match the real shape: passwordReset.mjs reads sql.password_resets.* and
  // sql.logins.select.loginsByEmail.
  sql: {
    logins: { select: { loginsByEmail: 'loginsByEmail' } },
    password_resets: {
      insert: { token: '' },
      select: { countRecent: 'countRecent', byTokenHash: '' },
      update: { markUsed: '' },
      delete: { expired: '' },
    },
  },
}));
vi.mock('./logins.mjs', () => ({ getLogin: (...args) => getLogin(...args) }));
vi.mock('./env.mjs', () => ({
  env: {
    SMTP_HOST: 'mailserver',
    SMTP_PORT: 25,
    SMTP_TLS_VERIFY: true,
    SMTP_FROM: '',
    RESET_BASE_URL: 'https://epost.example.com',
  },
}));

import {
  buildSmtpTransportConfig,
  findLoginForReset,
  requestPasswordReset,
  resetFromAddress,
  resetRecipient,
} from './passwordReset.mjs';

const SMTP_ENV = {
  SMTP_HOST: 'mailserver',
  SMTP_PORT: 25,
  SMTP_TLS_VERIFY: true,
  RESET_BASE_URL: 'https://epost.example.com',
};

// A local login: placeholder mailbox, real address in `email`.
const ADMIN = {
  id: 1,
  username: 'admin',
  mailbox: 'admin@dms-gui.com',
  email: 'ola@example.com',
  isAccount: 0,
};
// A mail account login whose stored address is its mailbox.
const KARI = {
  id: 7,
  username: 'kari@example.com',
  mailbox: 'kari@example.com',
  email: 'kari@example.com',
  isAccount: 1,
};

const NOT_FOUND = { success: true, message: undefined };

// getLogin(identifier, guess=true): matches username or mailbox.
const loginsByUsernameOrMailbox = (identifier) => {
  for (const login of [ADMIN, KARI]) {
    if (identifier === login.username || identifier === login.mailbox) {
      return { success: true, message: login };
    }
  }
  return NOT_FOUND;
};

// dbAll for the stored-address and alias lookups.
const dbAllFor =
  ({ storedAddress = {}, aliases = {} }) =>
  (sql, params, ...anon) => {
    if (sql === 'loginsByEmail') {
      return { success: true, message: storedAddress[params.email] ?? [] };
    }
    const destination = aliases[anon[0]];
    return {
      success: true,
      message: destination ? [{ destination }] : [],
    };
  };

beforeEach(() => {
  vi.clearAllMocks();
  getLogin.mockImplementation(async (identifier) =>
    loginsByUsernameOrMailbox(identifier)
  );
  dbAll.mockImplementation(dbAllFor({}));
  dbGet.mockReturnValue({ success: true, message: { count: 0 } });
  sendMail.mockResolvedValue({});
});

describe('buildSmtpTransportConfig — TLS hardening', () => {
  it('always sets requireTLS:true so an attacker cannot strip STARTTLS', () => {
    const cfg = buildSmtpTransportConfig(SMTP_ENV);
    expect(cfg.requireTLS).toBe(true);
  });

  it('passes SMTP_TLS_VERIFY=true through to tls.rejectUnauthorized (default)', () => {
    const cfg = buildSmtpTransportConfig(SMTP_ENV);
    expect(cfg.tls).toEqual({ rejectUnauthorized: true });
  });

  it('honors SMTP_TLS_VERIFY=false (opt-out for self-signed Docker setups)', () => {
    const cfg = buildSmtpTransportConfig({
      ...SMTP_ENV,
      SMTP_TLS_VERIFY: false,
    });
    expect(cfg.tls).toEqual({ rejectUnauthorized: false });
    // Crucially, requireTLS stays true even when verification is off:
    // we won't fall back to plaintext, just to a self-signed peer.
    expect(cfg.requireTLS).toBe(true);
  });

  it('passes host and port through unchanged', () => {
    const cfg = buildSmtpTransportConfig({
      ...SMTP_ENV,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
    });
    expect(cfg.host).toBe('smtp.example.com');
    expect(cfg.port).toBe(587);
    expect(cfg.secure).toBe(false); // STARTTLS upgrade, not implicit TLS
  });

  it('uses the RESET_BASE_URL host as HELO name, not the container hostname', () => {
    const cfg = buildSmtpTransportConfig(SMTP_ENV);
    expect(cfg.name).toBe('epost.example.com');
  });
});

describe('resetRecipient', () => {
  it('uses the stored email address of a local login, not its placeholder mailbox', () => {
    expect(resetRecipient(ADMIN)).toBe('ola@example.com');
  });

  it('falls back to the mailbox when no address is stored', () => {
    expect(resetRecipient({ ...KARI, email: '' })).toBe('kari@example.com');
    expect(resetRecipient({ ...KARI, email: null })).toBe('kari@example.com');
  });
});

describe('resetFromAddress', () => {
  it('defaults to noreply at the RESET_BASE_URL host', () => {
    expect(resetFromAddress({ ...SMTP_ENV, SMTP_FROM: '' })).toBe(
      'noreply@epost.example.com'
    );
  });

  it('uses SMTP_FROM when set', () => {
    expect(
      resetFromAddress({ ...SMTP_ENV, SMTP_FROM: 'dms-gui@example.com' })
    ).toBe('dms-gui@example.com');
  });
});

describe('findLoginForReset', () => {
  it('finds a login by username', async () => {
    expect(await findLoginForReset('admin')).toEqual(ADMIN);
  });

  it('finds a login by its stored email address', async () => {
    dbAll.mockImplementation(
      dbAllFor({ storedAddress: { 'ola@example.com': [ADMIN] } })
    );
    expect(await findLoginForReset('ola@example.com')).toEqual(ADMIN);
  });

  it('prefers the stored address over an alias of another mailbox', async () => {
    dbAll.mockImplementation(
      dbAllFor({
        storedAddress: { 'ola@example.com': [ADMIN] },
        aliases: { 'ola@example.com': 'kari@example.com' },
      })
    );
    expect(await findLoginForReset('ola@example.com')).toEqual(ADMIN);
  });

  it('resolves a mail alias to its mailbox login', async () => {
    dbAll.mockImplementation(
      dbAllFor({ aliases: { 'k@example.com': 'kari@example.com' } })
    );
    expect(await findLoginForReset('k@example.com')).toEqual(KARI);
  });

  it('returns null when more than one login has the stored address', async () => {
    dbAll.mockImplementation(
      dbAllFor({ storedAddress: { 'shared@example.com': [ADMIN, KARI] } })
    );
    expect(await findLoginForReset('shared@example.com')).toBeNull();
  });

  it('returns null for an unknown identifier', async () => {
    expect(await findLoginForReset('nobody@example.com')).toBeNull();
  });
});

describe('requestPasswordReset', () => {
  it('sends the link for "admin" to its stored address, not to what was typed', async () => {
    const result = await requestPasswordReset(
      'admin',
      'https://epost.example.com'
    );
    expect(result.success).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('ola@example.com');
    expect(mail.from).toBe('noreply@epost.example.com');
    expect(mail.text).toContain('"admin"');
    expect(mail.text).toContain(
      'https://epost.example.com/reset-password?token='
    );
  });

  it('sends to the mailbox login when an alias was typed', async () => {
    dbAll.mockImplementation(
      dbAllFor({ aliases: { 'k@example.com': 'kari@example.com' } })
    );
    await requestPasswordReset('k@example.com', 'https://epost.example.com');
    expect(sendMail.mock.calls[0][0].to).toBe('kari@example.com');
  });

  it('sends nothing for an unknown identifier but gives the same answer', async () => {
    const result = await requestPasswordReset(
      'nobody@example.com',
      'https://epost.example.com'
    );
    expect(result).toEqual({
      success: true,
      message: 'If that account exists, a reset link has been sent.',
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends nothing when the rate limit is reached', async () => {
    dbGet.mockReturnValue({ success: true, message: { count: 3 } });
    await requestPasswordReset('admin', 'https://epost.example.com');
    expect(sendMail).not.toHaveBeenCalled();
  });
});
