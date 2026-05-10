// Source of truth for the rest-api.py action protocol.
//
// Each entry declares one action that rest-api.py will accept. The
// interpreter (in backend/env.mjs's rest-api.py template) builds an
// argv list from the entry's `argv` or `pipeline` template by token-
// level substitution of {placeholder} occurrences with validated args,
// then runs it via subprocess.Popen(shell=False). There is no shell
// interpretation at any point in the pipeline.
//
// Schema:
//   { id:        string                — unique snake_case identifier
//     argv:      string[]              — single-stage argv template (one of argv/pipeline required)
//     pipeline:  [{argv: string[]}]    — multi-stage argv pipeline (stdin chained)
//     validate:  { <name>: <validator> } — per-arg validation rules
//     redirect:  { mode: 'write'|'append', file: <path-template> } — optional file redirect
//   }
//
// setup_path is supplied per-call from targetDict.setupPath (populated by
// getTargetDict() from the per-container settings DB, defaulting to
// env.DMS_SETUP_SCRIPT). This preserves per-container overrides via the
// settings UI that a hardcoded constant would silently ignore.

import './envBootstrap.mjs';

// DMS config path — the directory where postfix-regexp.cf lives. Read
// from process.env directly (rather than ./env.mjs) to avoid the
// circular import that env.mjs ↔ restApiManifest.mjs would otherwise
// cause. Default matches env.mjs's DMS_CONFIG_PATH default.
const DMS_CONFIG_PATH = process.env.DMS_CONFIG_PATH || '/tmp/docker-mailserver';
const POSTFIX_REGEXP_FILE = `${DMS_CONFIG_PATH}/postfix-regexp.cf`;

// Validator presets reused across multiple actions. Centralised here so
// regex tweaks (e.g. aligning with common.mjs regexEmailStrict) are made
// in one place rather than fanned across every action that takes a
// mailbox/box/setup_path arg.
//
// Mailbox regex aligned with regexEmailStrict from common.mjs — accepts
// 'user@domain' (no TLD required) so local-only setups work, but still
// rejects whitespace, '@'-in-local-part, and other malformed shapes.
const MAILBOX_VALIDATOR = {
  regex: '^[\\w.\\-_]+@[\\w.\\-_]+$',
  maxlen: 254,
};
// setup.sh path. Absolute path; no consecutive dots (no `..` traversal,
// no `foo..bar` shapes). Path segments are alphanumeric+_-, optionally
// with `.ext` suffixes (e.g. setup.sh) — the structure positively
// matches "valid path" rather than negatively rejecting `..`, which
// closes lookahead-bypass corner cases.
const SETUP_PATH_VALIDATOR = {
  regex:
    '^/[A-Za-z0-9_-]+(\\.[A-Za-z0-9_-]+)*(/[A-Za-z0-9_-]+(\\.[A-Za-z0-9_-]+)*)*$',
  maxlen: 256,
};
// dovecot folder names + mask patterns: alphanumeric + ./-_ + slash + space + glob chars (* % ?).
// Leading '-' / space disallowed to prevent the value from being parsed
// as an option flag by doveadm when positional.
//
// Note: this regex DOES allow '..' sequences (e.g. 'INBOX/../Private').
// Unlike SETUP_PATH_VALIDATOR — which guards a filesystem path —
// dovecot mailbox names are flat strings interpreted by the namespace
// mapping, NOT by the filesystem. '..' has no special meaning to
// doveadm; it's just two dots. doveadm will reject invalid mailbox
// references at the dovecot layer if the mailbox doesn't exist.
const BOX_VALIDATOR = {
  regex: '^[A-Za-z0-9._/*%?][A-Za-z0-9 ._/*%?\\-]*$',
  maxlen: 256,
};
// Postfix-regex source/destination line for printf+append. The whole
// "<src> <dst>" line is passed as a single argv token.
//
// Validation policy: forbid characters that would corrupt the file
// (C0 controls including newline/CR/NUL, DEL, C1 controls, and the
// Unicode line/paragraph separators U+2028/U+2029 — all of these can
// split a single line into multiple lines when the file is read back).
// Also forbid leading '-' / space as option-injection defense for the
// `printf` and `awk` invocations that consume this value as an argv
// token. Regex metacharacters (^, $, ., *, +, ?, (, ), [, ], {, }, |,
// \, /) are allowed because postfix-regexp SOURCES contain them by
// design.
const POSTFIX_REGEXP_LINE_VALIDATOR = {
  regex: '^[^-\\s][^\\x00-\\x1f\\x7f-\\x9f\\u2028\\u2029]*$',
  maxlen: 512,
};
// Per-request id used to namespace the regex-alias-delete tmp file so
// concurrent deletes don't clobber each other's intermediate state.
// Caller generates a random hex string (e.g. crypto.randomBytes(12).toString('hex'))
// — the regex restricts to hex digits to match the contract and keep
// the filename namespace tight.
const TMP_ID_VALIDATOR = {
  regex: '^[a-f0-9]{16,32}$',
  maxlen: 32,
};
// Generic 'short string' for things like alias source/destination
// (where they're already constrained at the route layer to be email
// shapes, but we add a manifest-level tight check too).
const ALIAS_SOURCE_VALIDATOR = MAILBOX_VALIDATOR;
const ALIAS_DESTINATION_VALIDATOR = MAILBOX_VALIDATOR;
// Sieve script as base64. RFC 4648 alphabet: A-Z a-z 0-9 + / =.
// Cap at 64 KB encoded (≈48 KB decoded) — well above any reasonable
// sieve filter size, well below the rest-api's DMS_API_SIZE limit.
const SIEVE_SCRIPT_B64_VALIDATOR = {
  regex: '^[A-Za-z0-9+/=]+$',
  maxlen: 65536,
};
// Generic password validator. Used by setup_email_add and doveadm_auth_test.
// Forbids C0 controls (except tab), DEL, and C1 controls. NUL in
// particular would otherwise pass length validation but then crash
// Python's subprocess argv construction with "embedded null byte".
// `+` (one-or-more) replaces the previous string validator's minlen=1.
const PASSWORD_VALIDATOR = {
  regex: '^[^\\x00-\\x08\\x0a-\\x1f\\x7f-\\x9f]+$',
  maxlen: 256,
};

