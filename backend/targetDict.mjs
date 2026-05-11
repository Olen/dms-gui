// Target-dict construction + host/port/protocol validators that the
// SSRF-defense chain relies on. Extracted from db.mjs's god-module
// during the #82 split.
//
// CodeQL recognises the boolean-AND chain in `isValidTargetHost` as a
// sanitiser for the js/request-forgery taint flow into fetch(). Keep
// the validators as expressions, not imperative early returns —
// dataflow analysers lose the chain when it's split across statements.
// See memory/feedback-codeql-sanitizers.md for the why.
//
// Re-exported through db.mjs so existing call sites don't churn.

import { getValueFromArrayOfObj } from '../common.mjs';
import { debugLog, errorLog } from './backend.mjs';
import { plugins } from './env.mjs';
import { getSettings } from './settings.mjs';
import { dbOpen } from './db.mjs';

// Allowed schemes for the targetDict.protocol used to construct the
// outbound URL `${protocol}://${host}:${port}` in execAction. Reject
// anything outside this list — `file://`, `gopher://`, etc. would let
// an attacker who can supply settings (admin only after the SSRF gate)
// reach non-HTTP resources via fetch().
const ALLOWED_TARGET_PROTOCOLS = new Set(['http', 'https']);

// Hostname allowlist for the targetDict.host. Three layered checks:
//
//   1. HOSTNAME_SHAPE_RE matches the same lenient shape as
//      middleware.js's validateContainerName: first char must be
//      alphanumeric, then any mix of alphanumeric / `.` / `_` / `-`.
//      Deliberately lenient — it accepts adjacent dots (`a..b`),
//      trailing dots (`a.`), and underscores. The character class is
//      the load-bearing exclusion: it blocks URL metacharacters
//      (`:` `/` `?` `#` `@`) and whitespace.
//   2. IPV4_LITERAL_RE rejects the canonical 4-octet dotted form
//      (`169.254.169.254`, `127.0.0.1`, `10.x.x.x`, `0.0.0.0`).
//      Combined with #1's exclusion of `:` `[` `]`, this also rules
//      out IPv6 bracketed literals and bare colon-separated forms.
//   3. URL-canonicalisation check: feed the host through `new URL()`
//      and reject if the WHATWG parser interprets it as an IP. The
//      parser canonicalises shorthand IPv4 (`127.1` → `127.0.0.1`,
//      `2130706433` → `127.0.0.1`, `0x7f.1` → `127.0.0.1`) and any
//      other ambiguous form before fetch() ever sees it. Without
//      this step the regex-only checks would let `127.1` through
//      as a "hostname" that immediately routes to loopback.
//
// CodeQL recognises the regex-based checks as sanitizers for the
// js/request-forgery taint flow; the URL-parse step closes the
// remaining canonicalisation gaps.
// `1024` cap is well above any realistic FQDN.
const HOSTNAME_SHAPE_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const IPV4_LITERAL_RE = /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/;
// WHATWG URL parser canonicalises shorthand IPv4 forms (`127.1`,
// `2130706433`, `0x7f.1`) to their full 4-octet equivalents. The
// regex sanitisers below don't catch shorthand because the input
// looks like a hostname (alphanumeric + dots). Defense step: parse
// `http://${s}` and check whether the parser normalised the host.
// Any normalisation away from `s.toLowerCase()` means fetch() would
// send the request somewhere other than what the caller wrote, and
// any canonical form that is itself an IPv4 literal means the parser
// reinterpreted the input as an IP — reject either way.
const isCanonicalizedByUrlParser = (s) => {
  let canonical;
  try {
    canonical = new URL(`http://${s}`).hostname;
  } catch {
    return true; // unparseable → treat as canonicalised (reject)
  }
  return canonical !== s.toLowerCase() || IPV4_LITERAL_RE.test(canonical);
};

// Single boolean expression so static analysers can recognise the
// regex.test() steps as sanitizers for the user-controlled value
// flowing into fetch(). Imperative early returns confuse some
// dataflow checkers; this form's short-circuit AND chain keeps the
// barriers visible.
const isValidTargetHost = (s) =>
  typeof s === 'string' &&
  s.length > 0 &&
  s.length <= 1024 &&
  HOSTNAME_SHAPE_RE.test(s) &&
  !IPV4_LITERAL_RE.test(s) &&
  !isCanonicalizedByUrlParser(s);

// Port must be a numeric string in the valid TCP/UDP range (1..65535).
// We allow leading zeros (`080` is accepted) because Node's URL
// parser canonicalises them to the unzeroed form anyway, and stored
// settings from older versions may have them — rejecting them
// would be a needless backwards-compat break. Scientific notation
// and negatives are rejected by the digits-only regex.
const TARGET_PORT_RE = /^[0-9]{1,7}$/;
const isValidPortNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;

