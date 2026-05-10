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

// DKIM keytype validators are split per-action so the action allowlist
// matches the command shape: an RSA-only action with `keysize` baked
// into argv must reject `keytype=ed25519` outright, and an ed25519-only
// action without `keysize` must reject `keytype=rsa`.
const KEYTYPE_RSA_VALIDATOR = { enum: ['rsa'] };
const KEYTYPE_NORSA_VALIDATOR = { enum: ['ed25519'] };
// DKIM keysize: accepts 1024, 2048, or 4096 (generateDkim validates all three).
const KEYSIZE_VALIDATOR = { enum: ['1024', '2048', '4096'] };
// DKIM selector: lowercase alphanumeric + hyphen + underscore, per RFC 6376.
const SELECTOR_VALIDATOR = { regex: '^[a-z0-9_-]+$', maxlen: 64 };
// DNS domain name: RFC 1035-style hostname labels (alphanumeric + internal
// hyphens) separated by single dots. Consecutive dots and leading/trailing
// dots/hyphens are not matched, so `..`, `.example.com`, `example..com`,
// `-bad.com`, and `bad-.com` are all rejected.
const DOMAIN_VALIDATOR = {
  regex:
    '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$',
  maxlen: 253,
};
// Email Message-ID: covers RFC 5322 atom-text characters (including `/`, `!`,
// `~`, `|`, backtick) plus the structural `@` and `.` and optional `<>`.
// Aligns with real-world IDs from Exchange and other MTAs that use `/`.
// Brackets must be balanced — either fully wrapped in '<...>' or no
// brackets at all. A simple `^<?...>?$` form would accept `<abc` or
// `abc>`, which are not valid Message-IDs.
const MESSAGE_ID_VALIDATOR = {
  regex:
    "^(?:<[A-Za-z0-9!#$%&'*+/=?^_`{|}~.\\-@]+>|[A-Za-z0-9!#$%&'*+/=?^_`{|}~.\\-@]+)$",
  maxlen: 1024,
};
// Helper: escape regex metacharacters in a literal string so it can be
// embedded in a regex pattern. DMS_CONFIG_PATH is operator-set; if it
// contains regex metachars (e.g. '.'), the unescaped form would over-match.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// DKIM keys subtree base. Operators with custom DMS_CONFIG_PATH get the
// resolved path; default /tmp/docker-mailserver works unchanged.
const DKIM_BASE = `${DMS_CONFIG_PATH}/rspamd/dkim`;
const DKIM_BASE_RE = escapeRegex(DKIM_BASE);

