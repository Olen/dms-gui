# dms-gui — Claude Code Context

## Project overview
Web GUI for docker-mailserver (DMS). React frontend (Vite, Bootstrap) + Node.js/Express backend + nginx reverse proxy, all in one Docker image. Communicates with DMS via a REST API (`rest-api.py`) running inside the DMS container.

## Repository structure
- `frontend/` — React SPA (Vite, Bootstrap)
- `backend/` — Express API server (port 3001), SQLite database
- `common.mjs` — Shared utilities (regex, array helpers) used by both frontend and backend
- `config/` — Example config files
- `Dockerfile` — Multi-stage build: frontend → backend → nginx

## Branch strategy

### Branch model
```
main                        ← primary development + production branch
  └── feature/<name>        ← optional branches for larger features
upstream-snapshot           ← frozen at the original fork point (audioscavenger/dms-gui v1.5.23)
fix/*                       ← archived branches mapped to upstream PRs #7–#25 (still open, no engagement)
```

This repo was forked from [audioscavenger/dms-gui](https://github.com/audioscavenger/dms-gui) at version 1.5.23 (tag `fork-from-upstream-1.5.23`). Since the fork, this repo has diverged 230+ commits while upstream has made one. The 18 `fix/*` branches were sent as PRs to upstream but received no review; they remain pushed to origin as archived snapshots of those proposals.

The `upstream` git remote (`https://github.com/audioscavenger/dms-gui.git`) is kept available locally for cherry-picks if upstream ever revives, but routine development assumes no upstream collaboration.

### Core rules
1. **`main` is the primary branch** — all development happens here
2. **Feature branches are optional** — use `feature/<name>` off `main` for larger multi-commit work, merge back when done
3. **`upstream-snapshot` is frozen** — do not commit to it; it preserves the upstream fork point for historical reference
4. **`fix/*` branches are archived** — they still exist for the open upstream PRs but are not actively maintained

### Day-to-day workflow

Develop on any machine with a clone of the repo. Push to `main`. Cutting a release and bringing it to production are separate steps documented under "Release & deploy" below.

```bash
# Simple changes: commit directly to main
git checkout main
# edit, test
git add <files> && git commit -m "description"
git push origin main
# Nothing builds yet. To ship the change, bump package.json
# on a later commit (see "Cutting a release" below).
```

### Larger features
```bash
git checkout main
git checkout -b feature/thing
# work, commit, test
git checkout main
git merge feature/thing --no-edit
git push origin main
# (no manual build/deploy here — release happens by bumping
#  package.json on a later commit; see "Release & deploy" below)
# optionally delete: git branch -d feature/thing
```

## Release & deploy

Builds happen in GitHub Actions (`.github/workflows/release.yml`) and the resulting image is published to `ghcr.io/olen/dms-gui`. The production host's only role at deploy time is pulling the published image and recreating the container — it never runs a local build for routine deploys.

A local checkout on the production host is useful only for the local-build fallback (see below) and for source-vs-running-image comparisons during debugging. Routine deploys do not require the production host to be on a current revision.

### Source of truth for the version

The release version lives in the root `package.json` `version` field. CI reads it on every push to `main` and:

1. If a git tag matching that version already exists, CI skips (idempotent — pushing non-release commits is free).
2. Otherwise CI runs the backend + frontend test suites, builds the image with `--build-arg DMSGUI_VERSION=<version>`, pushes both `ghcr.io/olen/dms-gui:<version>` and `ghcr.io/olen/dms-gui:latest`, and creates+pushes the matching git tag.

`backend/package.json` and `frontend/package.json` are internal-only and stay at `1.0.0`. Don't bump them.

### Cutting a release

```bash
# bump the version (canonical source)
npm version <new-version> --no-git-tag-version    # e.g. 2.1.0 → 2.1.1; edits root package.json only
git add package.json
git commit -m "Release <new-version>"
git push origin main
# CI does the rest: tests → build → push image → create+push git tag
```

Watch the run at https://github.com/Olen/dms-gui/actions. Typical end-to-end time is ~5–7 minutes.

### Build process (CI internals)

The workflow at `.github/workflows/release.yml` runs three jobs in sequence:

1. **`check-version`** — checks out the repo with full history (`fetch-depth: 0` is required so all tags are visible), reads `.version` from root `package.json`, validates it against a strict semver regex (defense-in-depth against shell-metacharacter injection through the version field), and checks whether a git tag with that name already exists. Sets `should_release=true|false` for downstream jobs.

2. **`test`** — guarded by `if: needs.check-version.outputs.should_release == 'true'`. Runs `npm ci && npx vitest run` in both `backend/` and `frontend/`. Fails the workflow if any test fails — no image is built or pushed when tests are red.

3. **`build-and-publish`** — depends on `test`. Logs into GHCR using the workflow's auto-provisioned `GITHUB_TOKEN` (no PAT needed — that's why the workflow declares `permissions: { packages: write }`), uses `docker/build-push-action@v5` to build with `--build-arg DMSGUI_VERSION=<version>`, and pushes both `ghcr.io/olen/dms-gui:<version>` and `ghcr.io/olen/dms-gui:latest`. After the push succeeds, the same job creates an annotated git tag matching the version and pushes it to origin (requires `permissions: { contents: write }`).

