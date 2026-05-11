import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execCb);

import { reduxPropertiesOfObj } from '../common.mjs';
import {
  debugLog,
  errorLog,
  execAction,
  formatDMSError,
  infoLog,
  successLog,
} from './backend.mjs';
import { env } from './env.mjs';
import { sql, sqlMatch } from './sql.mjs';
import {
  GCM_FORMAT_PREFIX,
  decrypt,
  encrypt,
  hashPassword,
} from './crypto.mjs';
// changePassword's mailserver branch calls getTargetDict to drive the
// setup_email_update action; import explicitly rather than going
// through the barrel re-export below (which only exposes the binding
// to outside consumers, not to db.mjs's own body).
import { getTargetDict } from './targetDict.mjs';

import Database from 'better-sqlite3';
import crypto from 'node:crypto';

var DB;

// Register signal handlers once at module import time so the DB is closed on
// shutdown. Previously these were registered inside dbOpen() which is called
// many times during runtime — each call stacked another set of listeners and
// Node would emit a MaxListenersExceededWarning at 11.
process.on('exit', () => {
  if (DB && DB.open) DB.close();
});
process.on('SIGHUP', () => process.exit(128 + 1));
process.on('SIGINT', () => process.exit(128 + 2));
process.on('SIGTERM', () => process.exit(128 + 15));

// rsa-2048-dkim-$domain.private.txt
// keytypes = ['rsa','ed25519']
// keysizes = ['1024','2048']

// https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
// TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null

export const dbOpen = () => {
  try {
    if (DB && DB.inTransaction) DB.close();

    if (!DB || !DB.open) {
      // https://github.com/WiseLibs/better-sqlite3/blob/HEAD/docs/api.md#close---this
      // DB = new Database(env.DATABASE, { verbose: console.debug });
      DB = new Database(env.DATABASE);
      DB.pragma('journal_mode = WAL');

      return DB;
    }
  } catch (error) {
    errorLog(`dbOpen error: ${error.code}: ${error.message}`);
    throw error;
  }
};

// password: `REPLACE INTO accounts (mailbox, salt, hash, scope) VALUES (@mailbox, @salt, @hash, ?)`,

// https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#binding-parameters
// dbRun takes params as Array = multiple inserts or String/Object = single insert
// dbRun takes multiple anonymous parameters anonParams as an array of strings, for WHERE clause value(s) when needed
export const dbRun = (sql, params = {}, ...anonParams) => {
  if (typeof sql != 'string') {
    throw new Error(`Error: sql argument must be a string: sql=${sql}`);
  }

  let result, insertMany;
  try {
    // exec https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#execstring---this
    if (sql.match(/BEGIN TRANSACTION/i)) {
      debugLog(`DB.exec(${sql})`);
      result = DB.exec(sql);
      debugLog(`DB.exec success`);

      // multiple inserts at once: DB.transaction https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function
    } else if (Array.isArray(params) && params.length) {
      if (anonParams.length) {
        debugLog(
          `DB.transaction("${sql}").run(${anonParams}, ${JSON.stringify(params)})`
        );
        insertMany = DB.transaction((params) => {
          for (const param of params) DB.prepare(sql).run(anonParams, param);
        });
        result = insertMany(params);
      } else {
        debugLog(`DB.transaction("${sql}").run(${JSON.stringify(params)})`);
        insertMany = DB.transaction((params) => {
          for (const param of params) {
            DB.prepare(sql).run(param);
          }
        });
        result = insertMany(params);
      }
      debugLog(`DB.transaction success`);

      // single statement: DB.prepare https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#runbindparameters---object
    } else {
      if (anonParams.length) {
        debugLog(
          `DB.prepare("${sql}").run(${anonParams}, ${JSON.stringify(params)})`
        );
        result = DB.prepare(sql).run(params, anonParams);
      } else {
        debugLog(`DB.prepare("${sql}").run(${JSON.stringify(params)})`);
        result = DB.prepare(sql).run(params);
      }
      debugLog(`DB.prepare success`);
    }
    return { success: true, message: result };
    // result = { changes: 0, lastInsertRowid: 0 }
  } catch (error) {
    infoLog(`${error?.code}: ${error.message}`);
    dbOpen();
    return { success: false, error: error.message, code: error?.code };
    // throw error;
  }
};

// dupe table:
// error.code=SQLITE_ERROR
// error.message=table xyz already exists
// dupe insert:
// error.code=SQLITE_CONSTRAINT_PRIMARYKEY
// error.message=UNIQUE constraint failed: settings.name
// missing table:
// error.code=SQLITE_ERROR
// error.message=no such table: master
// error.message=near ")": syntax error
// drop column that does not exist:
// error.code=SQLITE_ERROR
// error.message=no such column: "password"
// add column that exists:
// error.code=SQLITE_ERROR
// error.message=duplicate column name: salt

