import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { REST_API_MANIFEST } from './restApiManifest.mjs';

describe('REST_API_MANIFEST (Sprint B — accounts.mjs migration)', () => {
  it('exports an array', () => {
    expect(Array.isArray(REST_API_MANIFEST)).toBe(true);
  });

  it('contains the 12 actions accounts.mjs needs', () => {
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

describe('SETUP_PATH_VALIDATOR (Sprint B round-9)', () => {
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

describe('REST_API_MANIFEST structural invariants (Sprint B)', () => {
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
