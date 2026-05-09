import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { REST_API_MANIFEST } from './restApiManifest.mjs';

dotenv.config({ path: '/app/config/.dms-gui.env' });

// Resolve the SMTP_TLS_VERIFY default. Exported for unit tests; the
// resolution rules are documented next to the env consumer below.
export const resolveSmtpTlsVerify = (procEnv) => {
  const v = (procEnv.SMTP_TLS_VERIFY || '').toLowerCase();
  if (v === 'false') return false;
  if (v === 'true') return true;
  return Boolean(procEnv.SMTP_HOST);
};
export const env = {
  debug: (process.env.DEBUG || '').toLowerCase() == 'true' ? true : false,

  // const { name, version, description }: require('./package.json');
  DMSGUI_VERSION:
    process.env.DMSGUI_VERSION.split('v').length == 2
      ? process.env.DMSGUI_VERSION.split('v')[1]
      : process.env.DMSGUI_VERSION,
  DMSGUI_DESCRIPTION: process.env.DMSGUI_DESCRIPTION,
  HOSTNAME: process.env.HOSTNAME,
  NODE_ENV: process.env.NODE_ENV || 'production',
  PORT_NODEJS: Number(process.env.PORT_NODEJS) || 3001,
  TZ: process.env.TZ || 'UTC',

  // internals of dms-gui
  FRONTEND_URL: process.env.FRONTEND_URL || '/api', // for cors if you really are crazy with this sort of security
  API_URL: process.env.API_URL || '/api', // for cors too
  DMSGUI_CONFIG_PATH: process.env.DMSGUI_CONFIG_PATH || '/app/config',
  DATABASE:
    process.env.isDEMO === 'true'
      ? '/app/config/dms-gui-demo.sqlite3'
      : process.env.DATABASE || '/app/config/dms-gui.sqlite3',
  DATABASE_SAMPLE: '/app/config/dms-gui-example.sqlite3',
  DATABASE_SAMPLE_LIVE: '/app/config/dms-gui-demo.sqlite3',

  // some selectors in the DKIM UI
  DKIM_KEYTYPES: ['rsa', 'ed25519'],
  DKIM_KEYSIZES: ['1024', '2048'],
  DKIM_KEYTYPE_DEFAULT: 'rsa',
  DKIM_KEYSIZE_DEFAULT: 2048,

  // variables we will capture from DMS
  DMS_OPTIONS: [
    'TZ',
    'HOSTNAME',
    'DMS_RELEASE',
    'ENABLE_RSPAMD',
    'ENABLE_XAPIAN',
    'ENABLE_MTA_STS',
    'PERMIT_DOCKER',
    'DOVECOT_MAILBOX_FORMAT',
    'POSTFIX_MAILBOX_SIZE_LIMIT',
  ],

  isMutable: 1,
  isImmutable: 0,

  // other DMS internals defaults
  DMS_SETUP_SCRIPT: process.env.DMS_SETUP_SCRIPT
    ? process.env.DMS_SETUP_SCRIPT
    : '/usr/local/bin/setup',
  DMS_CONFIG_PATH: process.env.DMS_CONFIG_PATH
    ? process.env.DMS_CONFIG_PATH
    : '/tmp/docker-mailserver',
  DKIM_SELECTOR_DEFAULT: process.env.DKIM_SELECTOR_DEFAULT
    ? process.env.DKIM_SELECTOR_DEFAULT
    : 'mail', // hardcoded in DMS
  protocol: 'http',
  port: 8888,
  timeout: 4,
  containerName: 'dms',

  // JWT_SECRET and JWT_SECRET_REFRESH regenerated when container starts, and will invalidates all sessions
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_SECRET_REFRESH: process.env.JWT_SECRET_REFRESH,
  // ACCESS_TOKEN_EXPIRY and REFRESH_TOKEN_EXPIRY control the behavior of the /loginUser and /refresh API
  ACCESS_TOKEN_EXPIRY: process.env.ACCESS_TOKEN_EXPIRY || '1h',
  REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY || '7d',

  // IV_LEN is the length of the unique Initialization Vector (IV) = random salt used for encryption and hashing
  IV_LEN: Number(process.env.IV_LEN) || 16,
  // HASH_LEN is the length of the hashed keys for passwords
  HASH_LEN: Number(process.env.HASH_LEN) || 64,
  // AES_SECRET = encrypted data secret key, that one is set in the environment as well but must never change or you won;t be able to read your encrypted data anymore
  // generate it once and for all with node or openssl:
  // // openssl rand -hex 32
  // // node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  AES_SECRET: process.env.AES_SECRET || 'changeme',
  // encrypted data algorithm
  AES_ALGO: process.env.AES_ALGO || 'aes-256-cbc',
  // AES_HASH is the used to hash the secret key
  AES_HASH: process.env.AES_HASH || 'sha512',
  // Derive a 256-bit key from your secretKey (raw 32 bytes for true AES-256)
  AES_KEY: crypto
    .createHash(process.env.AES_HASH || 'sha512')
    .update(process.env.AES_SECRET || 'changeme')
    .digest()
    .subarray(0, 32),

  // doveadm API port, possible to especially with dovecot 2.4, but not used and likely never will
  // DOVEADM_PORT: ((process.env.DOVEADM_PORT) ? process.env.DOVEADM_PORT : 8080),

  // enable a daily restart of the container with this simple trick: default is 11PM
  //                                              ┌────────────── second (optional)
  //                                              │ ┌──────────── minute
  //                                              │ │ ┌────────── hour
  //                                              │ │ │  ┌──────── day of month
  //                                              │ │ │  │ ┌────── month
  //                                              │ │ │  │ │ ┌──── day of week
  //                                              │ │ │  │ │ │
  //                                              │ │ │  │ │ │
  //                                              * * *  * * *
  DMSGUI_CRON:
    process.env.isDEMO === 'true'
      ? '6 7 *  * * *'
      : process.env.DMSGUI_CRON || '* 1 23 * * *',

  // Mount the OpenAPI / Swagger UI at /docs. Default off — the docs
  // disclose every endpoint and request shape, which is useful in
  // dev/staging but provides reconnaissance value in prod (and is
  // typically already accessible through the Traefik OIDC gate
  // anyway, so the second-layer admin guard below is purely
  // defence-in-depth). Set ENABLE_SWAGGER=true in .dms-gui.env to
  // enable; even when enabled, the route is wrapped in
  // authenticateToken + requireActive + requireAdmin, so anonymous
  // traffic gets 401, inactive accounts are blocked by the active-
  // account check, and active non-admin users get 403.
  ENABLE_SWAGGER:
    (process.env.ENABLE_SWAGGER || '').toLowerCase() === 'true' ? true : false,

  // SMTP for password reset emails (local delivery to DMS container, no auth)
  SMTP_HOST: process.env.SMTP_HOST || 'mailserver',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 25,
  // SMTP TLS certificate verification. The resolution order:
  //   1. SMTP_TLS_VERIFY=true|false → explicit override, always wins.
  //   2. SMTP_HOST is set explicitly → default true (proper CA
  //      validation; the cohort using a real SMTP relay has, almost
  //      certainly, configured SMTP_HOST and we should validate
  //      their cert).
  //   3. SMTP_HOST is not set → default false (the user is using
  //      our default 'mailserver' Docker container hostname; that
  //      cert is self-signed and the CN won't match the container
  //      name. Verifying would just make password-reset email fail
  //      out of the box on every default deployment).
  // requireTLS stays true regardless — verification disabled does
  // not mean plaintext fallback, only that we accept a self-signed
  // peer.
  SMTP_TLS_VERIFY: resolveSmtpTlsVerify(process.env),

  // Base URL for password reset links (e.g., https://epost.example.com)
  // If not set, derived from X-Forwarded-Proto/Host headers (set by reverse proxy)
  RESET_BASE_URL: process.env.RESET_BASE_URL || '',

  LOG_COLORS:
    (process.env.LOG_COLORS || '').toLowerCase() === 'false' ? false : true,

  // DEMO will activate a mock database and disable all refresh options
  isDEMO: (process.env?.isDEMO || '').toLowerCase() == 'true' ? true : false,
  github: 'https://github.com/audioscavenger/dms-gui',
  wiki: 'https://github.com/audioscavenger/dms-gui',
  dockerhub: 'https://hub.docker.com/repositories/audioscavenger',
};

