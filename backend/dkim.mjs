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

  // Dispatch to one of four action ids based on keytype and force flag.
  // Action ids are inlined as literals so the build-time manifest invariant
  // test (restApiManifest.test.mjs) can statically verify each id exists.
  let result;
  if (keytype === 'rsa') {
    if (force) {
      result = await execAction(
        'setup_dkim_generate_rsa_force',
        {
          setup_path: targetDict.setupPath,
          keytype,
          keysize: String(keysize),
          selector,
          domain,
        },
        targetDict,
        { timeout: 30 }
      );
    } else {
      result = await execAction(
        'setup_dkim_generate_rsa',
        {
          setup_path: targetDict.setupPath,
          keytype,
          keysize: String(keysize),
          selector,
          domain,
        },
        targetDict,
        { timeout: 30 }
      );
    }
  } else {
    if (force) {
      result = await execAction(
        'setup_dkim_generate_force',
        { setup_path: targetDict.setupPath, keytype, selector, domain },
        targetDict,
        { timeout: 30 }
      );
    } else {
      result = await execAction(
        'setup_dkim_generate',
        { setup_path: targetDict.setupPath, keytype, selector, domain },
        targetDict,
        { timeout: 30 }
      );
    }
  }

  if (result.returncode)
    return { success: false, error: result.stderr || 'DKIM generation failed' };

  // DMS generates flat key files (e.g. rsa-2048-default-example.com.private.txt).
  // The signing config uses path = "...keys/$domain/$selector.private", so copy
  // the private key into that structure for rspamd to find it.
  // mkdir_p, cp_file and chown_rspamd_recursive validators require paths under
  // DMS_CONFIG_PATH/rspamd/dkim/; DKIM_DIR_VALIDATOR in restApiManifest.mjs
  // is derived from env.DMS_CONFIG_PATH so both sides stay in sync.
  const dkimBase = `${env.DMS_CONFIG_PATH}/rspamd/dkim`;
  const flatKey = `${dkimBase}/${keytype}-${keysize}-${selector}-${domain}.private.txt`;
  const keysDir = `${dkimBase}/keys/${domain}`;
  const keysDest = `${keysDir}/${selector}.private`;
  try {
    await execAction('mkdir_p', { dir: keysDir }, targetDict, { timeout: 10 });
    await execAction('cp_file', { src: flatKey, dst: keysDest }, targetDict, {
      timeout: 10,
    });
    await execAction('chown_rspamd_recursive', { dir: keysDir }, targetDict, {
      timeout: 10,
    });
    debugLog(`generateDkim: copied key to ${keysDest}`);
  } catch (e) {
    infoLog(
      `generateDkim: could not copy key to keys/ structure: ${e.message}`
    );
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