export const dbCount = (table, scope, schema) => {
  let result;
  let params = {};
  try {
    if (scope && sql[table]?.scope) params[sql[table].scope] = scope;
    if (schema) params.schema = schema;

    debugLog(
      `DB.prepare("${sql[table].select.count}").get(${JSON.stringify(params)})`
    );
    result = DB.prepare(sql[table].select.count).get(params);
    debugLog(`success:`, result);

    return { success: true, message: result.count };
  } catch (error) {
    errorLog(error.message);
    dbOpen();
    return { success: false, error: error.message, code: error?.code };
    // throw error;
  }
};

export const dbGet = (sql, params = {}, ...anonParams) => {
  if (typeof sql != 'string') {
    throw new Error(`Error: sql argument must be a string: sql=${sql}`);
  }

  let result;
  try {
    debugLog(
      `DB.prepare("${sql}").get(${JSON.stringify(params)}, ${JSON.stringify(anonParams)})`
    );
    result = DB.prepare(sql).get(params, anonParams);

    return { success: true, message: result };
    // result = { name: 'node', value: 'v24' } or { value: 'v24' } or undefined
  } catch (error) {
    errorLog(error.message);
    dbOpen();
    return { success: false, error: error.message, code: error?.code };
    // throw error;
  }
};

// WARNING: use the spread syntax when passing an array in anonParams!
export const dbAll = (sql, params = {}, ...anonParams) => {
  if (typeof sql != 'string') {
    throw new Error(`Error: sql argument must be a string: sql=${sql}`);
  }

  let result;
  try {
    if (anonParams.length) {
      debugLog(
        `DB.prepare("${sql}").all(${JSON.stringify(anonParams)}, ${JSON.stringify(params)})`
      );
      result = DB.prepare(sql).all(params, anonParams);
    } else {
      debugLog(`DB.prepare("${sql}").all(${JSON.stringify(params)})`);
      result = DB.prepare(sql).all(params);
    }
    // debugLog('ddebug result',result);
    return { success: true, message: result };
    // result = [ { name: 'node', value: 'v24' }, { name: 'node2', value: 'v27' } ] or []
  } catch (error) {
    debugLog('ddebug error.message', error.message);
    errorLog(error.message);
    dbOpen();
    return { success: false, error: error.message, code: error?.code };
    // throw error;
  }
};

export const dbInit = async (reset = false) => {
  debugLog(`start`);
  if (reset) await exec(`rm -f ${env.DATABASE}`);
  dbOpen();
  let result;

  for (const [table, actions] of Object.entries(sql)) {
    // init db table no matter what
    if (actions.init) {
      try {
        result = dbGet(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
        );
        if (!result.success || !result.message) {
          result = dbRun(actions.init);

          if (result.success) {
            // result.message can be a Database handle for DDL ops (CREATE TABLE)
            // — interpolating it produces the noisy "[object Object]" log line.
            // Just record that the table was created.
            infoLog(`${table}: created`);
          } else if (result.error && result.error.match(/already exists/i)) {
            infoLog(`${table}: exist`);
          } else {
            errorLog(`${table}: ${result?.code}: ${result.error}`);
            throw new Error(`${table}: ${result?.code}: ${result.error}`);
          }
        } else infoLog(`${table}: exist`);
      } catch (error) {
        errorLog(`${table}: ${error.message}`);
        throw error; // we want startup to stop completely
      }
    }
  }
  DB.close();

  try {
    dbUpgrade();
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
  }

  try {
    migrateEncryptionKey();
  } catch (error) {
    errorLog(`AES key migration failed: ${error.message}`);
  }

  try {
    migrateEncryptionAlgorithm();
  } catch (error) {
    errorLog(`AES algorithm migration failed: ${error.message}`);
  }

  debugLog(`end`);
};

