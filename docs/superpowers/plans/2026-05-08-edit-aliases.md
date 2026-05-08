# Edit Email Aliases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to edit destinations of an existing email alias (source stays read-only) via a pencil-icon modal, backed by a new `PUT /api/aliases/:containerName` endpoint that diffs old vs new destinations and applies only the changes via DMS `alias add`/`alias del`.

**Architecture:** Backend grows a new `updateAlias` function in `backend/aliases.mjs` and a new `PUT` route in `backend/routes/aliases.js`. Frontend adds a `services/api.mjs` method, a new `AliasEditModal` component, and wires a pencil button + modal state into `Aliases.jsx`. Three locales (en, no, pl) get four new keys.

**Tech Stack:** Node.js / Express / better-sqlite3 / vitest / supertest on the backend; React / Vite / react-bootstrap / react-select / vitest+@testing-library/react on the frontend.

**Reference spec:** `docs/superpowers/specs/2026-05-08-edit-aliases-design.md`

---

## File Structure

**Backend:**
- Modify `backend/aliases.mjs` — add `updateAlias` export
- Modify `backend/routes/aliases.js` — add `PUT /aliases/:containerName` route
- Create `backend/aliases.test.js` — unit tests for `updateAlias` (file does not currently exist)
- Create `backend/routes/aliases.test.js` — route tests (file does not currently exist)

**Frontend:**
- Modify `frontend/src/services/api.mjs` — add `updateAlias` export (insert after line 391, next to `addAlias`/`deleteAlias`)
- Create `frontend/src/components/AliasEditModal.jsx` — new modal component
- Modify `frontend/src/components/index.jsx` — re-export `AliasEditModal` (if components are barrel-exported there; check first)
- Modify `frontend/src/pages/Aliases.jsx` — pencil button, edit handler, modal mount
- Modify `frontend/src/pages/Aliases.test.jsx` — three new tests

**i18n:**
- Modify `frontend/src/locales/en/translation.json`
- Modify `frontend/src/locales/no/translation.json`
- Modify `frontend/src/locales/pl/translation.json`

---

## Task 1: Backend — `updateAlias` for the no-op case

**Files:**
- Test: `backend/aliases.test.js` (create)
- Modify: `backend/aliases.mjs` (add `updateAlias` export at end of file, before the commented-out `module.exports`)

This task introduces the function with the simplest behaviour: when the new destination set equals the old one, return success without touching DMS or the DB.

- [ ] **Step 1: Create the failing test file**

Create `backend/aliases.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test.
// Pattern matches backend/routes/accounts.test.js.
vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
  execCommand: vi.fn(),
  execSetup: vi.fn(),
  formatDMSError: vi.fn(async (_label, stderr) => stderr || 'dms error'),
}));

vi.mock('./env.mjs', () => ({
  env: { DMS_CONFIG_PATH: '/tmp/dms-config' },
}));

vi.mock('./demoMode.mjs', () => ({
  demoResponse: vi.fn(() => null),
  demoWriteResponse: vi.fn(() => null),
}));

const mockDbAll = vi.fn();
const mockDbRun = vi.fn();
const mockDbGet = vi.fn();
const mockDeleteEntry = vi.fn();
const mockGetTargetDict = vi.fn(() => ({ host: 'localhost' }));

vi.mock('./db.mjs', () => ({
  dbAll: (...a) => mockDbAll(...a),
  dbRun: (...a) => mockDbRun(...a),
  dbGet: (...a) => mockDbGet(...a),
  deleteEntry: (...a) => mockDeleteEntry(...a),
  getTargetDict: (...a) => mockGetTargetDict(...a),
  sql: {
    aliases: {
      select: { aliases: 'SELECT ... aliases' },
      insert: { alias: 'REPLACE INTO aliases ...' },
      delete: { bySource: 'DELETE ... bySource' },
    },
  },
}));

vi.mock('./settings.mjs', () => ({
  getConfigs: vi.fn(),
}));

import { execSetup } from './backend.mjs';
import { updateAlias } from './aliases.mjs';

describe('updateAlias', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no-op success when new destination equals old, without calling DMS or DB', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'info@example.com', destination: 'a@example.com,b@example.com', regex: 0 }],
    });

    const result = await updateAlias('mailserver', 'info@example.com', 'a@example.com,b@example.com');

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/no changes/i);
    expect(execSetup).not.toHaveBeenCalled();
    expect(mockDbRun).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd backend && npx vitest run aliases.test.js`
Expected: FAIL with `updateAlias is not a function` or similar import-resolution error.

- [ ] **Step 3: Add the minimal `updateAlias` implementation**

Append to `backend/aliases.mjs`, just before the commented-out `module.exports` block at the end:

