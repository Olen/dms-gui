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
// Sprint A ships an empty manifest. Sprints B–E populate it as
// individual call sites migrate from the legacy {command:} protocol.
// setup_path is supplied per-call from targetDict.setupPath (populated by
// getTargetDict() from the per-container settings DB, defaulting to
// env.DMS_SETUP_SCRIPT). This preserves per-container overrides via the
// settings UI that a hardcoded constant would silently ignore.

export const REST_API_MANIFEST = [
  // ---- Setup-based actions ----
  {
    id: 'setup_email_list',
    argv: ['{setup_path}', 'email', 'list'],
    validate: {
      // setup_path is supplied by execAction callers from targetDict.setupPath,
      // which is the same source the legacy execSetup helper used. This keeps
      // per-container overrides via the settings UI working.
      setup_path: { regex: '^/[A-Za-z0-9./_-]+$', maxlen: 256 },
    },
  },
  {
    id: 'setup_email_add',
    argv: ['{setup_path}', 'email', 'add', '{mailbox}', '{password}'],
    validate: {
      setup_path: { regex: '^/[A-Za-z0-9./_-]+$', maxlen: 256 },
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
      password: { string: { minlen: 1, maxlen: 256 } },
    },
  },
  {
    id: 'setup_email_del',
    argv: ['{setup_path}', 'email', 'del', '-y', '{mailbox}'],
    validate: {
      setup_path: { regex: '^/[A-Za-z0-9./_-]+$', maxlen: 256 },
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
    },
  },
  {
    id: 'setup_quota_del',
    argv: ['{setup_path}', 'quota', 'del', '{mailbox}'],
    validate: {
      setup_path: { regex: '^/[A-Za-z0-9./_-]+$', maxlen: 256 },
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
    },
  },
  {
    id: 'setup_quota_set',
    argv: ['{setup_path}', 'quota', 'set', '{mailbox}', '{quota}'],
    validate: {
      setup_path: { regex: '^/[A-Za-z0-9./_-]+$', maxlen: 256 },
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
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
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
    },
  },
  {
    id: 'doveadm_mailbox_list',
    argv: ['doveadm', 'mailbox', 'list', '-u', '{mailbox}'],
    validate: {
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
    },
  },
  {
    id: 'doveadm_mailbox_list_subscribed',
    argv: ['doveadm', 'mailbox', 'list', '-u', '{mailbox}', '-s'],
    validate: {
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
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
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
      // dovecot folder names + mask patterns: alphanumeric + ./-_ + slash for hierarchy + space + glob chars (* % ?).
      // Leading '-' / space disallowed to prevent the value from being parsed
      // as an option flag by doveadm when positional (defense in depth — even
      // though shell=False is in effect, doveadm's own getopt sees the token).
      box: { regex: '^[A-Za-z0-9._/*%?][A-Za-z0-9 ._/*%?\\-]*$', maxlen: 256 },
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
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
      // Single field name (e.g. 'all', 'messages') OR a space-separated list.
      field: { regex: '^[a-z_]+(?: [a-z_]+)*$', maxlen: 128 },
      // Leading '-' / space disallowed to prevent the value from being parsed
      // as an option flag by doveadm when positional (defense in depth — even
      // though shell=False is in effect, doveadm's own getopt sees the token).
      box: { regex: '^[A-Za-z0-9._/*%?][A-Za-z0-9 ._/*%?\\-]*$', maxlen: 256 },
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
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
      // Leading '-' / space disallowed to prevent the value from being parsed
      // as an option flag by doveadm when positional (defense in depth — even
      // though shell=False is in effect, doveadm's own getopt sees the token).
      box: { regex: '^[A-Za-z0-9._/*%?][A-Za-z0-9 ._/*%?\\-]*$', maxlen: 256 },
    },
  },
  {
    id: 'doveadm_quota_get',
    argv: ['doveadm', 'quota', 'get', '-u', '{mailbox}'],
    validate: {
      mailbox: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxlen: 254 },
    },
  },
];