// One-time migration: re-encrypt data with proper 256-bit AES key
// Old key used hex substring (32 ASCII chars), new key uses raw digest bytes (32 bytes)
// Idempotent: tries old-key decrypt on each row; skips if it fails (already migrated or plaintext)
export const migrateEncryptionKey = () => {
  const oldKey = Buffer.from(
    crypto
      .createHash(env.AES_HASH)
      .update(env.AES_SECRET)
      .digest('hex')
      .substring(0, 32)
  );
  const newKey = env.AES_KEY;

  if (oldKey.equals(newKey)) return;

  dbOpen();

  // Clean up stale flag from earlier broken migration attempt
  try {
    DB.prepare(`DELETE FROM settings WHERE name = 'aes_key_migrated'`).run();
  } catch {
    /* ignore */
  }

  const rows = DB.prepare(
    `SELECT s.id, s.value FROM settings s JOIN configs c ON s.configID = c.id WHERE c.plugin IN ('dnscontrol', 'userconfig')`
  ).all();

  let migrated = 0;
  for (const row of rows) {
    // Skip plaintext values (encrypted data is hex-encoded, at least 32 chars for IV)
    if (!/^[0-9a-f]{32,}$/i.test(row.value)) continue;

    try {
      // Decrypt with old key
      const ivLength = env.IV_LEN * 2;
      const iv = Buffer.from(row.value.slice(0, ivLength), 'hex');
      const ciphertext = row.value.slice(ivLength);
      const decipher = crypto.createDecipheriv(env.AES_ALGO, oldKey, iv);
      let plaintext = decipher.update(ciphertext, 'hex', 'utf-8');
      plaintext += decipher.final('utf-8');

      // Re-encrypt with new key
      const newIv = crypto.randomBytes(env.IV_LEN);
      const cipher = crypto.createCipheriv(env.AES_ALGO, newKey, newIv);
      let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
      encrypted += cipher.final('hex');
      const newValue = newIv.toString('hex') + encrypted;

      DB.prepare('UPDATE settings SET value = ? WHERE id = ?').run(
        newValue,
        row.id
      );
      migrated++;
    } catch {
      // Already migrated, not actually encrypted, or different format — skip
    }
  }

  if (migrated > 0) {
    successLog(
      `AES key migration: re-encrypted ${migrated} settings with 256-bit key`
    );
  }
};

// One-time migration: re-encrypt CBC-format (pre-2.2.0) settings with the
// current GCM format. Idempotent — rows already in GCM format are skipped.
// Runs after migrateEncryptionKey so any row first migrated to the 256-bit
// key (still in CBC format at that point) gets promoted to GCM here.
export const migrateEncryptionAlgorithm = () => {
  dbOpen();

  const rows = DB.prepare(
    `SELECT s.id, s.value FROM settings s JOIN configs c ON s.configID = c.id WHERE c.plugin IN ('dnscontrol', 'userconfig')`
  ).all();

  let migrated = 0;
  for (const row of rows) {
    // Skip if not encrypted, plaintext, or already GCM
    if (!row.value || typeof row.value !== 'string') continue;
    if (row.value.startsWith(GCM_FORMAT_PREFIX)) continue;
    if (!/^[0-9a-f]{32,}$/i.test(row.value)) continue;

    try {
      // decrypt() handles legacy CBC reads
      const plaintext = decrypt(row.value);
      // encrypt() always produces the new GCM format
      const newValue = encrypt(plaintext);
      DB.prepare('UPDATE settings SET value = ? WHERE id = ?').run(
        newValue,
        row.id
      );
      migrated++;
    } catch {
      // Row is not actually encrypted, has a different layout, or the key
      // doesn't match. Leave it untouched; it'll surface on first read.
    }
  }

  if (migrated > 0) {
    successLog(
      `AES algorithm migration: re-encrypted ${migrated} settings as aes-256-gcm`
    );
  }
};

