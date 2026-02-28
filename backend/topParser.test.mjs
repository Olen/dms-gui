import { describe, it, expect } from 'vitest';
import { processTopData } from './topParser.mjs';

const topFixture = `top - 02:49:04 up 35 days, 23:26,  0 user,  load average: 0.42, 0.24, 0.11
Tasks:  32 total,   1 running,  31 sleeping,   0 stopped,   0 zombie
%Cpu(s):  0.0 us,  0.0 sy,  0.0 ni,100.0 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st
MiB Mem :   4413.7 total,    224.1 free,   1332.9 used,   3154.7 buff/cache
MiB Swap:   2304.0 total,   2201.0 free,    103.0 used.   3080.8 avail Mem

  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
    1 root      20   0    2332   1024   1024 S   0.0   0.0   0:00.04 dumb-in+`;

describe('processTopData', () => {
  it('parses time from top line', () => {
    const result = processTopData(topFixture);
    expect(result.top.time).toBe('02:49:04');
  });

  it('parses up_days', () => {
    const result = processTopData(topFixture);
    expect(result.top.up_days).toBe('35');
  });

  it('parses up_hours', () => {
    const result = processTopData(topFixture);
    expect(result.top.up_hours).toBe('23:26');
  });

  it('parses load_average as 3-element array', () => {
    const result = processTopData(topFixture);
    expect(result.top.load_average).toEqual(['0.42', '0.24', '0.11']);
  });

  it('parses tasks totals', () => {
    const result = processTopData(topFixture);
    expect(result.tasks.total).toBe('32');
    expect(result.tasks.running).toBe('1');
    expect(result.tasks.sleeping).toBe('31');
    expect(result.tasks.stopped).toBe('0');
    expect(result.tasks.zombie).toBe('0');
  });

  it('parses cpu percentages', () => {
    const result = processTopData(topFixture);
    expect(result.cpu.us).toBe('0.0');
    expect(result.cpu.sy).toBe('0.0');
    expect(result.cpu.ni).toBe('0.0');
    expect(result.cpu.id).toBe('100.0');
    expect(result.cpu.wa).toBe('0.0');
    expect(result.cpu.hi).toBe('0.0');
    expect(result.cpu.si).toBe('0.0');
    expect(result.cpu.st).toBe('0.0');
  });

  it('parses memory stats', () => {
    const result = processTopData(topFixture);
    expect(result.mem.total).toBe('4413.7');
    expect(result.mem.used).toBe('1332.9');
    expect(result.mem.free).toBe('224.1');
    expect(result.mem.buff_cache).toBe('3154.7');
  });

  it('returns empty objects for non-matching input', () => {
    const result = processTopData('line one\nline two\nline three\nline four');
    expect(result.top).toEqual({});
    expect(result.tasks).toEqual({});
    expect(result.cpu).toEqual({});
    expect(result.mem).toEqual({});
  });
});
