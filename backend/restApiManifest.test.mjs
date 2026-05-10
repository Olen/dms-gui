import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { REST_API_MANIFEST } from './restApiManifest.mjs';

describe('REST_API_MANIFEST required-IDs', () => {
  it('exports an array', () => {
    expect(Array.isArray(REST_API_MANIFEST)).toBe(true);
  });

  it('contains the actions accounts.mjs needs', () => {
    const ids = REST_API_MANIFEST.map((a) => a.id);
    const required = [
      'setup_email_list',
      'setup_email_add',
      'setup_email_del',
      'setup_quota_del',
      'setup_quota_set',
      'doveadm_index',
      'doveadm_mailbox_list',
      'doveadm_mailbox_list_subscribed',
      'doveadm_mailbox_metadata_list',
      'doveadm_mailbox_status',
      'doveadm_force_resync',
      'doveadm_quota_get',
    ];
    for (const id of required) expect(ids).toContain(id);
  });

  it('contains the actions aliases.mjs / sieve.mjs / logins.mjs need', () => {
    const ids = REST_API_MANIFEST.map((a) => a.id);
    const required = [
      // aliases.mjs
      'setup_alias_list',
      'setup_alias_add',
      'setup_alias_del',
      'cat_postfix_regexp',
      'postfix_regexp_append',
      'postfix_regexp_filter_to_tmp',
      'tmp_postfix_regexp_to_final',
      'postfix_reload',
      // sieve.mjs
      'doveadm_sieve_list',
      'doveadm_sieve_get',
      'doveadm_sieve_put',
      'doveadm_sieve_activate',
      'doveadm_sieve_deactivate',
      'doveadm_sieve_delete',
      // logins.mjs
      'doveadm_auth_test',
    ];
    for (const id of required) expect(ids).toContain(id);
  });

  it('contains the actions settings.mjs needs', () => {
    const ids = REST_API_MANIFEST.map((a) => a.id);
    const required = [
      'tail_log',
      'grep_postfix_bounces',
      'df_var_mail',
      'top_summary',
      'ps_init_uptime',
      'setup_help',
      'setup_dkim_generate_rsa',
      'setup_dkim_generate_rsa_force',
      'setup_dkim_generate',
      'setup_dkim_generate_force',
      'doveconf_dump',
      'dovecot_version',
      'cat_rspamd_config',
      'print_env',
      'curl_rspamd_stat',
      'curl_rspamd_history',
      'redis_eval_bayes_users',
      'rspamd_learn',
      'rspamd_unlearn',
      'doveadm_search_message_id',
      'doveadm_who',
      'ls_dir',
      'openssl_pkey_inspect',
      'mkdir_p',
      'cp_file',
      'chown_rspamd_recursive',
    ];
    for (const id of required) expect(ids).toContain(id);
  });

  it('serialises to valid JSON', () => {
    expect(() => JSON.parse(JSON.stringify(REST_API_MANIFEST))).not.toThrow();
  });
});

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function placeholdersIn(text) {
  const out = new Set();
  let m;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) out.add(m[1]);
  return out;
}

function actionPlaceholders(action) {
  const all = new Set();
  if (action.argv) {
    for (const t of action.argv) for (const p of placeholdersIn(t)) all.add(p);
  } else if (action.pipeline) {
    for (const stage of action.pipeline)
      for (const t of stage.argv) for (const p of placeholdersIn(t)) all.add(p);
  }
  if (action.redirect?.file) {
    for (const p of placeholdersIn(action.redirect.file)) all.add(p);
  }
  return all;
}