export const dbUpgrade = () => {
  debugLog(`start`);

  dbOpen();
  let result, db_version, match;

  for (const [table, actions] of Object.entries(sql)) {
    try {
      // INSERT           INTO configs (config, plugin, schema, scope)      VALUES ('DB_VERSION', 'dms-gui', 'DB_VERSION', 'dms-gui');
      // INSERT OR IGNORE INTO settings (name, value, configID, isMutable) VALUES ('settings', '${env.DMSGUI_VERSION}', 1, ${env.isImmutable});
      // so we have config = DB_VERSION, plugin = 'dms-gui', schema = 'DB_VERSION', scope = 'dms-gui', and a setting name = 'table' for each table
      // env:      `SELECT         s.value FROM settings s LEFT JOIN configs c ON s.configID = c.id WHERE 1=1 AND configID = (select id FROM configs WHERE c.name = ? AND plugin = @plugin) AND isMutable = ${env.isImmutable} AND s.name = ?`,
      result = dbGet(
        sql.configs.select.env,
        { plugin: 'dms-gui' },
        'DB_VERSION',
        table
      );
      if (result.success) {
        db_version = result.message ? result.message.value : null;
        debugLog(`DB_VERSION ${table}=`, db_version);
      } else throw new Error(result?.error);
    } catch (error) {
      match = {
        get: {
          error: error.message.match(sqlMatch.get.error),
        },
      };

      // column does not exist or smth like that... patch needed
      if (match.get.error) {
        debugLog(`DB_VERSION ${table}= PATCH NEEDED`);
      } else {
        errorLog(`DB_VERSION ${table}= ${error.code}: ${error.message}`);
        throw error;
      }
    }

    // now check if we need patches for that table
    // 0: version strings are equal
    // 1: version a is greater than b
    // -1:version b is greater than a

    // first, check if there are any patches available
    if (actions.patch && actions.patch.length) {
      // now check is patches ar needed
      if (
        !db_version ||
        db_version.localeCompare(env.DMSGUI_VERSION, undefined, {
          numeric: true,
          sensitivity: 'base',
        }) == -1
      ) {
        // now check each patch array if we need it
        for (const patch of actions.patch) {
          // if patch version > current db_version then run it
          if (
            !db_version ||
            db_version.localeCompare(patch.DB_VERSION, undefined, {
              numeric: true,
              sensitivity: 'base',
            }) == -1
          ) {
            // patch.patches is a array of SQL lines to ADD or DROP columns etc
            for (const [newVersion, patchLine] of Object.entries(
              patch.patches
            )) {
              try {
                result = dbRun(patchLine);
                if (result.success) {
                  successLog(
                    `${table}: patch ${newVersion} from ${db_version} to ${patch.DB_VERSION}: success`
                  );
                } else {
                  errorLog(
                    `${table}: patch ${newVersion} from ${db_version} to ${patch.DB_VERSION}: ${result?.error}`
                  );
                  // throw new Error(result?.error);
                }
              } catch (error) {
                match = {
                  add: {
                    patch: patchLine.match(sqlMatch.add.patch),
                    error: error.message.match(sqlMatch.add.error),
                  },
                  drop: {
                    patch: patchLine.match(sqlMatch.drop.patch),
                    error: error.message.match(sqlMatch.drop.error),
                  },
                };

                // ADD COLUMN already exists:
                if (
                  match.add.patch &&
                  match.add.error &&
                  match.add.patch[1].toUpperCase() ==
                    match.add.error[1].toUpperCase()
                ) {
                  infoLog(
                    `${table}: patch ${newVersion} from ${db_version} to ${patch.DB_VERSION}: skip`
                  );

                  // DROP COLUMN does not exist:
                } else if (
                  match.drop.patch &&
                  match.drop.error &&
                  match.drop.patch[1].toUpperCase() ==
                    match.drop.error[1].toUpperCase()
                ) {
                  infoLog(
                    `${table}: patch ${newVersion} from ${db_version} to ${patch.DB_VERSION}: skip`
                  );
                } else {
                  errorLog(
                    `${table}: patch ${newVersion} from ${db_version} to ${patch.DB_VERSION}: ${error.code}: ${error.message}`
                  );
                  // throw error;
                }
              }
            }
            db_version = patch.DB_VERSION;
          }
        }
      }
    }
  }
  DB.close();
  dbOpen();
  debugLog(`end`);
};

// ("ALTER TABLE logins ADD salt xxx".match(/ALTER[\s]+TABLE[\s]+[\"]?(\w+)[\"]?[\s]+ADD[\s]+(\w+)/i)[2] == 'column "salt" already exists'.match(/column[\s]+[\"]?(\w+)[\"]?[\s]+already[\s]+exists/i)[1])

// verifyPassword works the same wherever a table has a salted hash
export const verifyPassword = async (
  credential = null,
  password = '',
  table = 'logins'
) => {
  debugLog(`for ${credential}`);

  try {
    // const login = dbGet(sql[table].select.saltHash, credential, credential);  // this worked perfectly until we switched to ES6
    const login = dbGet(sql[table].select.saltHash, {
      mailbox: credential,
      username: credential,
    });
    const saltHash = login.success ? login.message : false;
    // console.log('saltHash',saltHash);

    // return new Promise((resolve, reject) => {
    //   if (Object.keys(saltHash).length) {
    //     if (saltHash.salt && saltHash.hash) {
    //       crypto.scrypt(password, saltHash.salt, 64, (error, derivedKey) => {
    //         if (error) return reject(error);
    //         resolve(saltHash.hash === derivedKey.toString('hex'));
    //       });
    //     } else return reject(`please reset password for ${credential}`);
    //   } else return reject(`username ${credential} not found`);
    // });
    if (saltHash && Object.keys(saltHash).length) {
      // debugLog('Object.keys(saltHash).length=', Object.keys(saltHash).length);
      if (saltHash.salt && saltHash.hash) {
        const { salt, hash } = await hashPassword(
          password ?? '',
          saltHash.salt
        );
        // debugLog(`ddebug saltHash.salt = ${saltHash.salt} == ${salt} salt?`);
        // debugLog(`ddebug password ${password} hash=${hash} == ${saltHash.hash} saltHash.hash?`);
        return crypto.timingSafeEqual(
          Buffer.from(saltHash.hash, 'hex'),
          Buffer.from(hash, 'hex')
        );
      }
    }
    return false;
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
  }
};

