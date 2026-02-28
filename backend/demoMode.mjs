import { env } from './env.mjs';
import { demoData } from './demoData.mjs';

/**
 * Return demo data for a read endpoint.
 * @param {string} key - key in demoData
 * @param {object} opts - optional: { domain } for domain-keyed lookups
 * @returns {object|null} {success, message} if isDEMO, else null
 */
export const demoResponse = (key, opts = {}) => {
  if (!env.isDEMO) return null;

  let data = demoData[key];

  // Domain-keyed lookups (dnsLookup, dnsblCheck)
  if (opts.domain && data && typeof data === 'object' && !Array.isArray(data) && data._fallback !== undefined) {
    data = data[opts.domain] || data._fallback;
  }

  return { success: true, message: data };
};

/**
 * Return a no-op success response for write endpoints in demo mode.
 * @param {string} msg - optional message
 * @returns {object|null} {success, message} if isDEMO, else null
 */
export const demoWriteResponse = (msg = 'Demo mode') => {
  if (!env.isDEMO) return null;
  return { success: true, message: msg };
};