describe('SETUP_PATH_VALIDATOR', () => {
  // Look up the action and regex inside a beforeAll, not at describe-
  // definition time. If the manifest entry or validator is missing/
  // renamed, this surfaces as a normal test failure with a clear
  // assertion message rather than a TypeError that crashes the entire
  // file's module evaluation and skips every other test.
  let re;
  beforeAll(() => {
    const action = REST_API_MANIFEST.find((a) => a.id === 'setup_email_list');
    expect(action, 'manifest must contain setup_email_list').toBeDefined();
    expect(
      action.validate?.setup_path?.regex,
      'setup_email_list must validate setup_path'
    ).toBeDefined();
    re = new RegExp(action.validate.setup_path.regex);
  });

  it('accepts the standard /usr/local/bin/setup', () => {
    expect(re.test('/usr/local/bin/setup')).toBe(true);
  });

  it('accepts /usr/local/bin/setup.sh (with extension)', () => {
    expect(re.test('/usr/local/bin/setup.sh')).toBe(true);
  });

  it('accepts /setup (single segment, no extension)', () => {
    expect(re.test('/setup')).toBe(true);
  });

  it('accepts /foo.bar.baz (multiple extensions)', () => {
    expect(re.test('/foo.bar.baz')).toBe(true);
  });

  it('rejects path traversal via ..', () => {
    expect(re.test('/tmp/../../usr/bin/foo')).toBe(false);
  });

  it('rejects double-dot in a single segment', () => {
    expect(re.test('/foo..bar/setup')).toBe(false);
  });

  it('rejects relative paths', () => {
    expect(re.test('setup')).toBe(false);
  });

  it('rejects empty path', () => {
    expect(re.test('')).toBe(false);
  });

  it('rejects path consisting of only a slash', () => {
    expect(re.test('/')).toBe(false);
  });
});

describe('DKIM_DIR_VALIDATOR (via ls_dir action)', () => {
  // Mirrors SETUP_PATH_VALIDATOR's deferred-lookup pattern so a
  // missing manifest entry surfaces as a clear assertion failure
  // rather than a TypeError that aborts the file's evaluation.
  let re;
  let DKIM_BASE; // resolved at runtime — depends on DMS_CONFIG_PATH
  beforeAll(() => {
    const action = REST_API_MANIFEST.find((a) => a.id === 'ls_dir');
    expect(action, 'manifest must contain ls_dir').toBeDefined();
    expect(
      action.validate?.dir?.regex,
      'ls_dir must validate dir'
    ).toBeDefined();
    re = new RegExp(action.validate.dir.regex);
    DKIM_BASE = `${process.env.DMS_CONFIG_PATH || '/tmp/docker-mailserver'}/rspamd/dkim`;
  });

  it('accepts the DKIM base directory itself', () => {
    expect(re.test(DKIM_BASE)).toBe(true);
  });

  it('accepts a domain subdirectory', () => {
    expect(re.test(`${DKIM_BASE}/example.com`)).toBe(true);
  });

  it('accepts a key file inside a domain dir', () => {
    expect(re.test(`${DKIM_BASE}/example.com/default.private`)).toBe(true);
  });

  it('accepts a multi-extension filename', () => {
    expect(re.test(`${DKIM_BASE}/example.com/rsa-2048.private.txt`)).toBe(true);
  });

  it('rejects path traversal via ..', () => {
    expect(re.test(`${DKIM_BASE}/../etc/passwd`)).toBe(false);
  });

  it('rejects double-dot in a single segment', () => {
    expect(re.test(`${DKIM_BASE}/foo..bar/default`)).toBe(false);
  });

  it('rejects paths outside the DKIM base', () => {
    expect(re.test('/etc/passwd')).toBe(false);
    expect(re.test('/tmp/docker-mailserver/postfix-regexp.cf')).toBe(false);
  });

  it('rejects relative paths', () => {
    expect(re.test('rspamd/dkim/example.com')).toBe(false);
  });

  it('rejects a base path that has the DKIM base as a prefix but is not under it', () => {
    // Defense against `/tmp/docker-mailserver/rspamd/dkim-evil/...`
    // matching a base built with simple concatenation. The regex
    // anchors with a `/` separator, so this must be rejected.
    expect(re.test(`${DKIM_BASE}-evil/example.com`)).toBe(false);
  });
});