// Function to update a password in a table
export const changePassword = async (
  table,
  id,
  password,
  schema,
  containerName
) => {
  let result, results;

  try {
    const { salt, hash } = await hashPassword(password ?? '');

    // special case for accounts as we need to run a command in the container
    if (table == 'accounts') {
      const targetDict = getTargetDict('mailserver', containerName);

      debugLog(
        `Updating password for ${id} in ${table} for ${containerName}...`
      );
      results = await execAction(
        'setup_email_update',
        {
          setup_path: targetDict.setupPath,
          mailbox: id,
          password,
        },
        targetDict
      );
      if (!results.returncode) {
        debugLog(
          `Updating password for ${id} in ${table} with scope=${containerName}...`
        );
        result = dbRun(
          sql[table].update.password,
          { salt: salt, hash: hash, scope: containerName },
          id
        );
        successLog(`Password updated for ${table}: ${id}`);
        return {
          success: true,
          message: `Password updated for ${id} in ${table}`,
        };
      } else {
        let ErrorMsg = await formatDMSError(
          'setup_email_update',
          results.stderr
        );
        errorLog(ErrorMsg);
        return { success: false, error: ErrorMsg };
      }
    } else {
      debugLog(`Updating password for ${id} in ${table}...`);
      result = dbRun(
        sql.logins.update.password,
        { salt: salt, hash: hash, scope: containerName },
        id
      ); // doesn't hurt to add scope even when unused
      if (result.success) {
        successLog(`Password updated for ${id} in ${table}`);
        return {
          success: true,
          message: `Password updated for ${id} in ${table}`,
        };
      } else return result;
    }
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to theindex API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// Keys whose values must never appear in logs or response messages. Match is
// a case-insensitive substring so derivations like 'newPassword',
// 'refreshToken', 'apiToken' etc. are also covered.
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'hash',
  'salt',
  'token',
  'secret',
  'apikey',
];
const isSensitiveKey = (key) => {
  if (!key) return false;
  const lower = String(key).toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p));
};
const redactValue = (key, value) =>
  isSensitiveKey(key) ? '<redacted>' : value;

