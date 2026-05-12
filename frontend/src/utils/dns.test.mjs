import { describe, it, expect } from 'vitest';
import {
  spfGrade,
  dmarcGrade,
  keytypeBadge,
  keysizeBadge,
  computeSpfRecord,
  computeDmarcRecord,
} from './dns.mjs';

describe('spfGrade', () => {
  it('returns success for hard fail (-all)', () => {
    expect(spfGrade('v=spf1 mx a -all')).toBe('success');
    expect(spfGrade('v=spf1 mx -all   ')).toBe('success');
  });

  it('returns warning for soft fail (~all)', () => {
    expect(spfGrade('v=spf1 mx ~all')).toBe('warning');
  });

  it('returns danger for missing or weak SPF', () => {
    expect(spfGrade(null)).toBe('danger');
    expect(spfGrade('')).toBe('danger');
    expect(spfGrade('v=spf1 mx ?all')).toBe('danger');
    expect(spfGrade('v=spf1 mx +all')).toBe('danger');
    expect(spfGrade('v=spf1 mx')).toBe('danger'); // no all mechanism at all
  });
});

describe('dmarcGrade', () => {
  it('returns success for p=reject', () => {
    expect(dmarcGrade('v=DMARC1; p=reject')).toBe('success');
    expect(dmarcGrade('v=DMARC1; p=REJECT; rua=mailto:x@example.com')).toBe(
      'success'
    );
  });

  it('returns success for p=quarantine', () => {
    expect(dmarcGrade('v=DMARC1; p=quarantine')).toBe('success');
  });

  it('returns warning for p=none', () => {
    expect(dmarcGrade('v=DMARC1; p=none')).toBe('warning');
  });

  it('returns danger when missing', () => {
    expect(dmarcGrade(null)).toBe('danger');
    expect(dmarcGrade('')).toBe('danger');
  });
});

describe('keytypeBadge', () => {
  it('returns success for rsa', () => {
    expect(keytypeBadge('rsa')).toBe('success');
  });
  it('returns warning for ed25519', () => {
    expect(keytypeBadge('ed25519')).toBe('warning');
  });
  it('returns danger when missing', () => {
    expect(keytypeBadge(null)).toBe('danger');
    expect(keytypeBadge('')).toBe('danger');
  });
  it('returns secondary for unknown types', () => {
    expect(keytypeBadge('weird')).toBe('secondary');
  });
});

describe('keysizeBadge', () => {
  it('returns success for ≥2048', () => {
    expect(keysizeBadge(2048)).toBe('success');
    expect(keysizeBadge('2048')).toBe('success');
    expect(keysizeBadge(4096)).toBe('success');
  });
  it('returns warning for 1024..2047', () => {
    expect(keysizeBadge(1024)).toBe('warning');
    expect(keysizeBadge('1024')).toBe('warning');
  });
  it('returns danger for <1024 or missing', () => {
    expect(keysizeBadge(512)).toBe('danger');
    expect(keysizeBadge(null)).toBe('danger');
    expect(keysizeBadge('')).toBe('danger');
  });
});

