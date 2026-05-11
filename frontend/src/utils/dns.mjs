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