```js
// Function to update an alias by diffing destination sets.
// Source stays read-only; we add new destinations and remove gone ones.
// Regex aliases (regex=1) are not supported.
export const updateAlias = async (containerName=null, source=null, newDestination=null) => {
  if (!containerName) return {success: false, error: 'containerName is null'};
  if (!source) return {success: false, error: 'source is null'};
  if (!newDestination) return {success: false, error: 'destination is null'};

  const demo = demoWriteResponse(`Alias updated: ${source}`);
  if (demo) return demo;

  // Look up existing alias from the DB cache. We read all aliases for the
  // container and find by source, mirroring how getAliases reads.
  const allRes = dbAll(sql.aliases.select.aliases, {}, containerName);
  if (!allRes.success) return allRes;
  const existing = (allRes.message || []).find(a => a.source === source);
  if (!existing) return {success: false, error: 'Alias not found'};
  if (existing.regex) return {success: false, error: 'Editing regex aliases is not supported'};

  // Split, trim, drop empties.
  const splitTrim = (s) => String(s).split(',').map(d => d.trim()).filter(Boolean);
  const oldList = splitTrim(existing.destination);
  const newList = splitTrim(newDestination);

  if (newList.length === 0) return {success: false, error: 'destination is null'};

  // Case-insensitive set diff. Track lowercase-keyed lookup but preserve
  // original-case strings when issuing alias add/del to DMS.
  const lowerSet = (list) => new Set(list.map(d => d.toLowerCase()));
  const oldLower = lowerSet(oldList);
  const newLower = lowerSet(newList);
  const added = newList.filter(d => !oldLower.has(d.toLowerCase()));
  const removed = oldList.filter(d => !newLower.has(d.toLowerCase()));

  if (added.length === 0 && removed.length === 0) {
    return {success: true, message: 'No changes'};
  }

  // Future tasks expand this function. For now, no-op success only.
  return {success: false, error: 'not implemented yet'};
};
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx vitest run aliases.test.js`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add backend/aliases.mjs backend/aliases.test.js
git commit -m "Add updateAlias stub with no-op short-circuit"
```

---

## Task 2: Backend — `updateAlias` pure-add diff

**Files:**
- Modify: `backend/aliases.test.js`
- Modify: `backend/aliases.mjs`

- [ ] **Step 1: Add the pure-add test**

Append a new `it` block inside the existing `describe('updateAlias', ...)` in `backend/aliases.test.js`:

```js
  it('issues alias add for each added destination and updates DB on success', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'info@example.com', destination: 'a@example.com', regex: 0 }],
    });
    execSetup.mockResolvedValue({ returncode: 0, stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias('mailserver', 'info@example.com', 'a@example.com,b@example.com');

    expect(result.success).toBe(true);
    expect(execSetup).toHaveBeenCalledTimes(1);
    expect(execSetup).toHaveBeenCalledWith(
      expect.stringMatching(/^alias add 'info@example\.com' 'b@example\.com'$/),
      expect.any(Object),
    );
    // DB updated with the merged set
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ source: 'info@example.com', destination: 'a@example.com,b@example.com', regex: 0 }),
      'mailserver',
    );
  });
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd backend && npx vitest run aliases.test.js`
Expected: FAIL — `updateAlias` returns the "not implemented yet" placeholder.

- [ ] **Step 3: Implement add/del/update logic in `updateAlias`**

Replace the placeholder return at the bottom of `updateAlias` (the `return {success: false, error: 'not implemented yet'};` line) with:

```js
  const targetDict = getTargetDict('mailserver', containerName);
  const failedRemove = [];
  const failedAdd = [];

  // Removals first, so the alias is never temporarily over-fanned-out
  // beyond what the user requested.
  for (const dest of removed) {
    const r = await execSetup(`alias del ${escapeShellArg(source)} ${escapeShellArg(dest)}`, targetDict);
    if (r.returncode) {
      const msg = await formatDMSError('execSetup', r.stderr);
      errorLog(`Failed to remove ${source} -> ${dest}: ${msg}`);
      failedRemove.push(dest);
    }
  }

  for (const dest of added) {
    const r = await execSetup(`alias add ${escapeShellArg(source)} ${escapeShellArg(dest)}`, targetDict);
    if (r.returncode) {
      const msg = await formatDMSError('execSetup', r.stderr);
      errorLog(`Failed to add ${source} -> ${dest}: ${msg}`);
      failedAdd.push(dest);
    }
  }

  // Compute what actually exists on DMS now:
  // = (oldList minus removals that succeeded) plus (additions that succeeded)
  const lower = (s) => s.toLowerCase();
  const failedRemoveLower = new Set(failedRemove.map(lower));
  const failedAddLower = new Set(failedAdd.map(lower));
  const survivingFromOld = oldList.filter(d => !removed.includes(d) || failedRemoveLower.has(lower(d)));
  const successfulAdds = added.filter(d => !failedAddLower.has(lower(d)));
  const actualSet = [...survivingFromOld, ...successfulAdds];

  // Persist the actual state. Use REPLACE-style insert (sql.aliases.insert.alias).
  const dbResult = dbRun(sql.aliases.insert.alias,
    { source, destination: actualSet.join(','), regex: 0 },
    containerName);

  if (failedRemove.length === 0 && failedAdd.length === 0) {
    if (!dbResult.success) return dbResult;
    successLog(`Alias updated: ${source}`);
    return { success: true, message: `Alias updated: ${source}` };
  }

  const failed = [...failedRemove, ...failedAdd];
  return { success: false, error: `Partially updated. Failed: ${failed.join(', ')}` };
