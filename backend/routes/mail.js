import { Router } from 'express';
import { authenticateToken, requireActive, requireAdmin, serverError, validateContainerName } from '../middleware.js';
import { getRspamdBayesUsers, getRspamdConfig, getRspamdCounters, getRspamdHistory, getRspamdStats, getRspamdUserHistory, rspamdLearnMessage, getDovecotSessions } from '../settings.mjs';
import { generateAutoconfig, generateMobileconfig } from '../mailprofile.mjs';
import { generatePassphrase } from '../passphrase.mjs';
import { dbAll } from '../db.mjs';
import { debugLog } from '../backend.mjs';

const router = Router();
router.param('containerName', validateContainerName);

// Mail profile download endpoints (no admin required)
router.get('/mail-profile/:containerName/autoconfig',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const mailbox = req.user.mailbox || (req.user.roles && req.user.roles[0]);
    if (!mailbox) return res.status(400).json({ error: 'No mailbox associated with this user' });

    // Read UserConfig settings
    const allSettings = dbAll(
      `SELECT s.name, s.value FROM settings s
       JOIN configs c ON s.configID = c.id
       WHERE c.plugin = ? AND c.name = ? AND s.isMutable = 1`,
      {}, 'userconfig', containerName
    );
    const settings = {};
    if (allSettings.success && allSettings.message) {
      for (const row of allSettings.message) settings[row.name] = row.value;
    }

    if (!settings.IMAP_HOST && !settings.SMTP_HOST) {
      return res.status(404).json({ error: 'Mail server settings not configured' });
    }

    const xml = generateAutoconfig(mailbox, settings);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="autoconfig-${mailbox}.xml"`);
    res.send(xml);

  } catch (error) {
    serverError(res, 'GET /api/mail-profile/autoconfig', error);
  }
});

router.get('/mail-profile/:containerName/mobileconfig',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const mailbox = req.user.mailbox || (req.user.roles && req.user.roles[0]);
    if (!mailbox) return res.status(400).json({ error: 'No mailbox associated with this user' });

    // Read UserConfig settings
    const allSettings = dbAll(
      `SELECT s.name, s.value FROM settings s
       JOIN configs c ON s.configID = c.id
       WHERE c.plugin = ? AND c.name = ? AND s.isMutable = 1`,
      {}, 'userconfig', containerName
    );
    const settings = {};
    if (allSettings.success && allSettings.message) {
      for (const row of allSettings.message) settings[row.name] = row.value;
    }

    if (!settings.IMAP_HOST && !settings.SMTP_HOST) {
      return res.status(404).json({ error: 'Mail server settings not configured' });
    }

    const xml = generateMobileconfig(mailbox, settings);
    res.setHeader('Content-Type', 'application/x-apple-aspen-config');
    res.setHeader('Content-Disposition', `attachment; filename="mail.mobileconfig"`);
    res.send(xml);

  } catch (error) {
    serverError(res, 'GET /api/mail-profile/mobileconfig', error);
  }
});


// Generate a random passphrase
router.get('/generate-password',
  authenticateToken,
  requireActive,
(req, res) => {
  try {
    const words = parseInt(req.query.words) || 4;
    const count = Math.min(Math.max(words, 3), 8); // clamp 3-8 words
    const passphrase = generatePassphrase(count);
    res.json({ success: true, message: passphrase });
  } catch (error) {
    serverError(res, 'GET /api/generate-password', error);
  }
});


// Endpoint for per-user rspamd summary (no admin required)
router.get('/rspamd/:containerName/user-summary',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    // Determine the user's mailbox
    const mailbox = req.user.mailbox || (req.user.roles && req.user.roles[0]);
    if (!mailbox) return res.status(400).json({ success: false, error: 'No mailbox associated with this user' });

    // Collect all addresses: mailbox + alias sources pointing to this mailbox
    // Use exact or comma-delimited match (not LIKE substring) to prevent cross-user data leakage
    const addresses = [mailbox];
    try {
      const mb = mailbox.replace(/[%_\\]/g, '\\$&');
      const aliasRows = dbAll(
        `SELECT source FROM aliases WHERE destination = ? OR destination LIKE ? ESCAPE '\\' OR destination LIKE ? ESCAPE '\\' OR destination LIKE ? ESCAPE '\\'`,
        {}, mailbox, `${mb},%`, `%,${mb},%`, `%,${mb}`
      );
      if (aliasRows.success && aliasRows.message) {
        for (const row of aliasRows.message) {
          if (row.source && !addresses.includes(row.source)) addresses.push(row.source);
        }
      }
    } catch (e) {
      debugLog(`Could not fetch aliases for ${mailbox}:`, e.message);
    }

    const result = await getRspamdUserHistory('mailserver', containerName, addresses);
    res.json(result);

  } catch (error) {
    serverError(res, 'GET /api/rspamd/user-summary', error);
  }
});


/**
 * @swagger
 * /api/rspamd/{containerName}/stat:
 *   get:
 *     summary: Get rspamd statistics
 *     description: Retrieve rspamd stat data via internal API
 *     parameters:
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *     responses:
 *       200:
 *         description: Rspamd statistics
 *       500:
 *         description: Unable to retrieve rspamd stats
 */
router.get('/rspamd/:containerName/stat',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const result = await getRspamdStats('mailserver', containerName);
    res.json(result);

  } catch (error) {
    serverError(res, 'index GET /api/rspamd/stat', error);
  }
});


/**
 * @swagger
 * /api/rspamd/{containerName}/counters:
 *   get:
 *     summary: Get rspamd symbol counters
 *     description: Retrieve top rspamd symbol counters sorted by frequency
 *     parameters:
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *     responses:
 *       200:
 *         description: Top rspamd symbol counters
 *       500:
 *         description: Unable to retrieve rspamd counters
 */
router.get('/rspamd/:containerName/counters',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const result = await getRspamdCounters('mailserver', containerName);
    res.json(result);

  } catch (error) {
    serverError(res, 'index GET /api/rspamd/counters', error);
  }
});


// Endpoint for per-user Bayes learn statistics from Redis
router.get('/rspamd/:containerName/bayes-users',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const result = await getRspamdBayesUsers('mailserver', containerName);
    res.json(result);

  } catch (error) {
    serverError(res, 'GET /api/rspamd/bayes-users', error);
  }
});


// Read-only rspamd config (action thresholds, Bayes autolearn settings)
router.get('/rspamd/:containerName/config',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const result = await getRspamdConfig('mailserver', containerName);
    res.json(result);

  } catch (error) {
    serverError(res, 'GET /api/rspamd/config', error);
  }
});


// Endpoint for rspamd message history with Bayes training status
router.get('/rspamd/:containerName/history',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const result = await getRspamdHistory('mailserver', containerName);
    res.json(result);

  } catch (error) {
    serverError(res, 'GET /api/rspamd/history', error);
  }
});


// Endpoint for Bayes training a message as ham or spam
router.post('/rspamd/:containerName/learn',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const { message_id, action } = req.body;
    if (!message_id || !action) return res.status(400).json({ error: 'message_id and action are required' });

    const learnedBy = req.user.username || req.user.mailbox || 'admin';
    const result = await rspamdLearnMessage('mailserver', containerName, message_id, action, learnedBy);
    res.json(result);

  } catch (error) {
    serverError(res, 'POST /api/rspamd/learn', error);
  }
});


// Endpoint for active Dovecot sessions (admin only)
router.get('/dovecot/:containerName/sessions',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const result = await getDovecotSessions('mailserver', containerName);
    res.json(result);

  } catch (error) {
    serverError(res, 'GET /api/dovecot/sessions', error);
  }
});

export default router;