describe('computeSpfRecord', () => {
  // Used by the inline SPF editor in DnsDetailsModal. The DNS provider
  // hands us back a `dns` object with `.spf` (current record) and
  // `.mx` (sorted MX list). We either tweak the existing record's
  // `all` qualifier or synthesise a new record from MX hints.

  it('rewrites the all qualifier on an existing SPF record', () => {
    const dns = { spf: 'v=spf1 mx a include:_spf.example.com ~all' };
    expect(computeSpfRecord(dns, 'example.com', '-all')).toBe(
      'v=spf1 mx a include:_spf.example.com -all'
    );
  });

  it('rewrites a trailing-whitespace all qualifier', () => {
    const dns = { spf: 'v=spf1 mx ~all   ' };
    expect(computeSpfRecord(dns, 'example.com', '-all')).toBe('v=spf1 mx -all');
  });

  it('appends the all qualifier when the existing SPF has none', () => {
    // The editor's main job: fix a misconfigured SPF that just lists
    // mechanisms without a closing `all`. Previously this returned
    // the record unchanged (replace() with no match) — the editor
    // couldn't actually rescue these records.
    const dns = { spf: 'v=spf1 mx a' };
    expect(computeSpfRecord(dns, 'example.com', '~all')).toBe(
      'v=spf1 mx a ~all'
    );
  });

  it('appends the all qualifier and collapses any trailing whitespace', () => {
    const dns = { spf: 'v=spf1 mx a   ' };
    expect(computeSpfRecord(dns, 'example.com', '-all')).toBe(
      'v=spf1 mx a -all'
    );
  });

  it('drops a mid-record all token before appending the new one', () => {
    // SPF evaluation stops at the first `all`. A record like
    // "v=spf1 mx -all include:..." silently overrides whatever the
    // editor picks if we just append at the end. Strip every `all`
    // token, then append the user's choice — the editor's mode is
    // now the only `all` mechanism in the record.
    const dns = { spf: 'v=spf1 mx -all include:_spf.example.com' };
    expect(computeSpfRecord(dns, 'example.com', '~all')).toBe(
      'v=spf1 mx include:_spf.example.com ~all'
    );
  });

  it('drops multiple stray all tokens before appending', () => {
    // Pathological but possible — handle gracefully rather than
    // leaving residue.
    const dns = { spf: 'v=spf1 ~all mx -all a' };
    expect(computeSpfRecord(dns, 'example.com', '-all')).toBe(
      'v=spf1 mx a -all'
    );
  });

  it('drops unqualified `all` (equivalent to +all per RFC 7208)', () => {
    // An SPF record may use bare `all` without a qualifier — it
    // defaults to `+all`. Same evaluation rule: SPF stops at the
    // first `all`, so the bare token must be stripped before the
    // editor's chosen mode is appended.
    const dns = { spf: 'v=spf1 mx a all' };
    expect(computeSpfRecord(dns, 'example.com', '-all')).toBe(
      'v=spf1 mx a -all'
    );
  });

  it('drops a mid-record unqualified `all` (the truly silent foot-gun)', () => {
    const dns = { spf: 'v=spf1 mx all include:_spf.example.com' };
    expect(computeSpfRecord(dns, 'example.com', '~all')).toBe(
      'v=spf1 mx include:_spf.example.com ~all'
    );
  });

  it('synthesises a default record from MX hints when no SPF present', () => {
    const dns = {
      spf: null,
      mx: [
        { priority: 10, exchange: 'mx1.example.com.' },
        { priority: 20, exchange: 'mail.other.org.' },
      ],
    };
    expect(computeSpfRecord(dns, 'example.com', '~all')).toBe(
      'v=spf1 mx a include:mx1.example.com include:mail.other.org ~all'
    );
  });

  it('does not include the domain itself as an include:', () => {
    // When the MX target IS the domain, we shouldn't `include:example.com`
    // (the `mx` mechanism already covers it).
    const dns = {
      spf: null,
      mx: [{ priority: 10, exchange: 'example.com.' }],
    };
    expect(computeSpfRecord(dns, 'example.com', '~all')).toBe(
      'v=spf1 mx a ~all'
    );
  });

  it('falls back to mx + a + all when no SPF and no MX', () => {
    expect(computeSpfRecord({}, 'example.com', '~all')).toBe(
      'v=spf1 mx a ~all'
    );
    expect(computeSpfRecord(null, 'example.com', '~all')).toBe(
      'v=spf1 mx a ~all'
    );
  });

  it('strips `all` tokens case-insensitively (RFC 7208 §4.6.1)', () => {
    // Mechanism names are case-insensitive per spec. Without the
    // i-flag on SPF_ALL_TOKEN_RE, uppercase tokens like `-ALL` would
    // survive the filter and SPF evaluation would stop at them.
    const dns = { spf: 'v=spf1 mx -ALL include:_spf.example.com' };
    expect(computeSpfRecord(dns, 'example.com', '~all')).toBe(
      'v=spf1 mx include:_spf.example.com ~all'
    );
  });

  it('strips ALL/All/all variants together', () => {
    const dns = { spf: 'v=spf1 ALL mx ~All a +all' };
    expect(computeSpfRecord(dns, 'example.com', '-all')).toBe(
      'v=spf1 mx a -all'
    );
  });

  it('falls back to synthesis when the input lacks v=spf1', () => {
    // Pathological: input is just an `all` token with no version tag.
    // Without the v=spf1 guard, kept = [] → output starts with a
    // leading space and no version tag — a record DNS providers
    // would publish but no resolver would accept. Synthesise from
    // scratch so the pushed record is always valid SPF.
    expect(computeSpfRecord({ spf: '-all' }, 'example.com', '~all')).toBe(
      'v=spf1 mx a ~all'
    );
    expect(computeSpfRecord({ spf: 'mx a' }, 'example.com', '~all')).toBe(
      'v=spf1 mx a ~all'
    );
  });

  it('accepts a case-variant v=SPF1 version tag', () => {
    const dns = { spf: 'V=SPF1 mx a ~all' };
    expect(computeSpfRecord(dns, 'example.com', '-all')).toBe(
      'V=SPF1 mx a -all'
    );
  });
});

describe('computeDmarcRecord', () => {
  // No trailing semicolon — matches the original inline implementation
  // shape so the pushed record byte-matches what was previously emitted.

  it('returns just policy when rua/ruf are empty', () => {
    expect(computeDmarcRecord('reject', '', '')).toBe('v=DMARC1; p=reject');
    expect(computeDmarcRecord('none', null, undefined)).toBe(
      'v=DMARC1; p=none'
    );
  });

  it('appends rua= when provided', () => {
    expect(computeDmarcRecord('reject', 'reports@example.com', '')).toBe(
      'v=DMARC1; p=reject; rua=mailto:reports@example.com'
    );
  });

  it('appends ruf= when provided', () => {
    expect(computeDmarcRecord('reject', '', 'forensic@example.com')).toBe(
      'v=DMARC1; p=reject; ruf=mailto:forensic@example.com'
    );
  });

  it('includes both rua and ruf when both provided', () => {
    expect(
      computeDmarcRecord('quarantine', 'r@example.com', 'f@example.com')
    ).toBe(
      'v=DMARC1; p=quarantine; rua=mailto:r@example.com; ruf=mailto:f@example.com'
    );
  });

  it('trims whitespace from rua/ruf', () => {
    expect(
      computeDmarcRecord('none', '  rep@x.com  ', '\tforensic@x.com')
    ).toBe('v=DMARC1; p=none; rua=mailto:rep@x.com; ruf=mailto:forensic@x.com');
  });

  it('does not append when value is whitespace-only', () => {
    expect(computeDmarcRecord('none', '   ', '')).toBe('v=DMARC1; p=none');
  });
});
