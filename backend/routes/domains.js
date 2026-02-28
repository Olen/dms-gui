import { Router } from 'express';
import { authenticateToken, requireActive, requireAdmin, isValidDomain, serverError, validateContainerName } from '../middleware.js';
import { dnsLookup, dnsblCheck, generateDkim, getDkimSelector, getDomains } from '../settings.mjs';
import { updateDB } from '../db.mjs';
import { errorLog } from '../backend.mjs';
import { upsertDnsRecord } from '../dnsProviders.mjs';

const router = Router();
router.param('containerName', validateContainerName);

// Endpoint for testing DNS provider credentials
router.post('/dnscontrol/test',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { type, ...creds } = req.body;
    if (!type) return res.status(400).json({ success: false, error: 'Provider type is required' });

    const providerType = type.toUpperCase();
    let testResult;

    if (providerType === 'DOMAINNAMESHOP') {
      // Domeneshop: GET /v0/domains with HTTP Basic (token:secret)
      const response = await fetch('https://api.domeneshop.no/v0/domains', {
        headers: { 'Authorization': 'Basic ' + Buffer.from(`${creds.token}:${creds.secret}`).toString('base64') },
      });
      if (response.ok) {
        const domains = await response.json();
        testResult = { success: true, message: `OK — ${domains.length} domain(s) found` };
      } else {
        testResult = { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

    } else if (providerType === 'CLOUDFLAREAPI') {
      // Cloudflare: GET /client/v4/user/tokens/verify with Bearer token
      const response = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { 'Authorization': `Bearer ${creds.apitoken}` },
      });
      const data = await response.json();
      if (data.success) {
        testResult = { success: true, message: `OK — token status: ${data.result?.status || 'active'}` };
      } else {
        testResult = { success: false, error: data.errors?.[0]?.message || `HTTP ${response.status}` };
      }

    } else if (providerType === 'ROUTE53') {
      testResult = { success: false, error: 'Test not supported for Route53 — verify credentials by assigning a domain' };

    } else if (providerType === 'ORACLE') {
      testResult = { success: false, error: 'Test not supported for Oracle — verify credentials by assigning a domain' };

    } else if (providerType === 'AZURE_PRIVATE_DNS') {
      testResult = { success: false, error: 'Test not supported for Azure Private DNS — verify credentials by assigning a domain' };

    } else {
      testResult = { success: false, error: `Test not supported for provider type: ${type}` };
    }

    res.json(testResult);

  } catch (error) {
    errorLog(`POST /api/dnscontrol/test: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Endpoint for pushing DNS records to a domain's assigned DNS provider
router.post('/dnscontrol/:containerName/:domain/records',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName, domain } = req.params;
    if (!containerName) return res.status(400).json({ success: false, error: 'containerName is required' });
    if (!domain) return res.status(400).json({ success: false, error: 'domain is required' });
    if (!isValidDomain(domain)) return res.status(400).json({ success: false, error: 'Invalid domain format' });

    const { name, type, data } = req.body;
    if (!name || !type || !data) return res.status(400).json({ success: false, error: 'name, type, and data are required' });

    const result = await upsertDnsRecord(containerName, domain, { name, type, data });
    res.json(result);

  } catch (error) {
    errorLog(`POST /api/dnscontrol/records: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Get DKIM selector from rspamd signing config
router.get('/domains/:containerName/dkim-selector',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    const result = await getDkimSelector('mailserver', containerName);
    res.json(result);
  } catch (error) {
    serverError(res, 'index GET /api/domains/dkim-selector', error);
  }
});

/**
 * @swagger
 * /api/domains/{containerName}/{domain}:
 *   get:
 *     summary: Get domain(s)
 *     description: Retrieve 1 or all domains
 *     parameters:
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *       - in: path
 *         name: domain
 *         required: false
 *         default: undefined
 *         schema:
 *           type: string
 *         description: pull only that domain from the db
 *     responses:
 *       200:
 *         description: all domains even if empty
 *       400:
 *         description: Something is missing
 *       500:
 *         description: Unable to retrieve domains
 */
