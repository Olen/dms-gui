// DKIM key generation + selector lookup. Extracted from settings.mjs's
// god-module during the #82 split. Re-exported from settings.mjs so
// existing call sites don't churn.

import { env } from './env.mjs';
import { debugLog, execAction, infoLog } from './backend.mjs';
import { demoResponse } from './demoMode.mjs';
import { demoData } from './demoData.mjs';
import { dbRun, getTargetDict, sql } from './db.mjs';

// Read the DKIM selector from the rspamd signing config inside the DMS container.
export const getDkimSelector = async (plugin = 'mailserver', containerName) => {
  if (env.isDEMO) return { success: true, selector: demoData.dkimSelector };

  const targetDict = getTargetDict(plugin, containerName);
  for (const configPath of [
    '/etc/rspamd/override.d/dkim_signing.conf',
    '/etc/rspamd/local.d/dkim_signing.conf',
  ]) {
    try {
      const result = await execAction(
        'cat_rspamd_config',
        { path: configPath },
        targetDict,
        { timeout: 10 }
      );
      if (result.stdout) {
        const match = result.stdout.match(/^\s*selector\s*=\s*"([^"]+)"/m);
        if (match) return { success: true, selector: match[1] };
      }
    } catch (e) {
      /* file may not exist, try next */
    }
  }
  return { success: true, selector: 'mail' }; // DMS default
};

// Generate DKIM key for a domain using DMS setup command
export const generateDkim = async (
  plugin = 'mailserver',
  containerName,
  domain,
  keytype = 'rsa',
  keysize = '2048',
  selector = 'mail',
  force = false
) => {
  debugLog(
    `generateDkim domain=${domain} keytype=${keytype} keysize=${keysize} selector=${selector} force=${force}`
  );
  if (!/^[a-z0-9.-]+$/i.test(domain))
    return { success: false, error: 'Invalid domain' };
  if (!['rsa', 'ed25519'].includes(keytype))
    return { success: false, error: 'Invalid keytype' };
  if (!['1024', '2048', '4096'].includes(String(keysize)))
    return { success: false, error: 'Invalid keysize' };
  if (!/^[a-z0-9_-]+$/i.test(selector))
    return { success: false, error: 'Invalid selector' };

  // Normalize to lowercase: DNS is case-insensitive and the manifest
  // DOMAIN_VALIDATOR / SELECTOR_VALIDATOR are case-sensitive (lowercase-only).
  // Inputs like 'Example.COM' pass the /i guard above but would fail manifest
  // validation at runtime. Lowercasing here is canonical and safe.
  domain = domain.toLowerCase();
  selector = selector.toLowerCase();

  const demo = demoResponse('generateDkim');
  if (demo) return demo;

  const targetDict = getTargetDict(plugin, containerName);

  // rspamadm dkim_keygen writes the private key directly to `-k {keypath}`, so
  // we generate straight into the layout rspamd signs from
  // (…/rspamd/dkim/keys/$domain/$selector.private) — no flat-file + copy dance.
  // The directory must exist first (rspamadm won't create parents), so mkdir_p
  // runs before keygen. DKIM_KEY_PATH_VALIDATOR / DKIM_DIR_VALIDATOR constrain
  // these paths to the rspamd dkim subtree, derived from env.DMS_CONFIG_PATH.
  const dkimBase = `${env.DMS_CONFIG_PATH}/rspamd/dkim`;
  const keysDir = `${dkimBase}/keys/${domain}`;
  const keysDest = `${keysDir}/${selector}.private`;

  try {
    await execAction('mkdir_p', { dir: keysDir }, targetDict, { timeout: 10 });
  } catch (e) {
    return {
      success: false,
      error: `Could not create DKIM key directory: ${e.message}`,
    };
  }

  // Dispatch to one of four action ids based on keytype and force flag.
  // Action ids are inlined as literals so the build-time manifest invariant
  // test (restApiManifest.test.mjs) can statically verify each id exists.
  let result;
  if (keytype === 'rsa') {
    result = await execAction(
      force ? 'rspamd_dkim_keygen_rsa_force' : 'rspamd_dkim_keygen_rsa',
      { keysize: String(keysize), selector, domain, keypath: keysDest },
      targetDict,
      { timeout: 30 }
    );
  } else {
    result = await execAction(
      force ? 'rspamd_dkim_keygen_ed25519_force' : 'rspamd_dkim_keygen_ed25519',
      { selector, domain, keypath: keysDest },
      targetDict,
      { timeout: 30 }
    );
  }

  if (result.returncode)
    return { success: false, error: result.stderr || 'DKIM generation failed' };

  // Key was written as root by the interpreter; hand ownership to rspamd so the
  // signing worker can read it.
  try {
    await execAction('chown_rspamd_recursive', { dir: keysDir }, targetDict, {
      timeout: 10,
    });
    debugLog(`generateDkim: wrote key to ${keysDest}`);
  } catch (e) {
    infoLog(`generateDkim: could not chown keys/ structure: ${e.message}`);
  }

  // Parse the DNS record from stdout (line containing "v=DKIM1;")
  const dnsRecord =
    result.stdout
      .split('\n')
      .find((l) => l.includes('v=DKIM1;'))
      ?.trim() || null;

  // Update domain record in DB with new selector/keytype/keysize
  dbRun(
    sql.domains.insert.domain,
    { domain, dkim: selector, keytype, keysize: String(keysize), path: '' },
    containerName
  );

  if (!dnsRecord) {
    return {
      success: true,
      message: { dnsRecord: null, selector, keytype, keysize },
      warning:
        'DKIM key generated but DNS record could not be parsed from output. Check the server logs.',
    };
  }

  return {
    success: true,
    message: { dnsRecord, selector, keytype, keysize },
    warning: result.stderr,
  };
};
