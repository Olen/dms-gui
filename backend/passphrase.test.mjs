import { describe, it, expect } from 'vitest';
import { generatePassphrase } from './passphrase.mjs';

describe('generatePassphrase', () => {
  it('generates 4 words with dash separator by default', () => {
    const result = generatePassphrase();
    const words = result.split('-');
    expect(words).toHaveLength(4);
    words.forEach(word => expect(word.length).toBeGreaterThan(0));
  });

  it('generates custom word count of 1', () => {
    const result = generatePassphrase(1);
    expect(result.split('-')).toHaveLength(1);
    expect(result).not.toContain('-');
  });

  it('generates custom word count of 6', () => {
    const result = generatePassphrase(6);
    expect(result.split('-')).toHaveLength(6);
  });

  it('uses custom separator', () => {
    const result = generatePassphrase(3, '_');
    expect(result.split('_')).toHaveLength(3);
    expect(result).toContain('_');
  });

  it('generates different passphrases on successive calls', () => {
    const results = new Set(Array.from({ length: 10 }, () => generatePassphrase()));
    expect(results.size).toBeGreaterThan(1);
  });

  it('produces non-empty string words', () => {
    const result = generatePassphrase(6);
    result.split('-').forEach(word => {
      expect(word).toBeTruthy();
      expect(typeof word).toBe('string');
    });
  });
});
