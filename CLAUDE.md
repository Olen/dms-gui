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

### Branch model (fork-first, Feb 2026+)
```
deploy                      ← primary development + production branch
  └── feature/<name>        ← optional branches for larger features
main                        ← frozen snapshot of upstream (audioscavenger/dms-gui)
```

Upstream PRs (#7–#25) remain open but unreviewed. We develop directly on `deploy`.
If upstream ever engages, we can cherry-pick or rebase selectively.

### Core rules
1. **`deploy` is the primary branch** — all development happens here
2. **Feature branches are optional** — use `feature/<name>` off `deploy` for larger multi-commit work, merge back when done
3. **`main` is frozen** — do not commit to main; it preserves the upstream fork point
4. **Old `fix/*` branches are archived** — they still exist for the open PRs but are not actively maintained

### Day-to-day workflow
```bash
# Simple changes: commit directly to deploy
git checkout deploy
# edit, test
git add <files> && git commit -m "description"
docker build -t olen/dms-gui:latest .
cd /home/docker && make dms-gui-recreate
```

### Larger features
```bash
git checkout deploy
git checkout -b feature/thing
# work, commit, test
git checkout deploy
git merge feature/thing --no-edit
docker build -t olen/dms-gui:latest .
cd /home/docker && make dms-gui-recreate
# optionally delete: git branch -d feature/thing
```

## Build & deploy (Apollo)

```bash
cd /home/olen/prog/dms-gui
git checkout deploy
docker build -t olen/dms-gui:latest .
cd /home/docker && make dms-gui-recreate
```

## Critical: .dockerignore
The `.dockerignore` with `**/node_modules` is essential. Without it, local glibc-compiled node_modules get copied into the Alpine container, breaking better-sqlite3 with `ld-linux-x86-64.so.2` errors. Always ensure `.dockerignore` exists on the `deploy` branch before building.

## REST API (rest-api.py)
- Lives at `/home/mailserver/config/dms-gui/rest-api.py` on Apollo
- Runs inside DMS container via supervisor on port 8888
- Authenticated via `DMS_API_KEY` env var (must match in both mailserver.env and dms-gui .env)
- Uses `shlex.split()` for command execution (not `shell=True`) to prevent injection
- Supports shell pipes by splitting on `|` and chaining via `subprocess.Popen`
- Supports `>` / `>>` redirect on the last pipe stage only
- Supports `&&` command chaining (splits on `&&`, runs sequentially, stops on non-zero exit)
- Supervisor config: `/home/mailserver/config/dms-gui/rest-api.conf`
- Deployed by `user-patches.sh` in the DMS container

## Apollo deployment details
- Runs behind Traefik at `epost.nytt.no`
- Compose file: `/home/docker/dms-gui.yaml`
- Config: `/home/docker/dms-gui/config/.dms-gui.env`
- Container exposes port 80 (nginx serves SPA + proxies /api/ to backend on 3001)
- Shares `docker_traefik_net` with mailserver container

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
Tests use vitest + supertest:
```bash
cd /home/olen/prog/dms-gui/backend && npx vitest run
```
- `backend/middleware.test.mjs` — 31 tests for shared middleware
- `backend/routes/auth.test.js` — 14 tests for auth routes
- `backend/routes/accounts.test.js` — 15 tests for account routes
- `backend/test/routeHelper.mjs` — Shared test utilities (createTestApp, JWT tokens)
- Existing tests in `backend/` — 115 tests

Also verify manually:
1. Build image and recreate container
2. Check backend logs: `sudo docker logs dms-gui --tail 20`
3. Test login at https://epost.nytt.no
4. Verify affected functionality in the web UI
