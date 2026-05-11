// Domains + DKIM + DNSBL + DNS lookup + DNS-provider test/push.
// Mirrors backend/routes/domains.js (both domain CRUD and the
// dnscontrol/* routes live in routes/domains.js on the backend).

import { request } from './_client.mjs';

export const getDomains = async (containerName = null, name) => {
  const path = name
    ? `/domains/${containerName}/${name}`
    : `/domains/${containerName}`;
  return request('get', path, { requires: { containerName } });
};

export const updateDomain = async (containerName, domain, jsonDict) =>
  request('patch', `/domains/${containerName}/${domain}`, {
    requires: { containerName, domain },
    body: jsonDict,
  });

export const getDnsLookup = async (containerName = null, domain) =>
  request('get', `/dns/${containerName}/${domain}`, {
    requires: { containerName, domain },
  });

export const getDkimSelector = async (containerName) => {
  // Silent-failure: this is read on the Domains page for every
  // domain row; a network blip shouldn't blank the UI. Fall back
  // to the project default selector so the page still renders.
  // Both fallback branches return success:true so callers can rely
  // on `result.selector` unconditionally — the success flag is a
  // promise that a usable selector came back, not a claim about
  // whether the DB had one.
  if (!containerName) return { success: true, selector: 'mail' };
  try {
    return await request('get', `/domains/${containerName}/dkim-selector`);
  } catch {
    return { success: true, selector: 'mail' };
  }
};

export const generateDkim = async (containerName, domain, options = {}) =>
  request('post', `/domains/${containerName}/${domain}/dkim`, {
    requires: { containerName, domain },
    body: options,
  });

export const getDnsblCheck = async (containerName, domain) =>
  request('get', `/dnsbl/${containerName}/${domain}`, {
    requires: { containerName, domain },
  });

// ============================================
// DNS provider tests / pushes — backend mounts these under
// /dnscontrol/* via routes/domains.js.
// ============================================

export const testDnsProvider = async (credentials) => {
  // Silent-failure: the UI shows the error message inline rather
  // than throwing; prefer the server's structured error over the
  // raw HTTP message.
  try {
    return await request('post', '/dnscontrol/test', { body: credentials });
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error || error.message,
    };
  }
};

export const pushDnsRecord = async (containerName, domain, record) => {
  // Silent-failure: same UX contract as testDnsProvider.
  // containerName and domain interpolate into the URL — require both
  // so a missing arg short-circuits to a {success:false,error:...}
  // shape from request() instead of POSTing to /dnscontrol/undefined/...
  try {
    return await request(
      'post',
      `/dnscontrol/${containerName}/${domain}/records`,
      { requires: { containerName, domain }, body: record }
    );
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error || error.message,
    };
  }
};
