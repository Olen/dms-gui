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

// Regex shape: scheme + `://` + at least one non-slash, non-whitespace
// character, end of string. Permits ports (`:8080`), userinfo is
// rejected (it would contain `@` which isn't excluded, but the cors
// package wouldn't accept origins with userinfo anyway). The end
// anchor blocks trailing paths like `https://example.com/foo`, which
// the cors middleware also doesn't accept.
const ORIGIN_RE = /^https?:\/\/[^/\s]+$/;

export const isValidCorsOrigin = (s) =>
  typeof s === 'string' && ORIGIN_RE.test(s);

// Parse `CORS_ORIGINS` env value into an array. Returns null when
// the env var is unset/empty (signal: "no allowlist, fall back to
// same-origin only" in the consumer). Drops invalid entries and
// (optionally) reports them via the supplied warn callback.
export const parseCorsOrigins = (raw, warn = () => {}) => {
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => {
      if (isValidCorsOrigin(s)) return true;
      warn(`Dropping invalid CORS_ORIGINS entry: ${s}`);
      return false;
    });
  return list.length ? list : null;
};
