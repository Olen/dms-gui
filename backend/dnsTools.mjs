// DNS lookup + DNSBL checks. Extracted from settings.mjs's god-module
// during the #82 split; lives alongside dovecot.mjs, dkim.mjs,
// mailLogs.mjs, and rspamd.mjs. Imported back into settings.mjs's
// surface via barrel re-export so existing callers don't churn.

import dns from 'node:dns';

import { debugLog, errorLog } from './backend.mjs';
import { demoResponse } from './demoMode.mjs';
import { getSetting } from './settings.mjs';

// Open/free IP-based RBLs (no API key needed)
const OPEN_RBLS = [
  { name: 'Barracuda', zone: 'b.barracudacentral.org' },
  { name: 'SpamCop', zone: 'bl.spamcop.net' },
  { name: 'UCEProtect-1', zone: 'dnsbl-1.uceprotect.net' },
  { name: 'PSBL', zone: 'psbl.surriel.com' },
  { name: 'Mailspike', zone: 'bl.mailspike.net' },
];

// Key-based RBLs (Spamhaus DQS, Abusix) — keys read from DB settings
const KEY_RBLS = [
  {
    name: 'Spamhaus ZEN',
    zoneTemplate: '{key}.zen.dq.spamhaus.net',
    settingKey: 'SPAMHAUS_DQS_KEY',
  },
  {
    name: 'Abusix Combined',
    zoneTemplate: '{key}.combined.mail.abusix.zone',
    settingKey: 'ABUSIX_KEY',
  },
];

// Domain-based blocklists
const DOMAIN_RBLS = [
  {
    name: 'Spamhaus DBL',
    zoneTemplate: '{key}.dbl.dq.spamhaus.net',
    settingKey: 'SPAMHAUS_DQS_KEY',
  },
  {
    name: 'Abusix DBL',
    zoneTemplate: '{key}.dblack.mail.abusix.zone',
    settingKey: 'ABUSIX_KEY',
  },
];

// Check if an IP is private (RFC 1918, link-local, loopback, Docker)
const isPrivateIp = (ip) => {
  const parts = ip.split('.').map(Number);
  if (parts[0] === 10) return true; // 10.0.0.0/8
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
  if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
  if (parts[0] === 127) return true; // 127.0.0.0/8
  if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16
  return false;
};

// Get this server's public IP via external service
let _cachedPublicIp = null;
let _publicIpTimestamp = 0;
const PUBLIC_IP_CACHE_MS = 3600000; // 1 hour

const getPublicIp = async () => {
  if (_cachedPublicIp && Date.now() - _publicIpTimestamp < PUBLIC_IP_CACHE_MS) {
    return _cachedPublicIp;
  }
  const services = [
    'https://api.ipify.org?format=json',
    'https://ifconfig.me/ip',
    'https://icanhazip.com',
  ];
  for (const url of services) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      const ip = url.includes('json') ? JSON.parse(text).ip : text.trim();
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        _cachedPublicIp = ip;
        _publicIpTimestamp = Date.now();
        return ip;
      }
    } catch (e) {
      /* try next service */
    }
  }
  return null;
};

export const dnsLookup = async (domain, dkimSelector = 'dkim') => {
  debugLog(`dnsLookup domain=${domain} selector=${dkimSelector}`);
  if (!domain)
    return { success: false, error: 'dnsLookup: domain is required' };

  const demo = demoResponse('dnsLookup', { domain });
  if (demo) return demo;

  const result = {
    domain,
    a: [],
    mx: [],
    spf: null,
    dkim: null,
    dmarc: null,
    tlsa: [],
    srv: [],
  };

  try {
    try {
      result.a = await dns.promises.resolve4(domain);
    } catch (e) {
      /* no A records */
    }

    try {
      const mx = await dns.promises.resolveMx(domain);
      result.mx = mx.sort((a, b) => a.priority - b.priority);
    } catch (e) {
      /* no MX records */
    }

    try {
      const txtRecords = await dns.promises.resolveTxt(domain);
      const spfRecord = txtRecords.find((r) => r.join('').startsWith('v=spf1'));
      if (spfRecord) result.spf = spfRecord.join('');
    } catch (e) {
      /* no TXT records */
    }

    try {
      const dkimRecords = await dns.promises.resolveTxt(
        `${dkimSelector}._domainkey.${domain}`
      );
      if (dkimRecords.length) result.dkim = dkimRecords[0].join('');
    } catch (e) {
      /* no DKIM record */
    }

    try {
      const dmarcRecords = await dns.promises.resolveTxt(`_dmarc.${domain}`);
      if (dmarcRecords.length) result.dmarc = dmarcRecords[0].join('');
    } catch (e) {
      /* no DMARC record */
    }

    // TLSA records for SMTP (25), SMTPS (465), IMAPS (993)
    // TLSA records are published at the MX hostname, not the bare domain
    const tlsaHosts = new Set();
    if (result.mx.length) {
      result.mx.forEach((mx) => tlsaHosts.add(mx.exchange));
    } else {
      tlsaHosts.add(domain); // fallback to bare domain if no MX
    }
    for (const host of tlsaHosts) {
      for (const [port, proto] of [
        [25, 'tcp'],
        [465, 'tcp'],
        [993, 'tcp'],
      ]) {
        try {
          const tlsa = await dns.promises.resolve(
            `_${port}._${proto}.${host}`,
            'TLSA'
          );
          if (tlsa.length)
            result.tlsa.push(
              ...tlsa.map((r) => ({
                port,
                host,
                usage: r.usage,
                selector: r.selector,
                matchingType: r.matchingtype,
                data: Buffer.isBuffer(r.certificate)
                  ? Buffer.from(r.certificate).toString('hex')
                  : r.certificate,
              }))
            );
        } catch (e) {
          /* no TLSA */
        }
      }
    }

    // SRV records for mail-related services
    for (const svc of [
      '_submission._tcp',
      '_imaps._tcp',
      '_pop3s._tcp',
      '_autodiscover._tcp',
    ]) {
      try {
        const srv = await dns.promises.resolveSrv(`${svc}.${domain}`);
        if (srv.length)
          result.srv.push(...srv.map((r) => ({ service: svc, ...r })));
      } catch (e) {
        /* no SRV */
      }
    }

    return { success: true, message: result };
  } catch (error) {
    errorLog(`dnsLookup error:`, error.message);
    return { success: false, error: error.message };
  }
};

