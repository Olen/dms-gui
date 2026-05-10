// Helpers for parsing the CORS_ORIGINS env var.
//
// Extracted from index.js so the parsing/validation can be unit-tested
// without standing up the whole server. CodeQL alert #1
// (js/cors-permissive-configuration) flagged the prior implementation
// because the env value flowed straight into the cors middleware
// without filtering — a misconfigured `CORS_ORIGINS=*` would turn the
// allowlist into "allow everywhere" with credentials. The strict
// shape check here drops anything that isn't a fully-qualified
// http(s):// origin (no path, no wildcards, no bare hostnames).

// Regex shape: scheme + `://` + at least one non-{slash, whitespace,
// `@`, `?`, `#`} character, end of string. The `[^/\s@?#]` class is
// a tight host-and-port portion: it permits `:port` and IPv6-literal
// brackets (digits, `:`, `[`, `]` are not excluded), but rejects
// everything that wouldn't be a valid CORS origin:
//   - trailing paths (`https://example.com/foo`) via no `/`
//   - whitespace-injected origins via no `\s`
//   - userinfo (`https://user:pass@host`) via no `@`
//   - query strings (`https://example.com?x=1`) via no `?`
//   - fragments (`https://example.com#frag`) via no `#`
// Browsers never put any of those in the Origin header, so an entry
// containing them is a misconfiguration that would never match —
// rejecting them at the validator gives the operator immediate
// feedback (via the debugLog "Dropping invalid…" line) rather than
// the silent never-matches behaviour. The `/i` flag makes the
// scheme case-insensitive (RFC 3986); the parser normalises the
// whole entry to lowercase before storing.
const ORIGIN_RE = /^https?:\/\/[^/\s@?#]+$/i;

export const isValidCorsOrigin = (s) =>
  typeof s === 'string' && ORIGIN_RE.test(s);

// Parse `CORS_ORIGINS` env value into an array. Returns null when
// the env var is unset/empty (signal: "no allowlist, fall back to
// same-origin only" in the consumer). Drops invalid entries and
// (optionally) reports them via the supplied warn callback. Each
// kept entry is lowercased so the comparison matches what browsers
// actually send in the Origin header — operators writing
// `CORS_ORIGINS=HTTPS://Example.COM` end up with the canonical
// `https://example.com` in the allowlist.
export const parseCorsOrigins = (raw, warn = () => {}) => {
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((s) => {
      if (isValidCorsOrigin(s)) return true;
      warn(`Dropping invalid CORS_ORIGINS entry: ${s}`);
      return false;
    });
  return list.length ? list : null;
};
