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
// Sprint A shipped an empty manifest. Sprint B populates it with the
// 12 actions accounts.mjs needs; Sprints C–E continue per-file as
// migration progresses.
// setup_path is supplied per-call from targetDict.setupPath (populated by
// getTargetDict() from the per-container settings DB, defaulting to
// env.DMS_SETUP_SCRIPT). This preserves per-container overrides via the
// settings UI that a hardcoded constant would silently ignore.

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
const BOX_VALIDATOR = {
  regex: '^[A-Za-z0-9._/*%?][A-Za-z0-9 ._/*%?\\-]*$',
  maxlen: 256,
};

export const REST_API_MANIFEST = [
  // ---- Setup-based actions ----
  {
    id: 'setup_email_list',
    argv: ['{setup_path}', 'email', 'list'],
    validate: {
      // setup_path is supplied by execAction callers from targetDict.setupPath,
      // which is the same source the legacy execSetup helper used. This keeps
      // per-container overrides via the settings UI working.
      setup_path: SETUP_PATH_VALIDATOR,
    },
  },
  {
    id: 'setup_email_add',
    argv: ['{setup_path}', 'email', 'add', '{mailbox}', '{password}'],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      mailbox: MAILBOX_VALIDATOR,
      password: { string: { minlen: 1, maxlen: 256 } },
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
    // Original shell form had '\\*' to escape the glob. With shell=False
    // the argv token is just the literal '*'.
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
      // Single field name (e.g. 'all', 'messages') OR a space-separated list.
      field: { regex: '^[a-z_]+(?: [a-z_]+)*$', maxlen: 128 },
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
];