// DNS blacklist check for a domain's mail server IP
export const dnsblCheck = async (containerName, domain) => {
  debugLog(`dnsblCheck domain=${domain}`);
  if (!domain)
    return { success: false, error: 'dnsblCheck: domain is required' };

  const demo = demoResponse('dnsblCheck', { domain });
  if (demo) return demo;

  // 1. Get server IP: try MX → A resolution first, but validate it's public
  let dnsIp = null;
  try {
    const mx = await dns.promises.resolveMx(domain);
    if (mx.length) {
      const mxHost = mx.sort((a, b) => a.priority - b.priority)[0].exchange;
      const ips = await dns.promises.resolve4(mxHost);
      if (ips.length) dnsIp = ips[0];
    }
  } catch (e) {
    /* can't determine IP from MX */
  }
  if (!dnsIp) {
    try {
      const ips = await dns.promises.resolve4(domain);
      dnsIp = ips[0];
    } catch (e) {
      /* fallback failed */
    }
  }

  // If DNS returned a private/Docker IP, get the real public IP instead
  let serverIp = dnsIp;
  if (!serverIp || isPrivateIp(serverIp)) {
    const publicIp = await getPublicIp();
    if (publicIp) {
      debugLog(
        `dnsblCheck: DNS resolved to private IP ${dnsIp}, using public IP ${publicIp}`
      );
      serverIp = publicIp;
    }
  }
  if (!serverIp || isPrivateIp(serverIp)) {
    return {
      success: false,
      error: `Could not determine public IP for ${domain} (DNS resolved to ${dnsIp || 'nothing'})`,
    };
  }

  const reversed = serverIp.split('.').reverse().join('.');

  // 2. Load API keys from DB settings
  const keys = {};
  for (const rbl of [...KEY_RBLS, ...DOMAIN_RBLS]) {
    if (!keys[rbl.settingKey]) {
      try {
        const setting = await getSetting(
          'userconfig',
          containerName,
          rbl.settingKey,
          true
        );
        if (setting?.success && setting?.message) {
          keys[rbl.settingKey] = setting.message;
        }
      } catch (e) {
        /* key not configured */
      }
    }
  }

  // 3. Build query list
  const queries = [];

  for (const rbl of OPEN_RBLS) {
    queries.push({
      name: rbl.name,
      type: 'ip',
      query: `${reversed}.${rbl.zone}`,
    });
  }

  for (const rbl of KEY_RBLS) {
    const key = keys[rbl.settingKey];
    if (key) {
      queries.push({
        name: rbl.name,
        type: 'ip',
        query: `${reversed}.${rbl.zoneTemplate.replace('{key}', key)}`,
      });
    }
  }

  for (const rbl of DOMAIN_RBLS) {
    const key = keys[rbl.settingKey];
    if (key) {
      queries.push({
        name: rbl.name,
        type: 'domain',
        query: `${domain}.${rbl.zoneTemplate.replace('{key}', key)}`,
      });
    }
  }

  // 4. Query all in parallel
  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const records = await dns.promises.resolve4(q.query);
        return {
          name: q.name,
          type: q.type,
          listed: true,
          returnCode: records[0],
        };
      } catch (e) {
        return { name: q.name, type: q.type, listed: false, returnCode: null };
      }
    })
  );

  return { success: true, message: { domain, serverIp, results } };
};
