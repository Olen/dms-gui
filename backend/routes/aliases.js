import { Router } from 'express';
import {
  authenticateToken,
  denyPermission,
  requireActive,
  requireAdmin,
  serverError,
  validateContainerName,
} from '../middleware.js';
import { addAlias, deleteAlias, getAliases, updateAlias } from '../aliases.mjs';
import { dbGet } from '../db.mjs';

const router = Router();
router.param('containerName', validateContainerName);

// Check if non-admin alias management is allowed for the given container
const isUserAliasAllowed = (containerName) => {
  const result = dbGet(
    `SELECT s.value FROM settings s JOIN configs c ON s.configID = c.id WHERE c.plugin = ? AND c.name = ? AND s.name = ? AND s.isMutable = 1`,
    {},
    'userconfig',
    containerName,
    'ALLOW_USER_ALIASES'
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
router.get(
  '/aliases/:containerName',
  authenticateToken,
  requireActive,
  async (req, res) => {
    try {
      const { containerName } = req.params;
      if (!containerName)
        return res.status(400).json({ error: 'containerName is required' });
      // Robust to both the production query parser (booleans) and any
      // caller / test that uses Express's default parser (strings).
      // `?refresh=false` must NOT trigger a refresh.
      const refresh =
        req.query.refresh === true ||
        req.query.refresh === 'true' ||
        req.query.refresh === '1';

      // Users can only act on their own mailboxes or those in their roles (unless admin)
      let result;
      if (req.user.isAdmin) {
        result = await getAliases(containerName, refresh);
      } else {
        result = await getAliases(containerName, false, req.user.roles);
      }
      res.json(result);
    } catch (error) {
      serverError(res, 'GET /api/aliases', error);
    }
  }
);

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
router.post(
  '/aliases/:containerName',
  authenticateToken,
  requireActive,
  async (req, res) => {
    try {
      const { containerName } = req.params;
      if (!containerName)
        return res.status(400).json({ error: 'containerName is required' });
      const { source, destination } = req.body;
      if (!source || !destination) {
        return res
          .status(400)
          .json({ error: 'Source and destination are required' });
      }

      //
      // Non-admin alias-creation policy (POST):
      //
      //   1. ALLOW_USER_ALIASES must be enabled for this container (operator
      //      opt-in — admins can disable per-user aliases entirely).
      //   2. Both source and destination must contain a valid @domain.
      //   3. Source and destination domains must match (a user cannot create
      //      cross-domain forwarders; that prevents using one domain's
      //      "respected" local-parts to phish into a domain they don't own).
      //   4. Destination must be in req.user.roles — the user must already
      //      be the recipient of the forwarded mail. This is the load-bearing
      //      check; it ensures a user can only redirect mail TO themselves.
      //
      // Note: the source local-part is intentionally NOT restricted to the
      // user's roles. The whole point of role-based alias delegation is that
      // a user with a role for `userA@example.com` can create forwarders like
      // `info@example.com -> userA@example.com` even though `info@` isn't a
      // pre-existing role. The "they could create postmaster@example.com ->
      // self" risk is accepted: granting a user a role for a destination
      // mailbox in that domain implies you trust them to redirect any
      // local-part of that domain to themselves. If you don't want them
      // capturing postmaster@/abuse@ etc., don't grant a role whose
      // destination is in that domain.
      //
      let result;
      if (req.user.isAdmin) {
        result = await addAlias(containerName, source, destination);
      } else {
        if (!isUserAliasAllowed(containerName)) {
          return res.status(403).json({
            success: false,
            error: 'Alias creation is disabled for non-admin users',
          });
        }

        let domainSource = source.match(/.*@([_\-.\w]+)/);
        let domainDest = destination.match(/.*@([_\-.\w]+)/);
        if (!domainSource || !domainDest) {
          return res.status(400).json({
            success: false,
            error: 'Source and destination must contain a valid @domain',
          });
        }
        let domainsMatch =
          domainSource.length === 2 &&
          domainDest.length === 2 &&
          domainSource[1].toLowerCase() === domainDest[1].toLowerCase()
            ? true
            : false;
        if (!req.user.roles.includes(destination) || !domainsMatch) {
          return denyPermission(res);
        }
        result = await addAlias(containerName, source, destination);
      }
      res.status(result.success ? 201 : 500).json(result);
    } catch (error) {
      serverError(res, 'POST /api/aliases', error);
    }
  }
);

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
router.delete(
  '/aliases/:containerName',
  authenticateToken,
  requireActive,
  async (req, res) => {
    try {
      const { containerName } = req.params;
      if (!containerName)
        return res.status(400).json({ error: 'containerName is required' });

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
          return res.status(403).json({
            success: false,
            error: 'Alias management is disabled for non-admin users',
          });
        }

        if (!req.user.roles.includes(destination)) {
          return denyPermission(res);
        }
        result = await deleteAlias(containerName, source, destination);
      }
      res.json(result);
    } catch (error) {
      serverError(res, 'DELETE /api/aliases', error);
    }
  }
);

/**
 * @swagger
 * /api/aliases/{containerName}:
 *   put:
 *     summary: Update an alias's destinations
 *     description: Update the destination list of an existing alias. Source is read-only. Regex aliases are not editable.
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
 *                 description: Source email address (must already exist)
 *               destination:
 *                 type: string
 *                 description: New comma-separated destination list
 *             required:
 *               - source
 *               - destination
 *     responses:
 *       200:
 *         description: Alias updated successfully
 *       400:
 *         description: Source and destination are required
 *       403:
 *         description: Permission denied
 *       500:
 *         description: Unable to update alias
 */
router.put(
  '/aliases/:containerName',
  authenticateToken,
  requireActive,
  async (req, res) => {
    try {
      const { containerName } = req.params;
      if (!containerName)
        return res.status(400).json({ error: 'containerName is required' });

      const { source, destination } = req.body;
      if (!source || !destination) {
        return res
          .status(400)
          .json({ error: 'Source and destination are required' });
      }

      let result;
      if (req.user.isAdmin) {
        result = await updateAlias(containerName, source, destination);
      } else {
        if (!isUserAliasAllowed(containerName)) {
          return res.status(403).json({
            success: false,
            error: 'Alias management is disabled for non-admin users',
          });
        }

        // Non-admin: every destination must be in the user's roles, and source
        // domain must match every destination domain (defensive against
        // cross-domain hijacking).
        const dests = destination
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean);
        if (dests.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'At least one destination is required',
          });
        }
        const sourceMatch = source.match(/.*@([_\-.\w]+)/);
        if (!sourceMatch) {
          return res.status(400).json({
            success: false,
            error: 'Source must contain a valid @domain',
          });
        }
        const sourceDomain = sourceMatch[1].toLowerCase();

        for (const d of dests) {
          const m = d.match(/.*@([_\-.\w]+)/);
          if (!m) {
            return res.status(400).json({
              success: false,
              error: 'Destinations must contain a valid @domain',
            });
          }
          if (m[1].toLowerCase() !== sourceDomain) {
            return res
              .status(403)
              .json({ success: false, error: 'Permission denied' });
          }
          if (!req.user.roles.includes(d)) {
            return res
              .status(403)
              .json({ success: false, error: 'Permission denied' });
          }
        }

        result = await updateAlias(containerName, source, destination);
      }

      res.json(result);
    } catch (error) {
      serverError(res, 'PUT /api/aliases', error);
    }
  }
);

export default router;
