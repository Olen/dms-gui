import { describe, it, expect } from 'vitest';
import {
  fixStringType,
  funcName,
  parseExpiryToMs,
  jsonFixTrailingCommas,
  arrayOfStringToDict,
  obj2ArrayOfObj,
  reduxArrayOfObjByValue,
  reduxPropertiesOfObj,
  mergeArrayOfObj,
  getValueFromArrayOfObj,
  pluck,
  humanSize2ByteSize,
  regexEmailStrict,
  regexEmailRegex,
  regexUsername,
  safeUrl,
  redactKey,
  redactSensitiveSettings,
} from '../common.mjs';

describe('fixStringType', () => {
  it('converts numeric string to number', () => {
    expect(fixStringType('42')).toBe(42);
  });

  it('returns non-numeric string as-is', () => {
    expect(fixStringType('hello')).toBe('hello');
  });

  it('converts the zero string to numeric 0', () => {
    expect(fixStringType('0')).toBe(0);
  });

  it('converts decimal zero to numeric 0', () => {
    expect(fixStringType('0.0')).toBe(0);
  });

  it('converts negative numeric string to number', () => {
    expect(fixStringType('-7')).toBe(-7);
  });

  it('returns empty string as-is (does not coerce to 0)', () => {
    expect(fixStringType('')).toBe('');
  });

  it('returns null/undefined unchanged (no NaN coercion)', () => {
    expect(fixStringType(null)).toBe(null);
    expect(fixStringType(undefined)).toBe(undefined);
  });
});

describe('funcName', () => {
  it('returns the caller name from a regular named function', () => {
    function namedCaller() {
      return funcName(2, true);
    }
    expect(namedCaller()).toBe('namedCaller');
  });

  it('returns the dotted call site for anonymous Server.<...> contexts', () => {
    // Simulate a stack frame as if from app.listen's anonymous callback
    // by calling funcName from a method-shaped invocation.
    const obj = {
      'methodWithDots.<anonymous>': function () {
        return funcName(2, true);
      },
    };
    // Caller frame appears as something like "at Object.methodWithDots.<anonymous>".
    // Either way we must not return a raw multi-token stack line.
    const result = obj['methodWithDots.<anonymous>']();
    expect(typeof result).toBe('string');
    expect(result.startsWith('at ')).toBe(false); // not raw stack line
    expect(result.includes(' (')).toBe(false); // no file:line trailing
  });

  it('falls back to <anonymous> rather than dumping a raw stack line', () => {
    // Call from the very top — parent index larger than the stack depth.
    const result = funcName(999, true);
    // The previous implementation returned the literal "errorLines[i]" string
    // which contained "    at Server.<anonymous> (file:///...)". The new
    // fallback returns the static label.
    expect(result === '<anonymous>' || /^[\w.<>$_]+$/.test(result)).toBe(true);
  });
});

describe('parseExpiryToMs', () => {
  it('parses seconds', () => {
    expect(parseExpiryToMs('30s')).toBe(30_000);
  });

  it('parses minutes', () => {
    expect(parseExpiryToMs('15m')).toBe(15 * 60_000);
  });

  it('parses hours', () => {
    expect(parseExpiryToMs('1h')).toBe(3_600_000);
    expect(parseExpiryToMs('24h')).toBe(86_400_000);
  });

  it('parses days', () => {
    expect(parseExpiryToMs('1d')).toBe(86_400_000);
    expect(parseExpiryToMs('7d')).toBe(7 * 86_400_000);
  });

  it('accepts numeric input as-is', () => {
    expect(parseExpiryToMs(60_000)).toBe(60_000);
  });

  it('is case-insensitive on the unit', () => {
    expect(parseExpiryToMs('1H')).toBe(3_600_000);
    expect(parseExpiryToMs('30S')).toBe(30_000);
  });

  it('tolerates whitespace', () => {
    expect(parseExpiryToMs('  1h  ')).toBe(3_600_000);
    expect(parseExpiryToMs('5 m')).toBe(5 * 60_000);
  });

  it('returns the fallback for unparsable input', () => {
    expect(parseExpiryToMs('forever', 999)).toBe(999);
    expect(parseExpiryToMs('', 42)).toBe(42);
    expect(parseExpiryToMs(null, 7)).toBe(7);
    expect(parseExpiryToMs(undefined, 7)).toBe(7);
    expect(parseExpiryToMs({}, 7)).toBe(7);
  });

  it('returns 0 fallback by default for unparsable input', () => {
    expect(parseExpiryToMs('nope')).toBe(0);
  });
});

