# Edit Email Aliases — Design

**Status:** Approved
**Date:** 2026-05-08
**Branch:** `deploy` (development happens here per project convention)

## Summary

Add the ability to edit existing email aliases by changing their destination addresses. The source address stays read-only (rename-as-edit is out of scope). Postfix-regex aliases (`regex=1`) are not editable in this iteration. The change spans the backend route layer, the alias business-logic module, the SQLite cache, the frontend Aliases page, a new modal component, and the i18n catalogues.

## Motivation

Today the Aliases page only supports create and delete. The most common reason to touch an existing alias is to add or remove a destination (e.g. add a new recipient to a shared `info@` alias, drop a person who left a team). With only create/delete, users must remember and re-enter every other destination just to add or remove one. This is error-prone and friction-heavy.

## Non-goals

- **Renaming aliases** (changing the source address). DMS has no atomic rename primitive, so this would require careful transactional handling that we explicitly defer.
- **Editing regex aliases** (`regex=1`). Their source is a postfix regex pattern, not an email address; the editing UX and validation differ enough to warrant a separate feature.
- **Bulk edit.** One alias at a time.

## Constraints and context

- DMS exposes only `setup.sh alias add <source> <dest>` and `setup.sh alias del <source> <dest>` as primitives. There is no native edit. An "edit" must be implemented as a sequence of adds and dels.
- The local SQLite cache (`aliases` table, keyed by `source` per `containerName`) stores destinations as a single comma-separated string in the `destination` column. DMS itself models one (source, destination) pair per row, so when reading from DMS the backend merges per-source destinations into a comma-separated string (see `parseAliasesFromDMS` in `backend/aliases.mjs`).
- The existing `deleteAlias` already loops over comma-split destinations issuing one `alias del` per destination, with partial-failure handling that writes the surviving set back to the DB. The new edit path follows the same pattern.
- Permission model: admins can act on any alias. Non-admins are gated by the `ALLOW_USER_ALIASES` per-container setting AND must have the destination address in their `roles` array. The same gates apply to edits.

## Architecture

### Backend

#### New function `updateAlias` in `backend/aliases.mjs`

Signature:

```js
export const updateAlias = async (containerName, source, newDestination) => { ... }
```

Behaviour:

1. Validate args. If `source`, `containerName`, or `newDestination` is empty/null, return `{success:false, error:'…'}`. An empty `newDestination` is rejected — callers should use `deleteAlias` for full removal.
2. Honour demo mode (`demoWriteResponse`).
3. Look up the existing alias from SQLite (`sql.aliases.select.aliases` filtered by source, or read fresh via `dbGet`). If no row exists, return `{success:false, error:'Alias not found'}`.
4. If the existing row has `regex=1`, return `{success:false, error:'Editing regex aliases is not supported'}`.
5. Compute the diff (case-insensitive, trimmed):
   - `oldSet = split(currentDestination)`
   - `newSet = split(newDestination)`
   - `added = newSet \ oldSet`
   - `removed = oldSet \ newSet`
6. If both `added` and `removed` are empty, short-circuit with `{success:true, message:'No changes'}` — no DMS calls, no DB write.
7. For each address in `removed`, call `execSetup('alias del <source> <dest>', targetDict)`. Track failures.
8. For each address in `added`, call `execSetup('alias add <source> <dest>', targetDict)`. Track failures.
9. Reconcile DB with the actual surviving set:
   - On full success: `UPDATE aliases SET destination=? WHERE source=? AND containerName=?` with the new comma-joined string.
   - On partial success: compute the set that actually exists on DMS now (= `oldSet − successfully_removed + successfully_added`) and write that. Return `{success:false, error:'Partially updated. Failed: …'}`.
   - On full failure: leave DB unchanged, return `{success:false, error:'Failed to update alias'}`.
10. Use `escapeShellArg` on every shell-bound value (already established convention in this module).

#### New route `PUT /api/aliases/:containerName` in `backend/routes/aliases.js`

