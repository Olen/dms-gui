// ANSI ESC stripper
// eslint-disable-next-line no-control-regex -- intentional: matches ESC byte
export const regexColors = /\x1b\[[0-9;]*[mGKHF]/g;

// Strip non-printable control chars (NUL through US, plus DEL and C1)
// from text we render in logs and error messages. Tab/LF/CR are preserved
// so multi-line content survives intact.
// eslint-disable-next-line no-control-regex -- intentional: matches control chars
export const regexNonPrintable = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;

export const regexEmailStrict = /^([\w.\-_]+)@([\w.\-_]+)$/;
// Match a /pattern/-wrapped email regex literal — used in the aliases UI
// where a "source" can be a Postfix virtual-aliases regex.
export const regexEmailRegex = /^\/[\S]+@[\S]+\/$/;
// Non-whitespace token (login usernames must not contain spaces).
export const regexUsername = /^[^\s]+$/;
export const regexMatchPostfix = /(\/[\S]+@[\S]+\/)[\s]+([\w.\-_]+@[\w.\-_]+)/;

// safeUrl returns the input URL only if its scheme is in the allowlist
// (default: http/https). Returns null otherwise.
//
// Used at every <a href={...}> / window.open(...) site that takes an
// admin- or branding-supplied URL (WEBMAIL_URL, branding.webmailUrl,
// rspamd external URL). Without this guard a malicious admin can plant
// a 'javascript:' URL that runs in any non-admin user's session on
// click — the rest=noopener attribute on <a target="_blank"> does not
// block javascript: schemes, only opener access.
//
// Returns null (not '#' or '') so callers can use the truthy check to
// drive both the href and the conditional rendering of the link itself.
export const safeUrl = (url, allowedSchemes = ['http:', 'https:']) => {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    // We parse the trimmed value (not `url`) so that the value we
    // return matches the value we validated. `new URL()` already
    // tolerates surrounding whitespace, so the trim here is a
    // canonicalisation step, not a security-critical defence.
    const parsed = new URL(trimmed);
    // Both sides of the scheme comparison are lowercased so a caller can
    // pass either ['HTTPS:'] or ['https:'] and get the same result.
    const allowed = allowedSchemes.map((s) => s.toLowerCase());
    return allowed.includes(parsed.protocol.toLowerCase()) ? trimmed : null;
  } catch {
    // Malformed URL or relative path with no base — treat as unsafe.
    return null;
  }
};

// redactKey returns a short fingerprint suitable for logs: the first
// four and last four characters separated by '...'. Anything shorter
// than 12 chars is fully redacted to '***' (the prefix-suffix form
// would leak too much). Use whenever a secret-like value (API key,
// generated password) needs to appear in a log line for traceability.
export const redactKey = (key) => {
  if (typeof key !== 'string' || key.length < 12) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
};

// redactSensitiveSettings replaces the value of any [{name, value}, ...]
// row whose name looks secret-shaped with the redactKey form. Used
// before logging a full settings payload so a debug-level dump cannot
// leak credentials (DMS_API_KEY, AES_SECRET, JWT_SECRET, etc.) into
// shared log aggregators.
const SENSITIVE_NAME_RE = /SECRET|KEY|PASSWORD|TOKEN/i;
export const redactSensitiveSettings = (rows) => {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) =>
    row && typeof row.name === 'string' && SENSITIVE_NAME_RE.test(row.name)
      ? { ...row, value: redactKey(row.value) }
      : row
  );
};

// Walk the current call stack and return the caller's function name
// (with surrounding indentation when `parent` traversal includes more
// than one frame). Used by the logger to label each log line.
//
// Captures the token between "at " and the next whitespace or "(":
// handles "at funcName (file:…)", "at Server.<anonymous> (file:…)",
// "at Object.<anonymous> (file:…)", "at <anonymous>".
export const funcName = (parent = 4, onlyParent = false) => {
  const error = new Error();
  let match, funcName;

  const errorLines = error.stack.split('\n');
  for (let i = parent; i <= errorLines.length; i++) {
    match = /at\s+([^\s(]+)/.exec(errorLines[i]);

    if (match) {
      funcName = funcName ? '  ' + funcName : match[1];
      if (onlyParent) break;
    } else {
      funcName = funcName ? funcName : '<anonymous>';
      break;
    }
  }

  return funcName;
};

// Parse a JWT-style expiry string (e.g. "15m", "1h", "7d", "30s") to
// milliseconds. Accepts an integer prefix and a unit char from {s,m,h,d}.
// Returns the fallback (default 0) for unrecognised input.
//
// Used by both the JWT signer (jsonwebtoken accepts the same string syntax
// natively) and by the cookie maxAge config so the two can never drift.
export const parseExpiryToMs = (expiry, fallback = 0) => {
  if (typeof expiry === 'number' && Number.isFinite(expiry)) return expiry;
  if (typeof expiry !== 'string') return fallback;
  const m = expiry.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * multiplier;
};

export const fixStringType = (string) => {
  // Convert numeric strings to numbers; preserves '0' and '0.0' as numeric (the
  // previous `Number(s) ? Number(s) : s` form fell back to the string for any
  // value that coerced to a falsy number).
  const n = Number(string);
  return string !== '' && string != null && !Number.isNaN(n) ? n : string;
};

// Parse JSON that may contain trailing commas before ] or }. Returns the
// re-stringified JSON by default; pass returnJson=true for the parsed object.
export const jsonFixTrailingCommas = (jsonString, returnJson = false) => {
  const cleaned = jsonString.replace(/,\s*([}\]])/g, '$1');
  const jsonObj = JSON.parse(cleaned);
  if (returnJson) return jsonObj;
  else return JSON.stringify(jsonObj);
};

