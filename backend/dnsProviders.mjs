import {
  debugLog,
  errorLog,
  infoLog,
} from './backend.mjs';
import {
  getSetting,
  getDomains,
} from './settings.mjs';


// --- Provider implementations ---

const domeneshop = {
  baseUrl: 'https://api.domeneshop.no/v0',

  authHeader(creds) {
    return 'Basic ' + Buffer.from(`${creds.token}:${creds.secret}`).toString('base64');
  },

  async resolveDomain(domain, creds) {
    const response = await fetch(`${this.baseUrl}/domains`, {
      headers: { 'Authorization': this.authHeader(creds) },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('DNS provider authentication failed. Check your credentials in Settings > DNS Providers.');
      }
      throw new Error(`Domeneshop API error: HTTP ${response.status} ${response.statusText}`);
    }
    const domains = await response.json();

    // Try exact match first, then strip labels to find parent zone
    let search = domain;
    while (search.includes('.')) {
      const found = domains.find(d => d.domain === search);
      if (found) {
        return { zoneId: found.id, zoneName: found.domain };
      }
      search = search.substring(search.indexOf('.') + 1);
    }
    throw new Error(`Domain "${domain}" not found at Domeneshop. Verify it is managed by this provider.`);
  },

  async listRecords(zoneId, creds) {
    const response = await fetch(`${this.baseUrl}/domains/${zoneId}/dns`, {
      headers: { 'Authorization': this.authHeader(creds) },
    });
    if (!response.ok) throw new Error(`Domeneshop list records: HTTP ${response.status}`);
    return response.json();
  },

  async findTxtRecord(zoneId, host, creds, contentPrefix) {
    const records = await this.listRecords(zoneId, creds);
    const normalizeHost = (h) => (!h || h === '@') ? '' : h;
    const stripQuotes = (s) => s?.replace(/^"|"$/g, '') || '';
    return records.find(r =>
      r.type === 'TXT' &&
      normalizeHost(r.host) === normalizeHost(host) &&
      (!contentPrefix || stripQuotes(r.data).startsWith(contentPrefix))
    ) || null;
  },

  async upsertTxtRecord(zoneId, host, data, creds, contentPrefix) {
    const existing = await this.findTxtRecord(zoneId, host, creds, contentPrefix);

    if (existing) {
      const response = await fetch(`${this.baseUrl}/domains/${zoneId}/dns/${existing.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': this.authHeader(creds),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ host, type: 'TXT', data }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Domeneshop update record: HTTP ${response.status} — ${text}`);
      }
      return { success: true, message: `Updated TXT record for ${host}` };
    }

    const response = await fetch(`${this.baseUrl}/domains/${zoneId}/dns`, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader(creds),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ host, type: 'TXT', data }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Domeneshop create record: HTTP ${response.status} — ${text}`);
    }
    return { success: true, message: `Created TXT record for ${host}` };
  },
};


const cloudflare = {
  baseUrl: 'https://api.cloudflare.com/client/v4',

  authHeader(creds) {
    return `Bearer ${creds.apitoken}`;
  },

  async resolveDomain(domain, creds) {
    // Try exact match first, then strip labels
    let search = domain;
    while (search.includes('.')) {
      const response = await fetch(`${this.baseUrl}/zones?name=${encodeURIComponent(search)}`, {
        headers: { 'Authorization': this.authHeader(creds) },
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('DNS provider authentication failed. Check your credentials in Settings > DNS Providers.');
        }
        throw new Error(`Cloudflare API error: HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.result?.length > 0) {
        return { zoneId: data.result[0].id, zoneName: data.result[0].name };
      }
      search = search.substring(search.indexOf('.') + 1);
    }
    throw new Error(`Domain "${domain}" not found at Cloudflare. Verify it is managed by this provider.`);
  },

  async findTxtRecord(zoneId, fqdn, creds, contentPrefix) {
    let url = `${this.baseUrl}/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(fqdn)}`;
    const response = await fetch(url, {
      headers: { 'Authorization': this.authHeader(creds) },
    });
    if (!response.ok) throw new Error(`Cloudflare list records: HTTP ${response.status}`);
    const data = await response.json();
    if (!data.result?.length) return null;

    if (contentPrefix) {
      return data.result.find(r => r.content?.startsWith(contentPrefix)) || null;
    }
    return data.result[0];
  },

  async upsertTxtRecord(zoneId, fqdn, data, creds, contentPrefix) {
    const existing = await this.findTxtRecord(zoneId, fqdn, creds, contentPrefix);

    if (existing) {
      const response = await fetch(`${this.baseUrl}/zones/${zoneId}/dns_records/${existing.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': this.authHeader(creds),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'TXT', name: fqdn, content: data, ttl: 3600 }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(`Cloudflare update record: ${result.errors?.[0]?.message || response.status}`);
      }
      return { success: true, message: `Updated TXT record for ${fqdn}` };
    }

    const response = await fetch(`${this.baseUrl}/zones/${zoneId}/dns_records`, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader(creds),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'TXT', name: fqdn, content: data, ttl: 3600 }),
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(`Cloudflare create record: ${result.errors?.[0]?.message || response.status}`);
    }
    return { success: true, message: `Created TXT record for ${fqdn}` };
  },
};


// --- Provider registry ---

const providers = {
  'DOMAINNAMESHOP': domeneshop,
  'DOMENESHOP': domeneshop,
  'CLOUDFLAREAPI': cloudflare,
  'CLOUDFLARE': cloudflare,
};


// --- Credential retrieval ---

async function getProviderCredentials(containerName, profileName) {
  const result = await getSetting('dnscontrol', containerName, profileName, true);
  if (!result.success || !result.message) {
    throw new Error(`DNS provider profile "${profileName}" not found or could not be decrypted.`);
  }
  const creds = JSON.parse(result.message);
  if (!creds.type) {
    throw new Error(`DNS provider profile "${profileName}" has no type.`);
  }
  return creds;
}


function getProvider(type) {
  const providerType = type.toUpperCase();
  const provider = providers[providerType];
  if (!provider) {
    throw new Error(`DNS record management is not yet supported for provider type "${type}". Supported: Domeneshop, Cloudflare.`);
  }
  return provider;
}


// --- Exported high-level functions ---

/**
 * Upsert a DNS TXT record via the domain's assigned DNS provider.
 *
 * @param {string} containerName - DMS container name
 * @param {string} domain - domain name (e.g. "nytt.no")
 * @param {object} record - { name: FQDN, type: "TXT", data: record value }
 *   name examples: "nytt.no" (SPF), "_dmarc.nytt.no" (DMARC), "mail._domainkey.nytt.no" (DKIM)
 */
export async function upsertDnsRecord(containerName, domain, { name, type, data }) {
  debugLog(`upsertDnsRecord: ${domain} → ${name} ${type}`);

  // 1. Get domain's assigned provider profile
  const domainInfo = await getDomains(containerName, domain);
  const dnsProvider = domainInfo?.message?.message?.dnsProvider || domainInfo?.message?.dnsProvider;
  if (!dnsProvider) {
    return { success: false, error: 'No DNS provider assigned to this domain. Assign one in the Domains page.' };
  }

  // 2. Get decrypted credentials
  const creds = await getProviderCredentials(containerName, dnsProvider);
  const { type: providerType, ...providerCreds } = creds;
  const provider = getProvider(providerType);

  // 3. Resolve domain to provider zone
  const { zoneId, zoneName } = await provider.resolveDomain(domain, creds);
  infoLog(`upsertDnsRecord: resolved ${domain} → zone ${zoneName} (${zoneId})`);

  // 4. Compute host (relative for Domeneshop, FQDN for Cloudflare)
  //    The provider implementations handle this difference internally.
  //    Domeneshop uses relative host, Cloudflare uses FQDN.
  const fqdn = name;
  const relativeHost = fqdn === zoneName ? '' : fqdn.replace(`.${zoneName}`, '');

  // 5. Determine content prefix for finding existing records
  //    SPF records need matching by "v=spf1" prefix since multiple TXT records may exist at root
  const contentPrefix = data.startsWith('v=spf1') ? 'v=spf1'
    : data.startsWith('v=DMARC1') ? 'v=DMARC1'
    : data.startsWith('v=DKIM1') ? 'v=DKIM1'
    : null;

  // 6. Upsert — use the right host format per provider
  if (provider === domeneshop) {
    return provider.upsertTxtRecord(zoneId, relativeHost, data, creds, contentPrefix);
  } else {
    return provider.upsertTxtRecord(zoneId, fqdn, data, creds, contentPrefix);
  }
}
