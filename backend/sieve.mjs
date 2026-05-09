import { debugLog, errorLog, execAction, successLog } from './backend.mjs';
import { getTargetDict } from './db.mjs';
import { demoResponse, demoWriteResponse } from './demoMode.mjs';

// --- Sieve script generation ---

const MARKER_BEGIN = (type) => `# dms-gui:${type}:begin`;
const MARKER_END = (type) => `# dms-gui:${type}:end`;
const MARKER_KV = (type, key, value) => `# dms-gui:${type}:${key}=${value}`;

const defaultRules = () => ({
  forward: { enabled: false, address: '', keepCopy: true },
  vacation: { enabled: false, subject: '', message: '', days: 7 },
  block: { enabled: false, addresses: [] },
});

export const generateSieveScript = (rules) => {
  const requires = new Set();
  const sections = [];

  // Forward
  const fwd = rules.forward || {};
  sections.push(MARKER_BEGIN('forward'));
  sections.push(MARKER_KV('forward', 'enabled', !!fwd.enabled));
  if (fwd.address) sections.push(MARKER_KV('forward', 'address', fwd.address));
  sections.push(MARKER_KV('forward', 'keepCopy', !!fwd.keepCopy));
  if (fwd.enabled && fwd.address) {
    if (fwd.keepCopy) {
      requires.add('copy');
      sections.push(`redirect :copy "${fwd.address}";`);
    } else {
      sections.push(`redirect "${fwd.address}";`);
    }
  }
  sections.push(MARKER_END('forward'));

  // Vacation
  const vac = rules.vacation || {};
  sections.push(MARKER_BEGIN('vacation'));
  sections.push(MARKER_KV('vacation', 'enabled', !!vac.enabled));
  if (vac.subject) sections.push(MARKER_KV('vacation', 'subject', vac.subject));
  if (vac.message) sections.push(MARKER_KV('vacation', 'message', vac.message));
  sections.push(MARKER_KV('vacation', 'days', vac.days || 7));
  if (vac.enabled && vac.message) {
    requires.add('vacation');
    const days = vac.days || 7;
    const subject = vac.subject ? ` :subject "${vac.subject}"` : '';
    sections.push(`vacation :days ${days}${subject} "${vac.message}";`);
  }
  sections.push(MARKER_END('vacation'));

  // Block
  const blk = rules.block || {};
  sections.push(MARKER_BEGIN('block'));
  sections.push(MARKER_KV('block', 'enabled', !!blk.enabled));
  const addrs = blk.addresses || [];
  if (addrs.length)
    sections.push(MARKER_KV('block', 'addresses', addrs.join(',')));
  if (blk.enabled && addrs.length) {
    requires.add('reject');
    const addrList = addrs.map((a) => `"${a}"`).join(', ');
    sections.push(`if address :is "from" [${addrList}] { reject "Blocked"; }`);
  }
  sections.push(MARKER_END('block'));

  // Build require line
  const reqLine = requires.size
    ? `require [${[...requires]
        .sort()
        .map((r) => `"${r}"`)
        .join(', ')}];\n`
    : '';

  return reqLine + sections.join('\n') + '\n';
};

// --- Sieve script parsing ---