```
PUT /api/aliases/:containerName
Body: { source: string, destination: string }
```

- Apply the same `validateContainerName` param middleware and `authenticateToken`/`requireActive` middleware as the existing POST/DELETE routes.
- 400 if `source` or `destination` is missing.
- Admin path: `await updateAlias(containerName, source, destination)`.
- Non-admin path:
  - 403 if `!isUserAliasAllowed(containerName)`.
  - Validate that every address in the new `destination` set is in `req.user.roles`. If not, 403 `Permission denied`. (This is slightly stricter than the current POST, which only checks `req.user.roles.includes(destination)` for a single value; for edits with potentially multiple destinations we check all.)
  - Validate that source domain matches each destination's domain (mirrors the POST safeguard against cross-domain hijacking by non-admins).
  - On pass: call `updateAlias`.
- Return 200 on success, 500 on caught exceptions via `serverError`.
- Add Swagger JSDoc matching the style of the POST/DELETE routes in the same file.

### Frontend

#### New service method in `frontend/src/services/api.mjs`

```js
export const updateAlias = async (containerName, source, destination) => {
  // PUT /api/aliases/:containerName with body { source, destination }
}
```

Mirror the existing `addAlias`/`deleteAlias` shape (same auth header handling, same error decoding).

#### New component `frontend/src/components/AliasEditModal.jsx`

Props:

- `show: bool`
- `alias: { source: string, destination: string, regex: 0|1 } | null`
- `accountOptions: [{value, label}]`
- `isAdmin: boolean`
- `onSave: (source, newDestinationString) => Promise<void>`
- `onCancel: () => void`

Behaviour:

- Renders a Bootstrap `Modal`.
- Source field: text, `readOnly`, label "Source".
- Destination field: same `CreatableSelect` (admin) or `Select` (non-admin) used in the new-alias form, isMulti, prefilled by splitting `alias.destination` on `,`, trimming, and mapping to `{value, label}`.
- Validation on Save: at least one destination, every destination matches `regexEmailStrict`. Shows inline errors using the same styling as the new-alias form.
- Save button calls `onSave(alias.source, destinationsArr.map(d => d.value).join(','))`.
- Cancel just calls `onCancel`.

#### Changes to `frontend/src/pages/Aliases.jsx`

- New state: `const [editingAlias, setEditingAlias] = useState(null)`.
- New handler `handleEdit(alias)` opens the modal: `setEditingAlias(alias)`.
- New handler `handleEditSave(source, newDestination)`:
  - Calls `updateAlias(containerName, source, newDestination)`.
  - On success: clear modal, refresh the list (`fetchAliases(true)`), set `successMessage='aliases.aliasUpdated'`.
  - On failure: surface `result.error` via `errorMessage`, keep modal open so user can retry.
- Actions column:
  - Add a pencil-icon button alongside the trash button.
  - **Hide the pencil for regex rows** (`alias.regex === 1`). The trash button stays.
- Render `<AliasEditModal show={!!editingAlias} alias={editingAlias} ... />` near the bottom of the component tree.

### i18n

Add to every language catalogue under `frontend/src/i18n/` (mirroring existing `aliases.*` keys). Verify whether `common.save` / `common.cancel` already exist before adding duplicates.

- `aliases.editAlias` — "Edit alias"
- `aliases.aliasUpdated` — "Alias updated successfully"
- `aliases.editTitle` — modal heading text
- `aliases.cannotEditRegex` — error string for backend rejection (defensive — UI hides the pencil for regex rows, but the backend rejection message also needs translation)

## Data flow (edit happy path)

1. User clicks pencil on row `info@example.com` → `b@example.com,c@example.com`.
2. Modal opens, prefilled with `[b@example.com, c@example.com]`.
3. User removes `c@example.com`, adds `d@example.com`. Saves.
4. Frontend calls `PUT /api/aliases/mailserver` with body `{source:'info@example.com', destination:'b@example.com,d@example.com'}`.
5. Backend route validates, calls `updateAlias`.
6. `updateAlias`: old=`{b,c}`, new=`{b,d}` → `added={d}`, `removed={c}`.
7. Issues `alias del info@example.com c@example.com`, then `alias add info@example.com d@example.com`. Both succeed.
8. UPDATE sets the row's destination to `b@example.com,d@example.com`.
9. Returns `{success:true, message:'Alias updated: …'}`.
10. Frontend closes modal, refreshes table, shows success alert.

