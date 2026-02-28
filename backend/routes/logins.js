import { Router } from 'express';
import { authenticateToken, requireActive, requireAdmin, serverError } from '../middleware.js';
import { addLogin, getLogins, getRoles } from '../logins.mjs';
import { deleteEntry, updateDB } from '../db.mjs';
import { debugLog, errorLog } from '../backend.mjs';

const router = Router();

/**
 * @swagger
 * /api/roles/{credential}:
 *   get:
 *     summary: Get user roles
 *     description: Retrieve all roles from a user
 *     parameters:
 *       - in: path
 *         name: credential
 *         required: true
 *         schema:
 *           type: string
 *         description: login credential = mailbox
 *     responses:
 *       200:
 *         description: all roles even if empty
 *       500:
 *         description: Unable to retrieve roles
 */
router.get('/roles/:credential',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { credential } = req.params;
    if (!credential) return res.status(400).json({ error: 'credential is required' });

    // Users can only act on their own mailboxes or those in their roles (unless admin)
    let result;
    if (req.user.isAdmin) {
      result = await getRoles(credential);

    } else {
      result = (credential === req.user.mailbox) ? await getRoles(credential) : {success:false, message: 'Permission denied'};
    }
    res.json(result);

  } catch (error) {
    errorLog(`index GET /api/roles: ${error.message}`);
    res.status(500).json({ error: 'Unable to retrieve roles' });
  }
});


/**
 * @swagger
 * /api/getLogins:
 *   post:
 *     summary: Get logins
 *     description: Retrieve all or 1 logins
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: string
 *             minItems: 0
 *             uniqueItems: false
 *     responses:
 *       200:
 *         description: all logins even if empty
 *       500:
 *         description: Unable to retrieve logins
 */
router.post('/getLogins',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { ids } = req.body;

    const logins = await getLogins(ids);
    res.json(logins);

  } catch (error) {
    serverError(res, 'index POST /api/getLogins', error);
  }
});


/**
 * @swagger
 * /api/logins:
 *   put:
 *     summary: add Login
 *     description: add Login in db
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
 *                 description: mailbox address of the new login account
 *               username:
 *                 type: string
 *                 default: ''
 *                 description: Login name of the new login account
 *               email:
 *                 type: string
 *                 format: email
 *                 description: external email address for password recovery
 *               password:
 *                 type: string
 *                 description: Password for the new login account
 *               isAdmin:
 *                 type: boolean
 *                 default: 0
 *                 description: Is the user an admin
 *               isActive:
 *                 type: boolean
 *                 default: 1
 *                 description: Is the user active
 *               roles:
 *                 type: array
 *                 default: []
 *                 description: mailboxes the user can manage
 *             required:
 *               - mailbox
 *               - username
 *               - password
 *               - isAdmin
 *     responses:
 *       201:
 *         description: Login saved successfully
 *       400:
 *         description: Something is missing
 *       500:
 *         description: Unable to save Login
 */
router.put('/logins',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { mailbox, username, password, email, isAdmin, isAccount, isActive, mailserver, roles } = req.body;
    if (!mailbox)     return res.status(400).json({ error: 'mailbox is missing' });
    if (!username)  return res.status(400).json({ error: 'username is missing' });
    if (!password)  return res.status(400).json({ error: 'password is missing' });

    const result = await addLogin(mailbox, username, password, email, isAdmin, isAccount, isActive, mailserver, roles);
    res.status(201).json(result);

  } catch (error) {
    serverError(res, 'index PUT /api/logins', error);
  }
});

/**
 * @swagger
 * /api/logins/{id}:
 *   patch:
 *     summary: Update a login data
 *     description: Update the data for an existing login account
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: id of the login account to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password:
 *                 type: string
 *                 description: New password for the login account
 *               mailbox:
 *                 type: string
 *                 format: email
 *                 description: New mailbox for the login account
 *               email:
 *                 type: string
 *                 format: email
 *                 description: New email for the login account
 *               isAdmin:
 *                 type: integer
 *                 description: is login account admin
 *               isActive:
 *                 type: integer
 *                 description: de/activate login account
 *               mailserver:
 *                 type: string
 *                 description: New mailbox for the login account
 *     responses:
 *       200:
 *         description: Data updated successfully
 *       400:
 *         description: id or data are required
 *       500:
 *         description: Unable to update login
 */
router.patch('/logins/:id',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    // Users can only act on their own mailboxes or those in their roles (unless admin)
    let result;
    if (req.user.isAdmin) {
      result = await updateDB('logins', id, req.body);

    } else {
      // Non-admins: strip privilege fields to prevent escalation
      const { isAdmin, isActive, roles, ...safeBody } = req.body;
      result = (Number(id) === req.user.id) ? await updateDB('logins', id, safeBody) : {success:false, message: 'Permission denied'};
    }
    debugLog(`index PATCH /api/logins/${id}`, result)
    res.json(result);

  } catch (error) {
    serverError(res, 'index PATCH /api/logins', error);
  }
});


/**
 * @swagger
 * /api/logins/{id}:
 *   delete:
 *     summary: Delete a login account
 *     description: Delete a login account from dms-gui
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: id of the account to delete
 *     responses:
 *       200:
 *         description: Login deleted successfully
 *       400:
 *         description: id is required
 *       500:
 *         description: Unable to delete login
 */
router.delete('/logins/:id',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const result = await deleteEntry('logins', id);
    res.json(result);

  } catch (error) {
    serverError(res, 'index /api/login', error);
  }
});

export default router;
