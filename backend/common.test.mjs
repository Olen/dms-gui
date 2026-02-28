import { describe, it, expect } from 'vitest';
import { escapeShellArg } from '../common.mjs';

describe('escapeShellArg', () => {
  it('wraps a simple string in single quotes', () => {
    expect(escapeShellArg('hello')).toBe("'hello'");
  });

  it('handles empty string', () => {
    expect(escapeShellArg('')).toBe("''");
  });

  it('handles null', () => {
    expect(escapeShellArg(null)).toBe("''");
  });

  it('handles undefined', () => {
    expect(escapeShellArg(undefined)).toBe("''");
  });

  it('converts numbers to string', () => {
    expect(escapeShellArg(42)).toBe("'42'");
  });

  it('escapes embedded single quotes', () => {
    expect(escapeShellArg("it's")).toBe("'it'\\''s'");
  });

  it('escapes multiple single quotes', () => {
    expect(escapeShellArg("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  // Shell injection vectors
  it('neutralizes command substitution with backticks', () => {
    const result = escapeShellArg('`rm -rf /`');
    expect(result).toBe("'`rm -rf /`'");
    expect(result).not.toContain('$(');
  });

  it('neutralizes $() command substitution', () => {
    const result = escapeShellArg('$(whoami)');
    expect(result).toBe("'$(whoami)'");
  });

  it('neutralizes semicolon command chaining', () => {
    const result = escapeShellArg('foo; rm -rf /');
    expect(result).toBe("'foo; rm -rf /'");
  });

  it('neutralizes pipe operator', () => {
    const result = escapeShellArg('foo | cat /etc/passwd');
    expect(result).toBe("'foo | cat /etc/passwd'");
  });

  it('neutralizes && operator', () => {
    const result = escapeShellArg('foo && evil');
    expect(result).toBe("'foo && evil'");
  });

  it('neutralizes newline injection', () => {
    const result = escapeShellArg('foo\nbar');
    expect(result).toBe("'foo\nbar'");
  });

  it('handles email addresses (common input)', () => {
    expect(escapeShellArg('user@example.com')).toBe("'user@example.com'");
  });

  it('handles paths with spaces', () => {
    expect(escapeShellArg('/path/to/my file.txt')).toBe("'/path/to/my file.txt'");
  });

  it('handles double quotes (no special treatment needed inside single quotes)', () => {
    expect(escapeShellArg('say "hello"')).toBe("'say \"hello\"'");
  });

  it('handles backslashes', () => {
    expect(escapeShellArg('back\\slash')).toBe("'back\\slash'");
  });

  it('handles dollar sign variable expansion', () => {
    expect(escapeShellArg('$HOME')).toBe("'$HOME'");
  });

  it('handles complex injection payload', () => {
    const payload = "'; DROP TABLE users; --";
    const result = escapeShellArg(payload);
    expect(result).toBe("''\\''; DROP TABLE users; --'");
  });
});