describe('REST_API_MANIFEST structural invariants', () => {
  it('all action ids are unique', () => {
    const ids = REST_API_MANIFEST.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all action ids are snake_case', () => {
    for (const a of REST_API_MANIFEST) {
      expect(a.id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('every {placeholder} is declared in the action validate block', () => {
    for (const a of REST_API_MANIFEST) {
      const placeholders = actionPlaceholders(a);
      const declared = new Set(Object.keys(a.validate ?? {}));
      for (const p of placeholders) {
        expect(
          declared,
          `action ${a.id}: undeclared placeholder {${p}}`
        ).toContain(p);
      }
    }
  });

  it('no orphan validators (every validate key is referenced by a placeholder)', () => {
    for (const a of REST_API_MANIFEST) {
      const placeholders = actionPlaceholders(a);
      for (const d of Object.keys(a.validate ?? {})) {
        expect(
          placeholders,
          `action ${a.id}: orphan validator '${d}'`
        ).toContain(d);
      }
    }
  });

  it('argv tokens contain no shell-operator characters', () => {
    const badRe = /[|<>;&]/;
    for (const a of REST_API_MANIFEST) {
      const tokens = a.argv ?? a.pipeline.flatMap((s) => s.argv);
      for (const t of tokens) {
        expect(
          t,
          `action ${a.id}: token ${JSON.stringify(t)} has shell operator`
        ).not.toMatch(badRe);
      }
    }
  });

  it('redirect targets are absolute paths without ..', () => {
    for (const a of REST_API_MANIFEST) {
      if (!a.redirect) continue;
      expect(a.redirect.file).toMatch(/^\//);
      expect(a.redirect.file.split('/')).not.toContain('..');
    }
  });

  it("every execAction(literal, ...) and actionId: '...' literal references a manifest action", () => {
    const ids = new Set(REST_API_MANIFEST.map((a) => a.id));
    const here = fileURLToPath(import.meta.url);
    const backendDir = dirname(here);
    // Auto-enumerate every backend source file that could call execAction:
    //   backend/*.mjs              (business-logic modules)
    //   backend/routes/*.js        (Express route handlers)
    // Excludes test files and the test/ helper subdirectory. A new file
    // added in a future migration is picked up automatically without
    // updating this list — the previous hardcoded allowlist could
    // silently drop future call sites out of the coverage check.
    const collectFiles = () => {
      const out = [];
      for (const f of readdirSync(backendDir, { withFileTypes: true })) {
        if (
          f.isFile() &&
          f.name.endsWith('.mjs') &&
          !f.name.endsWith('.test.mjs')
        ) {
          out.push(f.name);
        }
      }
      const routesDir = resolve(backendDir, 'routes');
      if (existsSync(routesDir)) {
        for (const f of readdirSync(routesDir, { withFileTypes: true })) {
          if (
            f.isFile() &&
            f.name.endsWith('.js') &&
            !f.name.endsWith('.test.js')
          ) {
            out.push(`routes/${f.name}`);
          }
        }
      }
      return out;
    };
    const files = collectFiles();
    // (a) Direct calls: execAction('foo', ...)
    const callRe = /execAction\(\s*['"]([a-z][a-z0-9_]*)['"]/g;
    // (b) Config-table dispatch: actionId: 'foo' (e.g. accounts.mjs's doveadm map)
    const configRe = /\bactionId:\s*['"]([a-z][a-z0-9_]*)['"]/g;
    for (const f of files) {
      const filePath = resolve(backendDir, f);
      if (!existsSync(filePath)) continue;
      const src = readFileSync(filePath, 'utf8');
      let m;
      callRe.lastIndex = 0;
      while ((m = callRe.exec(src)) !== null) {
        expect(
          ids,
          `${f}: execAction('${m[1]}') has no manifest entry`
        ).toContain(m[1]);
      }
      configRe.lastIndex = 0;
      while ((m = configRe.exec(src)) !== null) {
        expect(
          ids,
          `${f}: actionId: '${m[1]}' has no manifest entry`
        ).toContain(m[1]);
      }
    }
  });
});