// we don't set any defaults here, as they will override whatever users set // cancelled, we only use the db
// export var live = {
// // Docker container name for docker-mailserver  // cancelled
// DMS_CONTAINER: process.env.DMS_CONTAINER,
// containers: {},   // used to hold the DMS Docker.containers but we don't use docker.sock anymore

// // DMS API key and port we need, to execute commands in DMS container; must be in DMS environement too // cancelled
// DMS_API_KEY: process.env.DMS_API_KEY,
// DMS_API_PORT: process.env.DMS_API_PORT,

// };

/*
  sh: {
    desc: 'python API server launcher - cancelled'
    path: DMSGUI_CONFIG_PATH + '/rest-api.sh',
    content:
`# this script is executed on startup

nohup /usr/bin/python3 $(dirname $0)/rest-api.py &
`,
  },
*/

export const mailserverRESTAPI = {
  dms: {
    manifest: {
      desc: 'Action manifest consumed by rest-api.py at startup. Generated from REST_API_MANIFEST in restApiManifest.mjs; do not hand-edit on the DMS volume.',
      path: env.DMSGUI_CONFIG_PATH + '/rest-api-manifest.json',
      content: JSON.stringify(REST_API_MANIFEST, null, 2),
    },
    api: {
      desc: 'python API server - should be created at /tmp/docker-mailserver/dms-gui/rest-api.py',
      path: env.DMSGUI_CONFIG_PATH + '/rest-api.py',
      content: `
#!/usr/bin/python3
# version={DMSGUI_VERSION}

import http.server
import socket
import socketserver
import subprocess
import shlex
import json
import os
import datetime
import re
import types

DMS_API_HOST = os.environ.get('DMS_API_HOST', '0.0.0.0')          # Listen on all available interfaces
DMS_API_PORT = int(os.environ.get('DMS_API_PORT', 8888))          # Port to listen on
DMS_API_KEY = os.environ.get('DMS_API_KEY', 'missing')            # generated by bms-gui on first start and added into DMS compose
DMS_API_SIZE = int(os.environ.get('DMS_API_SIZE', 1024))          # max bytes per request sent from dms-gui, prevents buffer overflow and other exploit mechanics
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'info')                   # relies on dms LOG_LEVEL value set in your 'mailserver.env'
timeout_default = 1                                               # can be superseeded by passed timeout in data
MANIFEST_PATH = os.environ.get(
  'DMS_API_MANIFEST',
  '/tmp/docker-mailserver/dms-gui/rest-api-manifest.json',
)

def logger(message):
  # 2025-11-05T15:05:49.710284+00:00 mx dms-gui-api:
  print(f'{datetime.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S.%f%z")} {os.uname().nodename.split(".")[0]} dms-gui-api: {message}')

def debugg(message):
  if LOG_LEVEL == 'debug': logger(message)

def redact(s):
  # Show first 4 + last 4 chars for traceability without leaking the
  # full secret. Anything shorter than 12 chars is fully redacted —
  # the prefix-suffix form would leak too much of a short value.
  s = str(s) if s is not None else ''
  if len(s) < 12: return '***'
  return f"{s[:4]}...{s[-4:]}"

def safe_id(s):
  # Sanitize an action id (or any short user-supplied string) for log
  # output: truncate to 64 chars, replace every ASCII control character
  # (C0 + DEL) with a space so a caller (with a valid API key) cannot
  # inject log lines via newlines, ANSI escapes, etc.
  return re.sub(r'[\\x00-\\x1f\\x7f]', ' ', str(s)[:64])

# ---- Manifest load + freeze at startup ----
def load_manifest(path):
  with open(path) as f:
    entries = json.load(f)
  if not isinstance(entries, list):
    raise ValueError(f"manifest must be a JSON array, got {type(entries).__name__}")
  actions = {}
  for e in entries:
    if not isinstance(e, dict):
      raise ValueError(f"manifest entry must be an object, got {type(e).__name__}: {e!r}")
    if 'id' not in e:
      raise ValueError(f"manifest entry missing 'id': {e}")
    if not isinstance(e['id'], str):
      raise ValueError(
        f"manifest entry 'id' must be a string, got "
        f"{type(e['id']).__name__}: {e['id']!r}"
      )
    if e['id'] in actions:
      raise ValueError(f"duplicate action id: {e['id']}")
    has_argv = 'argv' in e
    has_pipeline = 'pipeline' in e
    if has_argv == has_pipeline:
      raise ValueError(
        f"action {e['id']}: must have exactly one of 'argv' or 'pipeline'"
      )
    if has_argv:
      if not isinstance(e['argv'], list) or not e['argv']:
        raise ValueError(f"action {e['id']}: 'argv' must be a non-empty list")
      if not all(isinstance(t, str) for t in e['argv']):
        raise ValueError(f"action {e['id']}: 'argv' tokens must be strings")
    else:
      if not isinstance(e['pipeline'], list) or not e['pipeline']:
        raise ValueError(f"action {e['id']}: 'pipeline' must be a non-empty list")
      for i, s in enumerate(e['pipeline']):
        if not isinstance(s, dict) or 'argv' not in s:
          raise ValueError(f"action {e['id']}: pipeline[{i}] missing 'argv'")
        if not isinstance(s['argv'], list) or not s['argv']:
          raise ValueError(f"action {e['id']}: pipeline[{i}].argv must be a non-empty list")
        if not all(isinstance(t, str) for t in s['argv']):
          raise ValueError(f"action {e['id']}: pipeline[{i}].argv tokens must be strings")
    if 'validate' in e:
      v = e['validate']
      if not isinstance(v, dict):
        raise ValueError(f"action {e['id']}: 'validate' must be an object")
      for arg_name, spec in v.items():
        if not isinstance(spec, dict):
          raise ValueError(
            f"action {e['id']}: validate['{arg_name}'] must be an object"
          )
        # Each spec must have exactly one validator-type key.
        type_keys = {'enum', 'regex', 'int', 'string'} & set(spec.keys())
        if len(type_keys) != 1:
          raise ValueError(
            f"action {e['id']}: validate['{arg_name}'] must have exactly "
            f"one of 'enum', 'regex', 'int', 'string'; got keys "
            f"{sorted(spec.keys())}"
          )
        vtype = next(iter(type_keys))
        # Top-level keys allowed for each validator type. maxlen is
        # ONLY used by the regex validator (validate() reads
        # spec.get('maxlen') only in the regex branch). For string,
        # length is read from spec['string'].maxlen (nested). For
        # int/enum, top-level maxlen is silently ignored -- reject it
        # at load time so manifest authoring mistakes fail fast.
        if vtype == 'regex':
          allowed_keys = {'regex', 'maxlen', 'optional'}
        elif vtype == 'enum':
          allowed_keys = {'enum', 'optional'}
        elif vtype == 'int':
          allowed_keys = {'int', 'optional'}
        elif vtype == 'string':
          allowed_keys = {'string', 'optional'}
        unknown = set(spec.keys()) - allowed_keys
        if unknown:
          raise ValueError(
            f"action {e['id']}: validate['{arg_name}'] (type {vtype!r}) "
            f"has unknown/disallowed keys: {sorted(unknown)}"
          )
        # Type-check the validator-type's payload AND the nested numeric
        # fields. Without these checks, a malformed manifest can load
        # cleanly and surface as a TypeError / re.error at request time
        # (HTTP 500), instead of failing fast at startup with a clear
        # error.
        if vtype == 'enum' and not isinstance(spec['enum'], list):
          raise ValueError(
            f"action {e['id']}: validate['{arg_name}'].enum must be a list"
          )
        if vtype == 'regex':
          if not isinstance(spec['regex'], str):
            raise ValueError(
              f"action {e['id']}: validate['{arg_name}'].regex must be a string"
            )
          # Compile the pattern at load time so an invalid regex (e.g.
          # unclosed bracket) is rejected here rather than at the first
          # request that triggers it.
          try:
            re.compile(spec['regex'])
          except re.error as ex:
            raise ValueError(
              f"action {e['id']}: validate['{arg_name}'].regex is not a "
              f"valid regex: {ex}"
            )
          if 'maxlen' in spec:
            if not isinstance(spec['maxlen'], int) or isinstance(spec['maxlen'], bool):
              raise ValueError(
                f"action {e['id']}: validate['{arg_name}'].maxlen must be an int"
              )
            if spec['maxlen'] < 0:
              raise ValueError(
                f"action {e['id']}: validate['{arg_name}'].maxlen must be >= 0"
              )
        if vtype == 'int':
          if not isinstance(spec['int'], dict):
            raise ValueError(
              f"action {e['id']}: validate['{arg_name}'].int must be an object"
            )
          for k in ('min', 'max'):
            if k in spec['int']:
              v_ = spec['int'][k]
              if isinstance(v_, bool) or not isinstance(v_, int):
                raise ValueError(
                  f"action {e['id']}: validate['{arg_name}'].int.{k} must be an int"
                )
        if vtype == 'string':
          if not isinstance(spec['string'], dict):
            raise ValueError(
              f"action {e['id']}: validate['{arg_name}'].string must be an object"
            )
          for k in ('minlen', 'maxlen'):
            if k in spec['string']:
              v_ = spec['string'][k]
              if isinstance(v_, bool) or not isinstance(v_, int):
                raise ValueError(
                  f"action {e['id']}: validate['{arg_name}'].string.{k} must be an int"
                )
              if v_ < 0:
                raise ValueError(
                  f"action {e['id']}: validate['{arg_name}'].string.{k} must be >= 0"
                )
        if 'optional' in spec and not isinstance(spec['optional'], bool):
          raise ValueError(
            f"action {e['id']}: validate['{arg_name}'].optional must be a bool"
          )
    if 'redirect' in e:
      r = e['redirect']
      if not isinstance(r, dict):
        raise ValueError(f"action {e['id']}: 'redirect' must be an object")
      if 'file' not in r or not isinstance(r['file'], str):
        raise ValueError(f"action {e['id']}: redirect.file must be a string")
      if 'mode' in r and r['mode'] not in ('write', 'append'):
        raise ValueError(
          f"action {e['id']}: redirect.mode must be 'write' or 'append'"
        )
    actions[e['id']] = e
  return types.MappingProxyType(actions)

try:
  ACTIONS = load_manifest(MANIFEST_PATH)
  logger(f"Loaded {len(ACTIONS)} actions from {MANIFEST_PATH}")
except FileNotFoundError:
  logger(
    f"WARNING: manifest file not found at {MANIFEST_PATH}; "
    f"action protocol disabled, only legacy {{command:}} path will work"
  )
  ACTIONS = types.MappingProxyType({})
except (json.JSONDecodeError, ValueError, OSError) as e:
  logger(
    f"ERROR: failed to load manifest from {MANIFEST_PATH}: {type(e).__name__}: {e}; "
    f"action protocol disabled, only legacy {{command:}} path will work"
  )
  ACTIONS = types.MappingProxyType({})

# ---- Declarative validators ----
def validate(spec, value):
  """Apply one validator. Returns (ok, normalized, err_msg)."""
  if 'enum' in spec:
    if value in spec['enum']:
      return True, value, None
    return False, None, f"not in enum {spec['enum']}"
  if 'regex' in spec:
    if not isinstance(value, str):
      return False, None, "not a string"
    if len(value) > spec.get('maxlen', 1024):
      return False, None, "too long"
    # fullmatch -- anchor by default so a missing end-anchor on the
    # regex doesn't accept '<good>\\n<malicious>' as valid.
    if not re.fullmatch(spec['regex'], value):
      return False, None, "regex match failed"
    return True, value, None
  if 'int' in spec:
    # bool is a subclass of int in Python; reject it explicitly so a JSON
    # 'true'/'false' doesn't silently coerce to 1/0.
    if isinstance(value, bool):
      return False, None, "not an integer (bool)"
    if isinstance(value, float):
      # Reject non-integer floats; '1.9' shouldn't silently become 1.
      if not value.is_integer():
        return False, None, "not an integer (non-integer float)"
      n = int(value)
    elif isinstance(value, int):
      n = value
    elif isinstance(value, str):
      # Decimal-string input from the JSON-text-mode caller.
      try:
        n = int(value)
      except ValueError:
        return False, None, "not an integer (string parse failed)"
    else:
      return False, None, "not an integer"
    r = spec['int']
    if 'min' in r and n < r['min']:
      return False, None, f"value {n} < min {r['min']}"
    if 'max' in r and n > r['max']:
      return False, None, f"value {n} > max {r['max']}"
    return True, str(n), None
  if 'string' in spec:
    if not isinstance(value, str):
      return False, None, "not a string"
    s = spec['string']
    if len(value) < s.get('minlen', 0):
      return False, None, "too short"
    if len(value) > s.get('maxlen', 1024):
      return False, None, "too long"
    return True, value, None
  return False, None, f"unknown validator spec: {spec}"

# ---- Token-level template substitution ----
PLACEHOLDER = re.compile(r'\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}')

def substitute(token, args):
  """Replace {name} occurrences within a single argv token."""
  def repl(m):
    name = m.group(1)
    if name not in args:
      raise KeyError(f"missing arg '{name}' in '{token}'")
    return str(args[name])
  return PLACEHOLDER.sub(repl, token)

def build_argv(template, args):
  return [substitute(t, args) for t in template]

# ---- Execute one action ----
def execute_action(action, args, action_timeout):
  rules = action.get('validate', {})
  validated = {}
  for k, v in args.items():
    if k not in rules:
      return 1, '', f"undeclared arg '{k}'"
    ok, norm, err = validate(rules[k], v)
    if not ok:
      return 1, '', f"validation failed for '{k}': {err}"
    validated[k] = norm
  for k, spec in rules.items():
    if k not in validated and not spec.get('optional', False):
      return 1, '', f"missing required arg '{k}'"

  if 'argv' in action:
    stages = [build_argv(action['argv'], validated)]
  else:
    stages = [build_argv(s['argv'], validated) for s in action['pipeline']]

  prev = None
  procs = []
  num_stages = len(stages)
  try:
    for i, stage in enumerate(stages):
      is_last = (i == num_stages - 1)
      proc = subprocess.Popen(
        stage,
        stdin=prev.stdout if prev else None,
        stdout=subprocess.PIPE,
        # Only the last stage's stderr is read via communicate(); piping
        # earlier stages would deadlock the pipeline once the OS pipe
        # buffer fills (~64KB on Linux). Intermediate stage diagnostics
        # are sent to /dev/null — the exit-code propagation through the
        # pipe still surfaces failures.
        stderr=subprocess.PIPE if is_last else subprocess.DEVNULL,
        text=True,
        shell=False,
      )
      if prev:
        prev.stdout.close()
      procs.append(proc)
      prev = proc
  except (FileNotFoundError, OSError) as e:
    # Manifest references a binary that doesn't exist or can't be spawned.
    # Reap whatever started successfully; return a controlled 127-style
    # error rather than letting it surface as HTTP 500.
    for p in procs:
      try:
        p.kill()
      except OSError:
        pass
    for p in procs:
      p.wait()
    return 127, '', f"failed to spawn process: {e}"

  try:
    out, err = prev.communicate(timeout=action_timeout)
  except subprocess.TimeoutExpired:
    # Kill all stages and reap them before re-raising. communicate()
    # does not kill on timeout, and the single-threaded server can't
    # afford orphaned children accumulating across requests.
    for p in procs:
      p.kill()
    for p in procs:
      p.wait()
    raise
  for p in procs[:-1]:
    p.wait()

  # Pipefail-style returncode: surface the first non-zero exit from any
  # stage. Without this, "false | cat" would return 0 because only the
  # last stage's returncode is the final pipeline status. Iterate
  # left-to-right; the leftmost non-zero is most informative for diagnosis.
  returncode = prev.returncode
  for p in procs:
    if p.returncode != 0:
      returncode = p.returncode
      break

  redir = action.get('redirect')
  if redir and returncode == 0:
    target = substitute(redir['file'], validated)
    if not target.startswith('/') or '..' in target.split('/'):
      return 1, '', f"redirect target rejected: {target}"
    mode = 'a' if redir.get('mode') == 'append' else 'w'
    with open(target, mode) as f:
      f.write(out)
    out = ''
  return returncode, out, err

class APIHandler(http.server.BaseHTTPRequestHandler):

  def do_POST(self):
    # Defence in depth: even though the server runs HTTP/1.0 (no
    # keep-alive by default), explicitly close the connection after
    # this request so that under-reported Content-Length cannot leave
    # bytes buffered on the socket where a future HTTP/1.1 upgrade
    # would let them be interpreted as a smuggled request.
    self.close_connection = True

    api_key = self.headers.get('Authorization', 'missing')

    # Require an explicit Content-Length on POST. Missing or malformed
    # values are rejected with 4xx instead of falling through to a
    # 0-byte read + JSON parse error, so the response code accurately
    # communicates which client-side mistake was made.
    raw_cl = self.headers.get('Content-Length')
    if raw_cl is None:
      response_message = {"status": "error", "error": "Content-Length header required"}
      logger(response_message['error'])
      self.send_response(411)
      self.send_header('Content-type', 'application/json')
      self.end_headers()
      self.wfile.write(json.dumps(response_message).encode('utf-8'))
      return
    try:
      content_length = int(raw_cl)
      if content_length < 0:
        raise ValueError('negative')
    except (TypeError, ValueError):
      response_message = {"status": "error", "error": "invalid Content-Length header"}
      logger(response_message['error'])
      self.send_response(400)
      self.send_header('Content-type', 'application/json')
      self.end_headers()
      self.wfile.write(json.dumps(response_message).encode('utf-8'))
      return

    # Reject oversized requests BEFORE reading the body. Previously
    # the read happened first and the size check came after, so a
    # caller (with the API key) could push arbitrary bytes into the
    # process before the limit triggered — and the limit didn't
    # actually short-circuit, it just set an error string and
    # processing continued.
    if content_length > DMS_API_SIZE:
      response_message = {"status": "error", "error": "data received is too large"}
      logger(response_message['error'])
      self.send_response(413)
      self.send_header('Content-type', 'application/json')
      self.end_headers()
      self.wfile.write(json.dumps(response_message).encode('utf-8'))
      return

    # We've already enforced content_length <= DMS_API_SIZE above, so
    # rfile.read(content_length) is bounded in size. Also apply a
    # short read timeout so a slow / partial-body client (slowloris
    # variant: send N declared, transmit fewer, pause) cannot hold
    # the single-threaded socketserver.TCPServer indefinitely. 5s
    # is generous for a body capped at DMS_API_SIZE (default 1 KiB).
    self.connection.settimeout(5)
    try:
      post_data = self.rfile.read(content_length)
    except socket.timeout:
      response_message = {"status": "error", "error": "request body read timed out"}
      logger(response_message['error'])
      self.send_response(408)
      self.send_header('Content-type', 'application/json')
      self.end_headers()
      self.wfile.write(json.dumps(response_message).encode('utf-8'))
      return
    finally:
      # Restore the connection to the (default) blocking mode for
      # whatever cleanup the handler does after the response.
      self.connection.settimeout(None)

    try:
      json_data = json.loads(post_data.decode('utf-8'))
      debugg(f"Received JSON data: {json_data}")

      if not isinstance(json_data, dict):
        response_message = {"status": "error", "error": "request body must be a JSON object"}
        logger(response_message['error'])
        self.send_response(400)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response_message).encode('utf-8'))
        return

      action_id = json_data.get('action')
      command = json_data.get('command')
      args = json_data.get('args', {})
      timeout = json_data.get('timeout', timeout_default)

      # Never log the configured DMS_API_KEY in full; show only a
      # fingerprint of the *received* key so failed-auth diagnosis
      # is still possible.
      debugg(f"Received API Key: {redact(api_key)}")
      debugg(f"Received action: {safe_id(action_id)}")
      debugg(f"Received command: {command}")
      debugg(f"Received timeout: {timeout}")

      # Reject malformed shapes early with a 400 instead of letting them
      # raise inside execute_action / dict lookup, which would surface
      # as a 500. action_id may be absent entirely (legacy command path);
      # when present it must be a string. args may be absent (defaults
      # to {}) but if present must be an object.
      if action_id is not None and not isinstance(action_id, str):
        response_message = {"status": "error", "error": "'action' must be a string"}
        logger(response_message['error'])
        self.send_response(400)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response_message).encode('utf-8'))
        return
      if not isinstance(args, dict):
        response_message = {"status": "error", "error": "'args' must be an object"}
        logger(response_message['error'])
        self.send_response(400)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response_message).encode('utf-8'))
        return

      # timeout must be a positive number (int or float, not bool)
      # capped at 600s so a runaway client can't pin a single-threaded
      # request handler indefinitely.
      try:
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)):
          raise ValueError('not numeric')
        if timeout <= 0 or timeout > 600:
          raise ValueError('out of range')
      except (TypeError, ValueError):
        response_message = {"status": "error", "error": "'timeout' must be a positive number ≤ 600"}
        logger(response_message['error'])
        self.send_response(400)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response_message).encode('utf-8'))
        return

      # Empty / whitespace-only action ids are explicit programming
      # errors, not "missing action" — reject them rather than silently
      # falling through to the legacy command path.
      if isinstance(action_id, str) and not action_id.strip():
        response_message = {"status": "error", "error": "'action' must be a non-empty string"}
        logger(response_message['error'])
        self.send_response(400)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response_message).encode('utf-8'))
        return

      if api_key == DMS_API_KEY:
        if action_id is not None:
          # New action protocol path.
          if action_id not in ACTIONS:
            logger(f"Rejected: unknown action '{safe_id(action_id)}'")
            response_message = {"status": "error", "error": f"unknown action: {action_id}"}
            self.send_response(403)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response_message).encode('utf-8'))
            return

          logger(f"Executing action: {safe_id(action_id)}")
          try:
            returncode, stdout, stderr = execute_action(ACTIONS[action_id], args, timeout)
            response_message = {
              "status": "success",
              'returncode': returncode,
              'stdout': stdout,
              'stderr': stderr
            }
          except subprocess.TimeoutExpired:
            response_message = {
              "status": "success",
              'returncode': 124,
              'stdout': '',
              'stderr': f"timeout after {timeout}s"
            }
          except (KeyError, ValueError) as e:
            response_message = {"status": "error", "error": str(e)}
            self.send_response(400)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response_message).encode('utf-8'))
            return

        elif command:
          # Legacy free-form command path. Removed in Sprint E once all
          # callers use the action protocol.
          try:
            logger(f"Executing command: {command}")

            def run_pipeline(cmd):
              """Run a single command or pipeline (supports | and > / >>).

              Tokenises with shlex.shlex(posix=True, punctuation_chars='|<>')
              so '|', '>' and '>>' are treated as operators while respecting
              quoting. Previously this used cmd.split('|') and similar
              character-level splits, which corrupted the pipeline whenever
              a quoted argument contained a literal '|' (e.g. a password
              like 'pa|ss') — the quote-aware split now keeps such pipes
              inside the argument they belong to.
              """
              lex = shlex.shlex(cmd, posix=True, punctuation_chars='|<>')
              lex.whitespace_split = True
              # shlex.shlex defaults commenters='#' (unlike shlex.split). DMS
              # commands legitimately contain '#' (header filters, doveadm
              # queries), so disable comment parsing to avoid silent
              # truncation of arguments at an unquoted '#'.
              lex.commenters = ''
              tokens = list(lex)

              # Split tokens into stages on '|' operators; pull out a
              # trailing redirect (> or >>) if present.
              stages = [[]]
              redir_file = None
              redir_mode = None
              i = 0
              while i < len(tokens):
                tok = tokens[i]
                if tok == '|':
                  stages.append([])
                elif tok in ('>', '>>'):
                  if i + 1 >= len(tokens):
                    return 1, '', f"redirect operator '{tok}' requires a filename"
                  if i + 2 < len(tokens):
                    # We only support a trailing redirect on the final
                    # pipeline stage. Mid-pipeline redirects (e.g.
                    # 'a > out | b') would have shell semantics we don't
                    # replicate (the redirect would attach to the LEFT
                    # process's stdout and break the pipe), so reject
                    # them rather than silently doing the wrong thing.
                    return 1, '', f"redirect operator '{tok}' must be the last operator in the command"
                  redir_mode = 'a' if tok == '>>' else 'w'
                  redir_file = tokens[i + 1]
                  i += 1  # consume filename token
                else:
                  stages[-1].append(tok)
                i += 1

              stages = [s for s in stages if s]
              if not stages:
                return 1, '', 'empty command'

              prev_proc = None
              procs = []
              num_stages = len(stages)
              for i, stage in enumerate(stages):
                stdin_src = prev_proc.stdout if prev_proc else None
                is_last = (i == num_stages - 1)
                proc = subprocess.Popen(stage,
                                        stdin=stdin_src,
                                        stdout=subprocess.PIPE,
                                        # Only the last stage's stderr is read;
                                        # intermediate stages would deadlock
                                        # the pipeline once the OS pipe buffer
                                        # fills (~64KB on Linux).
                                        stderr=subprocess.PIPE if is_last else subprocess.DEVNULL,
                                        text=True,
                                        shell=False)
                if prev_proc:
                  prev_proc.stdout.close()
                procs.append(proc)
                prev_proc = proc

              out, err = prev_proc.communicate(timeout=timeout)
              for p in procs[:-1]:
                p.wait()

              # Handle file redirection
              if redir_file and prev_proc.returncode == 0:
                with open(redir_file, redir_mode) as f:
                  f.write(out)
                out = ''

              return prev_proc.returncode, out, err

            # Split on && for command chaining
            chain = [c.strip() for c in command.split('&&')]
            stdout = ''
            stderr = ''
            returncode = 0

            for sub_cmd in chain:
              returncode, out, err = run_pipeline(sub_cmd)
              stdout += out
              stderr += err
              if returncode != 0:
                break

            debugg(f"result returncode: {returncode}")

            response_message = {
              "status": "success",
              'returncode': returncode,
              'stdout': stdout,
              'stderr': stderr
            }
            debugg(f"response_message: {response_message}")

          except Exception as e:
            response_message = {"status": "error", "error": str(e)}
            logger(response_message['error'])

        else:
          # Neither action nor command provided. Client error → 400.
          response_message = {"status": "error", "error": "no action or command was passed"}
          logger(response_message['error'])
          self.send_response(400)
          self.send_header('Content-type', 'application/json')
          self.end_headers()
          self.wfile.write(json.dumps(response_message).encode('utf-8'))
          return

      else:
        if DMS_API_KEY != 'missing':
          if api_key != 'missing':
            response_message = {"status": "error", "error": f"Invalid api_key: api_match: {redact(api_key)}"}
          else:
            response_message = {"status": "error", "error": f"Missing api_key: api_miss"}
        else:
          response_message = {"status": "error", "error": f"DMS api_key unset: api_unset"}
        logger(response_message['error'])

      # 5. Send a successful response
      self.send_response(200)
      self.send_header('Content-type', 'application/json')
      self.end_headers()
      #logger(f"response_message: {response_message}")
      self.wfile.write(json.dumps(response_message).encode('utf-8'))

    except json.JSONDecodeError:
      # 6. Handle invalid JSON
      self.send_response(400) # Bad Request
      self.send_header('Content-type', 'application/json')
      self.end_headers()
      response_message = {"status": "error", "error": "Invalid JSON format"}
      logger(f"response_message: {response_message}")
      self.wfile.write(json.dumps(response_message).encode('utf-8'))

    except Exception as e:
      # 7. Handle other potential errors
      self.send_response(500) # Internal Server Error
      self.send_header('Content-type', 'application/json')
      self.end_headers()
      response_message = {"status": "error", "error": str(e)}
      logger(f"response_message: {response_message}")
      self.wfile.write(json.dumps(response_message).encode('utf-8'))


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer((DMS_API_HOST, DMS_API_PORT), APIHandler) as httpd:
  logger(f"Serving at port {DMS_API_HOST}:{DMS_API_PORT}")
  httpd.serve_forever()
`,
    },
    cron: {
      desc: 'https://github.com/orgs/docker-mailserver/discussions/2908 - mount this to /etc/supervisor/conf.d/rest-api.conf',
      path: env.DMSGUI_CONFIG_PATH + '/rest-api.conf',
      content: `
[program:rest-api]
startsecs=1
stopwaitsecs=0
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisor/%(program_name)s.log
stderr_logfile=/var/log/supervisor/%(program_name)s.log
command=/usr/bin/python3 /tmp/docker-mailserver/dms-gui/rest-api.py
`,
    },
  },
};