export const parseSieveScript = (scriptContent) => {
  if (!scriptContent || !scriptContent.includes('# dms-gui:')) return null;

  const rules = defaultRules();
  const lines = scriptContent.split('\n');
  let currentType = null;

  for (const line of lines) {
    const beginMatch = line.match(/^# dms-gui:(\w+):begin$/);
    if (beginMatch) {
      currentType = beginMatch[1];
      continue;
    }
    const endMatch = line.match(/^# dms-gui:(\w+):end$/);
    if (endMatch) {
      currentType = null;
      continue;
    }

    if (!currentType) continue;

    const kvMatch = line.match(/^# dms-gui:\w+:(\w+)=(.*)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;

      if (currentType === 'forward') {
        if (key === 'enabled') rules.forward.enabled = value === 'true';
        else if (key === 'address') rules.forward.address = value;
        else if (key === 'keepCopy') rules.forward.keepCopy = value === 'true';
      } else if (currentType === 'vacation') {
        if (key === 'enabled') rules.vacation.enabled = value === 'true';
        else if (key === 'subject') rules.vacation.subject = value;
        else if (key === 'message') rules.vacation.message = value;
        else if (key === 'days') rules.vacation.days = parseInt(value, 10) || 7;
      } else if (currentType === 'block') {
        if (key === 'enabled') rules.block.enabled = value === 'true';
        else if (key === 'addresses')
          rules.block.addresses = value ? value.split(',') : [];
      }
    }
  }

  return rules;
};

// --- CRUD operations ---

export const getSieveRules = async (containerName, mailbox) => {
  if (!containerName)
    return { success: false, error: 'containerName is required' };
  if (!mailbox) return { success: false, error: 'mailbox is required' };

  const demo = demoResponse('sieveRules');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict('mailserver', containerName);
    targetDict.timeout = 10;

    // List sieve scripts
    const listResult = await execAction(
      'doveadm_sieve_list',
      { mailbox },
      targetDict
    );

    if (listResult.returncode !== 0) {
      errorLog(`doveadm_sieve_list failed: ${listResult.stderr}`);
      return {
        success: false,
        error: listResult.stderr || 'sieve list failed',
      };
    }

    let scriptExists = false;
    let isActive = false;

    if (listResult.stdout) {
      for (const line of listResult.stdout.split('\n')) {
        const trimmed = line.trim();
        if (
          trimmed === 'roundcube ACTIVE' ||
          trimmed.startsWith('roundcube ')
        ) {
          scriptExists = true;
          if (trimmed.includes('ACTIVE')) isActive = true;
        }
      }
    }

    if (!scriptExists) {
      return {
        success: true,
        message: {
          rules: null,
          scriptExists: false,
          isActive: false,
          rawScript: null,
        },
      };
    }

    // Get the script content
    const getResult = await execAction(
      'doveadm_sieve_get',
      { mailbox },
      targetDict
    );

    if (getResult.returncode !== 0) {
      return {
        success: false,
        error: `Failed to read sieve script: ${getResult.stderr}`,
      };
    }

    const rawScript = getResult.stdout;
    const rules = parseSieveScript(rawScript);

    return {
      success: true,
      message: { rules, scriptExists: true, isActive, rawScript },
    };
  } catch (error) {
    errorLog('getSieveRules', error);
    return { success: false, error: error.message };
  }
};

export const saveSieveRules = async (containerName, mailbox, rules) => {
  if (!containerName)
    return { success: false, error: 'containerName is required' };
  if (!mailbox) return { success: false, error: 'mailbox is required' };

  const demo = demoWriteResponse('Sieve rules saved');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict('mailserver', containerName);
    targetDict.timeout = 10;

    const script = generateSieveScript(rules);
    const b64 = Buffer.from(script).toString('base64');

    // Two separate calls — deployed rest-api.py doesn't support && chaining
    const putResult = await execAction(
      'doveadm_sieve_put',
      { mailbox, b64 },
      targetDict
    );

    if (putResult.returncode !== 0) {
      return {
        success: false,
        error: `Failed to save sieve script: ${putResult.stderr}`,
      };
    }

    const activateResult = await execAction(
      'doveadm_sieve_activate',
      { mailbox },
      targetDict
    );

    if (activateResult.returncode !== 0) {
      return {
        success: false,
        error: `Failed to activate sieve script: ${activateResult.stderr}`,
      };
    }

    successLog(`Sieve rules saved for ${mailbox}`);
    return { success: true, message: 'Sieve rules saved' };
  } catch (error) {
    errorLog('saveSieveRules', error);
    return { success: false, error: error.message };
  }
};

export const deleteSieveRules = async (containerName, mailbox) => {
  if (!containerName)
    return { success: false, error: 'containerName is required' };
  if (!mailbox) return { success: false, error: 'mailbox is required' };

  const demo = demoWriteResponse('Sieve rules deleted');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict('mailserver', containerName);
    targetDict.timeout = 10;

    // Two separate calls — deployed rest-api.py doesn't support && chaining
    const deactivateResult = await execAction(
      'doveadm_sieve_deactivate',
      { mailbox },
      targetDict
    );

    // Deactivate may fail if no active script — that's OK, continue to delete
    if (deactivateResult.returncode !== 0) {
      debugLog(
        `sieve deactivate returned ${deactivateResult.returncode}: ${deactivateResult.stderr}`
      );
    }

    const deleteResult = await execAction(
      'doveadm_sieve_delete',
      { mailbox },
      targetDict
    );

    if (deleteResult.returncode !== 0) {
      return {
        success: false,
        error: `Failed to delete sieve script: ${deleteResult.stderr}`,
      };
    }

    successLog(`Sieve rules deleted for ${mailbox}`);
    return { success: true, message: 'Sieve rules deleted' };
  } catch (error) {
    errorLog('deleteSieveRules', error);
    return { success: false, error: error.message };
  }
};

// Export internals for unit testing
export const _test = { generateSieveScript, parseSieveScript, defaultRules };