// DKIM keys tree: absolute paths under the rspamd dkim base directory.
// Positive-match grammar: segments are [A-Za-z0-9_-] with optional `.ext`
// suffixes. Consecutive dots are structurally impossible → `..` traversal
// blocked. Mirrors SETUP_PATH_VALIDATOR.
// The trailing `*` (rather than `+`) allows the base dir itself to
// match, so ls_dir on the DKIM base directory works.
//
// maxlen sized for `${DMS_CONFIG_PATH}/rspamd/dkim/keys/<253-char-domain>/<file>`:
// a 253-char DNS label (RFC 1035 maximum) plus a long base path and filename
// must still fit. 1024 leaves margin without inviting pathological backtracking.
const DKIM_DIR_VALIDATOR = {
  regex: `^${DKIM_BASE_RE}(/[A-Za-z0-9_-]+(\\.[A-Za-z0-9_-]+)*)*$`,
  maxlen: 1024,
};
// Same positive-match grammar as DKIM_DIR_VALIDATOR; both are paths under
// the dkim subtree with the same shape (a file path is also a valid dir path
// candidate). Aliased for semantic clarity at call sites.
const DKIM_KEY_PATH_VALIDATOR = DKIM_DIR_VALIDATOR;

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

  // ---- settings.mjs: logs ----

  // Tail a DMS log file. `logfile` is constrained to the two paths that
  // getMailLogs supplies; `lines` uses the interpreter's int validator
  // with the same bounds getMailLogs caps the JS side at (min 10, max 500),
  // so the manifest is the single source of truth for the limit rather
  // than mirroring it in two places that could drift.
  {
    id: 'tail_log',
    argv: ['tail', '-n', '{lines}', '{logfile}'],
    validate: {
      lines: { int: { min: 10, max: 500 } },
      logfile: {
        enum: ['/var/log/mail/mail.log', '/var/log/mail/rspamd.log'],
      },
    },
  },
  // Two-stage pipeline: grep bounce/defer lines then cap at 500 (no params).
  {
    id: 'grep_postfix_bounces',
    pipeline: [
      {
        argv: [
          'grep',
          '-e',
          'postfix/smtp.*status=bounced',
          '-e',
          'postfix/smtp.*status=deferred',
          '/var/log/mail/mail.log',
        ],
      },
      { argv: ['tail', '-500'] },
    ],
  },

  // ---- settings.mjs: system dashboard ----

  // df disk usage for /var/mail, piped through awk (two-stage, fixed).
  {
    id: 'df_var_mail',
    pipeline: [
      { argv: ['df', '-BM', '/var/mail'] },
      { argv: ['awk', 'NR==2{print $3+0, $2+0, $5+0}'] },
    ],
  },
  // top CPU/memory snapshot (three-stage, fixed). `-d1` = 1-second delay,
  // `-bn2` = two iterations (second iteration has stable averages).
  {
    id: 'top_summary',
    pipeline: [
      { argv: ['top', '-bn2', '-d1'] },
      { argv: ['grep', '-A4', '^top'] },
      { argv: ['tail', '-5'] },
    ],
  },
  // Container uptime in seconds: elapsed time of PID 1 (dumb-init / init).
  {
    id: 'ps_init_uptime',
    argv: ['ps', '-o', 'etimes=', '-p', '1'],
  },

  // ---- settings.mjs: setup additions ----

  // `setup help` — used by getServerStatus to probe the DMS setup script.
  {
    id: 'setup_help',
    argv: ['{setup_path}', 'help'],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
    },
  },
  // Generate RSA DKIM key (keysize required for rsa).
  {
    id: 'setup_dkim_generate_rsa',
    argv: [
      '{setup_path}',
      'config',
      'dkim',
      'keytype',
      '{keytype}',
      'keysize',
      '{keysize}',
      'selector',
      '{selector}',
      'domain',
      '{domain}',
    ],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      keytype: KEYTYPE_RSA_VALIDATOR,
      keysize: KEYSIZE_VALIDATOR,
      selector: SELECTOR_VALIDATOR,
      domain: DOMAIN_VALIDATOR,
    },
  },
  // Same as setup_dkim_generate_rsa but with trailing --force flag.
  {
    id: 'setup_dkim_generate_rsa_force',
    argv: [
      '{setup_path}',
      'config',
      'dkim',
      'keytype',
      '{keytype}',
      'keysize',
      '{keysize}',
      'selector',
      '{selector}',
      'domain',
      '{domain}',
      '--force',
    ],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      keytype: KEYTYPE_RSA_VALIDATOR,
      keysize: KEYSIZE_VALIDATOR,
      selector: SELECTOR_VALIDATOR,
      domain: DOMAIN_VALIDATOR,
    },
  },
  // Generate non-RSA DKIM key (no keysize arg; keytype must not be 'rsa').
  {
    id: 'setup_dkim_generate',
    argv: [
      '{setup_path}',
      'config',
      'dkim',
      'keytype',
      '{keytype}',
      'selector',
      '{selector}',
      'domain',
      '{domain}',
    ],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      keytype: KEYTYPE_NORSA_VALIDATOR,
      selector: SELECTOR_VALIDATOR,
      domain: DOMAIN_VALIDATOR,
    },
  },
  // Same as setup_dkim_generate but with trailing --force flag.
  {
    id: 'setup_dkim_generate_force',
    argv: [
      '{setup_path}',
      'config',
      'dkim',
      'keytype',
      '{keytype}',
      'selector',
      '{selector}',
      'domain',
      '{domain}',
      '--force',
    ],
    validate: {
      setup_path: SETUP_PATH_VALIDATOR,
      keytype: KEYTYPE_NORSA_VALIDATOR,
      selector: SELECTOR_VALIDATOR,
      domain: DOMAIN_VALIDATOR,
    },
  },

  // ---- settings.mjs: dovecot/rspamd config readers ----

  // Dump all dovecot config; no args.
  {
    id: 'doveconf_dump',
    argv: ['doveconf'],
  },
  // Dovecot version string; no args.
  {
    id: 'dovecot_version',
    argv: ['dovecot', '--version'],
  },

  // ---- settings.mjs: cat rspamd config files ----

  // Read one rspamd config file. Path is constrained to a fixed enum of
  // known safe paths. The DMS_CONFIG_PATH default is /tmp/docker-mailserver.
  {
    id: 'cat_rspamd_config',
    argv: ['cat', '{path}'],
    validate: {
      path: {
        enum: [
          '/etc/rspamd/override.d/dkim_signing.conf',
          '/etc/rspamd/local.d/dkim_signing.conf',
          '/etc/rspamd/override.d/actions.conf',
          '/etc/rspamd/local.d/actions.conf',
          '/etc/rspamd/local.d/classifier-bayes.conf',
          '/etc/rspamd/override.d/classifier-bayes.conf',
          `${DMS_CONFIG_PATH}/rspamd/override.d/dkim_signing.conf`,
        ],
      },
    },
  },

  // ---- settings.mjs: env ----

  // Print container env; no args. Used by pullServerEnvs.
  {
    id: 'print_env',
    argv: ['env'],
  },

  // ---- settings.mjs: rspamd HTTP ----

  // Rspamd stat endpoint (fixed, no args).
  {
    id: 'curl_rspamd_stat',
    argv: ['curl', '-sf', 'http://localhost:11334/stat'],
  },
  // Rspamd full history (fixed, no args).
  // Query params are passed via -G --data to avoid embedding '&' (a shell
  // operator character) directly in the URL argv token. curl -G appends
  // --data values as URL query params, producing the same request as
  // passing '?from=0&to=999' inline.
  {
    id: 'curl_rspamd_history',
    argv: [
      'curl',
      '-sf',
      '-G',
      '--data',
      'from=0',
      '--data',
      'to=999',
      'http://localhost:11334/history',
    ],
  },

  // ---- settings.mjs: Redis Bayes EVAL ----

  // Single Redis EVAL that lists per-user Bayes learn counts. The Lua script
  // is baked in verbatim (after the .replace(/\n\s*/g,' ').trim() applied in
  // settings.mjs). No per-call substitution needed.
  {
    id: 'redis_eval_bayes_users',
    argv: [
      'redis-cli',
      '--no-auth-warning',
      '--raw', // preserve newlines in output; without this redis-cli escapes them as backslash-n, breaking JS .split('\n')
      'EVAL',
      "local result = {} local keys = redis.call('KEYS', 'RS*') for _, k in ipairs(keys) do local user = k:sub(3) if user:find('@') and not user:find('_[%dA-Fa-f]') then local ham = redis.call('HGET', k, 'learns_ham') or '0' local spam = redis.call('HGET', k, 'learns_spam') or '0' table.insert(result, user .. ' ' .. ham .. ' ' .. spam) end end table.sort(result) return table.concat(result, '\\n')",
      '0',
    ],
  },

  // ---- settings.mjs: rspamd-learn pipeline ----

  // Three-stage pipeline: doveadm fetch | tail (strip first line) | curl learn.
  // Used by rspamdLearnMessage to feed a raw message into rspamd's learn endpoint.
  // No `-w '%{http_code}'` flag: that format string contains `{http_code}`
  // which the interpreter would parse as a placeholder. HTTP failure is
  // detected from curl's exit code (`-sf` makes curl exit non-zero on
  // 4xx/5xx) instead of by parsing the status off stdout.
  {
    id: 'rspamd_learn',
    pipeline: [
      {
        argv: [
          'doveadm',
          'fetch',
          '-u',
          '{user}',
          'text',
          'mailbox-guid',
          '{guid}',
          'uid',
          '{uid}',
        ],
      },
      { argv: ['tail', '-n', '+2'] },
      {
        argv: [
          'curl',
          '-sf',
          '-o',
          '/dev/null',
          '-H',
          'Deliver-To: {user}',
          '--data-binary',
          '@-',
          'http://localhost:11334/learn{action}',
        ],
      },
    ],
    validate: {
      user: MAILBOX_VALIDATOR,
      guid: { regex: '^[0-9a-fA-F]+$', maxlen: 64 },
      uid: { int: { min: 1, max: 9999999 } },
      action: { enum: ['ham', 'spam'] },
    },
  },
  // Same as rspamd_learn but posts to the unlearn URL variant.
  {
    id: 'rspamd_unlearn',
    pipeline: [
      {
        argv: [
          'doveadm',
          'fetch',
          '-u',
          '{user}',
          'text',
          'mailbox-guid',
          '{guid}',
          'uid',
          '{uid}',
        ],
      },
      { argv: ['tail', '-n', '+2'] },
      {
        argv: [
          'curl',
          '-sf',
          '-o',
          '/dev/null',
          '-H',
          'Deliver-To: {user}',
          '--data-binary',
          '@-',
          'http://localhost:11334/learn{action}?unlearn=1',
        ],
      },
    ],
    validate: {
      user: MAILBOX_VALIDATOR,
      guid: { regex: '^[0-9a-fA-F]+$', maxlen: 64 },
      uid: { int: { min: 1, max: 9999999 } },
      action: { enum: ['ham', 'spam'] },
    },
  },

  // ---- settings.mjs: doveadm queries ----

  // Search all mailboxes for a message by Message-ID header.
  {
    id: 'doveadm_search_message_id',
    argv: ['doveadm', 'search', '-A', 'header', 'message-id', '{message_id}'],
    validate: {
      message_id: MESSAGE_ID_VALIDATOR,
    },
  },
  // List active Dovecot IMAP/POP3 sessions; no args.
  {
    id: 'doveadm_who',
    argv: ['doveadm', 'who'],
  },

  // ---- settings.mjs: DKIM key discovery ----

  // List directory contents (used to discover domains from DKIM keys dir).
  // `dir` is constrained to the rspamd dkim subtree.
  {
    id: 'ls_dir',
    argv: ['ls', '-1', '{dir}'],
    validate: {
      dir: DKIM_DIR_VALIDATOR,
    },
  },
  // Two-stage: inspect a DKIM private key then extract only the first line.
  // `keypath` is constrained to the rspamd dkim subtree.
  {
    id: 'openssl_pkey_inspect',
    pipeline: [
      {
        argv: ['openssl', 'pkey', '-in', '{keypath}', '-text', '-noout'],
      },
      { argv: ['head', '-1'] },
    ],
    validate: {
      keypath: DKIM_KEY_PATH_VALIDATOR,
    },
  },

  // ---- settings.mjs: file ops (DKIM key install) ----

  // Create directory tree for DKIM key install.
  {
    id: 'mkdir_p',
    argv: ['mkdir', '-p', '{dir}'],
    validate: {
      dir: DKIM_DIR_VALIDATOR,
    },
  },
  // Copy a DKIM private key file into the keys/ subdirectory.
  {
    id: 'cp_file',
    argv: ['cp', '{src}', '{dst}'],
    validate: {
      src: DKIM_KEY_PATH_VALIDATOR,
      dst: DKIM_KEY_PATH_VALIDATOR,
    },
  },
  // Fix ownership of the rspamd dkim keys directory after key install.
  // The user/group _rspamd:_rspamd is hardcoded; only `dir` is variable.
  {
    id: 'chown_rspamd_recursive',
    argv: ['chown', '-R', '_rspamd:_rspamd', '{dir}'],
    validate: {
      dir: DKIM_DIR_VALIDATOR,
    },
  },
];
