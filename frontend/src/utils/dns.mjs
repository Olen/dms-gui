// Pure DNS-related helpers + display constants. Used by the Domains
// page (#87 split). No React/state coupling — keep it that way so
// this file can be tested without a test renderer.

export const RECOMMENDED_KEYTYPE = 'rsa';
export const RECOMMENDED_KEYSIZE = '2048';

// TLSA record field display labels. RFC 7671/6698.
export const TLSA_USAGE = {
  0: 'PKIX-TA',
  1: 'PKIX-EE',
  2: 'DANE-TA',
  3: 'DANE-EE',
};
export const TLSA_SELECTOR = { 0: 'Full cert', 1: 'SubjectPublicKeyInfo' };
export const TLSA_MATCH = { 0: 'Exact', 1: 'SHA-256', 2: 'SHA-512' };

// SPF qualifier grading: -all is strict (success), ~all is softfail
// (warning), anything else (?all, +all, missing) is danger.
export const spfGrade = (spf) => {
  if (!spf) return 'danger';
  if (/-all\s*$/.test(spf)) return 'success';
  if (/~all\s*$/.test(spf)) return 'warning';
  return 'danger';
};

// DMARC policy grading: reject/quarantine pass; p=none surfaces as
// warning; missing record is danger.
export const dmarcGrade = (dmarc) => {
  if (!dmarc) return 'danger';
  const policy = dmarc.match(/;\s*p=([^;\s]+)/i)?.[1]?.toLowerCase();
  if (policy === 'reject') return 'success';
  if (policy === 'quarantine') return 'success';
  return 'warning';
};

// DKIM keytype badge: rsa is recommended (success), ed25519 is the
// modern alternative but less widely supported (warning).
export const keytypeBadge = (type) => {
  if (!type) return 'danger';
  if (type === 'rsa') return 'success';
  if (type === 'ed25519') return 'warning';
  return 'secondary';
};

// DKIM keysize badge: ≥2048 is recommended, 1024 is acceptable but
// weakening, below 1024 is danger.
export const keysizeBadge = (size) => {
  if (!size) return 'danger';
  const n = Number(size);
  if (n >= 2048) return 'success';
  if (n >= 1024) return 'warning';
  return 'danger';
};

// Build the SPF record that the inline editor publishes: keep the
// existing mechanisms (mx/a/include:...) if the domain already has
// an SPF, otherwise infer reasonable defaults from the MX records.
// `dns` is the result shape returned by getDnsLookup (object with
// `spf` string and `mx` array of `{priority, exchange}`).
export const computeSpfRecord = (dns, domain, spfAllMode) => {
  const currentSpf = dns?.spf;
  if (currentSpf) {
    return currentSpf.replace(/[~\-?+]all\s*$/, spfAllMode);
  }
  const mechanisms = ['mx', 'a'];
  if (dns?.mx?.length) {
    for (const mx of dns.mx) {
      const host = mx.exchange?.replace(/\.$/, '');
      if (host && host !== domain) {
        mechanisms.push(`include:${host}`);
      }
    }
  }
  return `v=spf1 ${mechanisms.join(' ')} ${spfAllMode}`;
};

// Build the DMARC record from the editor state. Always includes the
// policy; rua/ruf are optional and only appended when non-empty.
// No trailing semicolon — matches the original inline implementation
// so the pushed record byte-matches what was there before the
// inline editor was added.
export const computeDmarcRecord = (policy, rua, ruf) => {
  let record = `v=DMARC1; p=${policy}`;
  if (rua?.trim()) record += `; rua=mailto:${rua.trim()}`;
  if (ruf?.trim()) record += `; ruf=mailto:${ruf.trim()}`;
  return record;
};
