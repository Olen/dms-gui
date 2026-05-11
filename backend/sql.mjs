// SQL table definitions and statements for dms-gui's SQLite database.
// Extracted from db.mjs's god-module during the #82 split. Re-exported
// through db.mjs so existing call sites don't churn.
//
// `sqlMatch` is the regex pair the migration logic uses to detect
// already-applied ADD COLUMN / DROP COLUMN ops by inspecting SQLite's
// error message; `sql` is the big bundle of CREATE / SELECT / INSERT /
// UPDATE / DELETE templates keyed by domain (settings, configs,
// accounts, logins, aliases, sieve, domains, bayesLearned).
//
// Template values like `${env.DMSGUI_VERSION}` and `${env.isImmutable}`
// are interpolated when the module loads, so the resulting strings are
// frozen at startup. The DDL block under `init.patch` is replayed by
// dbInit() during boot to apply any in-progress migrations.

import { env } from './env.mjs';

export const sqlMatch = {
  add: {
    patch: /ALTER[\s]+TABLE[\s]+["]?[\w]+["]?[\s]+ADD[\s]+["]?(\w+)["]?/i,
    error: /duplicate[\s]+column[\s]+name:[\s]+["]?(\w+)["]?/i,
  },
  drop: {
    patch: /DROP[\s]+COLUMN[\s]+["]?(\w+)[";]?/i,
    error: /no[\s]+such[\s]+column[:\s]+["]?(\w+)["]?/i,
  },
  get: {
    error: /no[\s]+such[\s]+column[:\s]+["]?(\w+)["]?/i,
  },
};

