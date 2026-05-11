import {
  arrayOfStringToDict,
  getValueFromArrayOfObj,
  jsonFixTrailingCommas,
  obj2ArrayOfObj,
  pluck,
  redactKey,
  redactSensitiveSettings,
  reduxArrayOfObjByValue,
  reduxPropertiesOfObj,
} from '../common.mjs';
import { command, env, mailserverRESTAPI } from './env.mjs';

import {
  debugLog,
  errorLog,
  execAction,
  infoLog,
  ping,
  successLog,
  warnLog,
  writeFile,
} from './backend.mjs';
import { processTopData } from './topParser.mjs';
import { demoResponse } from './demoMode.mjs';

import {
  dbAll,
  dbCount,
  dbGet,
  dbRun,
  decrypt,
  encrypt,
  getTargetDict,
  sql,
} from './db.mjs';

// const path = require('node:path');
import * as childProcess from 'child_process';
import path from 'path';

// Classify a targetDict that is known to lack `Authorization` for the
// purpose of the dashboard status indicator. Three sub-cases:
//   - null/undefined targetDict           → 'unknown' (no config at all)
//   - {success:false, error:...} (the     → 'unknown' (propagate the
//     getTargetDict catch-block shape)      actual error to the user)
//   - a real config dict with the         → 'api_gen' (hint the user
//     DMS_API_KEY value missing             to generate the API key)
// Exported for unit-test coverage; the consumer is `getServerStatus`.
export const classifyMissingAuthTargetDict = (targetDict) => {
  if (!targetDict) {
    return { status: 'unknown', error: 'No targetDict provided' };
  }
  if (targetDict.success === false) {
    return {
      status: 'unknown',
      error: targetDict.error || 'targetDict lookup failed',
    };
  }
  return { status: 'api_gen', error: null };
};