```

- [ ] **Step 4: Run all `updateAlias` tests**

Run: `cd backend && npx vitest run aliases.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/aliases.mjs backend/aliases.test.js
git commit -m "Implement diff-based add/del logic in updateAlias"
```

---

## Task 3: Backend — `updateAlias` pure-remove and mixed diff

**Files:**
- Modify: `backend/aliases.test.js`

The implementation from Task 2 already handles these — these tests pin the behaviour.

- [ ] **Step 1: Add two more tests**

Append inside `describe('updateAlias', ...)`:

```js
  it('issues alias del for each removed destination', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'info@example.com', destination: 'a@example.com,b@example.com', regex: 0 }],
    });
    execSetup.mockResolvedValue({ returncode: 0, stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias('mailserver', 'info@example.com', 'a@example.com');

    expect(result.success).toBe(true);
    expect(execSetup).toHaveBeenCalledTimes(1);
    expect(execSetup).toHaveBeenCalledWith(
      expect.stringMatching(/^alias del 'info@example\.com' 'b@example\.com'$/),
      expect.any(Object),
    );
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ destination: 'a@example.com' }),
      'mailserver',
    );
  });

  it('handles a mixed diff: removes one, adds one', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'info@example.com', destination: 'a@example.com,b@example.com', regex: 0 }],
    });
    execSetup.mockResolvedValue({ returncode: 0, stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias('mailserver', 'info@example.com', 'b@example.com,c@example.com');

    expect(result.success).toBe(true);
    expect(execSetup).toHaveBeenCalledTimes(2);
    // First: del a@; second: add c@. Order: removals before additions.
    expect(execSetup.mock.calls[0][0]).toMatch(/^alias del 'info@example\.com' 'a@example\.com'$/);
    expect(execSetup.mock.calls[1][0]).toMatch(/^alias add 'info@example\.com' 'c@example\.com'$/);
  });
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && npx vitest run aliases.test.js`
Expected: PASS, 4 tests total.

- [ ] **Step 3: Commit**

```bash
git add backend/aliases.test.js
git commit -m "Pin updateAlias behaviour for pure-remove and mixed diffs"
```

---

## Task 4: Backend — `updateAlias` rejects regex aliases and missing rows

**Files:**
- Modify: `backend/aliases.test.js`

- [ ] **Step 1: Add tests for the rejection paths**

Append inside `describe('updateAlias', ...)`:

```js
  it('rejects regex aliases without calling DMS', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: '/^info.*/', destination: 'a@example.com', regex: 1 }],
    });

    const result = await updateAlias('mailserver', '/^info.*/', 'b@example.com');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/regex aliases is not supported/i);
    expect(execSetup).not.toHaveBeenCalled();
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('rejects when the alias does not exist in the DB', async () => {
    mockDbAll.mockReturnValue({ success: true, message: [] });

    const result = await updateAlias('mailserver', 'gone@example.com', 'a@example.com');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(execSetup).not.toHaveBeenCalled();
  });

  it('rejects empty newDestination', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'info@example.com', destination: 'a@example.com', regex: 0 }],
    });

    const result = await updateAlias('mailserver', 'info@example.com', '');

    expect(result.success).toBe(false);
    expect(execSetup).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && npx vitest run aliases.test.js`
Expected: PASS, 7 tests total.

- [ ] **Step 3: Commit**

```bash
git add backend/aliases.test.js
git commit -m "Pin updateAlias rejection paths (regex, missing, empty)"
```

---

## Task 5: Backend — `updateAlias` partial-failure handling

**Files:**
- Modify: `backend/aliases.test.js`

The Task 2 implementation already reconciles the DB to the actual surviving set on partial failure. This task adds the test that pins it.

- [ ] **Step 1: Add the partial-failure test**

Append inside `describe('updateAlias', ...)`:

```js
  it('on partial failure, writes the actual surviving set to the DB', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'info@example.com', destination: 'a@example.com,b@example.com', regex: 0 }],
    });
    // First call (del a@) succeeds, second call (add c@) fails.
    execSetup
      .mockResolvedValueOnce({ returncode: 0, stderr: '' })
      .mockResolvedValueOnce({ returncode: 1, stderr: 'boom' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias('mailserver', 'info@example.com', 'b@example.com,c@example.com');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Partially updated/);
    expect(result.error).toMatch(/c@example\.com/);

    // DB should be written with the actual surviving set: just b@example.com
    // (a@ was successfully removed; c@ failed to add).
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ destination: 'b@example.com' }),
      'mailserver',
    );
  });
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && npx vitest run aliases.test.js`
Expected: PASS, 8 tests total.

- [ ] **Step 3: Commit**

```bash
git add backend/aliases.test.js
git commit -m "Pin partial-failure DB reconciliation in updateAlias"
```

---

## Task 6: Backend — `PUT /api/aliases/:containerName` route, admin path

**Files:**
- Test: `backend/routes/aliases.test.js` (create)
- Modify: `backend/routes/aliases.js`

- [ ] **Step 1: Create the route test file**

Create `backend/routes/aliases.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
}));

vi.mock('../env.mjs', () => ({
  env: {
    JWT_SECRET: 'test-jwt-secret',
    JWT_SECRET_REFRESH: 'test-jwt-refresh-secret',
    ACCESS_TOKEN_EXPIRY: '1h',
    REFRESH_TOKEN_EXPIRY: '7d',
    NODE_ENV: 'test',
  },
}));

const mockGetAliases = vi.fn();
const mockAddAlias = vi.fn();
const mockDeleteAlias = vi.fn();
const mockUpdateAlias = vi.fn();

vi.mock('../aliases.mjs', () => ({
  getAliases: (...a) => mockGetAliases(...a),
  addAlias: (...a) => mockAddAlias(...a),
  deleteAlias: (...a) => mockDeleteAlias(...a),
  updateAlias: (...a) => mockUpdateAlias(...a),
}));

const mockDbGet = vi.fn();
vi.mock('../db.mjs', () => ({
  dbGet: (...a) => mockDbGet(...a),
}));

import { createTestApp, adminToken, userToken, inactiveToken } from '../test/routeHelper.mjs';
import aliasRoutes from './aliases.js';

const app = createTestApp(aliasRoutes);

