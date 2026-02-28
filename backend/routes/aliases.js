import { Router } from 'express';
import { authenticateToken, requireActive, requireAdmin, serverError, validateContainerName } from '../middleware.js';
import { addAlias, deleteAlias, getAliases } from '../aliases.mjs';
import { dbGet } from '../db.mjs';

const router = Router();
router.param('containerName', validateContainerName);

// Check if non-admin alias management is allowed for the given container
const isUserAliasAllowed = (containerName) => {
  const result = dbGet(
    `SELECT s.value FROM settings s JOIN configs c ON s.configID = c.id WHERE c.plugin = ? AND c.name = ? AND s.name = ? AND s.isMutable = 1`,
    {}, 'userconfig', containerName, 'ALLOW_USER_ALIASES'
  );
  return result.success && result.message?.value === 'true';
};

/**
 * @swagger
 * /api/aliases/{containerName}:
 *   get:
 *     summary: Get aliases
 *     description: Retrieve all email aliases
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
 *         description: List of email aliases
 *       500:
 *         description: Unable to retrieve aliases
 */
router.get('/aliases/:containerName',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    const refresh = ('refresh' in req.query) ? req.query.refresh : false;

    // Users can only act on their own mailboxes or those in their roles (unless admin)
    let result;
    if (req.user.isAdmin) {
      result = await getAliases(containerName, refresh);

    } else {
      result = await getAliases(containerName, false, req.user.roles);
    }
    res.json(result);

  } catch (error) {
    serverError(res, 'index /api/aliases', error);
  }
});

/**
 * @swagger
 * /api/aliases/{containerName}:
 *   post:
 *     summary: Add a new alias
 *     description: Add a new email alias to the docker-mailserver
 *     parameters:
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
 *               source:
 *                 type: string
 *                 description: Source email address for the alias
 *               destination:
 *                 type: string
 *                 description: Destination email address for the alias
 *             required:
 *               - source
 *               - destination
 *     responses:
 *       201:
 *         description: Alias created successfully
 *       400:
 *         description: Source and destination are required
 *       500:
 *         description: Unable to create alias
 */
router.post('/aliases/:containerName',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    const { source, destination } = req.body;
    if (!source || !destination) {
      return res
        .status(400)
        .json({ error: 'Source and destination are required' });
    }

    // Users can only act on their own mailboxes or those in their roles (unless admin)
    let result;
    if (req.user.isAdmin) {
      result = await addAlias(containerName, source, destination);

    } else {
      if (!isUserAliasAllowed(containerName)) {
        return res.status(403).json({ success: false, error: 'Alias creation is disabled for non-admin users' });
      }

      // check source for obvious hack attempt. extract domains and see that they match. Only admins can create aliases for different domain then destination
      let domainSource = source.match(/.*@([\_\-\.\w]+)/);
      let domainDest = destination.match(/.*@([\_\-\.\w]+)/);
      if (!domainSource || !domainDest) {
        return res.status(400).json({ success: false, error: 'Source and destination must contain a valid @domain' });
      }
      let domainsMatch = (domainSource.length === 2 && domainDest.length === 2 && domainSource[1].toLowerCase() === domainDest[1].toLowerCase()) ? true : false;
      result = (req.user.roles.includes(destination) && domainsMatch) ? await addAlias(containerName, source, destination) : {success:false, message: 'Permission denied'};
    }
    res.status(201).json(result);

  } catch (error) {
    serverError(res, 'index /api/aliases', error);
  }
});

/**
 * @swagger
 * /api/aliases/{containerName}:
 *   delete:
 *     summary: Delete an alias
 *     description: Delete an email alias from the docker-mailserver
 *     parameters:
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
 *               source:
 *                 type: string
 *                 description: Source email address for the alias
 *               destination:
 *                 type: string
 *                 description: Destination email address for the alias
 *     responses:
 *       200:
 *         description: Alias deleted successfully
 *       400:
 *         description: Source and destination are required
 *       500:
 *         description: Unable to delete alias
 */
router.delete('/aliases/:containerName',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const { source, destination } = req.body;
    if (!source || !destination) {
      return res
        .status(400)
        .json({ error: 'Source and destination are required' });
    }

    // Users can only act on their own mailboxes or those in their roles (unless admin)
    let result;
    if (req.user.isAdmin) {
      result = await deleteAlias(containerName, source, destination);

    } else {
      if (!isUserAliasAllowed(containerName)) {
        return res.status(403).json({ success: false, error: 'Alias management is disabled for non-admin users' });
      }

      result = (req.user.roles.includes(destination)) ? await deleteAlias(containerName, source, destination) : {success:false, message: 'Permission denied'};
    }
    res.json(result);

  } catch (error) {
    serverError(res, 'DELETE /api/aliases', error);
  }
});

export default router;