// Function to update a table in the db; id can very well be an array as well
// Renamed parameter `encrypt` -> `shouldEncrypt` to stop shadowing the
// module-level `encrypt()` function. With the old name, `if (encrypt)
// scopedValues[key] = encrypt(scopedValues[key])` resolved to "if (true)
// scopedValues[key] = true(scopedValues[key])" when a caller passed `true`
// for the flag — TypeError instead of an actual encryption call.
export const updateDB = async (
  table,
  id,
  jsonDict,
  scope,
  shouldEncrypt = false
) => {
  // jsonDict = { column:value, .. }
  debugLog(`${table} id=${id} for scope=${scope}`); // don't show jsonDict as it may contain a password

  let result, scopedValues, value2test, testResult;
  let messages = [];
  try {
    if (!sql[table]) {
      throw new Error(`unknown table ${table}`);
    }

    if (!jsonDict || Object.keys(jsonDict).length == 0) {
      throw new Error('nothing to modify was passed');
    }

    // keep only keys defined as updatable
    let validDict = reduxPropertiesOfObj(
      jsonDict,
      Object.keys(sql[table].keys)
    );
    if (!validDict || Object.keys(validDict).length == 0) {
      errorLog(
        `jsonDict is invalid: ${JSON.stringify(jsonDict)} not in`,
        sql[table].keys
      ); // only dump stuff in container log
      throw new Error(`jsonDict is invalid`);
    }

    // for each new value to update...
    for (const [key, value] of Object.entries(validDict)) {
      // is the value the right type...
      if (typeof value == sql[table].keys[key]) {
        // password has its own function
        if (key == 'password') {
          return changePassword(table, id, value, null, scope);

          // other sqlite3 valid types and we can test specific scenarios
        } else {
          // add named scope to the scopedValues, even if not used in the query it won't fail
          // scopedValues = (sql[table].scope) ? {[key]:value, scope:scope} : {[key]:value};
          if (typeof value == 'object') {
            scopedValues = { [key]: JSON.stringify(value), scope: scope };
          } else {
            scopedValues = { [key]: value, scope: scope };
          }

          // check if we have specifics before updating this key
          if (sql[table].update[key]) {
            // is there a test for THAT value or ANY values?
            if (sql[table].update[key][value] || sql[table].update[key][null]) {
              // fix the value2test and scope as we may have tests for any values
              value2test = sql[table].update[key][value] ? value : null;

              // there is a test for THAT value and now we check with id in mind
              testResult = dbGet(
                sql[table].update[key][value2test].test,
                scopedValues,
                id
              );
              debugLog(
                `there is a test for ${table}.${key}=${value2test} and check(${testResult.message})=${sql[table].update[key][value2test].check(testResult.message)}`
              );

              // compare the result in the check function
              if (
                sql[table].update[key][value2test].check(testResult.message)
              ) {
                // we pass the test, apply update
                if (shouldEncrypt)
                  scopedValues[key] = encrypt(scopedValues[key]);
                result = dbRun(
                  sql[table].update[key][value2test].pass,
                  scopedValues,
                  id
                );
                if (result.success) {
                  messages.push(`Updated ${table} ${id} with ${key}=${value}`);
                  successLog(`Updated ${table} ${id} with ${key}=${value}`);
                } else messages.push(result?.error);
              } else {
                // we do not pass the test
                errorLog(sql[table].update[key][value2test].fail);
                // return { success: false, error: sql[table].update[key][value2test].fail};
                messages.push(sql[table].update[key][value2test].fail);
              }

              // no test for any value of key, update the db with new value
            } else {
              if (shouldEncrypt) scopedValues[key] = encrypt(scopedValues[key]);
              result = dbRun(sql[table].update[key], scopedValues, id);
              if (result.success) {
                messages.push(
                  `Updated ${table} ${id} with ${key}=${redactValue(key, value)}`
                );
                successLog(
                  `Updated ${table} ${id} with ${key}=${redactValue(key, value)}`
                );
              } else messages.push(result?.error);
            }
          } else {
            // Fallback: key is in sql[table].keys (validated above via reduxPropertiesOfObj) but has no pre-defined update query.
            // Verify key contains only safe identifier characters as defense-in-depth.
            if (!/^[a-zA-Z_]\w*$/.test(key)) {
              errorLog(`updateDB: unsafe key name rejected: ${key}`);
              messages.push(`Invalid key name: ${key}`);
              continue;
            }

            if (shouldEncrypt) scopedValues[key] = encrypt(scopedValues[key]);
            result = dbRun(
              `UPDATE ${table} set ${key} = @${key} WHERE 1=1 AND ${sql[table].id} = ?`,
              scopedValues,
              id
            );
            if (result.success && result.message?.changes > 0) {
              messages.push(
                `Updated ${table} ${id} with ${key}=${redactValue(key, value)}`
              );
              successLog(
                `Updated ${table} ${id} with ${key}=${redactValue(key, value)}`
              );
            } else if (result.success && result.message?.changes === 0) {
              errorLog(`updateDB: no matching row for ${table} ${id}`);
              messages.push(`No matching row found for ${table} ${id}`);
            } else messages.push(result?.error);
          }
        }
      } else {
        errorLog(`typeof ${value} for ${key} is not ${sql[table].keys[key]}`);
        messages.push(
          `typeof ${value} for ${key} is not ${sql[table].keys[key]}`
        );
      }
    }
    return { success: true, message: messages.join('; ') };
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to theindex API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

export const deleteEntry = async (table, id, key, scope) => {
  debugLog(`${table} id=${id} for scope=${scope} and key=${key}`);
  // example: deleteEntry('accounts', mailbox, 'mailbox', containerName);
  // example: deleteEntry('aliases', source, 'bySource', containerName);
  // example: deleteEntry('logins', id);

  let result, testResult;
  try {
    // use default key if not passed
    key = key ? key : sql[table].key;

    // check if the sql is defined for the key to delete
    if (sql[table].delete[key]) {
      // add named scope to the scopedValues, even if not used in the query it won't fail
      // let scopedValues = (sql[table].scope) ? {scope:scope} : {};
      let scopedValues = { scope: scope }; // always add scope, why care? it's failproof

      // check if delete should be tested
      if (sql[table].delete[key][id] || sql[table].delete[key][null]) {
        // fix the value2test as we may have tests for any values
        // Note: was `... ? value : null` where `value` is undeclared in this
        // scope (it lives in updateDB's loop). Today only the `null` branch
        // is exercised; the corrected form selects the per-id sub-spec when
        // one exists, falling back to the null/default sub-spec.
        let value2test = sql[table].delete[key][id] ? id : null;

        // there is a test for THAT value and now we check with id in mind
        testResult = dbGet(
          sql[table].delete[key][value2test].test,
          scopedValues,
          id
        );
        debugLog(
          `there is a test for ${table}.${key}=${value2test} and check(${testResult.message})=${sql[table].delete[key][value2test].check(testResult.message)}`
        );

        // compare the result in the check function
        if (sql[table].delete[key][value2test].check(testResult.message)) {
          // we pass the test
          result = dbRun(
            sql[table].delete[key][value2test].pass,
            scopedValues,
            id
          );
          if (result.success) {
            successLog(`Entry deleted: ${id}`);
            return { success: true, message: `Entry deleted: ${id}` };
          } else return result;
        } else {
          // we do not pass the test
          errorLog(sql[table].delete[key][value2test].fail);
          return {
            success: false,
            error: sql[table].delete[key][value2test].fail,
          };
        }
      } else {
        // no test
        result = dbRun(sql[table].delete[key], scopedValues, id);
        if (result.success) {
          successLog(`Entry deleted: ${id}`);
          return { success: true, message: `Entry deleted: ${id}` };
        } else return result;
      }
    } else {
      errorLog(`sql[${table}].delete is missing [${key}]`);
      return {
        success: false,
        error: `sql[${table}].delete is missing [${key}]`,
      };
    }
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to theindex API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

export const refreshTokens = async (credentials) => {
  try {
    let result = dbRun(sql.logins.update.refreshTokens, credentials);
    if (result.success) {
      successLog(`tokens refreshed:`, credentials ?? '*');
      return { success: true, message: `tokens refreshed:` };
    } else return result;
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to theindex API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// module.exports = {
//   DB,
//   sql,
//   dbOpen,
//   dbInit,
//   dbUpgrade,
//   dbRun,
//   dbGet,
//   dbAll,
//   dbCount,
//   hashPassword,
//   verifyPassword,
//   changePassword,
//   updateDB,
//   deleteEntry,
// };

// debug = true;
// containerName = 'dms';
// DMSGUI_CONFIG_PATH   = process.env.DMSGUI_CONFIG_PATH || '/app/config';
// DATABASE      = DMSGUI_CONFIG_PATH + '/dms-gui.sqlite3';
// DB = require('better-sqlite3')(DATABASE);
// process.on('exit', () => DB.close());
// function dbOpen() {DB = require('better-sqlite3')(DATABASE);}
// function debugLog(message) {console.debug(message)}
// function errorLog(message) {console.debug(message)}

// get saltHash from admin:
// DB.prepare("SELECT salt, hash FROM logins WHERE (mailbox = @mailbox OR username = @username)").get({"email":"admin","mailbox":"admin","username":"admin"})
// {
//   salt: 'fdebebcdcec4e534757a49473759355b',
//   hash: 'a975c7c1bf9783aac8b87e55ad01fdc4302254d234c9794cd4227f8c86aae7306bbeacf2412188f46ab6406d1563455246405ef0ee5861ffe2440fe03b271e18'
// }

// DB.prepare('SELECT username, email from logins').all()
// DB.exec(sql)
// DB.inTransaction
// DB.open
// DB.close()

// dbRun(sql)

// insert = DB.prepare(`REPLACE INTO settings (name, value) VALUES (@name, @value)`)
// insert.run({name:'node',value:'v24'})  // { changes: 1, lastInsertRowid: 1 }

// insert = DB.prepare(`REPLACE INTO settings               VALUES (?, ?)`)
// insert.run(['node2','v26'])            // { changes: 1, lastInsertRowid: 2 }

// key = 'isAdmin'
// value = 1
// username = 'admin2'

// sql = { logins: { update: { any: `UPDATE logins set {@key}=? WHERE username = ?`, } } }
// sql = { logins: { update: { any: `REPLACE INTO logins (username, salt, hash, email, isAdmin) VALUES (@username, @salt, @hash, @email, @isAdmin)`, } } }
// dbRun(sql.logins.update.any, key, value, username)

// sql = { logins: { update: { isAdmin: `UPDATE logins set isAdmin = @isAdmin WHERE username = ?`, } } }
// dbRun(sql.logins.update.isAdmin, {isAdmin:value}, username) // works

// dbRun(`REPLACE INTO roles (username, mailbox, scope) VALUES (@username, @mailbox, ?)`, [{username:'user2',mailbox:'ops@doctusit.com'},{username:'user2',mailbox:'admin@doctusit.com'}], containerName)
// DB.prepare(`SELECT username, mailbox from roles WHERE 1=1 AND scope = @scope`).all(containerName)

// DB.prepare(`SELECT r.username, a.mailbox FROM accounts a LEFT JOIN roles r ON r.mailbox   = a.mailbox  WHERE 1=1 AND a.scope=r.scope AND a.scope = @scope`).all({scope:containerName})
// { username: 'user2', mailbox: 'ops@doctusit.com' },
// { username: 'user2', mailbox: 'admin@doctusit.com' }

// DB.prepare(`SELECT l.username, r.mailbox FROM logins l   LEFT JOIN roles r ON r.username  = l.username WHERE 1=1 AND r.scope = @scope`).all({scope:containerName})

// test and check:
// DB.prepare(`SELECT COUNT(isAdmin) value from logins WHERE 1=1 AND isActive = 1 AND isAdmin = 1`).get()  // { value: 2 }
// DB.prepare(`SELECT COUNT(isAdmin) value from logins WHERE 1=1 AND isActive = 1 AND isAdmin = 1 AND username IS NOT ?`).get('diane')

// DB.prepare(`SELECT COUNT(1) count`).get()
// { count: 1 }

// bug: leads to duplicate rows since we enabled PRIMARY key=id:
// DB.transaction("REPLACE INTO settings (name, value, scope, isMutable) VALUES (@name, @value, @scope, 1)").run([{"name":"setupPath","value":"/usr/local/bin/setup","scope":"dms"},{"name":"env.DMS_CONFIG_PATH","value":"/tmp/docker-mailserver","scope":"dms"},{"name":"setupPath","value":"/usr/local/bin/setup","scope":"dms"},{"name":"env.DMS_CONFIG_PATH","value":"/tmp/docker-mailserver","scope":"dms"},{"name":"containerName","value":"dms","scope":"dms"}])
// DB.prepare("SELECT name, value FROM settings WHERE 1=1 AND isMutable = 1 AND scope = @scope").all({"scope":"dms"})
// DB.prepare("SELECT * FROM settings WHERE 1=1 AND isMutable = 1 AND scope = @scope").all({"scope":"dms"})
// [
// { name: 'setupPath', value: '/usr/local/bin/setup' },
// { name: 'env.DMS_CONFIG_PATH', value: '/tmp/docker-mailserver' },
// { name: 'setupPath', value: '/usr/local/bin/setup' },
// { name: 'env.DMS_CONFIG_PATH', value: '/tmp/docker-mailserver' },
// { name: 'containerName', value: 'dms' },
// { name: 'setupPath', value: '/usr/local/bin/setup' },
// { name: 'env.DMS_CONFIG_PATH', value: '/tmp/docker-mailserver' },
// { name: 'setupPath', value: '/usr/local/bin/setup' },
// { name: 'env.DMS_CONFIG_PATH', value: '/tmp/docker-mailserver' },
// { name: 'containerName', value: 'dms' },
// { name: 'setupPath', value: '/usr/local/bin/setup' },
// { name: 'env.DMS_CONFIG_PATH', value: '/tmp/docker-mailserver' },
// { name: 'setupPath', value: '/usr/local/bin/setup' },
// { name: 'env.DMS_CONFIG_PATH', value: '/tmp/docker-mailserver' },
// { name: 'containerName', value: 'dms' }
// ]

// warning: REPLACE changes and increments the row id
// If you want to update an existing row without changing its primary key, you should use an UPDATE statement instead of REPLACE INTO.
// result = DB.prepare("REPLACE INTO settings (name, value, scope, isMutable) VALUES (@name, @value, @scope, 1)").run({"name":"setupPath","value":"/usr/local/bin/setup","scope":"dmsss"})
// { changes: 1, lastInsertRowid: 388 }
// { changes: 1, lastInsertRowid: 389 }
// { changes: 1, lastInsertRowid: 390 }
// DB.prepare("SELECT * FROM settings where scope = ?").all(['dmsss'])
// [
//   ...,
//   {
//     id: 391,
//     name: 'setupPath',
//     value: '/usr/local/bin/setup',
//     scope: 'dmsss',
//     isMutable: 1
//   }
// ]
// result = DB.prepare("UPDATE settings set value = @value WHERE 1=1 AND name = @name AND scope = @scope").run({"name":"setupPath","value":"/usr/local/bin/setup","scope":"dmsss"})
// { changes: 1, lastInsertRowid: 0 }   // UPDATE + run will never return lastInsertRowid, but lastInsertRowid will be settothe last actual INSERT == wrong id
// result = DB.prepare("UPDATE settings set value = @value WHERE 1=1 AND name = @name AND scope = @scope RETURNING id").run({"name":"setupPath","value":"/usr/local/bin/setup","scope":"dmsss"})
// { id: 393 }  // correct way for UPDATE: add RETURNING whatever and get -> not run

// `INSERT OR IGNORE INTO settings (name, value, scope) VALUES ('DKIM_PATH', 'xxx', 'dms') RETURNING id`

// =====================================================================
// Re-exports from extracted modules. db.mjs used to be a 2015-line
// god-module; the #82 split moved cohesive groups into sibling files.
// Existing import sites keep working unchanged — the barrel below
// proxies each domain's public surface back through `./db.mjs`. Over
// time, callers can migrate to the per-domain import paths and we can
// retire this block.
//
// `targetDict.mjs` imports `dbOpen` from this file (a cycle). ESM
// hoists the re-export declarations during linking and partially
// initialises the cycle, so statement position here doesn't gate when
// sibling modules load. The cycle is safe because `targetDict.mjs`
// only calls `dbOpen` at runtime (inside the catch block of
// `getTargetDict`), not at module-load time — by then the live
// binding points at the fully defined function.
// =====================================================================
export { sql, sqlMatch } from './sql.mjs';
export {
  GCM_FORMAT_PREFIX,
  decrypt,
  encrypt,
  generateIv,
  hashPassword,
} from './crypto.mjs';
export { getTargetDict } from './targetDict.mjs';
