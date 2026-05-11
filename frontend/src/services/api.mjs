// Barrel re-export. Each per-domain module lives under `./api/`
// and mirrors a backend route file (auth → routes/auth.js, etc.).
// Importers can either keep doing
//
//   import { getAccounts, addAlias } from '../services/api.mjs';
//
// or migrate to the more specific
//
//   import { getAccounts } from '../services/api/accounts.mjs';
//   import { addAlias } from '../services/api/aliases.mjs';
//
// The shared axios instance + request() helper live in `_client.mjs`;
// they're re-exported from here for the rare caller that needs them
// directly (test mocks, future plumbing).

export { api, request } from './api/_client.mjs';
export * from './api/auth.mjs';
export * from './api/logins.mjs';
export * from './api/accounts.mjs';
export * from './api/aliases.mjs';
export * from './api/settings.mjs';
export * from './api/domains.mjs';
export * from './api/server.mjs';
export * from './api/mail.mjs';