describe('jsonFixTrailingCommas', () => {
  it('strips trailing commas and returns JSON string', () => {
    const result = jsonFixTrailingCommas('{"a":1,"b":2,}');
    expect(result).toBe('{"a":1,"b":2}');
  });

  it('returns parsed object when returnJson is true', () => {
    const result = jsonFixTrailingCommas('{"a":1,}', true);
    expect(result).toEqual({ a: 1 });
  });

  it('throws on invalid JSON', () => {
    expect(() => jsonFixTrailingCommas('not json')).toThrow();
  });
});

describe('arrayOfStringToDict', () => {
  it('converts key=value array with custom separator', () => {
    const result = arrayOfStringToDict(['a=1', 'b=2'], '=');
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('uses default comma separator', () => {
    const result = arrayOfStringToDict(['a,1', 'b,hello']);
    expect(result).toEqual({ a: 1, b: 'hello' });
  });

  it('handles string input by splitting on newlines', () => {
    const result = arrayOfStringToDict('a=1\nb=2', '=');
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('returns empty dict for empty input', () => {
    expect(arrayOfStringToDict([])).toEqual({});
  });
});

describe('obj2ArrayOfObj', () => {
  it('converts object to array of {name, value} objects', () => {
    const result = obj2ArrayOfObj({ a: 1, b: 2 });
    expect(result).toEqual([
      { name: 'a', value: 1 },
      { name: 'b', value: 2 },
    ]);
  });

  it('stringifies values when stringify flag is true', () => {
    const result = obj2ArrayOfObj({ a: 1 }, true);
    expect(result).toEqual([{ name: 'a', value: '1' }]);
  });

  it('uses custom prop names', () => {
    const result = obj2ArrayOfObj({ a: 1 }, false, ['key', 'val']);
    expect(result).toEqual([{ key: 'a', val: 1 }]);
  });
});

describe('reduxArrayOfObjByValue', () => {
  it('filters by matching values', () => {
    const data = [
      { name: 'John', city: 'London' },
      { name: 'Mike', city: 'Warsaw' },
    ];
    const result = reduxArrayOfObjByValue(data, 'city', ['London']);
    expect(result).toEqual([{ name: 'John', city: 'London' }]);
  });

  it('accepts string values2Keep (converts to array)', () => {
    const data = [{ name: 'John', city: 'London' }];
    const result = reduxArrayOfObjByValue(data, 'city', 'London');
    expect(result).toEqual([{ name: 'John', city: 'London' }]);
  });

  it('returns empty array for empty input', () => {
    expect(reduxArrayOfObjByValue([], 'city', ['London'])).toEqual([]);
  });
});

describe('reduxPropertiesOfObj', () => {
  it('keeps only specified properties', () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(reduxPropertiesOfObj(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
  });

  it('accepts string key (converts to array)', () => {
    const obj = { a: 1, b: 2 };
    expect(reduxPropertiesOfObj(obj, 'a')).toEqual({ a: 1 });
  });
});

describe('mergeArrayOfObj', () => {
  it('b overrides matching entries in a', () => {
    const a = [{ name: 1, value: 'old' }];
    const b = [
      { name: 1, value: 'new' },
      { name: 2, value: 'added' },
    ];
    expect(mergeArrayOfObj(a, b)).toEqual([
      { name: 1, value: 'new' },
      { name: 2, value: 'added' },
    ]);
  });

  it('wraps non-array inputs', () => {
    const a = { name: 1, value: 'old' };
    const b = { name: 1, value: 'new' };
    expect(mergeArrayOfObj(a, b)).toEqual([{ name: 1, value: 'new' }]);
  });

  it('returns b when a is empty', () => {
    const b = [{ name: 1, value: 'x' }];
    expect(mergeArrayOfObj([], b)).toEqual(b);
  });

  it('returns empty array when both are null', () => {
    expect(mergeArrayOfObj(null, null)).toEqual([]);
  });
});

describe('getValueFromArrayOfObj', () => {
  const array = [
    { name: 'host', value: 'localhost' },
    { name: 'port', value: 3000 },
  ];

  it('returns first matching value', () => {
    expect(getValueFromArrayOfObj(array, 'host')).toBe('localhost');
  });

  it('accepts array of prop values', () => {
    expect(getValueFromArrayOfObj(array, ['port', 'missing'])).toBe(3000);
  });

  it('returns null when not found', () => {
    expect(getValueFromArrayOfObj(array, 'missing')).toBeNull();
  });
});

describe('pluck', () => {
  it('returns unique sorted values by default', () => {
    const array = [{ value: 'b' }, { value: 'a' }, { value: 'b' }];
    expect(pluck(array)).toEqual(['a', 'b']);
  });

  it('returns unsorted when sorted=false', () => {
    const array = [{ value: 'b' }, { value: 'a' }, { value: 'c' }];
    const result = pluck(array, 'value', true, false);
    expect(result).toEqual(['b', 'a', 'c']);
  });

  it('returns null for non-array input', () => {
    expect(pluck('not an array')).toBeNull();
  });
});

describe('humanSize2ByteSize', () => {
  it('converts 1KB to 1024', () => {
    expect(humanSize2ByteSize('1KB')).toBe('1024');
  });

  it('converts 5MB', () => {
    expect(humanSize2ByteSize('5MB')).toBe('5242880');
  });

  it('converts 2GB', () => {
    expect(humanSize2ByteSize('2GB')).toBe('2147483648');
  });

  it('converts 0B to 0', () => {
    expect(humanSize2ByteSize('0B')).toBe('0');
  });
});

describe('regex patterns', () => {
  it('regexEmailStrict matches valid email', () => {
    expect(regexEmailStrict.test('user@example.com')).toBe(true);
    expect(regexEmailStrict.test('not-an-email')).toBe(false);
  });

  it('regexEmailRegex matches regex-wrapped email pattern', () => {
    expect(regexEmailRegex.test('/user@domain/')).toBe(true);
    expect(regexEmailRegex.test('user@domain')).toBe(false);
  });

  it('regexUsername matches non-whitespace strings', () => {
    expect(regexUsername.test('validuser')).toBe(true);
    expect(regexUsername.test('user name')).toBe(false);
  });
});

describe('safeUrl', () => {
  it('returns the URL for http://', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com');
  });

  it('returns the URL for https://', () => {
    expect(safeUrl('https://webmail.example.com/path?q=1')).toBe(
      'https://webmail.example.com/path?q=1'
    );
  });

  it('rejects javascript: scheme', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects javascript: scheme with mixed case', () => {
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBeNull();
  });

  it('rejects javascript: with leading whitespace (whitespace-trim defence)', () => {
    expect(safeUrl('  javascript:alert(1)')).toBeNull();
  });

  it('rejects data: scheme', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects file: scheme', () => {
    expect(safeUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects mailto: by default (only http/https in default allowlist)', () => {
    expect(safeUrl('mailto:user@example.com')).toBeNull();
  });

  it('accepts custom allowlist containing mailto:', () => {
    expect(
      safeUrl('mailto:user@example.com', ['http:', 'https:', 'mailto:'])
    ).toBe('mailto:user@example.com');
  });

  it('accepts uppercase scheme in caller-supplied allowlist', () => {
    expect(safeUrl('https://x.com', ['HTTPS:'])).toBe('https://x.com');
  });

  it('returns the trimmed URL, not the input with surrounding whitespace', () => {
    expect(safeUrl('  https://x.com  ')).toBe('https://x.com');
  });

  it('rejects empty string', () => {
    expect(safeUrl('')).toBeNull();
  });

  it('rejects whitespace-only string', () => {
    expect(safeUrl('   ')).toBeNull();
  });

  it('rejects null', () => {
    expect(safeUrl(null)).toBeNull();
  });

  it('rejects undefined', () => {
    expect(safeUrl(undefined)).toBeNull();
  });

  it('rejects non-string types', () => {
    expect(safeUrl(123)).toBeNull();
    expect(safeUrl({ url: 'https://x' })).toBeNull();
  });

  it('rejects malformed URL (no scheme)', () => {
    expect(safeUrl('not-a-url')).toBeNull();
  });

  it('rejects relative path with no base', () => {
    expect(safeUrl('/some/path')).toBeNull();
  });
});

describe('redactKey', () => {
  it('shows first 4 and last 4 chars for keys >= 12 chars', () => {
    expect(redactKey('mailserver-12345678-90ab-cdef-1234')).toBe('mail...1234');
  });

  it('returns *** for keys shorter than 12 chars', () => {
    expect(redactKey('short')).toBe('***');
    expect(redactKey('eleven-chrs')).toBe('***'); // 11 chars
  });

  it('returns *** for empty string', () => {
    expect(redactKey('')).toBe('***');
  });

  it('returns *** for non-string input', () => {
    expect(redactKey(null)).toBe('***');
    expect(redactKey(undefined)).toBe('***');
    expect(redactKey(12345)).toBe('***');
    expect(redactKey({})).toBe('***');
  });

  it('does not include the middle of a real-looking key in output', () => {
    const key = 'super-secret-actual-key-content-99999';
    const out = redactKey(key);
    expect(out).not.toContain('secret-actual-key-content');
    expect(out).toContain('...');
  });
});

describe('redactSensitiveSettings', () => {
  it('redacts values for names matching SECRET/KEY/PASSWORD/TOKEN', () => {
    const rows = [
      { name: 'DMS_API_KEY', value: 'mailserver-12345678-90ab-cdef-1234' },
      { name: 'AES_SECRET', value: 'super-secret-actual-aes-content-9999' },
      { name: 'JWT_SECRET', value: 'jwt-private-signing-key-1234' },
      { name: 'RESET_TOKEN', value: 'token-1234-5678-90ab-cdef-1234' },
      { name: 'USER_PASSWORD', value: 'plain-text-password-12345' },
    ];
    const out = redactSensitiveSettings(rows);
    for (const row of out) {
      expect(row.value).toMatch(/^[\w-]{4}\.\.\.[\w-]{4}$/);
    }
  });

  it('passes through non-sensitive rows unchanged', () => {
    const rows = [
      { name: 'WEBMAIL_URL', value: 'https://webmail.example.com' },
      { name: 'TZ', value: 'UTC' },
    ];
    expect(redactSensitiveSettings(rows)).toEqual(rows);
  });

  it('is case-insensitive on the name match', () => {
    const rows = [
      { name: 'aes_secret', value: 'should-also-be-redacted-1234' },
    ];
    expect(redactSensitiveSettings(rows)[0].value).not.toBe(rows[0].value);
    expect(redactSensitiveSettings(rows)[0].value).toContain('...');
  });

  it('returns input unchanged when not an array', () => {
    expect(redactSensitiveSettings(null)).toBeNull();
    expect(redactSensitiveSettings(undefined)).toBeUndefined();
    expect(redactSensitiveSettings('a string')).toBe('a string');
  });

  it('tolerates rows missing the name field', () => {
    const rows = [{ value: 'something' }, null, { name: 42, value: 'x' }];
    expect(() => redactSensitiveSettings(rows)).not.toThrow();
  });
});