The workflow also runs on `workflow_dispatch` for manual rebuilds — same idempotency logic, so triggering it on a version that already has a tag is a no-op.

#### Required one-time GHCR setup

The repo's `GITHUB_TOKEN` can only push to packages it owns. If a `ghcr.io/olen/dms-gui` package was created earlier under a personal PAT (e.g. from manual `docker push` runs), CI's first push will fail with `permission_denied: write_package`. Fix once at https://github.com/users/Olen/packages/container/dms-gui/settings → "Manage Actions access" → add `Olen/dms-gui` with role "Write". After that, the package inherits the repo's CI access.

#### Dependency-update notifications

`.github/dependabot.yml` watches root/backend/frontend npm dependencies, GitHub Actions versions used in the workflow, and the Dockerfile base image. Updates are opened as PRs against `main` (not `upstream-snapshot`, which is frozen per the branch model). The Node.js 20 deprecation warnings on `actions/checkout`/`docker/*-action` will surface as Dependabot PRs once those upstream actions cut Node-24-compatible releases.

### Pulling the new image into production

After CI completes, on the production host (in the directory containing the compose files):

```bash
make dms-gui-recreate
```

The Makefile's `*-recreate` target does `docker compose pull && docker compose up -d --force-recreate`, so it always lands the newest image from GHCR. There is no "build locally and run that" step in the standard flow.

### Local builds (when bypassing CI)

For testing changes that have not been released yet (e.g. debugging an issue you can only reproduce in production), from a checkout of the repo on the production host:

```bash
docker build -t ghcr.io/olen/dms-gui:latest .
docker compose -f dms-gui.yaml -p dms-gui up -d --force-recreate
```

The second command uses `up -d --force-recreate` directly, not `make dms-gui-recreate`, because the latter would `docker compose pull` and overwrite the local build. Use sparingly — the canonical path is bump-and-push, let CI build.

### Rolling back a release

Every released version stays on GHCR as an immutable versioned tag (`ghcr.io/olen/dms-gui:<version>`). To revert production to a known-good earlier version:

```bash
# on the production host
docker pull ghcr.io/olen/dms-gui:<earlier-version>
docker tag ghcr.io/olen/dms-gui:<earlier-version> ghcr.io/olen/dms-gui:latest
docker compose -f dms-gui.yaml -p dms-gui up -d --force-recreate
```

Note: do NOT use `make dms-gui-recreate` for rollback — its `pull` step would re-fetch `:latest` from GHCR (i.e., the broken release). The direct `up -d --force-recreate` uses the locally-retagged image.

To restore the forward path afterwards, fix on `main`, bump the patch version, and let CI publish the fix.

### Image registry note

The compose file references `ghcr.io/olen/dms-gui:latest`. CI is the only writer to that tag — a manual PAT may exist on the production host for the local-build fallback above, but it is no longer the canonical publisher.

## Critical: .dockerignore
The `.dockerignore` with `**/node_modules` is essential. Without it, local glibc-compiled node_modules get copied into the Alpine container, breaking better-sqlite3 with `ld-linux-x86-64.so.2` errors. Always ensure `.dockerignore` exists on the `main` branch before building.

## REST API (rest-api.py)
- Lives in the DMS container's config dir (typically mounted from the host's `<dms-config>/dms-gui/rest-api.py`)
- Runs inside DMS container via supervisor on port 8888
- Authenticated via `DMS_API_KEY` env var (must match in both mailserver.env and dms-gui .env)
- Supervisor config: `<dms-config>/dms-gui/rest-api.conf` on the host
- Deployed by `user-patches.sh` in the DMS container

### Action protocol (the only request shape rest-api.py accepts)
After the Sprint A–E migration (last commit on main 2026-05-10), the interpreter accepts only `{action: <id>, args: {...}, timeout: <seconds>}` requests. The legacy `{command:}` shell-passthrough path has been removed.

