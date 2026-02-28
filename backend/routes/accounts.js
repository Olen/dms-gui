import { Router } from 'express';
import { authenticateToken, requireActive, requireAdmin, serverError, validateContainerName } from '../middleware.js';
import { addAccount, deleteAccount, doveadm, getAccounts, setQuota } from '../accounts.mjs';
import { updateDB } from '../db.mjs';
import { debugLog } from '../backend.mjs';

const router = Router();
router.param('containerName', validateContainerName);

/**
 * @swagger
 * /api/accounts/{containerName}:
 *   get:
 *     summary: Get mailbox accounts
 *     description: Retrieve all mailbox accounts
 *     parameters:
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
 *     responses:
 *       200:
 *         description: List of mailbox accounts
 *       500:
 *         description: Unable to retrieve accounts
 */
router.get('/accounts/:containerName',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    const refresh = ('refresh' in req.query) ? req.query.refresh : false;

    // Users can only pull their own mailboxes or those in their roles (unless admin)
    let accounts;
    if (req.user.isAdmin) {
      accounts = await getAccounts(containerName, refresh);

    } else {
      accounts = await getAccounts(containerName, false, req.user.roles);
    }
    res.json(accounts);

  } catch (error) {
    serverError(res, 'index /api/accounts', error);
  }
});

/**
 * @swagger
 * /api/accounts/{schema}/{containerName}:
 *   post:
 *     summary: Add a new mailbox account
 *     description: Add a new mailbox account to the docker-mailserver
 *     parameters:
 *       - in: path
 *         name: schema
 *         required: true
 *         schema:
 *           type: string
 *         description: mailserver type
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mailbox:
 *                 type: string
 *                 format: email
 *                 description: mailbox address of the new account
 *               password:
 *                 type: string
 *                 description: Password for the new account
 *             required:
 *               - mailbox
 *               - password
 *     responses:
 *       201:
 *         description: Account created successfully
 *       400:
 *         description: mailbox and password are required
 *       500:
 *         description: Unable to create account
 */
router.post('/accounts/:schema/:containerName',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { schema, containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const { mailbox, password, createLogin } = req.body;
    if (!mailbox || !password) {
      return res.status(400).json({ error: 'Mailbox and password are required' });
    }
    const result = await addAccount(schema, containerName, mailbox, password, createLogin);
    res.status(201).json(result);

  } catch (error) {
    serverError(res, 'index /api/accounts', error);
  }
});

/**
 * @swagger
 * /api/doveadm/{schema}/{containerName}/{command}/{mailbox}:
 *   put:
 *     summary: Execute doveadm command on mailbox
 *     description: Execute doveadm command on mailbox
 *     parameters:
 *       - in: path
 *         name: schema
 *         required: true
 *         schema:
 *           type: string
 *         description: mailserver type
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *       - in: path
 *         name: command
 *         required: true
 *         schema:
 *           type: string
 *         description: command to execute
 *       - in: path
 *         name: mailbox
 *         required: true
 *         schema:
 *           type: string
 *         description: mailbox to act upon
 *     responses:
 *       200:
 *         description: command executed successfully
 *       400:
 *         description: smth is missing
 *       500:
 *         description: See error message
 */
router.put('/doveadm/:schema/:containerName/:command/:mailbox',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { schema, containerName, command, mailbox } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    if (!command || !mailbox) return res.status(400).json({ error: 'Command and Mailbox are required' });

    // Users can only act on their own mailboxes or those in their roles (unless admin)
    let result;
    if (req.user.isAdmin) {
      result = await doveadm(schema, containerName, command, mailbox, req.body);

    } else {
      result = (req.user.roles.includes(mailbox)) ? await doveadm(schema, containerName, command, mailbox, req.body) : {success: false, error: 'Permission denied'};
    }
    res.json(result);

  } catch (error) {
    serverError(res, 'PUT /api/doveadm', error);
  }
});

/**
 * @swagger
 * /api/accounts/{schema}/{containerName}/{mailbox}:
 *   delete:
 *     summary: Delete a mailbox account
 *     description: Delete an mailbox account from the docker-mailserver
 *     parameters:
 *       - in: path
 *         name: schema
 *         required: true
 *         schema:
 *           type: string
 *         description: mailserver type
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *       - in: path
 *         name: mailbox
 *         required: true
 *         schema:
 *           type: string
 *         description: mailbox address of the account to delete
 *     responses:
 *       200:
 *         description: Account deleted successfully
 *       400:
 *         description: mailbox is required
 *       500:
 *         description: Unable to delete account
 */
router.delete('/accounts/:containerName/:mailbox',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName, mailbox } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    if (!mailbox) {
      return res.status(400).json({ error: 'Mailbox is required' });
    }
    const result = await deleteAccount('dms', containerName, mailbox);
    res.json(result);

  } catch (error) {
    serverError(res, 'index /api/accounts', error);
  }
});

/**
 * @swagger
 * /api/accounts/{containerName}/{mailbox}/quota:
 *   put:
 *     summary: Set mailbox quota
 *     description: Set or remove quota for a mailbox account (admin only)
 *     parameters:
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: mailbox
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quota:
 *                 type: string
 *                 description: Quota value (e.g. "500M", "2G") or "0" for unlimited
 *     responses:
 *       200:
 *         description: Quota updated successfully
 *       400:
 *         description: Missing required parameters
 *       500:
 *         description: Unable to set quota
 */
router.put('/accounts/:containerName/:mailbox/quota',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName, mailbox } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    if (!mailbox) return res.status(400).json({ error: 'mailbox is required' });

    const { quota } = req.body;
    const result = await setQuota(containerName, mailbox, quota);
    if (result.success) {
      // Trigger account refresh to update stored quota data
      await getAccounts(containerName, true);
    }
    res.json(result);

  } catch (error) {
    serverError(res, 'index PUT /api/accounts/quota', error);
  }
});

/**
 * @swagger
 * /api/accounts/{schema}/{containerName}/{mailbox}:
 *   patch:
 *     summary: Update an mailbox account
 *     description: Update an existing mailbox account
 *     parameters:
 *       - in: path
 *         name: schema
 *         required: true
 *         schema:
 *           type: string
 *         description: mailserver type
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *       - in: path
 *         name: mailbox
 *         required: true
 *         schema:
 *           type: string
 *         description: mailbox address of the account to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password:
 *                 type: string
 *                 description: New password for the account
 *               storage:
 *                 type: object
 *                 description: Updated storage data
 *     responses:
 *       200:
 *         description: Account updated successfully
 *       400:
 *         description: Account is required
 *       500:
 *         description: Unable to update account
 */
router.patch('/accounts/:schema/:containerName/:mailbox',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { schema, containerName, mailbox } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    if (!mailbox)       return res.status(400).json({ error: 'Mailbox is required' });

    // Users can only act on their own mailboxes or those in their roles (unless admin)
    let result, jsonDict;
    jsonDict = {...req.body, schema:schema};

    if (req.user.isAdmin) {
      result = await updateDB('accounts', mailbox,jsonDict, containerName);

    } else {
      result = (req.user.roles.includes(mailbox)) ? await updateDB('accounts', mailbox, jsonDict, containerName) : {success: false, error: 'Permission denied'};
    }
    res.json(result);

  } catch (error) {
    serverError(res, 'index PATCH /api/accounts', error);
  }
});

export default router;