router.get('/domains/:containerName{/:domain}',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName, domain } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const domains = await getDomains(containerName, domain);
    res.json(domains);

  } catch (error) {
    serverError(res, `index GET /api/domains/${req.params.domain}/${req.params.containerName}`, error);
  }
});

/**
 * @swagger
 * /api/domains/{containerName}/{domain}:
 *   patch:
 *     summary: Update domain settings
 *     description: Update domain properties like DNS provider (admin only)
 *     parameters:
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: domain
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
 *               dnsProvider:
 *                 type: string
 *     responses:
 *       200:
 *         description: Domain updated
 *       400:
 *         description: Missing parameters
 *       500:
 *         description: Unable to update domain
 */
router.patch('/domains/:containerName/:domain',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName, domain } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    if (!isValidDomain(domain)) return res.status(400).json({ error: 'invalid domain' });

    const result = await updateDB('domains', domain, req.body, containerName);
    res.json(result);

  } catch (error) {
    serverError(res, 'index PATCH /api/domains', error);
  }
});

/**
 * @swagger
 * /api/dns/{containerName}/{domain}:
 *   get:
 *     summary: DNS lookup for a domain
 *     description: Retrieve A, MX, SPF, DKIM, DMARC records for a domain
 *     parameters:
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         description: Domain to look up
 *     responses:
 *       200:
 *         description: DNS records for the domain
 *       400:
 *         description: Something is missing
 *       500:
 *         description: Unable to perform DNS lookup
 */
router.get('/dns/:containerName/:domain',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName, domain } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain format' });

    // Try to get DKIM selector from domain DB entry
    let dkimSelector = 'dkim';
    try {
      const domainInfo = await getDomains(containerName, domain);
      const dkim = domainInfo?.message?.message?.dkim || domainInfo?.message?.dkim;
      if (dkim) dkimSelector = dkim;
    } catch (e) { /* fall back to default selector */ }

    const result = await dnsLookup(domain, dkimSelector);
    res.json(result);

  } catch (error) {
    serverError(res, 'index GET /api/dns', error);
  }
});

/**
 * @swagger
 * /api/domains/{containerName}/{domain}/dkim:
 *   post:
 *     summary: Generate DKIM key
 *     description: Generate a DKIM key pair for a domain using DMS setup
 *     parameters:
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         description: Domain to generate DKIM key for
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               keytype:
 *                 type: string
 *                 default: rsa
 *               keysize:
 *                 type: string
 *                 default: '2048'
 *               selector:
 *                 type: string
 *                 default: mail
 *               force:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: DKIM key generated with DNS record
 *       400:
 *         description: Something is missing
 *       500:
 *         description: Unable to generate DKIM key
 */
router.post('/domains/:containerName/:domain/dkim',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName, domain } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain format' });

    const { keytype, keysize, selector, force } = req.body;
    const result = await generateDkim('mailserver', containerName, domain, keytype, keysize, selector, force);
    res.json(result);

  } catch (error) {
    serverError(res, 'index POST /api/domains/dkim', error);
  }
});

/**
 * @swagger
 * /api/dnsbl/{containerName}/{domain}:
 *   get:
 *     summary: Check DNS blacklists
 *     description: Check if domain's mail server IP is on any DNS blacklists
 *     parameters:
 *       - in: path
 *         name: containerName
 *         required: true
 *         schema:
 *           type: string
 *         description: DMS containerName
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         description: Domain to check blacklists for
 *     responses:
 *       200:
 *         description: Blacklist check results
 *       400:
 *         description: Something is missing
 *       500:
 *         description: Unable to check blacklists
 */
router.get('/dnsbl/:containerName/:domain',
  authenticateToken,
  requireActive,
  requireAdmin,
async (req, res) => {
  try {
    const { containerName, domain } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain format' });

    const result = await dnsblCheck(containerName, domain);
    res.json(result);

  } catch (error) {
    serverError(res, 'index GET /api/dnsbl', error);
  }
});

export default router;