export const getTargetDict = (
  plugin = null,
  containerName = null,
  settings = []
) => {
  let result, schema;
  try {
    if (settings.length) {
      const protocol = getValueFromArrayOfObj(settings, 'protocol');
      if (!ALLOWED_TARGET_PROTOCOLS.has(protocol)) {
        return {
          success: false,
          error: `protocol must be one of: ${[...ALLOWED_TARGET_PROTOCOLS].join(', ')}`,
        };
      }
      const host = getValueFromArrayOfObj(settings, 'containerName');
      if (!isValidTargetHost(host)) {
        return {
          success: false,
          error:
            'host must contain only alphanumeric characters, dots, hyphens, and underscores, must start with an alphanumeric character, and must not be an IP literal or any form the URL parser canonicalises to one',
        };
      }
      const portRaw = getValueFromArrayOfObj(settings, 'DMS_API_PORT');
      const portStr = typeof portRaw === 'number' ? String(portRaw) : portRaw;
      if (
        typeof portStr !== 'string' ||
        !TARGET_PORT_RE.test(portStr) ||
        !isValidPortNumber(Number(portStr))
      ) {
        return {
          success: false,
          error: 'port must be an integer between 1 and 65535',
        };
      }
      let targetDict = {
        containerName: host,
        protocol,
        host,
        port: portStr,
        Authorization: getValueFromArrayOfObj(settings, 'DMS_API_KEY'),
        setupPath: getValueFromArrayOfObj(settings, 'setupPath'),
        timeout: getValueFromArrayOfObj(settings, 'timeout'),
        scope: 'dms-gui',
      };
      return targetDict;
    } else {
      result = getSettings(plugin, containerName);

      if (result.success)
        schema = getValueFromArrayOfObj(result.message, 'schema');

      // Guard the diagnostic + the length comparison: if getSettings
      // failed, `result.message` is undefined; if plugin/schema were
      // never configured, `plugins[plugin][schema]` is undefined.
      // Without these guards the debugLog itself throws a TypeError,
      // masking the underlying getSettings error and forcing the
      // catch-path with a confusing "Cannot read properties of
      // undefined" message instead of the real cause.
      const pluginKeys = plugins[plugin]?.[schema]?.keys;
      const messageOK = result.success && Array.isArray(result.message);
      if (messageOK && pluginKeys) {
        debugLog(
          `ddebug result.message.length >= Object.keys(plugins[${plugin}][${schema}].keys: ${result.message.length} >= ${Object.keys(pluginKeys).length}`
        );
      }
      if (
        messageOK &&
        pluginKeys &&
        result.message.length >= Object.keys(pluginKeys).length
      ) {
        // Apply the same protocol/host/port allowlist as the
        // user-supplied path above. The DB values came from a
        // previous user-supplied save, so a malicious or accidentally-
        // wrong value persisted to the DB would otherwise reintroduce
        // the SSRF channel without going through the route-level
        // admin gate. Defense-in-depth: validate at every layer.
        const protocol = getValueFromArrayOfObj(result.message, 'protocol');
        if (!ALLOWED_TARGET_PROTOCOLS.has(protocol)) {
          return {
            success: false,
            error: `stored protocol must be one of: ${[...ALLOWED_TARGET_PROTOCOLS].join(', ')}`,
          };
        }
        const host = getValueFromArrayOfObj(result.message, 'containerName');
        if (!isValidTargetHost(host)) {
          return {
            success: false,
            error:
              'stored host must contain only alphanumeric characters, dots, hyphens, and underscores, must start with an alphanumeric character, and must not be an IP literal or any form the URL parser canonicalises to one',
          };
        }
        const portRaw = getValueFromArrayOfObj(result.message, 'DMS_API_PORT');
        const portStr = typeof portRaw === 'number' ? String(portRaw) : portRaw;
        if (
          typeof portStr !== 'string' ||
          !TARGET_PORT_RE.test(portStr) ||
          !isValidPortNumber(Number(portStr))
        ) {
          return {
            success: false,
            error: 'stored port must be an integer between 1 and 65535',
          };
        }
        let targetDict = {
          containerName: host,
          protocol,
          host,
          port: portStr,
          Authorization: getValueFromArrayOfObj(result.message, 'DMS_API_KEY'),
          setupPath: getValueFromArrayOfObj(result.message, 'setupPath'),
          timeout: getValueFromArrayOfObj(result.message, 'timeout'),
          schema: schema,
          scope: 'dms-gui',
        };
        return targetDict;
      }
    }
    throw new Error(result?.error);
  } catch (error) {
    errorLog(error.message);
    dbOpen();
    return { success: false, error: error.message };
  }
};