- **Manifest**: `backend/restApiManifest.mjs` is the source of truth for the action allowlist. Each entry declares `id`, an `argv` template (or `pipeline` for multi-stage), per-arg `validate` rules, and optional `redirect`. The manifest is written to `<dms-config>/dms-gui/rest-api-manifest.json` at deploy time and read by the interpreter at startup.
- **Execution**: token-level substitution (`{placeholder}` → validated arg) + `subprocess.Popen(shell=False)`. No shell ever runs. No `&&`, no `|` outside the manifest's own `pipeline` declarations, no `>`/`>>` outside the manifest's own `redirect` declarations.
- **Validators**: each placeholder must be declared with one of `enum`, `regex` (with `maxlen`), `int` (with `min`/`max`), or `string` (with `minlen`/`maxlen`). Build-time tests (`backend/restApiManifest.test.mjs`) enforce: unique snake_case ids, every placeholder declared, no orphan validators, argv tokens contain no shell-operator characters, redirect targets are absolute and `..`-free, every `execAction(literal, ...)` and `actionId: 'literal'` references a real manifest entry.
- **JS-side caller**: `backend/backend.mjs` exports `execAction(actionId, args, target, opts)`. Action ids must be reachable as static string literals (or a `{ actionId: 'foo' }` config-table key) so the build-time coverage test can grep them.
- **Empty-manifest detection**: if the interpreter fails to load the manifest at startup, ACTIONS is empty and every request returns 503 (not 403) so callers can distinguish server misconfiguration from "unknown action".