export const sql = {
  // ███████ ███████ ████████ ████████ ██ ███    ██  ██████  ███████
  // ██      ██         ██       ██    ██ ████   ██ ██       ██
  // ███████ █████      ██       ██    ██ ██ ██  ██ ██   ███ ███████
  //      ██ ██         ██       ██    ██ ██  ██ ██ ██    ██      ██
  // ███████ ███████    ██       ██    ██ ██   ████  ██████  ███████
  settings: {
    scope: true,
    id: 'name',
    keys: {
      name: 'string',
      value: 'string',
      configID: 'number',
      isMutable: 'number',
    },
    // select: {
    //   count:    `SELECT COUNT(*) count FROM settings WHERE 1=1 AND isMutable = ${env.isMutable}`,
    //   settings: `SELECT name, value FROM settings WHERE 1=1 AND isMutable = ${env.isMutable} AND scope = @scope`,
    //   setting:  `SELECT value       FROM settings WHERE 1=1 AND isMutable = ${env.isMutable} AND scope = @scope AND name = ?`,
    //   envs:     `SELECT name, value FROM settings WHERE 1=1 AND isMutable = ${env.isImmutable} AND scope = @scope`,
    //   env:      `SELECT value       FROM settings WHERE 1=1 AND isMutable = ${env.isImmutable} AND scope = @scope AND name = ?`,
    //   scopes:   `SELECT DISTINCT value FROM settings WHERE 1=1 AND isMutable = ${env.isMutable} AND name = 'containerName' AND scope NOT IN (SELECT DISTINCT id from logins)`,
    // },

    // insert: {
    //   setting:  `REPLACE INTO settings (name, value, scope, isMutable) VALUES (@name, @value, @scope, 1)`,
    //   env:      `REPLACE INTO settings (name, value, scope, isMutable) VALUES (@name, @value, @scope, 0)`,
    // },

    // delete: {
    //   envs:     `DELETE FROM settings WHERE 1=1 AND isMutable = ${env.isImmutable} AND scope = @scope`,
    //   env:      `DELETE FROM settings WHERE 1=1 AND isMutable = ${env.isImmutable} AND scope = @scope AND name = ?`,
    // },

    init: `BEGIN TRANSACTION;
          CREATE    TABLE IF NOT EXISTS settings (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          name      TEXT NOT NULL,
          value     TEXT NOT NULL,
          configID  INTEGER NOT NULL,
          isMutable BIT DEFAULT ${env.isImmutable},
          UNIQUE    (name, configID)
          );
          INSERT OR IGNORE INTO settings (name, value, configID, isMutable) VALUES ('settings', '${env.DMSGUI_VERSION}', 1, ${env.isImmutable});
          COMMIT;`,

    patch: [],
  },

  //  ██████  ██████  ███    ██ ███████ ██  ██████  ███████
  // ██      ██    ██ ████   ██ ██      ██ ██       ██
  // ██      ██    ██ ██ ██  ██ █████   ██ ██   ███ ███████
  // ██      ██    ██ ██  ██ ██ ██      ██ ██    ██      ██
  //  ██████  ██████  ██   ████ ██      ██  ██████  ███████
  configs: {
    scope: false,
    id: 'name',
    keys: {
      name: 'string',
      plugin: 'string',
      schema: 'string',
      scope: 'string',
    },
    select: {
      count: `SELECT COUNT(*) count FROM configs `,
      id: `SELECT id FROM configs WHERE 1=1 AND plugin = @plugin AND (name LIKE ?)`,
      configs: `SELECT name as value, plugin, schema, scope FROM configs WHERE 1=1 AND plugin = @plugin AND (scope LIKE ?)`,
      settings: `SELECT s.name, s.value FROM settings s LEFT JOIN configs c ON s.configID = c.id WHERE 1=1 AND configID = (select id FROM configs WHERE name = ? AND plugin = @plugin) AND isMutable = ${env.isMutable}`,
      setting: `SELECT         s.value FROM settings s LEFT JOIN configs c ON s.configID = c.id WHERE 1=1 AND configID = (select id FROM configs WHERE name = ? AND plugin = @plugin) AND isMutable = ${env.isMutable}   AND s.name = ?`,
      envs: `SELECT s.name, s.value FROM settings s LEFT JOIN configs c ON s.configID = c.id WHERE 1=1 AND configID = (select id FROM configs WHERE name = ? AND plugin = @plugin) AND isMutable = ${env.isImmutable}`,
      env: `SELECT         s.value FROM settings s LEFT JOIN configs c ON s.configID = c.id WHERE 1=1 AND configID = (select id FROM configs WHERE name = ? AND plugin = @plugin) AND isMutable = ${env.isImmutable} AND s.name = ?`,
    },

    insert: {
      config: `INSERT  INTO configs (name, plugin, schema, scope) VALUES (?, @plugin, @schema, @scope) RETURNING id`,
      setting: `REPLACE INTO settings (name, value, configID, isMutable) VALUES (@name, @value, (select id FROM configs WHERE name = ? AND plugin = @plugin), 1)`,
      env: `REPLACE INTO settings (name, value, configID, isMutable) VALUES (@name, @value, (select id FROM configs WHERE name = ? AND plugin = @plugin), 0)`,
    },

    update: {
      config: `UPDATE configs set name = @name, schema = @schema WHERE 1=1 AND plugin = @plugin AND name = ? RETURNING id`,
    },

    delete: {
      config: `DELETE FROM configs WHERE 1=1 AND name = ? AND plugin = @plugin AND schema = @schema`,
      envs: `DELETE FROM settings WHERE 1=1 AND isMutable = ${env.isImmutable} AND configID = (select id FROM configs WHERE name = ? AND plugin = @plugin)`,
      settings: `DELETE FROM settings WHERE 1=1 AND isMutable = ${env.isMutable}   AND configID = (select id FROM configs WHERE name = ? AND plugin = @plugin)`,
    },

    init: `BEGIN TRANSACTION;
          CREATE    TABLE IF NOT EXISTS configs (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          name      TEXT NOT NULL,
          plugin    TEXT NOT NULL,
          schema    TEXT NOT NULL,
          scope     TEXT NOT NULL,
          UNIQUE    (name, plugin)
          );
          INSERT           INTO configs    (name, plugin, schema, scope)      VALUES ('DB_VERSION', 'dms-gui', 'DB_VERSION', 'dms-gui');
          INSERT OR IGNORE INTO settings  (name, value, configID, isMutable) VALUES ('configs', '${env.DMSGUI_VERSION}', 1, ${env.isImmutable});
          COMMIT;`,
  },

  // ██       ██████   ██████  ██ ███    ██ ███████
  // ██      ██    ██ ██       ██ ████   ██ ██
  // ██      ██    ██ ██   ███ ██ ██ ██  ██ ███████
  // ██      ██    ██ ██    ██ ██ ██  ██ ██      ██
  // ███████  ██████   ██████  ██ ██   ████ ███████
  logins: {
    desc: "password is in the list of keys even though it's not a column",
    id: 'id',
    keys: {
      mailbox: 'string',
      username: 'string',
      email: 'string',
      salt: 'string',
      hash: 'string',
      isAdmin: 'number',
      isActive: 'number',
      isAccount: 'number',
      mailserver: 'string',
      refreshToken: 'string',
      roles: 'object',
      password: 'string',
      language: 'string',
    },
    scope: 'mailserver',
    select: {
      count: `SELECT COUNT(*) count from logins WHERE 1=1 and mailserver = @mailserver`,
      login: `SELECT id, username, email, isAdmin, isActive, isAccount, mailserver, roles, mailbox, language from logins WHERE 1=1 AND id = @id`,
      // Per-key variants used by getLogin's object-credential path. Replaces
      // a single template that used string-replace to splice the column name
      // in before .prepare() — safe in practice because the caller validated
      // the key against an allowlist, but a structural defect (a future
      // caller passing a key that slips past the allowlist would inject SQL).
      // Note: the existing `login` statement above already covers id lookups;
      // these add the missing mailbox/username variants.
      loginByMailbox: `SELECT id, username, email, isAdmin, isActive, isAccount, mailserver, roles, mailbox, language from logins WHERE 1=1 AND mailbox = @mailbox`,
      loginByUsername: `SELECT id, username, email, isAdmin, isActive, isAccount, mailserver, roles, mailbox, language from logins WHERE 1=1 AND username = @username`,
      loginGuess: `SELECT id, username, email, isAdmin, isActive, isAccount, mailserver, roles, mailbox, language from logins WHERE 1=1 AND (mailbox = @mailbox OR username = @username)`,
      logins: `SELECT id, username, email, isAdmin, isActive, isAccount, mailserver, roles, mailbox, language from logins WHERE 1=1`,
      admins: `SELECT id, username, email, isAdmin, isActive, isAccount, mailserver, roles, mailbox, language from logins WHERE 1=1 AND isAdmin = 1`,
      roles: `SELECT roles from logins WHERE 1=1 AND id = @id`,
      // Static-statement variants for the object-credential lookup. Same
      // rationale as loginByMailbox / loginByUsername above — drops the
      // string-replace template in favour of explicit prepared statements.
      rolesByMailbox: `SELECT roles from logins WHERE 1=1 AND mailbox = @mailbox`,
      rolesByUsername: `SELECT roles from logins WHERE 1=1 AND username = @username`,
      salt: `SELECT salt from logins WHERE id = ?`,
      hash: `SELECT hash from logins WHERE id = ?`,
      saltHash: `SELECT salt, hash FROM logins WHERE (mailbox = @mailbox OR username = @username)`,
      refreshToken: `SELECT * FROM logins WHERE id = ? AND refreshToken = @refreshToken`,
    },

    insert: {
      login: `REPLACE INTO logins  (mailbox, username, email, salt, hash, isAdmin, isAccount, isActive, mailserver, roles) VALUES (@mailbox, @username, @email, @salt, @hash, @isAdmin, @isAccount, @isActive, @mailserver, @roles)`,
      fromDMS: `REPLACE INTO logins  (mailbox, username, email, isAccount, mailserver, roles) VALUES (@mailbox, @username, @email, @isAccount, @mailserver, @roles)`,
    },

    update: {
      password: `UPDATE logins set salt=@salt, hash=@hash WHERE id = ?`,
      refreshToken: `UPDATE logins set refreshToken = NULL WHERE id = ?`,
      refreshTokens: `UPDATE logins set refreshToken = NULL`,
      mailbox: {
        undefined: {
          desc: "allow to change a login's mailbox only if isAdmin or not isAccount",
          test: `SELECT COUNT(mailbox) count from logins WHERE 1=1 AND (isAdmin = 1 OR isAccount = 0) AND id = ?`,
          check: function (result) {
            return result.count == 1;
          },
          pass: `UPDATE logins set mailbox = @mailbox WHERE id = ?`,
          fail: 'Cannot change mailbox from a mailbox-linked user.',
        },
      },
      isAdmin: {
        0: {
          desc: 'refuse to demote the last admin',
          test: `SELECT COUNT(isAdmin) count from logins WHERE 1=1 AND isActive = 1 AND isAdmin = 1 AND id IS NOT ?`,
          check: function (result) {
            return result.count > 0;
          },
          pass: `UPDATE logins set isAdmin = @isAdmin WHERE id = ?`,
          fail: 'Cannot demote the last admin, how will you administer dms-gui?',
        },
        1: {
          desc: 'not a test, just flipping login to isAdmin also flips isAccount to 0',
          test: `SELECT COUNT(isAdmin) count from logins WHERE 1=1 AND id = ?`,
          check: function () {
            return true;
          },
          pass: `UPDATE logins set isAdmin = @isAdmin, isAccount = 0, isActive = 1 WHERE id = ?`,
          fail: 'Cannot demote the last admin, how will you administer dms-gui?',
        },
      },
      isActive: {
        0: {
          desc: 'refuse to deactivate the last admin',
          test: `SELECT COUNT(isActive) count from logins WHERE 1=1 AND isActive = 1 AND isAdmin = 1 AND id IS NOT ?`,
          check: function (result) {
            return result.count > 0;
          },
          pass: `UPDATE logins set isActive = @isActive WHERE id = ?`,
          fail: 'Cannot deactivate the last admin, how will you administer dms-gui?',
        },
        undefined: {
          desc: 'no test',
          test: `SELECT COUNT(isActive) count from logins WHERE 1=1 AND id = ?`,
          check: function () {
            return true;
          },
          pass: `UPDATE logins set isActive = @isActive WHERE id = ?`,
        },
      },
      isAccount: {
        0: {
          desc: 'refuse to be isAccount when isAdmin',
          test: `SELECT COUNT(isAdmin) count from logins WHERE 1=1 AND isAdmin = 1 AND id = ?`,
          check: function (result) {
            return result.count == 0;
          },
          pass: `UPDATE logins set isAccount = @isAccount WHERE id = ?`,
          fail: "Cannot make an admin also a linked account, it's one or the other",
        },
        1: {
          desc: 'not a test, just flipping login to isAccount also flips isAdmin to 0',
          test: `SELECT COUNT(isAccount) count from logins WHERE 1=1 AND id = ?`,
          check: function () {
            return true;
          },
          pass: `UPDATE logins set isAccount = @isAccount, isAdmin = 0 WHERE id = ?`,
        },
      },
    },

    delete: {
      id: {
        undefined: {
          desc: 'refuse to delete last admin',
          test: `SELECT COUNT(isAdmin) count from logins WHERE 1=1 AND isAdmin = 1 AND id IS NOT ?`,
          check: function (result) {
            return result.count > 0;
          },
          pass: `DELETE from logins WHERE 1=1 AND id = ?`,
          fail: 'Cannot delete the last admin, how will you administer dms-gui?',
        },
      },
    },

    init: `BEGIN TRANSACTION;
          CREATE TABLE IF NOT EXISTS logins (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          mailbox   TEXT NOT NULL UNIQUE,
          username  TEXT NOT NULL UNIQUE,
          email     TEXT,
          salt      TEXT,
          hash      TEXT,
          isAdmin   BIT DEFAULT 0,
          isActive  BIT DEFAULT 1,
          isAccount BIT DEFAULT 1,
          mailserver  TEXT,
          refreshToken  TEXT,
          roles     TEXT DEFAULT '[]'
          );
          INSERT OR IGNORE INTO logins (mailbox, username, email, salt, hash, isAdmin, isActive, isAccount, roles) VALUES ('admin@dms-gui.com', 'admin', 'admin@dms-gui.com', 'fdebebcdcec4e534757a49473759355b', 'a975c7c1bf9783aac8b87e55ad01fdc4302254d234c9794cd4227f8c86aae7306bbeacf2412188f46ab6406d1563455246405ef0ee5861ffe2440fe03b271e18', 1, 1, 0, '[]');
          INSERT OR IGNORE INTO settings (name, value, configID, isMutable) VALUES ('logins', '${env.DMSGUI_VERSION}', 1, ${env.isImmutable});
          COMMIT;`,

    patch: [
      // { DB_VERSION: '1.4.7',
      //   patches: [
      //     `ALTER TABLE logins ADD refreshToken    TEXT`,
      //     `REPLACE INTO settings (name, value, scope, isMutable) VALUES ('DB_VERSION_logins', '1.4.7', 1, ${env.isImmutable})`,
      //   ],
      // },
      {
        DB_VERSION: '1.5.13',
        patches: [
          `ALTER TABLE logins RENAME COLUMN favorite TO mailserver`,
          `REPLACE INTO settings (name, value, configID, isMutable) VALUES ('logins', '1.5.13', 1, ${env.isImmutable})`,
        ],
      },
      {
        DB_VERSION: '1.5.24',
        patches: [
          `ALTER TABLE logins ADD language TEXT`,
          `REPLACE INTO settings (name, value, configID, isMutable) VALUES ('logins', '1.5.24', 1, ${env.isImmutable})`,
        ],
      },
    ],
  },

  //  █████   ██████  ██████  ██████  ██    ██ ███    ██ ████████ ███████
  // ██   ██ ██      ██      ██    ██ ██    ██ ████   ██    ██    ██
  // ███████ ██      ██      ██    ██ ██    ██ ██ ██  ██    ██    ███████
  // ██   ██ ██      ██      ██    ██ ██    ██ ██  ██ ██    ██         ██
  // ██   ██  ██████  ██████  ██████   ██████  ██   ████    ██    ███████
  accounts: {
    desc: "password is in the the list of keys even tho it's not a column; scope = containerName; schema = type of container: dms, poste, etc",
    id: 'mailbox',
    keys: {
      mailbox: 'string',
      domain: 'string',
      salt: 'string',
      hash: 'string',
      configID: 'number',
      password: 'string',
      storage: 'object',
      name: 'string',
    },
    scope: 'name',
    select: {
      count: `SELECT COUNT(*) count from accounts WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name)`,
      accounts: `SELECT a.mailbox, a.domain, a.storage, l.username 
               FROM accounts a 
               LEFT JOIN configs c ON c.id = a.configID 
               LEFT JOIN logins l ON l.mailbox = a.mailbox 
               WHERE 1=1 
               AND c.plugin = 'mailserver' 
               AND c.name = ? 
               ORDER BY a.domain, a.mailbox`,
      mailboxes: `SELECT mailbox FROM accounts WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name)`,
      mailbox: `SELECT mailbox FROM accounts WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name) AND mailbox = ?`,
      saltHash: `SELECT salt, hash FROM accounts WHERE mailbox = @mailbox`,
      configs: `SELECT DISTINCT name as value, 'mailserver' as plugin, schema, 'dms-gui' as scope FROM accounts a LEFT JOIN configs c ON c.id = a.configID WHERE 1=1 AND mailbox IN (?)`,
    },

    insert: {
      fromDMS: `REPLACE INTO accounts (mailbox, domain, storage, configID)     VALUES (@mailbox, @domain, @storage,     (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = ?))`,
      fromGUI: `REPLACE INTO accounts (mailbox, domain, salt, hash, configID)  VALUES (@mailbox, @domain, @salt, @hash, (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = ?))`,
    },

    update: {
      password: `UPDATE accounts set salt=@salt, hash=@hash WHERE 1=1 AND mailbox = ?`,
      storage: `UPDATE accounts set storage = @storage     WHERE 1=1 AND mailbox = ?`,
    },

    delete: {
      mailbox: `DELETE FROM accounts WHERE 1=1 AND mailbox = ? AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @scope)`,
    },

    init: `BEGIN TRANSACTION;
          CREATE TABLE IF NOT EXISTS accounts (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          mailbox   TEXT NOT NULL UNIQUE,
          domain    TEXT,
          salt      TEXT,
          hash      TEXT,
          storage   TEXT DEFAULT '{}',
          configID  INTEGER NOT NULL
          );
          INSERT OR IGNORE INTO settings (name, value, configID, isMutable) VALUES ('accounts', '${env.DMSGUI_VERSION}', 1, ${env.isImmutable});
          COMMIT;`,

    patch: [
      // { DB_VERSION: '1.1.3',
      //   patches: [
      //     `ALTER TABLE accounts ADD scope   TEXT DEFAULT '${live.DMS_CONTAINER}'`,
      //     `REPLACE INTO settings (name, value, scope, isMutable) VALUES ('DB_VERSION_accounts', '1.1.3', 1, ${env.isImmutable})`,
      //   ],
      // },
    ],
  },

  //  █████  ██      ██  █████  ███████ ███████ ███████
  // ██   ██ ██      ██ ██   ██ ██      ██      ██
  // ███████ ██      ██ ███████ ███████ █████   ███████
  // ██   ██ ██      ██ ██   ██      ██ ██           ██
  // ██   ██ ███████ ██ ██   ██ ███████ ███████ ███████
  aliases: {
    id: 'source',
    keys: {
      source: 'string',
      destination: 'string',
      regex: 'number',
      configID: 'number',
      name: 'string',
    },
    scope: 'name',
    select: {
      count: `SELECT COUNT(*) count from aliases WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name)`,
      aliases: `SELECT a.source, a.destination, a.regex, l.username 
               FROM aliases a 
               LEFT JOIN configs c ON c.id = a.configID 
               LEFT JOIN logins l ON l.mailbox = a.destination 
               WHERE 1=1 
               AND c.plugin = 'mailserver' 
               AND c.name = ? 
               ORDER BY a.source, a.destination`,
    },

    insert: {
      alias: `REPLACE INTO aliases (source, destination, regex, configID) VALUES (@source, @destination, @regex, (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = ?))`,
    },

    delete: {
      bySource: `DELETE FROM aliases WHERE 1=1 AND source = ? AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @scope)`,
      byConfig: `DELETE FROM aliases WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = ?)`,
    },

    init: `BEGIN TRANSACTION;
          CREATE TABLE IF NOT EXISTS aliases (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          source      TEXT NOT NULL,
          destination TEXT NOT NULL,
          regex       BIT DEFAULT 0,
          configID    INTEGER NOT NULL,
          UNIQUE (source, destination)
          );
          INSERT OR IGNORE INTO settings (name, value, configID, isMutable) VALUES ('aliases', '${env.DMSGUI_VERSION}', 1, ${env.isImmutable});
          COMMIT;`,
  },

  // ██████   ██████  ███    ███  █████  ██ ███    ██ ███████
  // ██   ██ ██    ██ ████  ████ ██   ██ ██ ████   ██ ██
  // ██   ██ ██    ██ ██ ████ ██ ███████ ██ ██ ██  ██ ███████
  // ██   ██ ██    ██ ██  ██  ██ ██   ██ ██ ██  ██ ██      ██
  // ██████   ██████  ██      ██ ██   ██ ██ ██   ████ ███████
  domains: {
    id: 'domain',
    keys: {
      domain: 'string',
      dkim: 'string',
      keytype: 'string',
      keysize: 'number',
      path: 'string',
      dnsProvider: 'string',
      configID: 'number',
    },
    scope: 'name',
    select: {
      count: `SELECT COUNT(*) count FROM domains WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name)`,
      domains: `SELECT * FROM domains WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name)`,
      domainsWithCounts: `SELECT allDomains.domain, allDomains.dkim, allDomains.keytype, allDomains.keysize, allDomains.path, allDomains.dnsProvider, allDomains.configID,
      (SELECT COUNT(*) FROM accounts a WHERE a.domain = allDomains.domain AND a.configID = allDomains.configID) as accountCount,
      (SELECT COUNT(DISTINCT source) FROM aliases WHERE SUBSTR(source, INSTR(source, '@') + 1) = allDomains.domain AND configID = allDomains.configID) as aliasCount
      FROM (
        SELECT d.domain, d.dkim, d.keytype, d.keysize, d.path, d.dnsProvider, d.configID
        FROM domains d
        WHERE d.configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name)
        UNION
        SELECT DISTINCT a.domain, NULL as dkim, NULL as keytype, NULL as keysize, NULL as path, NULL as dnsProvider, a.configID
        FROM accounts a
        WHERE a.configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name)
        AND a.domain NOT IN (SELECT d2.domain FROM domains d2 WHERE d2.configID = a.configID)
      ) allDomains`,
      domain: `SELECT * FROM domains WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name) AND domain = ?`,
      dkims: `SELECT DISTINCT dkim FROM domains WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name)`,
      dkim: `SELECT dkim FROM domains WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name) AND domain = ?`,
    },

    insert: {
      domain: `INSERT INTO domains (domain, dkim, keytype, keysize, path, configID) VALUES (@domain, @dkim, @keytype, @keysize, @path, (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = ?))
               ON CONFLICT(domain) DO UPDATE SET dkim=excluded.dkim, keytype=excluded.keytype, keysize=excluded.keysize, path=excluded.path, configID=excluded.configID`,
    },

    update: {},

    delete: {
      domain: `DELETE FROM domains WHERE 1=1 AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name) AND domain = ?`,
    },

    init: `BEGIN TRANSACTION;
          CREATE TABLE IF NOT EXISTS domains (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          domain      TEXT NOT NULL UNIQUE,
          dkim        TEXT DEFAULT '${env.DKIM_SELECTOR_DEFAULT}',
          keytype     TEXT DEFAULT 'rsa',
          keysize     TEXT DEFAULT 2048,
          path        TEXT DEFAULT '${env.DMS_CONFIG_PATH}/rspamd/dkim/${env.DKIM_KEYTYPE_DEFAULT}-${env.DKIM_KEYSIZE_DEFAULT}-${env.DKIM_SELECTOR_DEFAULT}-$domain.private.txt',
          dnsProvider TEXT,
          configID    INTEGER NOT NULL
          );
          INSERT OR IGNORE INTO settings (name, value, configID, isMutable) VALUES ('domains', '${env.DMSGUI_VERSION}', 1, ${env.isImmutable});
          COMMIT;`,

    patch: [
      // { DB_VERSION: '1.1.2',
      //   patches: [
      //     `ALTER TABLE domains ADD keytype TEXT DEFAULT 'rsa'`,
      //     `ALTER TABLE domains ADD keysize TEXT DEFAULT '2048'`,
      //     `REPLACE INTO settings (name, value, scope, isMutable) VALUES ('DB_VERSION_domains', '1.1.2', 1, ${env.isImmutable})`,
      //   ],
      // },
      // { DB_VERSION: '1.1.3',
      //   patches: [
      //     `ALTER TABLE domains ADD scope   TEXT DEFAULT '${live.DMS_CONTAINER}'`,
      //     `REPLACE INTO settings (name, value, scope, isMutable) VALUES ('DB_VERSION_domains', '1.1.3', 1, ${env.isImmutable})`,
      //   ],
      // },
      // { DB_VERSION: '1.5.7',
      //   patches: [
      //     `ALTER TABLE domains ADD provider   TEXT`,
      //     `REPLACE INTO settings (name, value, scope, isMutable) VALUES ('DB_VERSION_domains', '1.5.7', 1, ${env.isImmutable})`,
      //   ],
      // },
    ],
  },

  // ██████  ██     ██     ██████  ███████ ███████ ███████ ████████ ███████
  // ██   ██ ██     ██     ██   ██ ██      ██      ██         ██    ██
  // ██████  ██  █  ██     ██████  █████   ███████ █████      ██    ███████
  // ██      ██ ███ ██     ██   ██ ██           ██ ██         ██         ██
  // ██       ███ ███      ██   ██ ███████ ███████ ███████    ██    ███████
  password_resets: {
    id: 'id',
    keys: {
      loginId: 'number',
      tokenHash: 'string',
      expiresAt: 'number',
      usedAt: 'number',
      createdAt: 'number',
    },
    select: {
      byTokenHash: `SELECT pr.id, pr.loginId, pr.expiresAt, pr.usedAt, l.mailbox, l.isAccount, l.mailserver
                   FROM password_resets pr
                   JOIN logins l ON l.id = pr.loginId
                   WHERE pr.tokenHash = ?
                     AND pr.usedAt IS NULL
                     AND pr.expiresAt > ?`,
      countRecent: `SELECT COUNT(*) count FROM password_resets
                   WHERE loginId = ? AND createdAt > ?`,
    },

    insert: {
      token: `INSERT INTO password_resets (loginId, tokenHash, expiresAt, createdAt) VALUES (?, ?, ?, ?)`,
    },

    update: {
      markUsed: `UPDATE password_resets SET usedAt = ? WHERE id = ? AND usedAt IS NULL`,
    },

    delete: {
      expired: `DELETE FROM password_resets WHERE expiresAt < ?`,
    },

    init: `BEGIN TRANSACTION;
          CREATE TABLE IF NOT EXISTS password_resets (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          loginId   INTEGER NOT NULL,
          tokenHash TEXT NOT NULL,
          expiresAt INTEGER NOT NULL,
          usedAt    INTEGER,
          createdAt INTEGER NOT NULL,
          FOREIGN KEY (loginId) REFERENCES logins(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_pr_token ON password_resets(tokenHash);
          CREATE INDEX IF NOT EXISTS idx_pr_expiry ON password_resets(expiresAt);
          INSERT OR IGNORE INTO settings (name, value, configID, isMutable) VALUES ('password_resets', '${env.DMSGUI_VERSION}', 1, ${env.isImmutable});
          COMMIT;`,

    patch: [],
  },

  // ██████  ███    ██ ███████
  // ██   ██ ████   ██ ██
  // ██   ██ ██ ██  ██ ███████
  // ██   ██ ██  ██ ██      ██
  // ██████  ██   ████ ███████
  dns: {
    desc: 'dns entries, with SRV priority/weight/port being use also for TLSA usage/selector/type, MX, CERT type/tag/algo, and DNSKEY flag/protocol/algo',
    id: 'domain',
    keys: {
      domain: 'string',
      name: 'string',
      type: 'string',
      ttl: 'number',
      priority: 'number',
      weight: 'number',
      port: 'number',
      data: 'string',
      CF_PROXY_ON: 'number',
    },
    scope: false,
    select: {
      count: `SELECT COUNT(*) count FROM dns WHERE 1=1 AND domain = @domain`,
      dns: `SELECT * FROM dns WHERE 1=1 AND domain = @domain`,
      byT: `SELECT * FROM dns WHERE 1=1 AND domain = @domain AND type = ?`,
      byName: `SELECT * FROM dns WHERE 1=1 AND domain = @domain AND name = ?`,
      byNameT: `SELECT * FROM dns WHERE 1=1 AND domain = @domain AND name = ? AND type = ?`,
      byNameTP: `SELECT * FROM dns WHERE 1=1 AND domain = @domain AND name = ? AND type = ? AND priority = ?`,
    },

    insert: {
      entry: `REPLACE INTO dns (domain, name, type, ttl, priority, data, CF_PROXY_ON) VALUES (@domain, @name, @type, @ttl, @priority, @data, @CF_PROXY_ON)`,
      entryFull: `REPLACE INTO dns (domain, name, type, ttl, priority, weight, port, data, CF_PROXY_ON) VALUES (@domain, @name, @type, @ttl, @priority, @weight, @port, @data, @CF_PROXY_ON)`,
      CF_PROXY_ON: `REPLACE INTO dns (domain, name, type, priority, CF_PROXY_ON) VALUES (@domain, @name, @type, @priority, @CF_PROXY_ON)`,
    },

    delete: {
      all: `DELETE FROM dns`,
      byDomain: `DELETE FROM dns WHERE 1=1 AND domain = @domain`,
      entry: `DELETE FROM dns WHERE 1=1 AND domain = @domain AND name = @name AND type = @type AND priority = @priority`,
    },

    init: `BEGIN TRANSACTION;
          CREATE TABLE IF NOT EXISTS dns (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          domain      TEXT NOT NULL UNIQUE,
          name        TEXT NOT NULL,
          type        TEXT NOT NULL,
          priority    INTEGER,
          weight      INTEGER,
          port        INTEGER,
          data        TEXT NOT NULL,
          ttl         INTEGER DEFAULT 1,
          CF_PROXY_ON BIT DEFAULT 0,
          UNIQUE (domain, name, type, priority)
          );
          INSERT OR IGNORE INTO settings (name, value, configID, isMutable) VALUES ('dns', '${env.DMSGUI_VERSION}', 1, ${env.isImmutable});
          COMMIT;`,
  },

  // ██████   █████  ██    ██ ███████ ███████
  // ██   ██ ██   ██  ██  ██  ██      ██
  // ██████  ███████   ████   █████   ███████
  // ██   ██ ██   ██    ██    ██           ██
  // ██████  ██   ██    ██    ███████ ███████
  bayesLearned: {
    scope: false,
    keys: {
      message_id: 'string',
      action: 'string',
      user: 'string',
      learned_by: 'string',
    },
    select: {
      allMap: `SELECT message_id, action FROM bayes_learned WHERE configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name)`,
      byMsgId: `SELECT message_id, action, user, learned_by, learned_at FROM bayes_learned WHERE message_id = ? AND configID = (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = @name)`,
    },

    insert: {
      learned: `REPLACE INTO bayes_learned (message_id, action, user, learned_by, learned_at, configID) VALUES (@message_id, @action, @user, @learned_by, datetime('now'), (SELECT id FROM configs WHERE plugin = 'mailserver' AND name = ?))`,
    },

    init: `BEGIN TRANSACTION;
          CREATE TABLE IF NOT EXISTS bayes_learned (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id  TEXT NOT NULL,
          action      TEXT NOT NULL,
          user        TEXT NOT NULL,
          learned_by  TEXT NOT NULL,
          learned_at  TEXT NOT NULL DEFAULT (datetime('now')),
          configID    INTEGER NOT NULL,
          UNIQUE (message_id, user)
          );
          INSERT OR IGNORE INTO settings (name, value, configID, isMutable) VALUES ('bayes_learned', '${env.DMSGUI_VERSION}', 1, ${env.isImmutable});
          COMMIT;`,

    patch: [],
  },
};