describe('PUT /api/aliases/:containerName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/api/aliases/mailserver')
      .send({ source: 'info@example.com', destination: 'a@example.com' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is inactive', async () => {
    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${inactiveToken}`])
      .send({ source: 'info@example.com', destination: 'a@example.com' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when source is missing', async () => {
    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ destination: 'a@example.com' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when destination is missing', async () => {
    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ source: 'info@example.com' });
    expect(res.status).toBe(400);
  });

  it('admin: calls updateAlias and returns 200', async () => {
    mockUpdateAlias.mockResolvedValue({ success: true, message: 'Alias updated: info@example.com' });

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ source: 'info@example.com', destination: 'a@example.com,b@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpdateAlias).toHaveBeenCalledWith('mailserver', 'info@example.com', 'a@example.com,b@example.com');
  });
});
```

- [ ] **Step 2: Run the test, confirm the PUT-related cases fail**

Run: `cd backend && npx vitest run routes/aliases.test.js`
Expected: FAIL — the PUT route does not exist yet, so most cases will get 404 instead of the expected status.

- [ ] **Step 3: Add the PUT route to `backend/routes/aliases.js`**

First, update the import on line 3 from:

```js
import { addAlias, deleteAlias, getAliases } from '../aliases.mjs';
```

to:

```js
import { addAlias, deleteAlias, getAliases, updateAlias } from '../aliases.mjs';
```

Then append the new route just before `export default router;` at the bottom of the file:

```js
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
router.put('/aliases/:containerName',
  authenticateToken,
  requireActive,
async (req, res) => {
  try {
    const { containerName } = req.params;
    if (!containerName) return res.status(400).json({ error: 'containerName is required' });

    const { source, destination } = req.body;
    if (!source || !destination) {
      return res.status(400).json({ error: 'Source and destination are required' });
    }

    let result;
    if (req.user.isAdmin) {
      result = await updateAlias(containerName, source, destination);
    } else {
      if (!isUserAliasAllowed(containerName)) {
        return res.status(403).json({ success: false, error: 'Alias management is disabled for non-admin users' });
      }

      // Non-admin: every destination must be in the user's roles, and source
      // domain must match every destination domain (defensive against
      // cross-domain hijacking).
      const dests = destination.split(',').map(d => d.trim()).filter(Boolean);
      const sourceMatch = source.match(/.*@([\_\-\.\w]+)/);
      if (!sourceMatch) {
        return res.status(400).json({ success: false, error: 'Source must contain a valid @domain' });
      }
      const sourceDomain = sourceMatch[1].toLowerCase();

      for (const d of dests) {
        const m = d.match(/.*@([\_\-\.\w]+)/);
        if (!m) {
          return res.status(400).json({ success: false, error: 'Destinations must contain a valid @domain' });
        }
        if (m[1].toLowerCase() !== sourceDomain) {
          return res.status(403).json({ success: false, error: 'Permission denied' });
        }
        if (!req.user.roles.includes(d)) {
          return res.status(403).json({ success: false, error: 'Permission denied' });
        }
      }

      result = await updateAlias(containerName, source, destination);
    }

    res.json(result);

  } catch (error) {
    serverError(res, 'PUT /api/aliases', error);
  }
});
```

- [ ] **Step 4: Run the route tests**

Run: `cd backend && npx vitest run routes/aliases.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/aliases.js backend/routes/aliases.test.js
git commit -m "Add PUT /api/aliases route with admin path"
```

---

## Task 7: Backend — `PUT` route non-admin permission paths

**Files:**
- Modify: `backend/routes/aliases.test.js`

- [ ] **Step 1: Add non-admin tests**

Append inside `describe('PUT /api/aliases/:containerName', ...)`:

```js
  it('non-admin: returns 403 when ALLOW_USER_ALIASES is not set', async () => {
    mockDbGet.mockReturnValue({ success: true, message: { value: 'false' } });

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ source: 'info@test.com', destination: 'user@test.com' });

    expect(res.status).toBe(403);
    expect(mockUpdateAlias).not.toHaveBeenCalled();
  });

  it('non-admin: returns 403 when a destination is not in their roles', async () => {
    mockDbGet.mockReturnValue({ success: true, message: { value: 'true' } });

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ source: 'info@test.com', destination: 'someone-else@test.com' });

    expect(res.status).toBe(403);
    expect(mockUpdateAlias).not.toHaveBeenCalled();
  });

  it('non-admin: returns 403 when source domain differs from destination domain', async () => {
    mockDbGet.mockReturnValue({ success: true, message: { value: 'true' } });

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ source: 'info@test.com', destination: 'user@other.com' });

    expect(res.status).toBe(403);
    expect(mockUpdateAlias).not.toHaveBeenCalled();
  });

  it('non-admin: succeeds when ALLOW_USER_ALIASES=true and destination is in roles with matching domain', async () => {
    mockDbGet.mockReturnValue({ success: true, message: { value: 'true' } });
    mockUpdateAlias.mockResolvedValue({ success: true, message: 'Alias updated: info@test.com' });

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ source: 'info@test.com', destination: 'user@test.com' });

    expect(res.status).toBe(200);
    expect(mockUpdateAlias).toHaveBeenCalledWith('mailserver', 'info@test.com', 'user@test.com');
  });
```

- [ ] **Step 2: Run the route tests**

Run: `cd backend && npx vitest run routes/aliases.test.js`
Expected: PASS, 9 tests total.

- [ ] **Step 3: Run the full backend test suite to make sure nothing else broke**

Run: `cd backend && npx vitest run`
Expected: PASS — all previously-passing tests still pass plus the new ones.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/aliases.test.js
git commit -m "Pin PUT /aliases non-admin permission paths"
```

---

## Task 8: Frontend — `updateAlias` API service method

**Files:**
- Modify: `frontend/src/services/api.mjs` (insert after the `deleteAlias` block, around line 405)

- [ ] **Step 1: Add the service method**

Insert immediately after the closing brace of `deleteAlias` in `frontend/src/services/api.mjs`:

```js
export const updateAlias = async (containerName=null, source, destination) => {
  if (!containerName) return {success: false, error: 'containerName is required'};
  try {
    const response = await api.put(`/aliases/${containerName}`, { source, destination });
    return response.data;
  } catch (error) {
    errorLog(error.message);
    throw error;
  }
};
```

- [ ] **Step 2: Commit**

There are no service-level unit tests for `addAlias`/`deleteAlias` in this codebase (search confirms only page-level tests mock these), so we don't add one for `updateAlias` either — it will be exercised through the page tests in Task 11.

```bash
git add frontend/src/services/api.mjs
git commit -m "Add updateAlias service method"
```

---

## Task 9: Frontend — `AliasEditModal` component

**Files:**
- Create: `frontend/src/components/AliasEditModal.jsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/AliasEditModal.jsx`:

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from 'react-bootstrap/Modal';
import Form from 'react-bootstrap/Form';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';

import { regexEmailStrict } from '../../../common.mjs';
import { Button } from './index.jsx';

const splitDestinations = (destStr) =>
  String(destStr || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => ({ value: d, label: d }));

const AliasEditModal = ({ show, alias, accountOptions = [], isAdmin, onSave, onCancel }) => {
  const { t } = useTranslation();
  const [destinations, setDestinations] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset internal state every time we open with a new alias.
  useEffect(() => {
    if (show && alias) {
      setDestinations(splitDestinations(alias.destination));
      setError(null);
      setSubmitting(false);
    }
  }, [show, alias]);

  const isValidNewOption = (input) =>
    input.trim().length > 0 && regexEmailStrict.test(input.trim());

  const handleSave = async () => {
    if (!destinations.length) {
      setError('aliases.destinationRequired');
      return;
    }
    const invalid = destinations.find((d) => !regexEmailStrict.test(d.value.trim()));
    if (invalid) {
      setError('aliases.invalidDestination');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSave(alias.source, destinations.map((d) => d.value).join(','));
    } finally {
      setSubmitting(false);
    }
  };

  const SelectComponent = isAdmin ? CreatableSelect : Select;

  // Avoid mounting heavy children when modal is closed.
  if (!show || !alias) return null;

  return (
    <Modal show={show} onHide={onCancel} backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>{t('aliases.editTitle')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label>{t('aliases.sourceAddress')}</Form.Label>
          <Form.Control type="text" value={alias.source} readOnly />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('aliases.destinationAddress')}</Form.Label>
          <SelectComponent
            isMulti
            value={destinations}
            onChange={(v) => setDestinations(v || [])}
            options={accountOptions}
            {...(isAdmin
              ? {
                  isValidNewOption,
                  placeholder: t('aliases.selectDestination'),
                  formatCreateLabel: (input) => `${t('aliases.addExternal')}: ${input}`,
                  noOptionsMessage: () => t('aliases.typeToAdd'),
                }
              : {
                  placeholder: t('aliases.selectDestination'),
                  noOptionsMessage: () => t('aliases.noRoles'),
                })}
          />
          {error && <div className="text-danger small mt-1">{t(error)}</div>}
          <Form.Text muted>{t('aliases.destinationInfo')}</Form.Text>
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" text="common.cancel" onClick={onCancel} />
        <Button variant="primary" text="aliases.save" onClick={handleSave} disabled={submitting} />
      </Modal.Footer>
    </Modal>
  );
};

export default AliasEditModal;
```

- [ ] **Step 2: Verify whether `frontend/src/components/index.jsx` is a barrel export and if so, add `AliasEditModal`**

Run: `grep -n "export" frontend/src/components/index.jsx | head -20`

If you see lines like `export { default as Button } from './Button';`, add this line in alphabetical order:

```js
export { default as AliasEditModal } from './AliasEditModal.jsx';
```

If `index.jsx` does not re-export components in that pattern, skip this — `Aliases.jsx` will import directly from `'../components/AliasEditModal.jsx'` in Task 10.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AliasEditModal.jsx
# If index.jsx was modified:
git add frontend/src/components/index.jsx
git commit -m "Add AliasEditModal component"
```

---

## Task 10: Frontend — wire pencil button + modal into Aliases.jsx

**Files:**
- Modify: `frontend/src/pages/Aliases.jsx`

- [ ] **Step 1: Add the import for `AliasEditModal` and `updateAlias`**

In `frontend/src/pages/Aliases.jsx`, update the imports.

Change the api.mjs import (around line 19-26) to include `updateAlias`:

```jsx
import {
  getAccounts,
  getAliases,
  getUserSettings,
  addAlias,
  deleteAlias,
  updateAlias,
} from '../services/api.mjs';
```

Add a new import below the components barrel import (line 27-35). If `AliasEditModal` was added to the barrel in Task 9 step 2, just add it to the existing destructured list. Otherwise add a separate import line below it:

```jsx
import AliasEditModal from '../components/AliasEditModal.jsx';
```

- [ ] **Step 2: Add edit state and handler**

Add a new piece of state right after the existing `formErrors` state (around line 58):

```jsx
  const [editingAlias, setEditingAlias] = useState(null);
```

Add a new handler right after `handleDelete` (around line 270):

```jsx
  const handleEdit = (alias) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setEditingAlias(alias);
  };

  const handleEditSave = async (source, newDestination) => {
    try {
      const result = await updateAlias(containerName, source, newDestination);
      if (result.success) {
        setEditingAlias(null);
        fetchAliases(true);
        setSuccessMessage('aliases.aliasUpdated');
      } else {
        setErrorMessage(result?.error);
      }
    } catch (error) {
      errorLog(t('api.errors.updateAlias'), error.message);
      setErrorMessage('api.errors.updateAlias');
    }
  };

  const handleEditCancel = () => setEditingAlias(null);
```

- [ ] **Step 3: Add pencil button to the actions column**

Replace the actions column entry in `columns` (currently spanning lines ~281-294) with:

```jsx
    ...(canModify ? [{
      key: 'actions',
      label: 'common.actions',
      noSort: true,
      noFilter: true,
      render: (alias) => (
        <>
          {!alias.regex && (
            <Button
              variant="primary"
              size="sm"
              icon="pencil"
              onClick={() => handleEdit(alias)}
              className="me-1"
            />
          )}
          <Button
            variant="danger"
            size="sm"
            icon="trash"
            onClick={() => handleDelete(alias.source, alias.destination)}
          />
        </>
      ),
    }] : []),
```

- [ ] **Step 4: Mount the modal**

Add the modal just before the closing `</div>` of the component (right after the closing `</Row>` on line ~451):

```jsx
      <AliasEditModal
        show={!!editingAlias}
        alias={editingAlias}
        accountOptions={accountOptions}
        isAdmin={isAdmin}
        onSave={handleEditSave}
        onCancel={handleEditCancel}
      />
```

- [ ] **Step 5: Manually start the dev server and confirm the build works**

Run: `cd frontend && npx vite build`
Expected: build succeeds. (If you have a running dev server, refresh the Aliases page; the pencil button should now appear next to trash for non-regex aliases.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Aliases.jsx
git commit -m "Wire pencil button and edit modal into Aliases page"
```

---

## Task 11: Frontend — Aliases page tests for edit flow

**Files:**
- Modify: `frontend/src/pages/Aliases.test.jsx`

- [ ] **Step 1: Read the existing test file to understand its mock setup**

Run: `wc -l frontend/src/pages/Aliases.test.jsx`

The mocks pattern (vi.mock for api.mjs, components, etc.) is already in place. We extend it.

- [ ] **Step 2: Add `updateAlias` to the api.mjs mock**

Find the existing `vi.mock('../services/api.mjs', ...)` block (around line 65) and add `updateAlias` to it. Also declare a `mockUpdateAlias` constant alongside the others. Change:

```jsx
const mockGetAliases = vi.fn();
const mockGetAccounts = vi.fn();
const mockAddAlias = vi.fn();
const mockDeleteAlias = vi.fn();

const mockGetUserSettings = vi.fn();

vi.mock('../services/api.mjs', () => ({
  getAliases: (...args) => mockGetAliases(...args),
  getAccounts: (...args) => mockGetAccounts(...args),
  addAlias: (...args) => mockAddAlias(...args),
  deleteAlias: (...args) => mockDeleteAlias(...args),
  getUserSettings: (...args) => mockGetUserSettings(...args),
}));
```

to:

```jsx
const mockGetAliases = vi.fn();
const mockGetAccounts = vi.fn();
const mockAddAlias = vi.fn();
const mockDeleteAlias = vi.fn();
const mockUpdateAlias = vi.fn();

const mockGetUserSettings = vi.fn();

vi.mock('../services/api.mjs', () => ({
  getAliases: (...args) => mockGetAliases(...args),
  getAccounts: (...args) => mockGetAccounts(...args),
  addAlias: (...args) => mockAddAlias(...args),
  deleteAlias: (...args) => mockDeleteAlias(...args),
  updateAlias: (...args) => mockUpdateAlias(...args),
  getUserSettings: (...args) => mockGetUserSettings(...args),
}));
```

- [ ] **Step 3: Mock the modal component**

The existing test mocks the components barrel via `vi.mock('../components/index.jsx', ...)`. We additionally mock the modal so we can drive its callbacks. Add this mock block alongside the other `vi.mock` calls (after the api.mjs mock):

```jsx
let _onSaveLatest = null;
let _onCancelLatest = null;
let _aliasLatest = null;
let _showLatest = false;

vi.mock('../components/AliasEditModal.jsx', () => ({
  default: ({ show, alias, onSave, onCancel }) => {
    _onSaveLatest = onSave;
    _onCancelLatest = onCancel;
    _aliasLatest = alias;
    _showLatest = show;
    return show
      ? (
          <div data-testid="alias-edit-modal">
            <span data-testid="modal-source">{alias?.source}</span>
            <span data-testid="modal-destination">{alias?.destination}</span>
          </div>
        )
      : null;
  },
}));
```

- [ ] **Step 4: Extend the `Button` mock to expose `icon` and to invoke onClick on row buttons**

The existing Button mock renders a `<button>` with the `text` prop. Pencil/trash buttons in the actions column don't have a `text`, only an `icon`. To target them in tests, extend the mock (find it inside the `vi.mock('../components/index.jsx', ...)` block) so it also reflects `icon`:

Replace the existing Button definition (currently `Button: ({ type, variant, text, onClick, ...rest }) => (...)`) with:

```jsx
  Button: ({ type, variant, text, icon, onClick, ...rest }) => (
    <button
      type={type}
      className={variant}
      data-icon={icon}
      onClick={onClick}
      {...rest}
    >{text || icon}</button>
  ),
```

This adds `data-icon="pencil"` / `data-icon="trash"` so tests can find the right button.

- [ ] **Step 5: Extend the DataTable mock to render columns**

The existing `DataTable` mock just renders `row.source → row.destination`. To exercise pencil/trash, the mock must call the `actions` column's `render` per row. Replace the existing DataTable mock (inside `vi.mock('../components/index.jsx', ...)`):

```jsx
  DataTable: ({ columns, data, emptyMessage }) => (
    <div data-testid="data-table">
      {data.length === 0 ? <span>{emptyMessage}</span> : data.map((row, i) => (
        <div key={i} data-testid="alias-row" data-source={row.source}>
          <span>{row.source} → {row.destination}</span>
          {columns.filter(c => c.render).map((col) => (
            <span key={col.key} data-testid={`row-${i}-${col.key}`}>{col.render(row)}</span>
          ))}
        </div>
      ))}
    </div>
  ),
```

- [ ] **Step 6: Add the three new tests**

Append a new `describe` block at the end of `Aliases.test.jsx`:

```jsx
describe('Aliases — edit flow', () => {
  const adminUser = { id: 1, isAdmin: 1, isActive: 1, roles: [], mailbox: 'admin@test.com', username: 'admin' };

  beforeEach(() => {
    vi.clearAllMocks();
    _onSaveLatest = null;
    _onCancelLatest = null;
    _aliasLatest = null;
    _showLatest = false;

    // Default useAuth → admin
    // (existing tests already mock useAuth; reuse the same shape)

    mockGetAccounts.mockResolvedValue({
      success: true,
      message: [{ mailbox: 'admin@test.com', domain: 'test.com', storage: {} }],
    });
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        { source: 'info@test.com', destination: 'a@test.com,b@test.com', regex: 0 },
        { source: '/^postmaster.*/', destination: 'admin@test.com', regex: 1 },
      ],
    });
  });

  it('renders pencil button only for non-regex rows', async () => {
    const { default: Aliases } = await import('./Aliases.jsx');
    render(<Aliases />);

    await waitFor(() => expect(screen.getAllByTestId('alias-row')).toHaveLength(2));

    const row0Actions = screen.getByTestId('row-0-actions');
    const row1Actions = screen.getByTestId('row-1-actions');
    expect(row0Actions.querySelector('[data-icon="pencil"]')).not.toBeNull();
    expect(row1Actions.querySelector('[data-icon="pencil"]')).toBeNull();
    // Trash exists on both
    expect(row0Actions.querySelector('[data-icon="trash"]')).not.toBeNull();
    expect(row1Actions.querySelector('[data-icon="trash"]')).not.toBeNull();
  });

  it('clicking pencil opens the modal with the row prefilled', async () => {
    const { default: Aliases } = await import('./Aliases.jsx');
    render(<Aliases />);

    await waitFor(() => expect(screen.getAllByTestId('alias-row')).toHaveLength(2));

    const pencil = screen.getByTestId('row-0-actions').querySelector('[data-icon="pencil"]');
    await act(async () => { fireEvent.click(pencil); });

    expect(screen.getByTestId('alias-edit-modal')).toBeTruthy();
    expect(screen.getByTestId('modal-source').textContent).toBe('info@test.com');
    expect(screen.getByTestId('modal-destination').textContent).toBe('a@test.com,b@test.com');
  });

  it('saving from the modal calls updateAlias and refreshes the list', async () => {
    mockUpdateAlias.mockResolvedValue({ success: true, message: 'Alias updated' });

    const { default: Aliases } = await import('./Aliases.jsx');
    render(<Aliases />);

    await waitFor(() => expect(screen.getAllByTestId('alias-row')).toHaveLength(2));

    const pencil = screen.getByTestId('row-0-actions').querySelector('[data-icon="pencil"]');
    await act(async () => { fireEvent.click(pencil); });

    // Drive the captured onSave directly — the modal itself is mocked.
    await act(async () => {
      await _onSaveLatest('info@test.com', 'a@test.com,b@test.com,c@test.com');
    });

    expect(mockUpdateAlias).toHaveBeenCalledWith(
      expect.any(String), // containerName from useLocalStorage default
      'info@test.com',
      'a@test.com,b@test.com,c@test.com',
    );
    // After save, fetchAliases should have been called again (refresh=true).
    expect(mockGetAliases).toHaveBeenCalledTimes(2);
  });
});
```

> Note: this `describe` block uses dynamic `await import('./Aliases.jsx')` to ensure the new mocks are in scope when the page module is evaluated. If the existing test file imports `Aliases` statically at the top, this still works because Vitest's module resolution honours the mocks defined before either import.

- [ ] **Step 7: Run the page tests**

Run: `cd frontend && npx vitest run src/pages/Aliases.test.jsx`
Expected: PASS — all existing tests still pass plus the three new ones.

- [ ] **Step 8: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Aliases.test.jsx
git commit -m "Add tests for alias edit flow"
```

---

## Task 12: i18n — add four new keys to all three locales

**Files:**
- Modify: `frontend/src/locales/en/translation.json`
- Modify: `frontend/src/locales/no/translation.json`
- Modify: `frontend/src/locales/pl/translation.json`

The four keys to add to the `aliases` object in each file:

| Key | English | Norwegian | Polish |
| --- | --- | --- | --- |
| `editAlias` | "Edit Alias" | "Rediger alias" | "Edytuj alias" |
| `editTitle` | "Edit alias destinations" | "Rediger destinasjoner for alias" | "Edytuj odbiorców aliasu" |
| `aliasUpdated` | "Alias updated successfully!" | "Aliaset er oppdatert!" | "Alias zaktualizowany!" |
| `cannotEditRegex` | "Editing regex aliases is not supported." | "Redigering av regex-alias er ikke støttet." | "Edycja aliasów regex nie jest obsługiwana." |
| `save` | "Save" | "Lagre" | "Zapisz" |

Plus one `api.errors.updateAlias` key, mirroring the existing `api.errors.addAlias` pattern.

- [ ] **Step 1: Add keys to `en/translation.json`**

Inside the `aliases` block, add (alphabetically, near other keys):

```json
    "editAlias": "Edit Alias",
    "editTitle": "Edit alias destinations",
    "aliasUpdated": "Alias updated successfully!",
    "cannotEditRegex": "Editing regex aliases is not supported.",
    "save": "Save",
```

Locate the `api.errors` block (search for `"addAlias"` inside an `errors` block) and add:

```json
      "updateAlias": "Unable to update alias. Please try again.",
```

next to the existing `addAlias` / `deleteAlias` entries.

- [ ] **Step 2: Add the same keys to `no/translation.json`**

Same locations, with the Norwegian values from the table above. For the `api.errors.updateAlias` Norwegian string use: `"Klarte ikke å oppdatere aliaset. Prøv igjen."`

- [ ] **Step 3: Add the same keys to `pl/translation.json`**

Same locations, with Polish values from the table. For `api.errors.updateAlias` Polish string use: `"Nie udało się zaktualizować aliasu. Spróbuj ponownie."`

- [ ] **Step 4: Validate JSON syntax**

Run: `python3 -c "import json; [json.load(open(f'frontend/src/locales/{l}/translation.json')) for l in ['en','no','pl']]; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/locales/en/translation.json frontend/src/locales/no/translation.json frontend/src/locales/pl/translation.json
git commit -m "Add i18n keys for alias edit modal"
```

---

## Task 13: End-to-end build + manual verification

**Files:** None modified. This task validates the whole feature against a running container per project convention (`CLAUDE.md` "Build & deploy").

- [ ] **Step 1: Run all backend tests once more**

Run: `cd backend && npx vitest run`
Expected: PASS, full suite green.

- [ ] **Step 2: Run all frontend tests once more**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Build the Docker image**

Run: `cd /home/olen/prog/dms-gui && docker build -t olen/dms-gui:latest .`
Expected: build succeeds. If it fails on `better-sqlite3`, double-check that `.dockerignore` still excludes `**/node_modules` (per the project CLAUDE.md warning about glibc-vs-Alpine).

- [ ] **Step 4: Recreate the container**

Run: `cd /home/docker && make dms-gui-recreate`
Expected: container comes up cleanly. Tail logs: `sudo docker logs dms-gui --tail 20`.

- [ ] **Step 5: Manual UI verification at https://epost.nytt.no**

Verify manually (do not skip — type checking confirms code correctness, not feature correctness):

1. **Pencil visible on regular aliases, hidden on regex aliases.**
2. **Click pencil → modal opens with current source (read-only) and current destinations as chips.**
3. **Add a destination, save → success toast, table refreshes, new value visible.**
4. **Remove a destination, save → success toast, table refreshes, value gone.**
5. **Cancel button closes modal without API call (verify by checking network tab or logs).**
6. **Save with empty destinations → inline validation error, modal stays open, no API call.**
7. **As a non-admin user with `ALLOW_USER_ALIASES=true`, edit an alias whose only destination is one of their roles → succeeds.**
8. **As a non-admin, try to add a destination not in their roles → backend returns 403, error toast appears, modal stays open.**

If any step fails, do NOT mark this task complete — debug, fix, add a regression test, recommit.

- [ ] **Step 6: Bump version**

The latest version per `CLAUDE.md` recent commits is 1.5.24. Bump to 1.5.25 in the appropriate file (search for `1.5.24` to locate it):

Run: `grep -rn "1\.5\.24" --include="*.json" --include="*.mjs" --include="*.js"`

Edit the file(s) found (likely `package.json` and possibly an env constant) to `1.5.25`. Commit:

```bash
git add <changed-files>
git commit -m "Bump version to 1.5.25 for alias edit feature"
```

- [ ] **Step 7: Final commit / push**

```bash
git push origin deploy
```

---

## Self-Review Notes

**Spec coverage:**
- §"updateAlias" function — Tasks 1-5
- §"PUT /api/aliases/:containerName" route — Tasks 6-7
- §"updateAlias" service method — Task 8
- §"AliasEditModal" component — Task 9
- §"Aliases.jsx" page wiring — Task 10
- §Tests (backend module) — Tasks 1-5
- §Tests (backend route) — Tasks 6-7
- §Tests (frontend page) — Task 11
- §i18n — Task 12
- §Deployment — Task 13

**Type/name consistency:**
- Function name `updateAlias` (Task 1, 2, 6, 8, 10, 11) — consistent.
- Body shape `{source, destination}` for PUT (Task 6) matches the spec and matches what `addAlias`/`deleteAlias` already use.
- Modal prop `accountOptions` (Task 9) matches the variable used in `Aliases.jsx` (Task 10).
- DB row schema `{source, destination, regex}` matches existing `sql.aliases.insert.alias` parameters.

**Placeholder scan:** all "implement later" / "TODO" / "TBD" content has been expanded into concrete code. The one place a concrete value is deferred is the version bump file location in Task 13 step 6, where the engineer is told exactly how to find it (`grep -rn "1\.5\.24"`); that is appropriate because the current source-of-truth file is not certain and the search is one command.
