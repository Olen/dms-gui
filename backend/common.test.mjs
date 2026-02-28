import { describe, it, expect } from 'vitest';
import {
  escapeShellArg,
  fixStringType,
  jsonFixTrailingCommas,
  arrayOfStringToDict,
  obj2ArrayOfObj,
  reduxArrayOfObjByKey,
  reduxArrayOfObjByValue,
  reduxPropertiesOfObj,
  mergeArrayOfObj,
  getValueFromArrayOfObj,
  getValuesFromArrayOfObj,
  pluck,
  byteSize2HumanSize,
  humanSize2ByteSize,
  moveKeyToLast,
  regexEmailStrict,
  regexEmailLax,
  regexEmailRegex,
  regexUsername,
} from '../common.mjs';

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


describe('fixStringType', () => {
  it('converts numeric string to number', () => {
    expect(fixStringType('42')).toBe(42);
  });

  it('returns non-numeric string as-is', () => {
    expect(fixStringType('hello')).toBe('hello');
  });

  it('returns zero string as string (falsy Number(0) edge case)', () => {
    expect(fixStringType('0')).toBe('0');
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

  it('returns empty array for empty input', () => {
    expect(arrayOfStringToDict([])).toEqual([]);
  });
});


describe('obj2ArrayOfObj', () => {
  it('converts object to array of {name, value} objects', () => {
    const result = obj2ArrayOfObj({ a: 1, b: 2 });
    expect(result).toEqual([{ name: 'a', value: 1 }, { name: 'b', value: 2 }]);
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


describe('reduxArrayOfObjByKey', () => {
  it('keeps only specified keys', () => {
    const data = [
      { name: 'John', city: 'London', age: 42 },
      { name: 'Mike', city: 'Warsaw', age: 18 },
    ];
    const result = reduxArrayOfObjByKey(data, ['name']);
    expect(result).toEqual([{ name: 'John' }, { name: 'Mike' }]);
  });

  it('accepts string key (converts to array)', () => {
    const data = [{ name: 'John', city: 'London' }];
    const result = reduxArrayOfObjByKey(data, 'name');
    expect(result).toEqual([{ name: 'John' }]);
  });

  it('returns empty array for empty input', () => {
    expect(reduxArrayOfObjByKey([], ['name'])).toEqual([]);
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
    const b = [{ name: 1, value: 'new' }, { name: 2, value: 'added' }];
    expect(mergeArrayOfObj(a, b)).toEqual([{ name: 1, value: 'new' }, { name: 2, value: 'added' }]);
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


describe('getValuesFromArrayOfObj', () => {
  const array = [
    { name: 'a', value: 1 },
    { name: 'b', value: 2 },
    { name: 'c', value: 3 },
  ];

  it('returns all matching values', () => {
    expect(getValuesFromArrayOfObj(array, ['a', 'c'])).toEqual([1, 3]);
  });

  it('returns empty array when not found', () => {
    expect(getValuesFromArrayOfObj(array, ['z'])).toEqual([]);
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


describe('byteSize2HumanSize', () => {
  it('returns 0B for zero bytes', () => {
    expect(byteSize2HumanSize(0)).toBe('0B');
  });

  it('converts 1024 bytes to KB', () => {
    expect(byteSize2HumanSize(1024)).toBe('1KB');
  });

  it('converts 1048576 bytes to MB', () => {
    expect(byteSize2HumanSize(1048576)).toBe('1MB');
  });

  it('converts 1073741824 bytes to GB', () => {
    expect(byteSize2HumanSize(1073741824)).toBe('1GB');
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


describe('moveKeyToLast', () => {
  it('moves key to last position', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = moveKeyToLast(obj, 'a');
    expect(Object.keys(result)).toEqual(['b', 'c', 'a']);
    expect(result.a).toBe(1);
  });

  it('returns object unchanged when key is missing', () => {
    const obj = { a: 1, b: 2 };
    const result = moveKeyToLast(obj, 'z');
    expect(Object.keys(result)).toEqual(['a', 'b']);
  });
});


describe('regex patterns', () => {
  it('regexEmailStrict matches valid email', () => {
    expect(regexEmailStrict.test('user@example.com')).toBe(true);
    expect(regexEmailStrict.test('not-an-email')).toBe(false);
  });

  it('regexEmailLax matches permissive email format', () => {
    expect(regexEmailLax.test('any+thing@domain')).toBe(true);
    expect(regexEmailLax.test('no-at-sign')).toBe(false);
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