## Error and partial-failure handling

| Scenario | Behaviour |
| --- | --- |
| `alias del` succeeds for some removed dests, fails for others | DB written to reflect actual surviving set (= old minus successful removals plus successful additions). Response is `{success:false, error:'Partially updated. Failed: …'}`. |
| `alias add` fails for one or more new dests | Same: DB reflects actual state. Response `{success:false}` with the failing addresses listed. |
| All add/del calls fail | DB unchanged. Response `{success:false}`. |
| Both `added` and `removed` are empty | Skip DMS entirely. Response `{success:true, message:'No changes'}`. DB untouched. |
| Alias not found in DB | 404-ish (return `{success:false, error:'Alias not found'}` from `updateAlias`; route returns 200 with that body, matching existing convention). |
| Source row is regex (`regex=1`) | Return `{success:false, error:'Editing regex aliases is not supported'}`. |

## Testing

### Backend (`backend/aliases.test.js`)

New cases — wire them in alongside the existing add/delete tests:

- `updateAlias` pure-add diff: old `{a}`, new `{a,b}` → one `alias add b`, no `alias del`. DB ends up with `a,b`.
- `updateAlias` pure-remove diff: old `{a,b}`, new `{a}` → one `alias del b`, no `alias add`. DB ends up with `a`.
- `updateAlias` mixed diff: old `{a,b}`, new `{b,c}` → `alias del a` + `alias add c`.
- `updateAlias` no-op: old `{a,b}`, new `{a,b}` → no shell calls, returns `{success:true, message:'No changes'}`.
- `updateAlias` partial failure: stub `execSetup` so one call fails. Verify DB reflects the partial state, not the requested one.
- `updateAlias` rejects regex alias: row with `regex=1` → returns `{success:false}` without any shell calls.
- `updateAlias` rejects empty newDestination.

### Backend route (`backend/routes/aliases.test.js` — new file, mirroring `accounts.test.js`)

- Admin PUT succeeds → 200, calls `updateAlias`.
- Non-admin PUT with `ALLOW_USER_ALIASES=true` and all destinations in roles → succeeds.
- Non-admin PUT with `ALLOW_USER_ALIASES=false` → 403.
- Non-admin PUT where one destination is not in roles → 403.
- PUT with missing `source` or `destination` → 400.
- Non-admin PUT with cross-domain destination → 403.

### Frontend (`frontend/src/pages/Aliases.test.jsx`)

- Pencil button is rendered for `regex=0` rows, not for `regex=1` rows.
- Clicking the pencil opens the modal prefilled with current destinations.
- Saving with empty destinations shows validation error and does not call the API.
- Saving with valid destinations calls `updateAlias` with the right `(containerName, source, joinedDestinations)` and refreshes the list.

## Deployment

Standard project flow per `CLAUDE.md`:

```bash
cd /home/olen/prog/dms-gui
git checkout deploy
# implement, test
docker build -t olen/dms-gui:latest .
cd /home/docker && make dms-gui-recreate
```

Bump version in the appropriate place (the recent commit `404565e` bumped to 1.5.24 for the language column migration; this feature would land as the next minor patch, e.g. 1.5.25, decided at implementation time).

## Open questions

None blocking. Two minor things confirmed implicitly during brainstorming and worth re-checking during implementation:

- Whether to short-circuit no-op edits with success or with a specific "no changes" string. Spec choice: success with `'No changes'` message; frontend can suppress the success toast for that case if it feels noisy.
- Whether non-admin domain-match validation should run on every new destination or only the new ones (`added` set). Spec choice: every destination in the new set, to be conservative.
