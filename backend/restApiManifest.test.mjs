import { describe, it, expect } from 'vitest';
import { REST_API_MANIFEST } from './restApiManifest.mjs';

describe('REST_API_MANIFEST (Sprint A — action protocol)', () => {
  it('exports an array', () => {
    expect(Array.isArray(REST_API_MANIFEST)).toBe(true);
  });

  it('is empty in Sprint A — no actions migrated yet', () => {
    // Sprint A only ships the protocol; Sprint B onwards adds entries.
    expect(REST_API_MANIFEST).toEqual([]);
  });

  it('serialises to valid JSON', () => {
    expect(() => JSON.parse(JSON.stringify(REST_API_MANIFEST))).not.toThrow();
  });
});
