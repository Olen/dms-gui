import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
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

  it('every execAction(literal, ...) call site references a manifest action', () => {
    const ids = new Set(REST_API_MANIFEST.map((a) => a.id));
    const here = fileURLToPath(import.meta.url);
    const backendDir = dirname(here);
    const files = [
      'accounts.mjs',
      'aliases.mjs',
      'sieve.mjs',
      'logins.mjs',
      'settings.mjs',
      'db.mjs',
    ];
    const callRe = /execAction\(\s*['"]([a-z][a-z0-9_]*)['"]/g;
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
    }
  });
});
