import { Router } from 'express';
import { authenticateToken, requireActive, requireAdmin, serverError, validateContainerName } from '../middleware.js';
import { getNodeInfos, getServerEnvs, getServerStatus, getMailLogs, initAPI, killContainer } from '../settings.mjs';
import { dbCount } from '../db.mjs';
import { debugLog } from '../backend.mjs';

const router = Router();
router.param('containerName', validateContainerName);

/**
 * @swagger
 * /api/status/{plugin}/{containerName}:
 *   post:
 *     summary: Get server status
 *     description: Retrieve the status of the docker-mailserver
 *     parameters:
 *       - in: path
 *         name: plugin
 *         required: true
 *         schema:
 *           type: string
 *         description: plugin like mailserver or mailclient
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               settings:
 *                 type: array
 *                 description: array of settings to build getTargetdict
 *     responses:
 *       200:
 *         description: Server status
 *       500:
 *         description: Unable to connect to docker-mailserver
 */
router.post('/status/:plugin/:containerName',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { plugin, containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    const test = ('test' in req.query) ? req.query.test : null;
    const { settings } = req.body;

    const status = await getServerStatus(plugin, containerName, test, settings);

    // Non-admin users only get connection status, not server resources or DB counts
    if (!req.user.isAdmin && status.success && status.message) {
      delete status.message.resources;
      delete status.message.db;
    }

    res.json(status);

  } catch (error) {
    serverError(res, 'index /api/status', error);
  }
});

/**
 * @swagger
 * /api/infos:
 *   get:
 *     summary: Get server infos
 *     description: Retrieve the infos of the docker-mailserver
 *     responses:
 *       200:
 *         description: Server infos
 *       500:
 *         description: Unable to connect to docker-mailserver
 */
router.get('/infos',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const infos = await getNodeInfos();
    res.json(infos);
  } catch (error) {
    serverError(res, 'index /api/infos', error);
  }
});

/**
 * @swagger
 * /api/envs/{plugin}/{containerName}:
 *   get:
 *     summary: Get server envs
 *     description: Retrieve all the DMS envs we parsed or just one
 *     parameters:
 *       - in: path
 *         name: plugin
 *         required: true
 *         schema:
 *           type: string
 *         description: plugin is server type among mailserver, mailclient, etc
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *       - in: query
 *         name: refresh
 *         required: false
 *         default: false
 *         schema:
 *           type: boolean
 *         description: pull data from DMS instead of local database
 *       - in: query
 *         name: name
 *         required: false
 *         default: undefined
 *         schema:
 *           type: string
 *         description: pull data from DMS instead of local database
 *     responses:
 *       200:
 *         description: Server envs
 *       400:
 *         description: Something is missing
 *       500:
 *         description: Unable to connect to docker-mailserver
 */
router.get('/envs/:plugin/:containerName',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { plugin, containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const refresh = ('refresh' in req.query) ? req.query.refresh   : false;
    const name = ('name' in req.query) ? req.query.name : null;
    debugLog('ddebug req.query:', req.query);

    const envs = await getServerEnvs(plugin, containerName, refresh, name);
    res.json(envs);

  } catch (error) {
    serverError(res, 'index /api/envs', error);
  }
});

/**
 * @swagger
 * /api/logs/{containerName}:
 *   get:
 *     summary: Get log lines from DMS container
 *     description: Tail mail.log or rspamd.log (admin only)
 *     parameters:
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [mail, rspamd]
 *           default: mail
 *       - in: query
 *         name: lines
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: Log lines returned successfully
 *       400:
 *         description: Missing parameters
 *       500:
 *         description: Unable to read logs
 */
router.get('/logs/:containerName',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const source = req.query.source || 'mail';
    const lines = req.query.lines || 100;

    const result = await getMailLogs(containerName, source, lines);
    res.json(result);

  } catch (error) {
    serverError(res, 'GET /api/logs', error);
  }
});


/**
 * @swagger
 * /api/getCount/{table}/{containerName}/{schema}:
 *   get:
 *     summary: Get count
 *     description: Get count from a table
 *     parameters:
 *       - in: path
 *         name: table
 *         required: true
 *         schema:
 *           type: string
 *         description: Get count from a table
 *       - in: path
 *         name: containerName
 *         required: false
 *         schema:
 *           type: string
 *         description: scope as needed
 *       - in: path
 *         name: schema
 *         required: false
 *         schema:
 *           type: string
 *         description: schema as needed
 *     responses:
 *       200:
 *         description: Return count from a table
 *       400:
 *         description: parameter table is missing
 *       500:
 *         description: Unable to count table
 */
router.get('/getCount/:table{/:containerName}{/:schema}',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { table, containerName, schema } = req.params;
    if (!table) return res.status(400).json({ error: 'table is required' });

    const count = dbCount(table, containerName, schema);
    res.json(count);

  } catch (error) {
    serverError(res, 'index GET /api/getCount', error);
  }
});


/**
 * @swagger
 * /api/initAPI/{plugin}/{schema}/{containerName}:
 *   post:
 *     summary: Provide or regenerate DMS_API_KEY
 *     description: Provide or regenerate DMS_API_KEY + API scripts
 *     parameters:
 *       - in: path
 *         name: plugin
 *         required: true
 *         schema:
 *           type: string
 *         description: type of container to reboot
 *       - in: path
 *         name: schema
 *         required: true
 *         schema:
 *           type: string
 *         description: subtype of containerName to reboot
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dms_api_key_param:
 *                 type: string
 *                 description: DMS API key to use or 'regen' to  get a new one
 *     responses:
 *       200:
 *         description: DMS_API_KEY from db
 *       400:
 *         description: Something is missing
 *       500:
 *         description: Unable to generate DMS_API_KEY
 */
router.post('/initAPI/:plugin/:schema/:containerName',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { plugin, schema, containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    const { dms_api_key_param } = req.body;

    const dms_api_key_response = await initAPI(plugin, schema, containerName, dms_api_key_param);
    res.json(dms_api_key_response);

  } catch (error) {
    serverError(res, 'index /api/accounts', error);
  }
});


/**
 * @swagger
 * /api/killContainer/{plugin}/{schema}/{containerName}:
 *   post:
 *     summary: reboot this container
 *     description: reboot this container
 *     parameters:
 *       - in: path
 *         name: plugin
 *         required: false
 *         schema:
 *           type: string
 *         description: type of container to reboot
 *       - in: path
 *         name: schema
 *         required: false
 *         schema:
 *           type: string
 *         description: subtype of containerName to reboot
 *       - in: path
 *         name: containerName
 *         required: false
 *         schema:
 *           type: string
 *         description: containerName to reboot
 *     responses:
 *       200:
 *         description: true
 *       401:
 *         description: access denied
 *       500:
 *         description: Unable to restart container
 */
router.post('/killContainer{/:plugin}{/:schema}{/:containerName}',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { plugin, schema, containerName } = req.params;

    const result = killContainer(plugin, schema, containerName);
    res.json({success:true, message: result?.message});

  } catch (error) {
    serverError(res, 'index /api/killContainer', error);
  }
});

export default router;
