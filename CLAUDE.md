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
- Uses `shlex.split()` for command execution (not `shell=True`) to prevent injection
- Supports shell pipes by splitting on `|` and chaining via `subprocess.Popen`
- Supports `>` / `>>` redirect on the last pipe stage only
- Supports `&&` command chaining (splits on `&&`, runs sequentially, stops on non-zero exit)
- Supervisor config: `<dms-config>/dms-gui/rest-api.conf` on the host
- Deployed by `user-patches.sh` in the DMS container

## Production deployment topology
- Runs behind Traefik (hostname configured per environment)
- Compose file: `dms-gui.yaml` (lives in the production host's docker-compose dir)
- Config: `<compose-dir>/dms-gui/config/.dms-gui.env`
- Container exposes port 80 (nginx serves SPA + proxies /api/ to backend on 3001)
- Shares the Traefik docker network with the mailserver container

## Backend architecture (refactored Feb 28)
Backend was split from a 2,980-line monolith into modular route files:

- `backend/index.js` — App setup, global middleware, route mounting, startup (~185 lines)
- `backend/middleware.js` — Shared auth/validation/error middleware (authenticateToken, requireAdmin, requireActive, validateContainerName, authLimiter, serverError, generateAccessToken/RefreshToken, DOMAIN_RE, isValidDomain)
- `backend/routes/auth.js` — Login, logout, refresh, forgot/reset password
- `backend/routes/logins.js` — Login CRUD, roles (admin user management)
- `backend/routes/accounts.js` — Email account CRUD, doveadm, quota
- `backend/routes/aliases.js` — Alias CRUD
- `backend/routes/settings.js` — Settings CRUD, configs, branding, logo upload
- `backend/routes/domains.js` — Domains, DNS lookup, DKIM, DNSBL, DNS control
- `backend/routes/server.js` — Status, infos, envs, logs, count, initAPI, killContainer
- `backend/routes/mail.js` — Autoconfig, mobileconfig, password gen, rspamd, dovecot
- `backend/env.mjs` — Environment config, embedded rest-api.py template
- `backend/settings.mjs` — DMS status/dashboard data, DKIM generation, DNS lookup
- `backend/dnsProviders.mjs` — DNS provider abstraction (Domeneshop + Cloudflare), upsert TXT records
- `backend/accounts.mjs` — Account management (uses `escapeShellArg`)
- `backend/aliases.mjs` — Alias management
- `backend/db.mjs` — SQLite database layer (better-sqlite3), encrypt/decrypt, AES key migration

## Key frontend files
- `frontend/src/pages/Domains.jsx` — Domain list, DNS Details modal, click-to-edit SPF/DMARC, DKIM generation + push
- `frontend/src/pages/DnsProviderConfig.jsx` — DNS provider profile CRUD (encrypted credentials)
- `frontend/src/pages/Settings.jsx` — Settings accordion tabs
- `frontend/src/components/DataTable.jsx` — Reusable table component

## Security notes
- All user input passed to shell commands must use `escapeShellArg()` from `common.mjs`
- CORS is restricted via `CORS_ORIGINS` env var (not open to all origins)
- Auth endpoints are rate-limited (express-rate-limit)
- Non-admin users cannot set isAdmin/isActive/roles on themselves
- `jsonFixTrailingCommas` uses `JSON.parse()` (not `eval()`)
- AES-256 encryption: key derived as raw 32 bytes from SHA-512 digest of AES_SECRET
- Password comparison uses `crypto.timingSafeEqual()` to prevent timing attacks

## Testing
Tests use vitest + supertest. Run from the project root:
```bash
cd backend && npx vitest run
cd frontend && npx vitest run
```
- `backend/middleware.test.mjs` — 31 tests for shared middleware
- `backend/routes/auth.test.js` — 14 tests for auth routes
- `backend/routes/accounts.test.js` — 15 tests for account routes
- `backend/test/routeHelper.mjs` — Shared test utilities (createTestApp, JWT tokens)
- Existing tests in `backend/` — 115 tests

CI runs both suites before any release; releases fail closed if any test fails.

For manual verification after a deploy:
1. Check backend logs: `docker logs dms-gui --tail 20`
2. Test login at the configured production hostname
3. Verify affected functionality in the web UI