// Transform ["a=1", "b=2", ...] => {a: 1, b: 2, ...}. Accepts a raw
// newline-separated string in place of the array. Returns {} (never [])
// for empty input so callers can always treat the result as a dict.
export const arrayOfStringToDict = (array = [], separator = ',') => {
  let dict = {};

  if (typeof array == 'string') {
    array = array.split(/\r?\n/);
  }
  if (!array.length) return dict;

  array.map((item) => {
    let split = item.split(separator);
    if (split.length == 2) {
      dict[split[0]] = fixStringType(split[1]);
    }
  });
  return dict;
};

export const obj2ArrayOfObj = (
  obj = {},
  stringify = false,
  props = ['name', 'value']
) => {
  return stringify
    ? Object.keys(obj).map((key) => ({
        [props[0]]: key,
        [props[1]]: String(obj[key]),
      }))
    : Object.keys(obj).map((key) => ({
        [props[0]]: key,
        [props[1]]: obj[key],
      }));
};

// Filter an array of objects to rows whose `key` value is in `values2Keep`.
export const reduxArrayOfObjByValue = (array = [], key, values2Keep = []) => {
  if (!array.length) return [];
  if (typeof values2Keep == 'string') values2Keep = [values2Keep];
  return array.filter((item) => values2Keep.includes(item[key]));
};

// Project an object to only the keys listed in `keys2Keep`.
export const reduxPropertiesOfObj = (obj = {}, keys2Keep = []) => {
  if (typeof keys2Keep == 'string') keys2Keep = [keys2Keep];
  const allKeys = Object.keys(obj);
  return allKeys.reduce((next, key) => {
    if (keys2Keep.includes(key)) {
      return { ...next, [key]: obj[key] };
    } else {
      return next;
    }
  }, {});
};

// Merge two arrays of objects, replacing items in `a` whose `prop`
// matches the same `prop` in `b`. The merged array preserves `b`'s order.
export const mergeArrayOfObj = (a = [], b = [], prop = 'name') => {
  if (!a || !b) return [];

  if (!Array.isArray(a)) a = [a];
  if (!Array.isArray(b)) b = [b];
  const reduced = a.length
    ? a.filter((aitem) => !b.find((bitem) => aitem[prop] === bitem[prop]))
    : [];
  return reduced.concat(b);
};

// Return the FIRST value found in a list of props, from an array of objects like
// [{name: propValue, value: value1}, ...] => "value1"
export const getValueFromArrayOfObj = (
  array,
  propValues,
  keyName = 'name',
  keyValue = 'value'
) => {
  if (!Array.isArray(array)) return null;
  if (!Array.isArray(propValues)) propValues = [propValues];
  const found = array.find((item) => propValues.includes(item[keyName]));
  return found ? found[keyValue] : null;
};

// Return the (uniq) and/or (sorted) values from an array of objects like
// [{keyName: propName, keyValue: value1}, ...] => [value1, ...]
export const pluck = (
  array,
  keyValue = 'value',
  uniq = true,
  sorted = true
) => {
  if (!Array.isArray(array)) return null;
  let values = array.map((item) => item[keyValue]);
  let uniqValues = uniq ? [...new Set(values)] : values;
  return sorted ? uniqValues.sort() : uniqValues;
};

// Parse a human-readable byte size ("128MB", "1.5G", "200K") to a byte count.
export const humanSize2ByteSize = (humanBytes) => {
  const sizes = [
    /(\S+)B/i,
    /(\S+)KB?/i,
    /(\S+)MB?/i,
    /(\S+)GB?/i,
    /(\S+)TB?/i,
    /(\S+)PB?/i,
  ];
  for (const [power, regex] of Object.entries(sizes).reverse()) {
    let match = humanBytes.match(regex);
    if (match) return (match[1] * Math.pow(1024, power)).toFixed();
  }
  return 0;
};