export const REST_API_MANIFEST = [
  // ---- Setup-based actions ----
  {
    id: 'setup_email_list',
    argv: ['{setup_path}', 'email', 'list'],
    validate: {
      // setup_path is supplied by execAction callers from targetDict.setupPath,
      // so per-container overrides via the settings UI keep working.
      setup_path: SETUP_PATH_VALIDATOR,
    },
  },
  {
    id: 'setup_email_add',
    argv: ['{setup_path}', 'email', 'add', '{mailbox}', '{password}'],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      mailbox: MAILBOX_VALIDATOR,
      password: PASSWORD_VALIDATOR,
    },
  },
  {
    id: 'setup_email_del',
    argv: ['{setup_path}', 'email', 'del', '-y', '{mailbox}'],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      mailbox: MAILBOX_VALIDATOR,
    },
  },
  {
    id: 'setup_quota_del',
    argv: ['{setup_path}', 'quota', 'del', '{mailbox}'],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      mailbox: MAILBOX_VALIDATOR,
    },
  },
  {
    id: 'setup_quota_set',
    argv: ['{setup_path}', 'quota', 'set', '{mailbox}', '{quota}'],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      mailbox: MAILBOX_VALIDATOR,
      // setup quota set accepts strings like '1G', '500M', or 'unlimited'.
      quota: { regex: '^(?:[0-9]+[BKMGT]?|unlimited)$', maxlen: 16 },
    },
  },

  // ---- doveadm-based actions ----
  {
    id: 'doveadm_index',
    // The token is the literal '*' (no shell expansion under shell=False).
    argv: ['doveadm', 'index', '-u', '{mailbox}', '-q', '*'],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
    },
  },
  {
    id: 'doveadm_mailbox_list',
    argv: ['doveadm', 'mailbox', 'list', '-u', '{mailbox}'],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
    },
  },
  {
    id: 'doveadm_mailbox_list_subscribed',
    argv: ['doveadm', 'mailbox', 'list', '-u', '{mailbox}', '-s'],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
    },
  },
  {
    id: 'doveadm_mailbox_metadata_list',
    argv: [
      'doveadm',
      'mailbox',
      'metadata',
      'list',
      '-p',
      '-u',
      '{mailbox}',
      '{box}',
    ],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
      // dovecot folder names + mask patterns: alphanumeric + ./-_ + slash for hierarchy + space + glob chars (* % ?).
      // Leading '-' / space disallowed to prevent the value from being parsed
      // as an option flag by doveadm when positional (defense in depth — even
      // though shell=False is in effect, doveadm's own getopt sees the token).
      box: BOX_VALIDATOR,
    },
  },
  {
    id: 'doveadm_mailbox_status',
    argv: [
      'doveadm',
      'mailbox',
      'status',
      '-u',
      '{mailbox}',
      '{field}',
      '{box}',
    ],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
      // Single field name only (e.g. 'all', 'messages', 'vsize'). The
      // action protocol substitutes {field} as ONE argv token; a
      // space-separated list (`'messages recent'`) would arrive at
      // doveadm as a single argument with an embedded space rather
      // than multiple positional args. If multi-field support is ever
      // needed, model it as a distinct action with a multi-stage argv
      // template (or extend the protocol to support array placeholders).
      field: { regex: '^[a-z_]+$', maxlen: 64 },
      // Leading '-' / space disallowed to prevent the value from being parsed
      // as an option flag by doveadm when positional (defense in depth — even
      // though shell=False is in effect, doveadm's own getopt sees the token).
      box: BOX_VALIDATOR,
    },
  },
  {
    id: 'doveadm_force_resync',
    argv: [
      'doveadm',
      'force-resync',
      '-u',
      '{mailbox}',
      '--mailbox-mask',
      '{box}',
    ],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
      // Leading '-' / space disallowed to prevent the value from being parsed
      // as an option flag by doveadm when positional (defense in depth — even
      // though shell=False is in effect, doveadm's own getopt sees the token).
      box: BOX_VALIDATOR,
    },
  },
  {
    id: 'doveadm_quota_get',
    argv: ['doveadm', 'quota', 'get', '-u', '{mailbox}'],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
    },
  },

  // ---- aliases.mjs actions ----
  {
    id: 'setup_alias_list',
    argv: ['{setup_path}', 'alias', 'list'],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
    },
  },
  {
    id: 'setup_alias_add',
    argv: ['{setup_path}', 'alias', 'add', '{source}', '{destination}'],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      source: ALIAS_SOURCE_VALIDATOR,
      destination: ALIAS_DESTINATION_VALIDATOR,
    },
  },
  {
    id: 'setup_alias_del',
    argv: ['{setup_path}', 'alias', 'del', '{source}', '{destination}'],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      source: ALIAS_SOURCE_VALIDATOR,
      destination: ALIAS_DESTINATION_VALIDATOR,
    },
  },
  {
    // Read the postfix regex aliases file.
    id: 'cat_postfix_regexp',
    argv: ['cat', POSTFIX_REGEXP_FILE],
  },
  {
    // Append a postfix-regex alias line to the file.
    // line is a free-form string; constrained server-side and at the
    // route layer (the JS caller composes "<src> <dst>" before the call).
    id: 'postfix_regexp_append',
    // printf '%s\n' is option-safe — the format arg is fixed, the data
    // arg is always treated as content. Replaces a previous `echo {line}`
    // which would interpret `{line}` as flags if it started with '-'.
    // The validator already disallows leading '-', but layering both is cheap.
    argv: ['printf', '%s\\n', '{line}'],
    redirect: {
      mode: 'append',
      file: POSTFIX_REGEXP_FILE,
    },
    validate: {
      line: POSTFIX_REGEXP_LINE_VALIDATOR,
    },
  },
  {
    // Filter a line OUT of the postfix-regex file by writing the
    // remaining content to a per-request tmp file (intermediate file).
    // The legacy code did `grep -Fv X file > /tmp/file && mv /tmp/file file`
    // for atomic-ish replace; the action protocol splits this into two
    // sequential calls (this one + tmp_postfix_regexp_to_final).
    //
    // awk replaces the legacy `grep -Fv` here: awk exits 0 even when
    // output is empty (i.e. the last remaining regex alias is deleted),
    // whereas GNU grep exits 1 on no-match — the legacy grep form silently
    // failed on "delete last regex alias" because callers treated exit 1
    // as a hard failure and skipped the mv+reload steps.
    //
    // The tmp filename is parameterised with {tmp_id} (a per-request
    // random hex string) so two concurrent deletes don't clobber each
    // other's intermediate state between the filter and mv steps.
    id: 'postfix_regexp_filter_to_tmp',
    // awk program: keep lines where the substring p (passed via -v) is
    // NOT found. `index($0, p) == 0` is the awk equivalent of grep -Fv.
    argv: ['awk', '-v', 'p={line}', 'index($0, p) == 0', POSTFIX_REGEXP_FILE],
    redirect: {
      mode: 'write',
      file: '/tmp/postfix-regexp.cf.{tmp_id}',
    },
    validate: {
      line: POSTFIX_REGEXP_LINE_VALIDATOR,
      tmp_id: TMP_ID_VALIDATOR,
    },
  },
  {
    // Atomically replace the postfix-regex file with the filtered tmp.
    // Pairs with postfix_regexp_filter_to_tmp. Uses the same {tmp_id}
    // so the mv targets the correct per-request intermediate file.
    id: 'tmp_postfix_regexp_to_final',
    argv: ['mv', '/tmp/postfix-regexp.cf.{tmp_id}', POSTFIX_REGEXP_FILE],
    validate: {
      tmp_id: TMP_ID_VALIDATOR,
    },
  },
  {
    id: 'postfix_reload',
    argv: ['postfix', 'reload'],
  },

  // ---- sieve.mjs actions ----
  {
    id: 'doveadm_sieve_list',
    argv: ['doveadm', 'sieve', 'list', '-u', '{mailbox}'],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
    },
  },
  {
    // The sieve script slot is the constant 'roundcube' (the dms-gui
    // UI only manages roundcube's filter; that's fixed, not a parameter).
    id: 'doveadm_sieve_get',
    argv: ['doveadm', 'sieve', 'get', '-u', '{mailbox}', 'roundcube'],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
    },
  },
  {
    // sieve put receives the script via stdin: the JS caller base64-encodes
    // the script first; the pipeline echoes the b64, decodes it, and pipes
    // the raw script into doveadm sieve put. Three stages:
    //   echo {b64} | base64 -d | doveadm sieve put -u {mailbox} roundcube
    id: 'doveadm_sieve_put',
    pipeline: [
      { argv: ['echo', '{b64}'] },
      { argv: ['base64', '-d'] },
      { argv: ['doveadm', 'sieve', 'put', '-u', '{mailbox}', 'roundcube'] },
    ],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
      b64: SIEVE_SCRIPT_B64_VALIDATOR,
    },
  },
  {
    id: 'doveadm_sieve_activate',
    argv: ['doveadm', 'sieve', 'activate', '-u', '{mailbox}', 'roundcube'],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
    },
  },
  {
    id: 'doveadm_sieve_deactivate',
    argv: ['doveadm', 'sieve', 'deactivate', '-u', '{mailbox}'],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
    },
  },
  {
    id: 'doveadm_sieve_delete',
    argv: ['doveadm', 'sieve', 'delete', '-u', '{mailbox}', 'roundcube'],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
    },
  },

  // ---- logins.mjs actions ----
  {
    // Used to verify a user's DMS dovecot password during dms-gui login.
    id: 'doveadm_auth_test',
    argv: ['doveadm', 'auth', 'test', '{mailbox}', '{password}'],
    validate: {
      mailbox: MAILBOX_VALIDATOR,
      password: PASSWORD_VALIDATOR,
    },
  },
];