// returns a string
export const getSetting = async (
  plugin = 'mailserver',
  containerName = null,
  name = null,
  encrypted = false
) => {
  debugLog(plugin, containerName, name, encrypted);
  if (!name) return { success: false, error: 'getSetting: name is required' };
  if (!containerName)
    return {
      success: false,
      error: 'getSetting: scope=containerName is required',
    };
  if (!plugin)
    return { success: false, error: 'getSetting: plugin is required' };

  try {
    // const result = dbGet(sql.settings.select.setting, {scope:containerName}, name);
    // setting:  `SELECT         s.value FROM settings s LEFT JOIN configs c ON s.configID = c.id WHERE 1=1 AND configID = (select id FROM configs WHERE c.name = ? AND plugin = @plugin) AND isMutable = ${env.isMutable}   AND s.name = ?`,
    const result = dbGet(
      sql.configs.select.setting,
      { plugin: plugin },
      containerName,
      name
    ); // plugin:'mailserver', schema:'dms', scope:'dms-gui'
    if (result.success) {
      return {
        success: true,
        message: encrypted
          ? decrypt(result.message?.value)
          : result.message?.value,
      }; // success is true also when no result is returned
    }
    return result;
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// this returns an array of objects; schema and scope are optional; not async anymore since called by getTargetdict
export const getSettings = (
  plugin = 'mailserver',
  containerName = null,
  name = null,
  encrypted = false
) => {
  debugLog(plugin, containerName, name, encrypted);
  if (!containerName)
    return {
      success: false,
      error: 'getSettings: scope=containerName is required',
    };
  if (!plugin)
    return { success: false, error: 'getSettings: plugin is required' };

  const demoKey = plugin === 'dnscontrol' ? 'dnsProviderSettings' : 'settings';
  const demo = demoResponse(demoKey);
  if (demo) {
    if (name) {
      const found = demo.message.find((s) => s.name === name);
      return { success: true, message: found?.value };
    }
    return demo;
  }

  if (name) return getSetting(plugin, containerName, name, encrypted);

  let result, settings;
  try {
    // result = dbAll(sql.settings.select.settings, {scope:containerName});
    // settings: `SELECT s.name, s.value FROM settings s LEFT JOIN configs c ON s.configID = c.id WHERE 1=1 AND configID = (select id FROM configs WHERE c.name = ? AND plugin = @plugin) AND isMutable = ${env.isMutable}`,
    result = dbAll(
      sql.configs.select.settings,
      { plugin: plugin },
      containerName
    ); // plugin:'mailserver', schema:'dms', scope:'dms-gui', containerName:'dms'
    if (result.success) {
      // we could read DB_Logins and it is valid
      if (result.message.length) {
        infoLog(`Found ${result.message.length} entries in settings`);
        // Redact sensitive values (DMS_API_KEY, AES_SECRET, etc.) before
        // dumping the full payload to debug logs.
        debugLog('settings', redactSensitiveSettings(result.message));

        // decryption where needed
        if (encrypted) {
          result.message = result.message.map((setting) => ({
            ...setting,
            value: decrypt(setting.value),
          }));
        }
      } else {
        warnLog(`db settings seems empty:`, result.message);
      }
    } else errorLog(result?.error);

    return result;
    // [ { name: 'containerName', value: 'dms' }, .. ]
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// this returns all configs, and roles are mailboxes or logins id
export const getConfigs = async (
  plugin = 'mailserver',
  roles = [],
  name = null
) => {
  debugLog(plugin, roles, name);

  const demo = demoResponse('configs');
  if (demo) return demo;

  let result;
  try {
    if (plugin === 'mailserver') {
      // non admins: roles are mailboxes
      // configs:  `SELECT DISTINCT name as value, 'mailserver' as plugin, schema, 'dms-gui' as scope FROM accounts a LEFT JOIN config c ON c.id = a.configID WHERE 1=1 AND mailbox IN (?)`,
      if (roles && roles.length) {
        result = dbAll(
          sql.accounts.select.configs.replace(
            '?',
            Array(roles.length).fill('?').join(',')
          ),
          { plugin: plugin },
          ...roles
        );

        // admins
      } else {
        result = dbAll(sql.configs.select.configs, { plugin: plugin }, '%');
      }
    } else {
      // configs:  `SELECT name as value, plugin, schema, scope FROM configs WHERE 1=1 AND plugin = @plugin AND (scope LIKE ?)`,

      // non admins: roles are logins id
      if (roles && roles.length) {
        result = dbAll(
          sql.configs.select.configs.replace(
            'scope LIKE ?',
            Array(roles.length).fill('scope LIKE ?').join(' OR ')
          ),
          { plugin: plugin },
          ...roles
        );

        // admins
      } else {
        result = dbAll(sql.configs.select.configs, { plugin: plugin }, '%');
      }
    }

    // debugLog('ddebug result', result);
    if (result.success) {
      if (name)
        result.message = reduxArrayOfObjByValue(result.message, 'value', name);

      if (result.message.length) {
        infoLog(
          `Found ${result.message.length} configs for ${plugin}/scope=`,
          ...roles
        );
      } else {
        warnLog(
          `Found ${result.message.length} configs for ${plugin}/scope=`,
          ...roles
        );
      }
    } else errorLog(result?.error);

    return result;
    // [ { value: 'containerName' }, .. ]
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// jsonArrayOfObjects = [{name:name, value:value}, ..]
// Until we figure a better way or decide to not handle more then one DMS container...
// ... the value for containerName will always be decided and come from the frontend
// ... the value for DMS_API_KEY   will always be dependent on containerName from the frontend
// ... the value for DMS_API_PORT  will always be dependent on containerName from the frontend
export const saveSettings = async (
  plugin = 'mailserver',
  schema = null,
  scope = null,
  containerName = null,
  jsonArrayOfObjects = [],
  encrypted = false
) => {
  debugLog(plugin, schema, scope, containerName, jsonArrayOfObjects, encrypted);
  if (!jsonArrayOfObjects.length)
    return {
      success: false,
      error: 'saveSettings: values=jsonArrayOfObjects is required',
    };
  if (!containerName)
    return { success: false, error: 'saveSettings: containerName is required' };
  if (!scope)
    return { success: false, error: 'saveSettings: scope is required' };
  if (!schema)
    return { success: false, error: 'saveSettings: schema is required' };
  if (!plugin)
    return { success: false, error: 'saveSettings: plugin is required' };

  let result;
  try {
    result = dbGet(
      sql.configs.select.id,
      { plugin: plugin, schema: schema, scope: scope },
      containerName
    );
    if (!result.message?.id) {
      // config:   `INSERT INTO configs (config, plugin, schema, scope) VALUES (?, @plugin, @schema, @scope) RETURNING id`,
      result = dbGet(
        sql.configs.insert.config,
        { plugin: plugin, schema: schema, scope: scope },
        containerName
      );
      if (!result.success) return result;
    }

    // scope all settings for that container
    const jsonArrayOfObjectsScoped = jsonArrayOfObjects.map((setting) => {
      return {
        ...setting,
        value: encrypted ? encrypt(setting.value) : setting.value,
        plugin: plugin,
        schema: schema,
        scope: scope,
      };
    });

    // setting:  `REPLACE INTO settings (name, value, configID, isMutable) VALUES (@name, @value, (select id FROM configs WHERE config = ? AND plugin = @plugin), 1)`,
    result = dbRun(
      sql.configs.insert.setting,
      jsonArrayOfObjectsScoped,
      containerName
    ); // jsonArrayOfObjects = [{name:name, value:value, scope:scope, ..}, ..]
    if (result.success) {
      successLog(
        `Saved ${jsonArrayOfObjectsScoped.length} settings for containerName=${containerName}`
      );

      // now (re) generate API scripts if we are saving a new DMS_API_KEY
      // NOOOOOOOOOO one function does one job not two
      // const DMS_API_KEY = getValueFromArrayOfObj(jsonArrayOfObjectsScoped, 'DMS_API_KEY');
      // if (DMS_API_KEY) result = await initAPI(plugin, schema, containerName, DMS_API_KEY);
    }
    return result;
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// Function to tail log files from DMS container
// Function to get server status from DMS, you can add some extra test like ping or execAction('setup_help', ...)
export const getServerStatus = async (
  plugin = 'mailserver',
  containerName = null,
  test = undefined,
  settings = []
) => {
  debugLog(plugin, containerName, test, settings);
  if (!containerName)
    return {
      success: false,
      error: 'getServerStatus: containerName is required',
    };
  if (!plugin)
    return { success: false, error: 'getServerStatus: plugin is required' };

  const demo = demoResponse('serverStatus');
  if (demo) return demo;

  let result, results, schema;
  let status = {
    status: {
      status: 'stopped',
      error: null,
    },
    resources: {
      cpuUsage: 0,
      memoryUsage: 0,
      diskUsage: 0,
      error: null,
    },
    db: {
      logins: 0,
      accounts: 0,
      aliases: 0,
      error: null,
    },
  };

  // const cpu_Usage    = "top -bn1 | awk '/Cpu/ { print $2}'"
  // const memory_Used  = "free -m | awk '/Mem/ {print $3}'"
  // const memory_Usage = "free -m | awk '/Mem/ {print 100*$3/$2}'"

  // top_parser will parse all of the below
  // top - 02:02:32 up 35 days, 22:39,  0 user,  load average: 0.00, 0.01, 0.00
  // Tasks:  35 total,   1 running,  34 sleeping,   0 stopped,   0 zombie
  // %Cpu(s):  0.0 us,100.0 sy,  0.0 ni,  0.0 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st
  // MiB Mem :   4413.7 total,    410.5 free,   1269.0 used,   3088.8 buff/cache
  // MiB Swap:   2304.0 total,   2201.0 free,    103.0 used.   3144.7 avail Mem

  // PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
  // 1946 _mta-sts  20   0  335112  34004  12288 S   6.2   0.8   0:08.83 mta-sts-daemon
  // 1 root      20   0    2332   1024   1024 S   0.0   0.0   0:00.04 dumb-init
  // 7 root      20   0   37260  31280  10240 S   0.0   0.7   0:01.39 supervisord
  // 49 root      20   0    2896   1536   1536 S   0.0   0.0   0:00.55 tail
  // 1899 root      20   0   24716  18048   9088 S   0.0   0.4   0:00.52 python3

  try {
    result = await ping(containerName);
    if (result.success) {
      status.status.status = 'alive';
      if (test == 'ping') return { success: true, message: status };

      const targetDict = getTargetDict(plugin, containerName, settings);
      // debugLog('ddebug targetDict', redactKey(targetDict));
      if (targetDict?.Authorization) {
        results = await execAction(
          'setup_help',
          { setup_path: targetDict.setupPath },
          targetDict
        );
        if (!results.returncode) {
          status.status.status = 'running';
        } else {
          debugLog('error:', results);
          if (results.stderr) {
            if (results.stderr.match(/api_miss/))
              status.status.status = 'api_miss'; // API key was not sent by dms-gui somehow
            if (results.stderr.match(/api_unset/))
              status.status.status = 'api_unset'; // API key is not defined in DMS compose
            if (results.stderr.match(/api_match/))
              status.status.status = 'api_match'; // API key is different on either side
            if (results.stderr.match(/port_closed|ECONNREFUSED/))
              status.status.status = 'port_closed'; // API port is closed or filtered
            if (results.stderr.match(/port_timeout|ETIMEDOUT/))
              status.status.status = 'port_timeout'; // API port timeout
            if (results.stderr.match(/port_unknown/))
              status.status.status = 'port_unknown'; // API port unknown error, should never happen
            if (results.stderr.match(/missing|ENOTFOUND/))
              status.status.status = 'missing'; // name or IP not found, should not happen here as ping takes care of that

            status.status.error = results.stderr; // we should handle HTTP POST error! status: 500
          } else {
            status.status.status = 'api_error'; // unknown API error
            status.status.error = 'unknown';
          }
          return { success: true, message: status }; // api errors are not errors unless we add an error
        }

        // Sentinel matches the action id dispatched a few lines above
        // so the query string and the underlying call shape line up.
        if (test == 'setup_help') {
          return { success: !results.returncode, message: status };
        }

        const runTop = test !== 'disk';
        const runDisk = test !== 'status';

        const [result_top, result_disk, result_uptime] = await Promise.all([
          runTop ? execAction('top_summary', {}, targetDict) : null,
          runDisk ? execAction('df_var_mail', {}, targetDict) : null,
          runTop ? execAction('ps_init_uptime', {}, targetDict) : null,
        ]);

        if (result_top) {
          if (!result_top.returncode) {
            const topJson = processTopData(result_top.stdout);
            status.resources.cpuUsage =
              Number(topJson.cpu.us) + Number(topJson.cpu.sy);
            status.resources.memoryUsage =
              (100 * Number(topJson.mem.used)) / Number(topJson.mem.total);
            status.resources.memoryTotal = Number(topJson.mem.total);
            status.resources.memoryUsed = Number(topJson.mem.used);
            status.resources.loadAverage = topJson.top.load_average;
            if (result_uptime && !result_uptime.returncode) {
              const secs = Number(result_uptime.stdout.trim());
              const days = Math.floor(secs / 86400);
              const hours = Math.floor((secs % 86400) / 3600);
              const mins = Math.floor((secs % 3600) / 60);
              status.resources.uptime =
                days > 0 ? `${days}d ${hours}h` : `${hours}h ${mins}m`;
            }
          } else {
            errorLog(result_top.stderr);
            status.resources.error = result_top.stderr;
            if (result_top.stderr.match(/api_miss/))
              status.status.status = 'api_miss';
            if (result_top.stderr.match(/api_match/))
              status.status.status = 'api_match';
            if (result_top.stderr.match(/api_unset/))
              status.status.status = 'api_unset';
          }
        }

        if (result_disk) {
          if (!result_disk.returncode) {
            const parts = result_disk.stdout.trim().split(/\s+/);
            status.resources.diskUsed = Number(parts[0]);
            status.resources.diskTotal = Number(parts[1]);
            status.resources.diskPercent = Number(parts[2]);
            status.resources.diskUsage = Number(parts[0]); // backward compat
          } else {
            errorLog(result_disk.stderr);
            status.resources.error = result_disk.stderr;
          }
        }

        if (test == 'status' || test == 'disk')
          return { success: true, message: status };
      } else {
        // No Authorization on targetDict. Three sub-cases:
        //   - getTargetDict returned null/undefined → caller error
        //   - getTargetDict returned its catch-block failure shape
        //     ({success:false, error:...}) → propagate the error
        //   - getTargetDict returned a real config object with no
        //     DMS_API_KEY value → the API key just hasn't been
        //     generated yet, route the user to the api_gen UX.
        const classified = classifyMissingAuthTargetDict(targetDict);
        status.status.status = classified.status;
        status.status.error = classified.error;
      }
    } else {
      status.status.error = result.message; // transmit actual error to frontend

      if (result?.message && result.message.match(/bad address/)) {
        status.status.status = 'missing'; // dns error or container not created
      } else {
        status.status.status = 'stopped';
      }
    }

    // get schema
    // getSettings(plugin, containerName, name, encrypted)
    result = getSettings(plugin, containerName);
    if (result.success)
      schema = getValueFromArrayOfObj(result.message, 'schema');

    result = dbCount('logins', containerName);
    if (result.success) status.db.logins = result.message;

    result = dbCount('accounts', containerName, schema);
    if (result.success) status.db.accounts = result.message;

    result = dbCount('aliases', containerName, schema);
    if (result.success) status.db.aliases = result.message;

    // remote server being down is not a measure of failure
    return { success: true, message: status };
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

// function readDovecotConfFile will convert dovecot conf file syntax to JSON
export const readDovecotConfFile = async (stdout = '') => {
  // what we get: -------------------
  /*
  mail_plugins = $mail_plugins fts fts_xapian
  plugin {
    fts = xapian
    fts_xapian = partial=3 full=20 verbose=0

    fts_autoindex = yes
    fts_enforced = yes
    # https://doc.dovecot.org/2.3/settings/plugin/fts-plugin/#plugin_setting-fts-fts_autoindex_max_recent_msgs
    # fts_autoindex_max_recent_msgs = 999

    # https://doc.dovecot.org/2.3/settings/plugin/fts-plugin/#plugin_setting-fts-fts_autoindex_exclude
    fts_autoindex_exclude = \Trash
    fts_autoindex_exclude2 = \Junk

    # https://doc.dovecot.org/2.3/settings/plugin/fts-plugin/#plugin_setting-fts-fts_decoder
    # fts_decoder = decode2text
  }
  service indexer-worker {
    # limit size of indexer-worker RAM usage, ex: 512MB, 1GB, 2GB
    vsz_limit = 2GB
  }
  */

  // what we want: -------------------
  // plugin: {
  // fts: "xapian",
  // fts_xapian: "partial=3 full=20 verbose=0",
  // fts_autoindex: "yes",
  // fts_enforced: "yes",
  // fts_autoindex_exclude: "\Trash",
  // fts_autoindex_exclude2: "\Junk",
  // }

  // TODO: not capture trailing spaces in a set of words /[\s+]?=[\s+]?([\S\s]+)[\s+]?$/
  const regexConfComments = /^(\s+)?#(.*?)$/;
  // " mail_plugins = $mail_plugins fts fts_xapian ".replace(/(\s+)?(\S+)(\s+)?=(\s+)?([\S\s]+)(\s+)?$/, "'$2': '$5',") -> "'mail_plugins': '$mail_plugins fts fts_xapian ',"
  // const regexConfDeclare = /(\s+)?(\S+)(\s+)?[=:](\s+)?\"?([\S\s]+)\"?(\s+)?$/;
  const regexConfDeclare = /(\s+)?(\S+)[\s]*[=:][\s]*["]?([\S\s]+)["]?[\s]*$/; // $3 is greedy and will capture the last quote
  // " ssss indexer-worker { ".replace(/(\s+)?([\S]+)?([\s\S-]*)?-?([\S]+)?([[{])(\s+)?$/, "'$2': $5") -> " 'ssss': {"
  const regexConfObjOpen = /(\s+)?([\S]+)?([\s\S-]*)?-?([\S]+)?([[{])(\s+)?$/;
  const regexConfObjClose = /(\s+)?([\]}])(\s+)?$/;
  const regexEmpty = /^\s*[\r\n]/gm;

  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  const cleanlines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
      .replace(regexEmpty, '')
      .replace(regexConfComments, '')
      .replace(regexConfDeclare, '"$2": "$3",')
      .replace(/["]+/g, '"')
      .replace(regexConfObjOpen, '"$2": $5')
      .replace(regexConfObjClose, '$2,')
      .trim();
    if (line) cleanlines.push(line);
  }

  const cleanData = `{${cleanlines.join('\n')}}`;
  // debugLog(`cleanData:`, cleanData);

  try {
    const json = jsonFixTrailingCommas(cleanData, true);
    // debugLog(`json:`, json);
    return json;
  } catch (error) {
    errorLog(`cleanData not valid JSON:`, error.message);
    return {};
  }
};

// function readDkimFile will convert dkim conf file syntax to JSON
export const readDkimFile = async (stdout = '') => {
  // what we get: -------------------
  /*
  enabled = true;

  # If false, messages from authenticated users are not selected for signing
  sign_authenticated = true;
  # If false, inbound messages are not selected for signing
  sign_inbound = true;

  # If false, messages from local networks are not selected for signing
  sign_local = true;
  # Whether to fallback to global config
  try_fallback = false;

  # Domain to use for ARC signing: can be "header" (MIME From), "envelope" (SMTP From), "recipient" (SMTP To), "auth" (SMTP username) or directly specified domain name
  use_domain = "header";
  # don't change unless Redis also provides the DKIM keys
  use_redis = false;
  # Whether to normalise domains to eSLD: sub.domain.com becomes domain.com as discussed here https://github.com/docker-mailserver/docker-mailserver/issues/3778
  use_esld = true;
  # If true, username does not need to contain matching domain
  allow_username_mismatch = true;

  # you want to use this in the beginning
  check_pubkey = true;

  # global DKIM-selector: this is critical and must match a TXT entry called selector._domainkey in ALL of your domains
  # DKIM Rotation example with minimal downtime (due to restart of dms):
  # 0. alias dmss='docker exec -it dms setup'
  # 1. generate new keys with new selector: dmss config dkim domain ${domain} selector new_selector keytype ${keytype} keysize ${keysize}
  # 2. create new TXT entries 'new_selector._domainkey' with the content of the generated *-public.dns.txt keys
  # 3. modify the selector name below and restart dms:
  selector = "dkim";

  # The path location is searched for a DKIM key with these variables:
  # - $domain is sourced from the MIME mail message From header
  # - $selector is configured for mail (as a default fallback)
  # Update the keytype=rsa and keysize=2048 to the values you use for your keys
  path = "/tmp/docker-mailserver/rspamd/dkim/rsa-2048-$selector-$domain.private.txt";
  
  # domain specific configurations can be provided below:
  domain {
      domain.com {
          path = "/tmp/docker-mailserver/rspamd/dkim/rsa-2048-dkim-domain.com.private.txt";
          selector = "dkim";
      }
      ..
  }
  */

  // what we want: -------------------
  // dkim: {
  // enabled: "true",
  // selector: "dkim",
  // path: "/tmp/docker-mailserver/rspamd/dkim/rsa-2048-$selector-$domain.private.txt",
  // domain: {
  // domain.com: {
  // path: "/tmp/docker-mailserver/rspamd/dkim/rsa-2048-dkim-domain.com.private.txt",
  // selector: "dkim"
  // },
  // ..
  // }
  // }

  // TODO: not capture trailing spaces in a set of words /[\s+]?=[\s+]?([\S\s]+)[\s+]?$/
  const regexConfComments = /^(\s+)?#(.*?)$/;
  // " mail_plugins = $mail_plugins fts fts_xapian ".replace(/(\s+)?(\S+)(\s+)?=(\s+)?([\S\s]+)(\s+)?$/, "'$2': '$5',") -> "'mail_plugins': '$mail_plugins fts fts_xapian ',"
  const regexConfDeclare = /(\s+)?(\S+)(\s+)?=(\s+)?([\S\s]+)(\s+)?$/;
  // " ssss indexer-worker { ".replace(/(\s+)?([\S]+)?([\s\S-]*)?-?([\S]+)?([[{])(\s+)?$/, "'$2': $5") -> " 'ssss': {"
  const regexConfObjOpen = /(\s+)?([\S]+)?([\s\S-]*)?-?([\S]+)?([[{])(\s+)?$/;
  const regexConfObjClose = /(\s+)?([\]}])(\s+)?$/;
  const regexEmpty = /^\s*[\r\n]/gm;
  const regexRemoveQuotesColon = /[";]/g;

  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  const cleanlines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
      .replace(regexEmpty, '')
      .replace(regexRemoveQuotesColon, '')
      .replace(regexConfComments, '')
      .replace(regexConfDeclare, '"$2": "$5",')
      .replace(regexConfObjOpen, '"$2": $5')
      .replace(regexConfObjClose, '$2,')
      .trim();
    if (line) cleanlines.push(line);
  }

  // BUG:
  // domain {
  // domain.com {
  // path = "/tmp/docker-mailserver/rspamd/dkim/rsa-2048-dkim-domain.com.private.txt";
  // selector = "dkim";
  // }
  // ..

  // becomes
  // "domain": {
  // "domain.com": {
  // "path": ""/tmp/docker-mailserver/rspamd/dkim/rsa-2048-dkim-domain.com.private.txt";",
  // "selector": ""dkim";",
  // },
  // ..

  const cleanData = `{${cleanlines.join('\n')}}`;
  // debugLog(`cleanData:`, cleanData);

  try {
    const json = jsonFixTrailingCommas(cleanData, true);
    debugLog(`json:`, json);
    return json;
  } catch (error) {
    errorLog(`cleanData not valid JSON:`, error.message);
    return {};
  }
};

// pulls entire doveconf and parse what we need
export const pullDoveConf = async (targetDict = {}) => {
  // TODO: add quotas
  // "quota_max_mail_size": "314M",
  // "quota_rule": "*:storage=5242M",

  debugLog(`start`);
  let envs = {};

  try {
    const results = await execAction('doveconf_dump', {}, targetDict);
    if (!results.returncode) {
      const doveconf = await readDovecotConfFile(results.stdout);
      // debugLog(`doveconf:`, doveconf);   // super large output, beware

      if (doveconf?.plugin?.fts) {
        envs.DOVECOT_FTS_PLUGIN = doveconf.plugin.fts;
        envs.DOVECOT_FTS_AUTOINDEX = doveconf.plugin.fts_autoindex;
      }

      if (doveconf?.mail_plugins) {
        // [ "mail_plugins", "quota", "fts", "fts_xapian", "zlib" ]
        // the bellow will add those items: envs.DOVECOT_QUOTA, DOVECOT_FTS, DOVECOT_FTP_XAPIAN, DOVECOT_ZLIB etc
        for (const PLUGIN of doveconf.mail_plugins.split(' ')) {
          if (PLUGIN) envs[`DOVECOT_${PLUGIN.toUpperCase()}`] = 1;
        }
      }
    } else errorLog(results.stderr);
  } catch (error) {
    errorLog(`execAction failed with error:`, error.message);
  }
  return envs;
};

export const pullDOVECOT = async (targetDict = {}) => {
  let envs = {};

  try {
    const results = await execAction('dovecot_version', {}, targetDict); // 2.3.19.1 (9b53102964)
    if (!results.returncode) {
      const DOVECOT_VERSION = results.stdout.split(' ')[0];
      debugLog(`DOVECOT_VERSION:`, DOVECOT_VERSION);

      envs.DOVECOT_VERSION = DOVECOT_VERSION;
    } else errorLog(results.stderr);
  } catch (error) {
    errorLog(`execAction failed with error:`, error.message);
  }
  return envs;
};

export const pullDkimRspamd = async (targetDict = {}) => {
  const cName =
    typeof targetDict === 'string' ? targetDict : targetDict?.containerName;

  // we pull only if ENABLE_RSPAMD=1 because we don't know what the openDKIM config looks like
  let envs = {};
  let results, dkimConfig;
  // The path is validated against the cat_rspamd_config enum in the manifest.
  // DMS_CONFIG_PATH defaults to /tmp/docker-mailserver.
  const dkimSigningConfPath = `${env.DMS_CONFIG_PATH}/rspamd/override.d/dkim_signing.conf`;

  try {
    results = await execAction(
      'cat_rspamd_config',
      { path: dkimSigningConfPath },
      targetDict
    );
    if (!results.returncode) {
      debugLog(`dkim file content:`, results.stdout);
      dkimConfig = await readDkimFile(results.stdout);
      debugLog(`dkim json:`, dkimConfig);

      envs.DKIM_ENABLED = dkimConfig?.enabled;
      envs.DKIM_SELECTOR = dkimConfig?.selector || env.DKIM_SELECTOR_DEFAULT;
      envs.DKIM_PATH = dkimConfig?.path;

      if (dkimConfig?.domain) {
        for (const [domain, item] of Object.entries(dkimConfig.domain)) {
          let split,
            [keytype, keysize] = ['', ''];
          if (item?.path) {
            split = path.basename(item.path).split('-'); // [ 'rsa', '2048', 'dkim', '$domain.private.txt' ]
            keytype = split[0];
            keysize = split[1];
          }
          if (item?.selector) {
            results = dbRun(
              sql.domains.insert.domain,
              {
                domain: domain,
                dkim: item?.selector,
                keytype: keytype,
                keysize: keysize,
                path: item?.path || envs.DKIM_PATH,
              },
              cName
            );
          }
        }
      } else if (envs.DKIM_PATH) {
        // No per-domain config — discover domains from DKIM key directory
        const dkimKeysDir = path.dirname(
          envs.DKIM_PATH.replace('$selector', envs.DKIM_SELECTOR).replace(
            '$domain',
            ''
          )
        );
        // Note: ls_dir and openssl_pkey_inspect validators require paths
        // under `${env.DMS_CONFIG_PATH}/rspamd/dkim/` (DKIM_DIR_VALIDATOR
        // is built from DMS_CONFIG_PATH at manifest load time). If
        // DKIM_PATH resolves to a non-rspamd base (e.g. opendkim) the
        // validator intentionally rejects it — adding more paths to the
        // allowlist widens the action protocol's surface and should
        // only be done after reviewing the security implications.
        const lsResult = await execAction(
          'ls_dir',
          { dir: dkimKeysDir },
          targetDict,
          { timeout: 5 }
        );
        if (!lsResult.returncode && lsResult.stdout) {
          const domains = lsResult.stdout
            .trim()
            .split('\n')
            .filter((d) => d && /^[a-z0-9.-]+$/i.test(d));
          infoLog(
            `Discovered ${domains.length} DKIM domains from ${dkimKeysDir}`
          );
          for (const domain of domains) {
            const keyPath = envs.DKIM_PATH.replace('$domain', domain).replace(
              '$selector',
              envs.DKIM_SELECTOR
            );
            // Detect key type and size
            let keytype = '',
              keysize = '';
            const keyInfo = await execAction(
              'openssl_pkey_inspect',
              { keypath: keyPath },
              targetDict,
              { timeout: 5 }
            );
            if (!keyInfo.returncode) {
              const match = keyInfo.stdout.match(
                /(?:(RSA|EC|ED25519)\s+)?Private-Key:\s*\((\d+)\s*bit/i
              );
              if (match) {
                keysize = match[2];
                keytype = (match[1] || 'rsa').toLowerCase();
              }
            }
            results = dbRun(
              sql.domains.insert.domain,
              {
                domain: domain,
                dkim: envs.DKIM_SELECTOR,
                keytype: keytype,
                keysize: keysize,
                path: keyPath,
              },
              cName
            );
          }
        }
      }
    } else warnLog(results.stderr); // dkim is optional, not an error if absent
  } catch (error) {
    errorLog(`execAction failed with error:`, error.message);
  }
  return envs;
};

// Function to pull server environment from API
export const pullServerEnvs = async (targetDict = {}) => {
  var envs = { DKIM_SELECTOR_DEFAULT: env.DKIM_SELECTOR_DEFAULT };
  try {
    // Get container instance
    const result_env = await execAction('print_env', {}, targetDict);
    if (!result_env.returncode) {
      // get and conver DMS environment to dict ------------------------------------------ envs
      const dictEnvDMS = arrayOfStringToDict(result_env.stdout, '=');
      // debugLog(`dictEnvDMS`, dictEnvDMS);

      // we keep only some options not all
      const dictEnvDMSredux = reduxPropertiesOfObj(dictEnvDMS, env.DMS_OPTIONS);
      // debugLog(`dictEnvDMSredux:`, dictEnvDMSredux);

      // look for dovecot version -------------------------------------------------- dovecot version
      const dovecot = await pullDOVECOT(targetDict);

      // look for doveconf mail_plugins fts etc -------------------------------------------------- doveconf
      const doveconf = await pullDoveConf(targetDict);

      // TODO: look for quotas -------------------------------------------------- quota

      // pull dkim conf ------------------------------------------------------------------ dkim rspamd
      const dkim = await pullDkimRspamd(targetDict);

      // merge all ------------------------------------------------------------------ merge
      envs = { ...envs, ...dictEnvDMSredux, ...dovecot, ...doveconf, ...dkim };
      debugLog(`Server pull envs result:`, envs);
      // DKIM_SELECTOR_DEFAULT: 'mail',
      // ENABLE_MTA_STS: 1,
      // ENABLE_RSPAMD: 1,
      // DMS_RELEASE: 'v15.1.0',
      // PERMIT_DOCKER: 'none',
      // DOVECOT_MAILBOX_FORMAT: 'maildir',
      // POSTFIX_MAILBOX_SIZE_LIMIT: 5242880000,
      // TZ: 'UTC',
      // DOVECOT_VERSION: '2.3.19.1',
      // DOVECOT_FTS_PLUGIN: 'xapian',
      // DOVECOT_FTS_AUTOINDEX: 'yes',
      // DOVECOT_QUOTA: 1,
      // DOVECOT_FTS: 1,
      // DOVECOT_FTS_XAPIAN: 1,
      // DOVECOT_ZLIB: 1,
      // DKIM_ENABLED: 'true',
      // DKIM_SELECTOR: 'dkim',
      // DKIM_PATH: '/tmp/docker-mailserver/rspamd/dkim/rsa-2048-$selector-$domain.private.txt'
    } else {
      throw new Error(result_env.stderr);
    }

    return obj2ArrayOfObj(envs, true);
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
  }
};

// Internal helper — only called by getServerEnvs() below. Removed the
// `export` since no other module imports it.
const getServerEnv = async (
  plugin = 'mailserver',
  containerName = null,
  name = null
) => {
  debugLog(`plugin=${plugin}, containerName=${containerName}, name=${name}`);
  if (!name) return { success: false, error: 'name is required' };
  if (!containerName)
    return { success: false, error: 'containerName is required' };
  if (!plugin) return { success: false, error: 'plugin is required' };

  try {
    // const env = dbGet(sql.settings.select.env, {scope:containerName}, name);
    // env:      `SELECT         s.value FROM settings s LEFT JOIN configs c ON s.configID = c.id WHERE 1=1 AND configID = (select id FROM configs WHERE c.name = ? AND plugin = @plugin) AND isMutable = ${env.isImmutable} AND s.name = ?`,
    const result = dbGet(
      sql.configs.select.env,
      { plugin: plugin },
      containerName,
      name
    );
    return { success: true, message: result.message?.value };
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// export const getServerEnvs = async (plugin, schema, scope, containerName, refresh, name) => {
export const getServerEnvs = async (
  plugin = 'mailserver',
  containerName = null,
  refresh = false,
  name = null
) => {
  debugLog(
    `plugin=${plugin}, containerName=${containerName}, refresh=${refresh}, name=${name}`
  );
  if (!containerName)
    return {
      success: false,
      error: 'getServerEnvs: containerName is required',
    };
  if (!plugin)
    return { success: false, error: 'getServerEnvs: plugin is required' };

  const demo = demoResponse('serverEnvs');
  if (demo) {
    if (name) {
      const found = demo.message.find((e) => e.name === name);
      return { success: true, message: found?.value };
    }
    return demo;
  }

  if (!refresh) {
    if (name) return getServerEnv(plugin, containerName, name);

    try {
      // const result = dbAll(sql.settings.select.envs, {scope:containerName});
      // envs:     `SELECT s.name, s.value FROM settings s LEFT JOIN configs c ON s.configID = c.id WHERE 1=1 AND configID = (select id FROM configs WHERE c.name = ? AND plugin = @plugin) AND isMutable = ${env.isImmutable}`,
      const result = dbAll(
        sql.configs.select.envs,
        { plugin: plugin },
        containerName
      );
      if (result.success) {
        const envs = result.message;
        debugLog(`envs: (${typeof envs}) of length ${envs?.length}:`, envs);

        // we could read DB_Logins and it is valid
        if (envs.length) {
          infoLog(`Found ${envs.length} entries in envs`);
          // {success:true, message: [ { name: 'DOVECOT_FTS_PLUGIN', value: 'xapian' }, .. ] }
        } else {
          warnLog(`db settings[env] seems empty:`, envs);
        }
      }
      return result;
    } catch (error) {
      errorLog(error.message);
      throw new Error(error.message);
      // TODO: we should return smth to the index API instead of throwing an error
      // return {
      // status: 'unknown',
      // error: error.message,
      // };
    }
  }

  // now refreshing by pulling data from DMS
  debugLog(`will pullServerEnvs for ${containerName}`);
  const targetDict = getTargetDict(plugin, containerName);
  const pulledEnv = await pullServerEnvs(targetDict);
  infoLog(
    `got ${Object.keys(pulledEnv).length} pulledEnv from pullServerEnvs(${containerName})`,
    pulledEnv
  );

  if (pulledEnv && pulledEnv.length) {
    saveServerEnvs(
      plugin,
      targetDict.schema,
      targetDict.scope,
      containerName,
      pulledEnv
    );
    return name
      ? await getServerEnv(plugin, containerName, name)
      : { success: true, message: pulledEnv };

    // unknown error
  } else {
    errorLog(`pullServerEnvs could not pull environment from ${containerName}`);
    return {
      success: false,
      error: `pullServerEnvs could not pull environment from ${containerName}`,
    };
  }
};

export const saveServerEnvs = async (
  plugin = 'mailserver',
  schema = null,
  scope = null,
  containerName = null,
  jsonArrayOfObjects = []
) => {
  // jsonArrayOfObjects = [{name:name, value:value}, ..]
  debugLog(plugin, schema, scope, containerName, jsonArrayOfObjects);
  if (!jsonArrayOfObjects.length)
    return {
      success: false,
      error: 'saveServerEnvs: values=jsonArrayOfObjects is required',
    };
  if (!containerName)
    return {
      success: false,
      error: 'saveServerEnvs: scope=containerName is required',
    };

  let result;
  try {
    // const jsonArrayOfObjectsScoped = jsonArrayOfObjects.map(env => { return { ...env, scope:containerName }; });
    // const jsonArrayOfObjectsScoped = jsonArrayOfObjects.map(env => { return { ...env, plugin:plugin, schema:schema, scope:scope }; });
    const jsonArrayOfObjectsScoped = jsonArrayOfObjects.map((env) => {
      return { ...env, plugin: plugin };
    });
    // result = dbRun(sql.settings.delete.envs, {scope:containerName});
    // envs:     `DELETE FROM settings WHERE 1=1 AND isMutable = ${env.isImmutable} AND configID = (select id FROM configs WHERE name = ? AND plugin = @plugin)`,
    result = dbRun(sql.configs.delete.envs, { plugin: plugin }, containerName);
    if (result.success) {
      // result = dbRun(sql.settings.insert.env, jsonArrayOfObjectsScoped); // jsonArrayOfObjectsScoped = [{name:name, value:value, scope:containerName}, ..]
      // env:      `REPLACE INTO settings (name, value, configID, isMutable) VALUES (@name, @value, (select id FROM configs WHERE config = ? AND plugin = @plugin), 0)`,
      result = dbRun(
        sql.configs.insert.env,
        jsonArrayOfObjectsScoped,
        containerName
      ); // jsonArrayOfObjectsScoped = [{name:name, value:value, plugin:'mailserver', schema:'dmsEnv', scope:containerName}, ..]
    }
    return result;
  } catch (error) {
    errorLog(error.message);
    return { success: false, error: error.message };
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// Function to get dms-gui server infos
export const getNodeInfos = async () => {
  return {
    success: true,
    message: [
      { name: 'debug', value: env.debug },
      { name: 'DMSGUI_VERSION', value: env.DMSGUI_VERSION },
      { name: 'DMSGUI_CONFIG_PATH', value: env.DMSGUI_CONFIG_PATH },
      { name: 'HOSTNAME', value: env.HOSTNAME },
      { name: 'TZ', value: env.TZ },
      { name: 'NODE_VERSION', value: process.version },
      { name: 'NODE_ENV', value: env.NODE_ENV },
      { name: 'PORT_NODEJS', value: env.PORT_NODEJS },
    ],
  };
};

export const getDomain = async (containerName = null, name = null) => {
  debugLog(containerName, name);
  if (!name) return { success: false, error: 'getDomain: name is required' };
  if (!containerName)
    return {
      success: false,
      error: 'getDomain: scope=containerName is required',
    };

  try {
    const domain = dbGet(
      sql.domains.select.domain,
      { name: containerName },
      name
    );
    return { success: true, message: domain };
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

export const getDomains = async (containerName = null, name = null) => {
  debugLog(containerName, name);
  if (name) return getDomain(containerName, name);
  if (!containerName)
    return {
      success: false,
      error: 'getDomains: scope=containerName is required',
    };

  const demo = demoResponse('domains');
  if (demo) return demo;

  try {
    const domains = dbAll(sql.domains.select.domainsWithCounts, {
      name: containerName,
    });
    if (domains.success) {
      debugLog(`domains: domains (${typeof domains.message})`);

      // we could read DB_Logins and it is valid
      if (domains.message && domains.message.length) {
        infoLog(`Found ${domains.message.length} entries in domains`);
        // {success: true, [ { name: 'containerName', value: 'dms' }, .. ] }
      } else {
        warnLog(`db domains seems empty:`, domains.message);
      }
    }
    return domains;
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// dms-gui  | [3:36:59 AM 🔎 [DEBUG]     dbRun DB.transaction success
// dms-gui  | [3:36:59 AM ✔️  [SUCCESS] saveSettings Saved 7 settings for containerName=dms
// dms-gui  | [3:36:59 AM 🔎 [DEBUG]     initAPI (plugin:mailserver, schema:dms, containerName:dms, dms_api_key_param:d6657c97-2f43-40c6-8104-3e3d43478f41)
// dms-gui  | [3:36:59 AM 🔎 [DEBUG]     initAPI Injecting API scripts to dms...
// dms-gui  | [3:36:59 AM ✔️  [SUCCESS]         writeFile /app/config/rest-api.py
// dms-gui  | [3:36:59 AM 🔎 [DEBUG]         createAPIfiles created file.path: /app/config/rest-api.py
// dms-gui  | [3:36:59 AM ✔️  [SUCCESS]         writeFile /app/config/rest-api.conf
// dms-gui  | [3:36:59 AM 🔎 [DEBUG]         createAPIfiles created file.path: /app/config/rest-api.conf
// dms-gui  | [3:36:59 AM 🔎 [DEBUG]         getSetting mailserver dms null false
// dms-gui  | [3:36:59 AM 🔎 [DEBUG]       initAPI success: false, dms_api_key_db: undefined
// dms-gui  | [3:36:59 AM 🔎 [DEBUG]       initAPI dms_api_key_new=param d6657c97-2f43-40c6-8104-3e3d43478f41

// Creates API script and conf file for DMS
// 1. if    dms_api_key_param, use it and replace value in db
// 2. if no dms_api_key_param, use what's in db
// 3. if no dms_api_key_param and nothing in db, generate it
// 4. if    dms_api_key_param == 'regen',  regenerate it and save in db
// 4. if    dms_api_key_param == 'inject', only inject API files to DMS config folder
// 5. always create script and conf file at the end
export const initAPI = async (
  plugin = 'mailserver',
  schema = 'dms',
  containerName = null,
  dms_api_key_param = null
) => {
  // dms_api_key_param can be the literal sentinels 'regen' / 'inject' OR
  // a real key the caller wants to install — redact unconditionally.
  debugLog(
    `(plugin:${plugin}, schema:${schema}, containerName:${containerName}, dms_api_key_param:${redactKey(dms_api_key_param)})`
  );
  if (!containerName)
    return { success: false, error: 'initAPI: containerName is required' };
  if (!schema) return { success: false, error: 'initAPI: schema is required' };
  if (!plugin) return { success: false, error: 'initAPI: plugin is required' };

  let result, dms_api_key_db, dms_api_key_new;
  try {
    // inject API files and exit if inject is passed
    debugLog(`Injecting API scripts to ${containerName}...`);
    result = await createAPIfiles(schema);
    if (dms_api_key_param == 'inject') return result;

    // get what key is in db if any
    result = await getSetting(plugin, containerName, 'DMS_API_KEY');
    if (result.success) dms_api_key_db = result.message;
    debugLog(
      `success: ${result.success}, dms_api_key_db: ${redactKey(dms_api_key_db)}, error:`,
      result?.error
    );

    // replace key when key is passed
    if (dms_api_key_param) {
      // regen is passed
      if (dms_api_key_param == 'regen') {
        dms_api_key_new = containerName + '-' + crypto.randomUUID();
        debugLog(`dms_api_key_new=regen`, redactKey(dms_api_key_new));

        // inject API was passed
      } else if (dms_api_key_param == 'inject') {
        dms_api_key_new = dms_api_key_param;
        debugLog(`dms_api_key_new=inject`);

        // use key vparam passed
      } else {
        dms_api_key_new = dms_api_key_param;
        debugLog(`dms_api_key_new=param`, redactKey(dms_api_key_new));
      }
    }

    // nothing passed
    if (!dms_api_key_new) {
      // but key exist in db
      if (dms_api_key_db) {
        dms_api_key_new = dms_api_key_db;
        debugLog(
          `regen dms_api_key_new=dms_api_key_db`,
          redactKey(dms_api_key_new)
        );

        // and key is not in db: generate
      } else {
        dms_api_key_new = containerName + '-' + crypto.randomUUID();
        debugLog(`generate dms_api_key_new=`, redactKey(dms_api_key_new));
      }
    }

    // save key in db only if there is a config, do not try to save it during testing before a config exists
    // Note: mailserver configs are always scoped to 'dms-gui' (see FormContainerAdd flow).
    if (
      result.success &&
      dms_api_key_new != dms_api_key_db &&
      dms_api_key_param != 'inject'
    ) {
      debugLog(`Saving DMS_API_KEY=`, redactKey(dms_api_key_new));

      let jsonArrayOfObjects = [
        { name: 'DMS_API_KEY', value: dms_api_key_new },
      ];
      result = await saveSettings(
        plugin,
        schema,
        'dms-gui',
        containerName,
        jsonArrayOfObjects
      );
      if (!result.success) return result;
    }

    // Reaching here means either:
    //   - the save above succeeded, or
    //   - the key already matched what's in the DB (no save was needed), or
    //   - we're in the testing-before-config-exists path
    // In all three cases the new key is the canonical one to return to the caller.
    return { success: true, message: dms_api_key_new };
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// API files and path are defined in env.mjs and depend on the container type == schema
export const createAPIfiles = async (schema = 'dms') => {
  if (env.isDEMO) return { success: true, message: 'API files created' };

  let result;
  try {
    for (const file of Object.values(mailserverRESTAPI[schema])) {
      // The version-marker substitution applies to the rest-api.py template.
      // The template carries {DMSGUI_VERSION} in two places: the header
      // comment and the REST_API_VERSION class constant that drives the
      // X-Rest-Api-Version response header. Use replaceAll so BOTH sites
      // get substituted — a plain replace() would leave the second one
      // as the literal string and break drift detection on every request.
      //
      // JSON manifests are skipped: a future action argv token containing
      // the literal '{DMSGUI_VERSION}' would otherwise be silently rewritten.
      const content = file.path.endsWith('.json')
        ? file.content
        : file.content.replaceAll('{DMSGUI_VERSION}', env.DMSGUI_VERSION);
      result = await writeFile(file.path, content);
      if (result.success) {
        debugLog('created file.path:', file.path);
      } else {
        errorLog(`FAILED to created ${file.path}:`, result?.error);
        return { success: false, error: result?.error };
      }
    }
    return { success: true, message: 'API files created' };
  } catch (error) {
    errorLog(error.message);
    return { success: false, error: error.message };
  }
};

export const killContainer = async (
  plugin = 'dms-gui',
  schema = 'dms-gui',
  containerName = 'dms-gui',
  errorcode = 0
) => {
  if (env.isDEMO && containerName == 'dms-gui') {
    childProcess.exec(
      `cp ${env.DATABASE_SAMPLE} ${env.DATABASE_SAMPLE_LIVE}`,
      (error, stdout, stderr) => {
        if (error) {
          errorLog(`exec error: ${error}`);
          return;
        }
      }
    );
    successLog(
      `--------------------------- RESET ${containerName} DATABASE ---------------------------`
    );
  }

  let result;
  warnLog(
    `--------------------------- REBOOT ${containerName} NOW ---------------------------`
  );
  if (!env.isDEMO) {
    if (containerName == 'dms-gui') {
      childProcess.exec(
        command[plugin][schema].kill,
        (error, stdout, stderr) => {
          if (error) {
            errorLog(`exec error: ${error}`);
            return;
          }
        }
      );
      return { success: true, message: 'reboot initiated' };

      // reboot another container; first we check if it exists then do it
    } else {
      result = await getConfigs(plugin);
      if (result.success) {
        let containerNames = pluck(result.message, 'value');
        if (!containerNames.includes(containerName)) {
          return {
            success: false,
            error: `container ${containerName} not found`,
          };
        }
        const killActionId = command[plugin][schema]?.actionId;
        if (!killActionId) {
          return {
            success: false,
            error: `kill action missing for ${plugin} schema=${schema}`,
          };
        }
        const targetDict = getTargetDict(plugin, containerName);
        // Fire-and-forget after a 1s delay. Once the kill action runs
        // and supervisord (or whatever daemon manages the container's
        // services) dies, the HTTP response is lost — awaiting it
        // would surface as a confusing timeout. The setTimeout
        // mirrors the legacy `sleep 1 && kill ...` shell form: this
        // function's success response has a moment to reach the
        // client before the daemon goes down.
        //
        // execAction never rejects: it always resolves with
        // {returncode, stdout, stderr} (including transport errors,
        // which surface as returncode=99). So .catch() would be dead
        // code — inspect the resolved value's returncode instead.
        // Belt-and-braces: a try/catch wraps the async body so any
        // unforeseen throw (e.g. a future internal change to
        // execAction) doesn't surface as an unhandled promise
        // rejection, and `.unref()` keeps the 1s delay from holding
        // the event loop open during shutdown.
        const t = setTimeout(async () => {
          try {
            const r = await execAction(killActionId, {}, targetDict);
            if (r.returncode) {
              errorLog(
                `${killActionId} scheduled action failed: rc=${r.returncode} stderr=${r.stderr}`
              );
            }
          } catch (err) {
            errorLog(`${killActionId} scheduled action threw: ${err.message}`);
          }
        }, 1000);
        t.unref();
        return {
          success: true,
          message: `reboot initiated for ${containerName}`,
        };
      }
      return {
        success: false,
        error: `getConfigs failed for ${plugin}: ${result.error || 'unknown error'}`,
      };
    }
  }
  return { success: true, message: 'reboot initiated' }; // fails silently in all other cases
};

// =====================================================================
// Re-exports from extracted modules. settings.mjs used to be a 2766-line
// god-module; the #82 split moved cohesive groups of functions into
// sibling files. Existing import sites keep working unchanged — the
// barrel below proxies each domain's public surface back through
// `./settings.mjs`. Over time, callers can migrate to the per-domain
// import paths and we can retire this block.
//
// Kept at the end so dnsblCheck's `getSetting` import is satisfied by
// this module's own definition before the re-export pulls dnsTools.mjs
// in (avoiding partial-initialization on the cycle).
// =====================================================================
export * from './dnsTools.mjs';
export * from './dovecot.mjs';
export * from './mailLogs.mjs';
export * from './dkim.mjs';
export * from './rspamd.mjs';