// https://github.com/orgs/docker-mailserver/discussions/2908
// Much better to just use a supervisord service config like I had shown over a month ago:

// /etc/supervisor/conf.d/dms-api.conf:

// [program:dms-api]
// startsecs=5
// stopwaitsecs=0
// autostart=true
// autorestart=true
// stdout_logfile=/var/log/supervisor/%(program_name)s.log
// stderr_logfile=/var/log/supervisor/%(program_name)s.log
// command=/usr/bin/python3 /tmp/docker-mailserver/rest-api.py

// plugins are only for settings where isMutable=1 and not the environment where isMutable=0 or anything else
// TODO: plugins and schemas should be in their own table really
export const plugins = {
  'dms-gui': {
    DB_VERSION: {
      config: env.DMSGUI_VERSION,
      settings: env.DMSGUI_VERSION,
      logins: env.DMSGUI_VERSION,
      roles: env.DMSGUI_VERSION,
      accounts: env.DMSGUI_VERSION,
      aliases: env.DMSGUI_VERSION,
      domains: env.DMSGUI_VERSION,
      dns: env.DMSGUI_VERSION,
    },
  },

  // login: {
  //   profile: {
  //     mailbox:'mailbox',
  //     username:'username',
  //     email:'',
  //     salt:'',
  //     hash:'',
  //     isAdmin:0,
  //     isAccount:1,
  //     isActive:1,
  //     mailserver:'',
  //     roles:[],
  //   },

  mailserver: {
    dms: {
      keys: {
        containerName: 'containerName',
        protocol: 'protocol',
        host: 'containerName',
        port: 'DMS_API_PORT',
        Authorization: 'DMS_API_KEY',
        setupPath: 'setupPath',
        timeout: 'timeout',
      },
      defaults: {
        containerName: env.containerName,
        protocol: env.protocol,
        DMS_API_PORT: env.DMS_API_PORT,
        DMS_API_KEY: env.DMS_API_KEY,
        setupPath: env.DMS_SETUP_SCRIPT,
        timeout: env.timeout,
      },
    },
    dmsEnv: {
      DKIM_SELECTOR_DEFAULT: 'mail',
      ENABLE_MTA_STS: 1,
      ENABLE_RSPAMD: 1,
      DMS_RELEASE: 'v15.1.0',
      PERMIT_DOCKER: 'none',
      DOVECOT_MAILBOX_FORMAT: 'maildir',
      POSTFIX_MAILBOX_SIZE_LIMIT: 5242880000,
      TZ: 'UTC',
      DOVECOT_VERSION: '2.3.19.1',
      DOVECOT_FTS_PLUGIN: 'xapian',
      DOVECOT_FTS_AUTOINDEX: 'yes',
      DOVECOT_QUOTA: 1,
      DOVECOT_FTS: 1,
      DOVECOT_FTS_XAPIAN: 1,
      DOVECOT_ZLIB: 1,
      DKIM_ENABLED: 'true',
      DKIM_SELECTOR: 'dkim',
      DKIM_PATH:
        '/tmp/docker-mailserver/rspamd/dkim/rsa-2048-$selector-$domain.private.txt',
    },
  },

  dnscontrol: {
    cloudflare: {
      desc: 'https://developers.cloudflare.com/api/',
      TYPE: 'CLOUDFLAREAPI',
      apitoken: 'your-cloudflare-api-token',
    },
    domeneshop: {
      desc: 'https://api.domeneshop.no/docs/',
      TYPE: 'DOMAINNAMESHOP',
      token: 'your-api-token',
      secret: 'your-api-secret',
    },
    digitalocean: {
      desc: 'https://docs.digitalocean.com/reference/api/',
      TYPE: 'DIGITALOCEAN',
      apitoken: 'your-digitalocean-api-token',
    },
    hetzner: {
      desc: 'https://dns.hetzner.com/api-docs',
      TYPE: 'HETZNER',
      apitoken: 'your-hetzner-dns-api-token',
    },
  },
};

export const command = {
  'dms-gui': {
    'dms-gui': {
      kill: `sleep 1 && kill -9 $(pgrep "master process nginx")`,
    },
  },

  mailserver: {
    dms: {
      kill: `sleep 1 && kill -9 $(pgrep "supervisord")`,
    },
  },
};
