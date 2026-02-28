# Docker Mailserver GUI

[![Docker Pulls](https://img.shields.io/docker/pulls/audioscavenger/dms-gui)](https://hub.docker.com/r/audioscavenger/dms-gui)

A web-based management interface for [Docker-Mailserver](https://github.com/docker-mailserver/docker-mailserver) (DMS). Manage email accounts, aliases, domains, DNS records, spam filtering, and more — all from a single dashboard.

Built as a single Docker container: React frontend (Vite, Bootstrap) + Node.js/Express backend + nginx reverse proxy. Communicates with DMS via a lightweight Python REST API running inside the DMS container.

![Dashboard](assets/dashboard.webp)

## Features

### Core
- **Dashboard** — Server status, resource usage, account/alias/login counts (admin); personal quota, spam summary, webmail link (users)
- **Accounts** — Create, delete, and manage email accounts with storage quota display, active IMAP session indicators, and sortable columns
- **Aliases** — Single and multi-destination aliases, regex aliases, catch-all (`@domain.com`)
- **Logins** — Three user types: admins, users (manage multiple mailboxes), and linked mailbox users (DMS Dovecot auth)
- **Profile** — Password change for both GUI and DMS Dovecot accounts

### DNS & Domains
- **Live DNS checks** — A, MX, SPF, DKIM, DMARC, TLSA, SRV with color-coded status badges
- **DKIM generation** — Configurable selector, key type (RSA/Ed25519), key size; runs `setup config dkim` inside DMS
- **SPF/DMARC editor** — Click-to-edit with guided setup and grading
- **DNS push** — One-click record push to Domeneshop or Cloudflare (more providers available but untested)
- **DNSBL checks** — Spamhaus, Abusix, Barracuda, SpamCop, UCEProtect, and others

### Spam Filtering (rspamd)
- Server statistics: version, uptime, scan counts, processing time
- Message action breakdown with progress bars (clean/add header/greylist/reject)
- Per-user Bayes learning stats and manual training (mark as ham/spam)
- Top symbols by score impact
- Message history browser

### Other
- **Mail Setup** — Downloadable Thunderbird autoconfig and Apple .mobileconfig profiles
- **Password Reset** — Self-service email-based reset with rate limiting and token expiry
- **Branding** — Custom name, logo, icon, and colors per container
- **Multi-DMS** — Connect and switch between multiple DMS instances
- **Multilingual** — English, Norwegian (Bokmal), Polish; language preference saved per user
- **better-sqlite3** database with automatic migration patches

## Compatibility

| DMS     | dms-gui | x86_64 | aarch64 |
|---------|---------|--------|---------|
| v15.x   | v1.5    | yes    | yes     |

## Screenshots

> Screenshots use anonymized demo data. Sensitive information (addresses, domains, subjects) has been redacted.

### Login
![Login](assets/login.webp)

### Dashboard (admin)
![Dashboard admin](assets/dashboard.webp)

### Dashboard (user)
![Dashboard user](assets/dashboard-user.webp)

### Accounts
![Accounts](assets/accounts.webp)

### Aliases
![Aliases](assets/aliases.webp)

### Domains & DNS
![Domains](assets/domains.webp)

### Rspamd
![Rspamd](assets/rspamd.webp)

### Settings
![Settings](assets/settings.webp)

## Quick Start

### 1. Docker Compose

Add dms-gui alongside your DMS container. Both must share a Docker network.

```yaml
services:
  mailserver:
    # your existing DMS config
    environment:
      DMS_API_PORT: 8888
      DMS_API_KEY: your-api-key-here  # generate in dms-gui Settings
    expose:
      - "8888"
    volumes:
      # enable after generating the API key in dms-gui Settings:
      - ./config/dms-gui/rest-api.conf:/etc/supervisor/conf.d/rest-api.conf:ro
    networks:
      - mail

  dms-gui:
    image: audioscavenger/dms-gui:latest
    container_name: dms-gui
    restart: unless-stopped
    depends_on:
      - mailserver
    env_file: ./config/dms-gui/.dms-gui.env
    environment:
      - TZ=${TZ:-UTC}
    expose:
      - 80
    volumes:
      - ./config/dms-gui/:/app/config/
    networks:
      - mail

networks:
  mail:
    name: mail
```

### 2. Configure environment

Copy the example env file and generate an AES secret:

```bash
cp config/dms-gui/.dms-gui.env.example config/dms-gui/.dms-gui.env

# Generate AES_SECRET (set this once, never change it):
openssl rand -hex 32
```

Edit `.dms-gui.env` and set `AES_SECRET` to the generated value.

### 3. Start and connect

```bash
docker compose up -d
```

1. Open dms-gui in your browser (via your reverse proxy)
2. Log in with `admin` / `changeme` — you'll be prompted to change the password
3. Go to **Settings** and configure the DMS connection (container name, API key)
4. Generate the REST API key — this creates `rest-api.conf` and `rest-api.py`
5. Restart DMS to activate the REST API

## Configuration

### Environment Variables (.dms-gui.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node.js environment |
| `DEBUG` | `false` | Enable debug logging |
| `AES_SECRET` | — | **Required.** Encryption key for stored credentials. Generate once, never change. |
| `AES_ALGO` | `aes-256-cbc` | Encryption algorithm |
| `ACCESS_TOKEN_EXPIRY` | `1h` | JWT access token lifetime |
| `REFRESH_TOKEN_EXPIRY` | `1d` | JWT refresh token lifetime |
| `DMSGUI_CRON` | `0 1 23 * * *` | Daily restart schedule (regenerates JWT secrets) |
| `IV_LEN` | `16` | Initialization vector length |
| `HASH_LEN` | `64` | Password hash key length |
| `LOG_COLORS` | `true` | Colored backend logs |
| `isDEMO` | `false` | Demo mode |

### DMS REST API Environment (in your DMS compose)

| Variable | Default | Description |
|----------|---------|-------------|
| `DMS_API_HOST` | `0.0.0.0` | API listen address |
| `DMS_API_PORT` | `8888` | API listen port |
| `DMS_API_KEY` | — | API authentication key (must match dms-gui Settings) |
| `DMS_API_SIZE` | `1024` | Maximum request payload size |

## Reverse Proxy

dms-gui serves on port 80 (nginx). Place it behind your reverse proxy of choice.

**Traefik example** (labels on the dms-gui container):

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.dms-gui.rule=Host(`mail-admin.example.com`)"
  - "traefik.http.routers.dms-gui.entrypoints=websecure"
  - "traefik.http.routers.dms-gui.tls.certresolver=letsencrypt"
  - "traefik.http.services.dms-gui.loadbalancer.server.port=80"
```

**Nginx example:**

```nginx
server {
    listen 443 ssl;
    server_name mail-admin.example.com;

    location / {
        proxy_pass http://dms-gui:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Security

### Authentication
- Crypto-secure hashed passwords (scrypt) with per-user salt
- HTTP-Only cookies with JWT access and refresh tokens
- JWT secrets regenerated daily via scheduled container restart
- Per-IP rate limiting on login and password reset endpoints
- `crypto.timingSafeEqual()` for password comparison (timing-attack safe)

### Authorization

| Access | Admin | User | Linked mailbox user |
|--------|-------|------|---------------------|
| Auth method | GUI password | GUI password | DMS Dovecot |
| Dashboard | full | personal | personal |
| Accounts | full | partial | password only |
| Aliases | full | own (configurable) | own |
| Domains & DNS | full | — | — |
| Rspamd | full | — | — |
| Logins | full | — | — |
| Settings | full | — | — |
| Mail Setup | full | full | full |
| Profile | full | full | full |

### Data Protection
- AES-256-CBC encryption for stored DNS provider credentials
- Command injection prevention via `escapeShellArg()` on all shell commands
- REST API uses `subprocess.Popen` (not `shell=True`)
- CORS restricted to configured origins
- SQL parameterized via named bindings (no string interpolation)

## Architecture

```
Browser
  |
  v
[Reverse Proxy] (Traefik / Nginx / ...)
  |
  v
[dms-gui container]
  ├── nginx (:80) ── serves React SPA
  │                   proxies /api/* to backend
  └── node (:3001) ── Express API server
       |                ├── SQLite database
       |                └── JWT auth
       v
  [DMS container]
  └── rest-api.py (:8888) ── executes setup/doveadm commands
```

### REST API

The Python REST API runs inside DMS as a supervisor service. It accepts authenticated POST requests, executes system commands (`setup`, `doveadm`, etc.), and returns JSON results. The API key is verified on every request, and the port is only exposed on the Docker network.

Both `rest-api.py` and `rest-api.conf` are generated by dms-gui when you create the API key in Settings. The source template is embedded in `backend/env.mjs`.

## Development

### Prerequisites

- Node.js v24+ (embedded in the Docker image)
- npm

### Running tests

```bash
cd backend && npx vitest run
```

### Building

```bash
docker build -t dms-gui:latest .
```

### Project structure

```
├── backend/            Express API server
│   ├── routes/         Route handlers (auth, logins, accounts, aliases, etc.)
│   ├── db.mjs          SQLite database layer
│   ├── middleware.js    Auth, validation, error handling
│   ├── env.mjs         Environment config, REST API template
│   ├── settings.mjs    DMS status, DKIM generation, DNS lookup
│   └── dnsProviders.mjs  DNS provider abstraction
├── frontend/           React SPA (Vite, Bootstrap)
│   └── src/
│       ├── pages/      Page components
│       ├── components/ Reusable UI components
│       ├── services/   API client
│       ├── hooks/      React hooks (auth, localStorage, branding)
│       └── locales/    i18n translations (en, no, pl)
├── common.mjs          Shared utilities (frontend + backend)
├── Dockerfile          Multi-stage build
└── config/             Example configuration files
```

## FAQ

**How does dms-gui communicate with DMS?**
Via a Python REST API that runs inside the DMS container as a supervisor service. It executes `setup` and `doveadm` commands and returns results as JSON.

**How secure is the REST API?**
The API port is only exposed on the Docker network (not to the host). Every request requires an API key in the Authorization header. Commands use `subprocess.Popen` with `shlex.split()` — never `shell=True`.

**Can I see the REST API source code?**
Yes, the template is in `backend/env.mjs`. The actual files are generated in `config/dms-gui/` when you create the API key.

**Can a non-admin user escalate privileges?**
No. The backend strips `isAdmin`, `isActive`, and `roles` from non-admin PATCH requests. Authorization is checked server-side on every request using the JWT payload.

**Can users reset forgotten passwords?**
Yes. The login page has a "Forgot password?" link that sends a time-limited reset token (1 hour) to the user's email. Rate-limited to 3 requests per 15 minutes.

## License

AGPL-3.0-only