## Production deployment topology
- Runs behind Traefik (hostname configured per environment)
- Compose file: `dms-gui.yaml` (lives in the production host's docker-compose dir)
- Config: `<compose-dir>/dms-gui/config/.dms-gui.env`
- Container exposes port 80 (nginx serves SPA + proxies /api/ to backend on 3001)
- Shares the Traefik docker network with the mailserver container

## Backend architecture
Backend is split into modular route files + business-logic modules:

- `backend/index.js` — App setup, global middleware, route mounting, startup
- `backend/middleware.js` — Shared auth/validation/error middleware (authenticateToken, requireAdmin, requireActive, validateContainerName, authLimiter, serverError, generateAccessToken/RefreshToken, DOMAIN_RE, isValidDomain)
- `backend/envBootstrap.mjs` — Side-effect dotenv loader; imported first by env.mjs and restApiManifest.mjs to make DMS_CONFIG_PATH visible before either module's body runs
- `backend/corsConfig.mjs` — CORS origin parser/validator (env → allowlist) with regex shape check; index.js wires it through a function-based origin handler so CodeQL recognises the sanitizer
- `backend/restApiManifest.mjs` — Source of truth for the action protocol. Declarative `argv` / `pipeline` / `validate` / `redirect` entries; build-time tests enforce structural invariants. See "REST API" section above.
- `backend/routes/auth.js` — Login, logout, refresh, forgot/reset password
- `backend/routes/logins.js` — Login CRUD, roles (admin user management)
- `backend/routes/accounts.js` — Email account CRUD, doveadm, quota
- `backend/routes/aliases.js` — Alias CRUD (uses `^[^@]+@([_\-.\w]+)` for domain extraction; no greedy `.*@` to avoid polynomial-time backtracking)
- `backend/routes/settings.js` — Settings CRUD, configs, branding, logo upload (multer 2.x)
- `backend/routes/domains.js` — Domains, DNS lookup, DKIM, DNSBL, DNS control
- `backend/routes/server.js` — Status, infos, envs, logs, count, initAPI, killContainer. The `/status/:plugin/:containerName` route applies the SSRF gates: admin-only `settings` body, containerName must be in caller's accessible config set.
- `backend/routes/mail.js` — Autoconfig, mobileconfig, password gen, rspamd, dovecot
- `backend/env.mjs` — Environment config + embedded rest-api.py template (action-only after Sprint E)
- `backend/settings.mjs` — DMS status/dashboard data, DKIM generation, DNS lookup. `getConfigs(plugin, roles)`: empty `roles` is the admin path, callers must guard non-admin code accordingly (see security notes).
- `backend/dnsProviders.mjs` — DNS provider abstraction (Domeneshop + Cloudflare), upsert TXT records
- `backend/accounts.mjs` — Account management (uses `escapeShellArg`)
- `backend/aliases.mjs` — Alias management (action protocol)
- `backend/sieve.mjs` — Sieve script management (action protocol)
- `backend/logins.mjs` — dms-gui login user management (action protocol)
- `backend/db.mjs` — SQLite database layer (better-sqlite3), encrypt/decrypt, AES key migration. `getTargetDict(plugin, containerName, settings)` is the SSRF host validator: protocol allowlist (http/https), host regex (alphanumeric + `._-`, no IP literals, URL-canonical check), port range (1..65535).

## Key frontend files
- `frontend/src/pages/Domains.jsx` — Domain list, DNS Details modal, click-to-edit SPF/DMARC, DKIM generation + push
- `frontend/src/pages/DnsProviderConfig.jsx` — DNS provider profile CRUD (encrypted credentials)
- `frontend/src/pages/Settings.jsx` — Settings accordion tabs
- `frontend/src/components/DataTable.jsx` — Reusable table component

## Security notes
- **Action protocol**: rest-api.py runs no shell. Token-level substitution into `argv` from manifest, `subprocess.Popen(shell=False)`. See "REST API" above.
- **SSRF defenses on `/status/:plugin/:containerName`** (PR #74):
  1. `settings` body is admin-only (`req.user.isAdmin && Array.isArray(...) && length > 0`); non-admins drop the override and fall through to the DB target dict.
  2. ContainerName presence check against `getConfigs(plugin, scope)`. Non-admin scope is `req.user.roles` (mailserver) or `[req.user.id]` (other plugins). Empty-roles non-admin on mailserver is rejected upfront — `getConfigs(plugin, [])` is the admin path and would otherwise grant full access.
  3. Protocol allowlist (`http`/`https` only) in `getTargetDict`. Applied to both user-supplied and DB-loaded values.
  4. Host regex (`^[a-z0-9][a-z0-9._-]*$/i`) + IPv4-literal reject (`^[0-9]{1,3}(\.[0-9]{1,3}){3}$`) + URL-canonical check (rejects WHATWG IPv4 shorthand: `127.1`, `2130706433`, `0x7f.1`). Validators are written as boolean-AND chains so CodeQL recognises them as sanitisers.
- **CORS** is restricted via `CORS_ORIGINS` env var (PR #75). Wildcards (`*`), userinfo, paths, queries, fragments, and disallowed schemes are filtered out by `corsConfig.mjs`'s parser. Function-based origin handler in `index.js` so CodeQL closes the `js/cors-permissive-configuration` flow.
- **ReDoS** in alias domain extraction was fixed by switching from `/.*@([_\-.\w]+)/` to `/^[^@]+@([_\-.\w]+)/` — the negated char class avoids polynomial-time backtracking.
- All user input passed to shell commands (the few legacy paths that remain) must use `escapeShellArg()` from `common.mjs`.
- Auth endpoints are rate-limited (express-rate-limit). CSRF protection (#40) via double-submit cookie on every authenticated route.
- Non-admin users cannot set isAdmin/isActive/roles on themselves.
- `jsonFixTrailingCommas` uses safe parsing only — no dynamic-code evaluation.
- AES-256-GCM encryption (g1: format prefix); key derived as raw 32 bytes from SHA-512 digest of AES_SECRET. Legacy CBC ciphertext (pre-2.2.0) still readable on decrypt.
- Password comparison uses `crypto.timingSafeEqual()` to prevent timing attacks. New password hashing uses `setup_email_update` action (Sprint E).

## Testing
Tests use vitest + supertest. Run from the project root:
```bash
cd backend && DMSGUI_VERSION=test npx vitest run    # ~465 tests
cd frontend && npx vitest run                        # ~42 tests
```

Notable test files:
- `backend/restApiManifest.test.mjs` — Build-time invariants (unique snake_case ids, every placeholder declared, no orphan validators, every `execAction(literal, ...)` references a real action). Auto-enumerates source files for the coverage check, so new modules are picked up automatically.
- `backend/test/restApiSmoke.test.mjs` — Spawns rest-api.py against a synthetic manifest and exercises real HTTP requests (skipped when python3 isn't available).
- `backend/db.test.mjs` — encrypt/decrypt + getTargetDict host/port/protocol allowlists.
- `backend/routes/server.test.js` — `/status` SSRF gates (admin-only settings, containerName presence, empty-roles guard).
- `backend/corsConfig.test.mjs` — CORS origin parser/validator (PR #75).
- `backend/test/routeHelper.mjs` — Shared route-test utilities (createTestApp, JWT admin/user/inactive tokens; inline a custom token for unusual user shapes like empty roles).

CI runs both suites before any release; releases fail closed if any test fails.

For manual verification after a deploy:
1. Check backend logs: `docker logs dms-gui --tail 20`
2. Test login at the configured production hostname
3. Verify affected functionality in the web UI
