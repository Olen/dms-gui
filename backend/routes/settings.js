import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { authenticateToken, requireActive, requireAdmin, serverError, validateContainerName } from '../middleware.js';
import { getConfigs, getSettings, saveSettings } from '../settings.mjs';
import { dbAll, dbGet } from '../db.mjs';
import { debugLog } from '../backend.mjs';
import { env, plugins } from '../env.mjs';
import { demoResponse } from '../demoMode.mjs';
import { getValueFromArrayOfObj } from '../../common.mjs';

const router = Router();
router.param('containerName', validateContainerName);

// Logo upload config
const UPLOADS_DIR = path.join(env.DMSGUI_CONFIG_PATH || '/app/config', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/x-icon', 'image/webp', 'image/vnd.microsoft.icon'];
const ALLOWED_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp'];
const SCOPE_RE = /^[a-zA-Z0-9_-]+$/;

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const scope = req.params.scope || '_global';
    if (!SCOPE_RE.test(scope)) return cb(new Error('Invalid scope'));
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo-${scope}-${Date.now()}${ext}`);
  },
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIMES.includes(file.mimetype) || !ALLOWED_EXTS.includes(ext)) {
      return cb(new Error('Only image files are allowed (PNG, JPG, GIF, ICO, WebP)'));
    }
    cb(null, true);
  },
});

const BRANDING_KEYS = ['brandName', 'brandIcon', 'brandLogo', 'brandColorPrimary', 'brandColorSidebar'];

// Public branding endpoint — no auth needed (used on login page)
router.get('/branding{/:containerName}', async (req, res) => {
  try {
    const containerName = req.params.containerName || '_global';
    let result = getSettings('dms-gui', containerName);
    // Fallback to global if container config has no branding keys
    // (e.g. "mailserver" config has DMS_API_KEY etc., not branding)
    const hasBranding = result.success && result.message?.some(s => BRANDING_KEYS.includes(s.name));
    if (!hasBranding && containerName !== '_global') {
      result = getSettings('dms-gui', '_global');
    }
    const msg = (result.success && result.message) ? [...result.message] : [];

    // Also include webmailUrl if configured (public — shown on login page)
    try {
      const webmail = dbGet(
        'SELECT s.value FROM settings s JOIN configs c ON s.configID = c.id WHERE c.plugin = ? AND s.name = ? LIMIT 1',
        {}, 'userconfig', 'WEBMAIL_URL'
      );
      if (webmail.success && webmail.message?.value) {
        msg.push({ name: 'webmailUrl', value: webmail.message.value });
      }
    } catch { /* ignore */ }

    res.json({ success: true, message: msg });
  } catch (error) {
    res.json({ success: true, message: [] }); // fail silently with defaults
  }
});

// Upload brand logo (admin only)
router.post('/branding/logo{/:scope}',
  authenticateToken,
  requireActive,
  requireAdmin,
  logoUpload.single('logo'),
async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const scope = req.params.scope || '_global';
    if (!SCOPE_RE.test(scope)) return res.status(400).json({ error: 'Invalid scope' });

    // Delete old logo file if one exists
    const existing = getSettings('dms-gui', scope);
    if (existing.success && existing.message?.length) {
      const oldLogo = getValueFromArrayOfObj(existing.message, 'brandLogo');
      if (oldLogo) {
        const oldPath = path.resolve(UPLOADS_DIR, path.basename(oldLogo));
        if (oldPath.startsWith(UPLOADS_DIR) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }

    // Save brandLogo setting
    const filename = req.file.filename;
    await saveSettings('dms-gui', 'branding', 'dms-gui', scope, [{ name: 'brandLogo', value: filename }]);

    res.json({ success: true, filename, url: `/uploads/${filename}` });

  } catch (error) {
    serverError(res, 'POST /api/branding/logo', error);
  }
});

// Delete brand logo (admin only)
router.delete('/branding/logo{/:scope}',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const scope = req.params.scope || '_global';
    if (!SCOPE_RE.test(scope)) return res.status(400).json({ error: 'Invalid scope' });

    // Find and delete the logo file
    const existing = getSettings('dms-gui', scope);
    if (existing.success && existing.message?.length) {
      const oldLogo = getValueFromArrayOfObj(existing.message, 'brandLogo');
      if (oldLogo) {
        const oldPath = path.resolve(UPLOADS_DIR, path.basename(oldLogo));
        if (oldPath.startsWith(UPLOADS_DIR) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }

    // Clear brandLogo setting
    await saveSettings('dms-gui', 'branding', 'dms-gui', scope, [{ name: 'brandLogo', value: '' }]);

    res.json({ success: true, message: 'Logo removed' });

  } catch (error) {
    serverError(res, 'DELETE /api/branding/logo', error);
  }
});


/**
 * @swagger
 * /api/settings/{plugin}/{containerName}/{scope}:
 *   get:
 *     summary: Get settings
 *     description: Retrieve all or 1 settings
 *     parameters:
 *       - in: path
 *         name: plugin
 *         required: true
 *         schema:
 *           type: string
 *         description: plugin like mailserver or dnscontrol
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *       - in: path
 *         name: scope
 *         required: false
 *         schema:
 *           type: string
 *         description: scope aka owner of the settings like dms-gui or user id
 *       - in: query
 *         name: name
 *         required: false
 *         default: undefined
 *         schema:
 *           type: string
 *         description: pull 1 setting from the db
 *     responses:
 *       200:
 *         description: all or 1 settings even if empty
 *       500:
 *         description: Unable to retrieve settings
 */
router.get('/settings/:plugin/:containerName{/:scope}',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { plugin, containerName, scope } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    const name = ('name' in req.query) ? req.query.name : null;
    const encrypted = ('encrypted' in req.query) ? req.query.encrypted : false;

    const settings = (req.user.isAdmin || String(req.user.id) === scope) ? getSettings(plugin, containerName, name, encrypted) : {success:false, message:'Permission denied'};    // fails silently
    res.json(settings);

  } catch (error) {
    serverError(res, 'GET /api/settings', error);
  }
});


// Endpoint for retrieving public user-facing settings (no admin required)
router.get('/user-settings/:containerName',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const demo = demoResponse('userSettings');
    if (demo) return res.json(demo);

    const publicKeys = ['WEBMAIL_URL', 'IMAP_HOST', 'IMAP_PORT', 'SMTP_HOST', 'SMTP_PORT', 'POP3_HOST', 'POP3_PORT', 'ALLOW_USER_ALIASES', 'RSPAMD_URL'];
    const settings = {};

    // Read directly from DB — getSetting's SQL has a correlated subquery bug
    // that fails when multiple configs share the same plugin name
    const allSettings = dbAll(
      `SELECT s.name, s.value FROM settings s
       JOIN configs c ON s.configID = c.id
       WHERE c.plugin = ? AND c.name = ? AND s.isMutable = 1`,
      {}, 'userconfig', containerName
    );
    if (allSettings.success && allSettings.message) {
      for (const row of allSettings.message) {
        if (publicKeys.includes(row.name)) {
          settings[row.name] = row.value;
        }
      }
    }

    // Count aliases for this user (exact or comma-delimited match, not LIKE substring)
    const mailbox = req.user.mailbox || (req.user.roles && req.user.roles[0]);
    if (mailbox) {
      try {
        const mb = mailbox.replace(/[%_\\]/g, '\\$&');
        const aliasRows = dbAll(
          `SELECT COUNT(*) as count FROM aliases WHERE destination = ? OR destination LIKE ? ESCAPE '\\' OR destination LIKE ? ESCAPE '\\' OR destination LIKE ? ESCAPE '\\'`,
          {}, mailbox, `${mb},%`, `%,${mb},%`, `%,${mb}`
        );
        if (aliasRows.success && aliasRows.message?.[0]) {
          settings.USER_ALIAS_COUNT = aliasRows.message[0].count;
        }
      } catch (e) { /* non-critical */ }
    }

    res.json({ success: true, message: settings });

  } catch (error) {
    serverError(res, 'GET /api/user-settings', error);
  }
});


/**
 * @swagger
 * /api/configs/{plugin}/{name}:
 *   get:
 *     summary: Get config names other then 'dms-gui'
 *     description: Get config names for plugin in parameter
 *     parameters:
 *       - in: path
 *         name: plugin
 *         required: true
 *         schema:
 *           type: string
 *         description: config plugin name among mailserver, dnscontrol
 *       - in: path
 *         name: name
 *         required: false
 *         schema:
 *           type: string
 *         description: name of the config to look for
 *     responses:
 *       200:
 *         description: all config names or empty array
 *       400:
 *         description: something is missing
 *       500:
 *         description: Unable to retrieve configs
 */
router.get('/configs/:plugin{/:name}',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { plugin, name } = req.params;
    // for non-admins:  for mailserver plugin we send scope=roles, for anything else we send scope=userID
    debugLog(            `getConfigs(${plugin}, ${(req.user.isAdmin) ? [] : (plugin === 'mailserver') ? req.user.roles : [req.user.id]}, ${name})`)
    const configs = await getConfigs(plugin,      (req.user.isAdmin) ? [] : (plugin === 'mailserver') ? req.user.roles : [req.user.id],    name);

    // For non-mailserver plugins with templates in env.mjs (e.g. dnscontrol),
    // always serve the static templates — DB rows are container configs, not templates
    if (plugin !== 'mailserver' && plugins[plugin]) {
      const templateEntries = Object.entries(plugins[plugin]).map(([key, val]) => ({ name: key, value: val }));
      if (name) {
        const filtered = templateEntries.filter(e => e.name === name);
        return res.json({ success: true, message: filtered });
      }
      return res.json({ success: true, message: templateEntries });
    }

    res.json(configs);

  } catch (error) {
    serverError(res, 'GET /api/configs', error);
  }
});

/**
 * @swagger
 * /api/settings/{plugin}/{schema}/{scope}/{containerName}:
 *   post:
 *     summary: save settings
 *     description: save settings
 *     parameters:
 *       - in: path
 *         name: plugin
 *         required: true
 *         schema:
 *           type: string
 *         description: plugin like mailserver or dnscontrol
 *       - in: path
 *         name: schema
 *         required: true
 *         schema:
 *           type: string
 *         description: plugin schema like dms or cloudflare etc
 *       - in: path
 *         name: scope
 *         required: true
 *         schema:
 *           type: string
 *         description: scope aka owner of the settings like dms-gui or user id
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: config name that can also be a DMS containerName
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               properties:
 *                 name:
 *                  type: string
 *                 value:
 *                  type: string
 *             minItems: 1
 *             uniqueItems: true
 *     responses:
 *       201:
 *         description: settings saved successfully
 *       400:
 *         description: something is missing
 *       500:
 *         description: Unable to save settings
 */
router.post('/settings/:plugin/:schema/:scope/:containerName',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { plugin, schema, scope, containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const encrypted = ('encrypted' in req.query) ? req.query.encrypted : false;

    debugLog('ddebug containerName', containerName);
    debugLog('ddebug req.body', req.body);
    const result = await saveSettings(plugin, schema, scope, containerName, req.body, encrypted);     // req.body = [{name:name, value:value}, ..]
    res.status(201).json(result);

  } catch (error) {
    serverError(res, 'index POST /api/settings', error);
  }
});

export { logoUpload };
export default router;
