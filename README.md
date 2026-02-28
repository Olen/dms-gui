# 📬 Docker Mailserver GUI

[![GHCR](https://img.shields.io/badge/ghcr.io-olen%2Fdms--gui-blue?logo=github)](https://github.com/Olen/dms-gui/pkgs/container/dms-gui)

A web-based management interface for [Docker-Mailserver](https://github.com/docker-mailserver/docker-mailserver) (DMS). Manage email accounts, aliases, domains, DNS records, spam filtering, and more — all from a single dashboard.

Built as a single Docker container: React frontend (Vite, Bootstrap) + Node.js/Express backend + nginx reverse proxy. Communicates with DMS via a lightweight Python REST API running inside the DMS container.

> **Fork notice** — This is a fork of [audioscavenger/dms-gui](https://github.com/audioscavenger/docker-mailserver-GUI) with significant additions: rspamd integration, DNS record pushing (Domeneshop + Cloudflare), DKIM generation, DNSBL checks, demo mode, and more.

---

## 📖 Table of Contents

- [🔧 Admin](#-admin)
- [👤 Users](#-users)
- [🌍 Shared Features](#-shared-features)
- [🚀 Quick Start](#-quick-start)
- [⚙️ Configuration](#️-configuration)
- [🔒 Security](#-security)
- [🏗️ Architecture](#️-architecture)
- [🛠️ Development](#️-development)
- [🎭 Demo Mode](#-demo-mode)
- [❓ FAQ](#-faq)
- [📄 License](#-license)

---

## 🔧 Admin

> Screenshots use anonymized demo data.

### 📊 Dashboard

At-a-glance server health: container status, CPU/memory/disk usage, and counts of accounts, aliases, and logins. The dashboard auto-refreshes every 30 seconds.

<img width="1555" alt="Admin Dashboard" src="https://github.com/user-attachments/assets/475b240c-ca19-4558-b9a2-4370a18a01b1" />

### 👥 Email Accounts

Create, delete, and manage email accounts. Each account shows its storage quota with a usage bar, and active IMAP sessions are highlighted so you can see who's currently connected.

<img width="1555" alt="Email Accounts" src="https://github.com/user-attachments/assets/39889d0f-bfd5-4306-8a26-9244303514b8" />

### 📨 Aliases

Manage single and multi-destination aliases, regex aliases, and catch-all addresses (`@domain.com`). All columns are sortable and filterable.

<img width="1555" alt="Aliases" src="https://github.com/user-attachments/assets/7688ec93-0577-40ec-a1e2-e619a5e52310" />

### 👤 User Logins

Three login types: **admins** (full access), **users** (manage multiple mailboxes), and **linked mailbox users** (authenticate via DMS Dovecot). Any email account can be granted GUI access so users can change their own password, view quotas, and manage aliases.

<img width="1529" alt="User Logins" src="https://github.com/user-attachments/assets/3a2869ff-6ba0-4138-8786-3a9ca4f825dc" />

### 🌐 Domains & DNS

Live DNS checks for every domain: A, MX, SPF, DKIM, DMARC, TLSA, and SRV records with color-coded status badges. Assign a DNS provider per domain for one-click record pushing.

<img width="1533" alt="Domains & DNS" src="https://github.com/user-attachments/assets/581ac687-38be-454f-a1aa-e8b210b75896" />

Click a domain to open the DNS Details modal where you can inspect each record, edit SPF and DMARC with guided setup, generate DKIM keys (RSA or Ed25519), and push records to Domeneshop or Cloudflare. The Blacklist tab checks your mail server IP against Spamhaus, Abusix, Barracuda, SpamCop, UCEProtect, and others.

| DNS Details | Blacklist Check |
|-------------|-----------------|
| <img width="813" alt="DNS Details" src="https://github.com/user-attachments/assets/88f9d756-5d2a-4694-9f48-c21a17717254" /> | <img width="814" alt="Blacklist Check" src="https://github.com/user-attachments/assets/9f734c96-075a-423e-81d0-9c42206d9c8b" /> |

### 🧹 Rspamd

Full rspamd integration: server statistics with version and uptime, message action breakdown (clean / add header / greylist / reject) with progress bars, per-user Bayes learning stats, top symbols ranked by score impact, and a message history browser with manual ham/spam training.

<img width="1539" alt="Rspamd" src="https://github.com/user-attachments/assets/d3f6f087-3d8a-42c7-a444-bf3934852cf9" />

Browse message history and re-learn individual messages as ham or spam with one click.

<img width="1539" alt="Rspamd Learning" src="https://github.com/user-attachments/assets/78fb259e-b8f1-4b26-9f28-c0f55262fba1" />

### 📋 Logs

Browse logs from the DMS-GUI backend, the DMS container, and rspamd — all in one place. Logs are color-coded and auto-scroll, with configurable line count.

<img width="1555" alt="Logs" src="https://github.com/user-attachments/assets/bf72ae15-78d5-47e9-b8ec-975afbff274e" />

### ⚙️ Settings

**User Settings** — Configure IMAP/SMTP/POP3 hostnames and ports, webmail URL, rspamd URL, and toggle whether users can manage their own aliases.

<img width="1555" alt="User Settings" src="https://github.com/user-attachments/assets/d01bdab0-ebee-4889-8c58-ed1bd02a2fcb" />

**Branding** — Customize the site name, upload a logo, and set primary and sidebar colors. Branding is shown on the login page and throughout the UI.

<img width="1555" alt="Branding" src="https://github.com/user-attachments/assets/fddb17e4-b700-48fd-9268-563f75910f46" />

**DNS Providers** — Set up provider profiles with encrypted API credentials (Domeneshop, Cloudflare, Route53, Oracle, Azure) to push SPF, DKIM, and DMARC records directly from the Domains page.

**Multi-DMS** — Connect and switch between multiple DMS instances from the sidebar. Each container has its own settings, accounts, and domains.

---

## 👤 Users

Admins can grant any email account access to the GUI. Users see a personalized view with only their own data — no server-level settings or other users' accounts.

### 📊 Dashboard

Personal mailbox quota with usage bar, spam summary with recent spam subjects, alias count, and a quick link to webmail.

<img width="1538" alt="User Dashboard" src="https://github.com/user-attachments/assets/22f1d569-a583-4ecb-8801-7b7a4187174a" />

### 🔐 Profile & Password

Change the GUI password and the DMS Dovecot password from the same page.

| Profile | Change Password |
|---------|-----------------|
| <img width="654" alt="Profile" src="https://github.com/user-attachments/assets/4fd60d02-fd09-4164-9373-c9aaa2088efc" /> | <img width="522" alt="Change Password" src="https://github.com/user-attachments/assets/8a966914-f807-4172-a878-fb8fc3be5ed8" /> |

### 📨 Aliases

Users can view (and optionally manage) the aliases that deliver to their mailbox. The admin controls whether users can add/delete their own aliases or only see the current list.

<img width="1544" alt="User Aliases" src="https://github.com/user-attachments/assets/6fde0b95-5b7d-4ef6-bd93-6a5d104a52c0" />

### ✉️ Mail Setup

One-click download of Thunderbird autoconfig (XML) and Apple .mobileconfig profiles, pre-filled with the correct server hostnames and ports.

<img width="1053" alt="Mail Setup" src="https://github.com/user-attachments/assets/6a05c08d-9ee6-46f4-a551-da142305bfe7" />

### 🔑 Password Reset

Forgot your password? The login page has a self-service reset link that sends a time-limited token (1 hour) to your email. Rate-limited to 3 requests per 15 minutes.

---

## 🌍 Shared Features

- **Multilingual** — English, Norwegian (Bokmål), Polish; language preference saved per user
- **Responsive** — Bootstrap-based UI works on desktop and mobile
- **SQLite database** — better-sqlite3 with automatic migration patches

---

## 🚀 Quick Start

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
    image: ghcr.io/olen/dms-gui:latest
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

---

## ⚙️ Configuration

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
| `isDEMO` | `false` | Demo mode — shows anonymized fake data, all write operations are no-ops |

### DMS REST API Environment (in your DMS compose)

| Variable | Default | Description |
|----------|---------|-------------|
| `DMS_API_HOST` | `0.0.0.0` | API listen address |
| `DMS_API_PORT` | `8888` | API listen port |
| `DMS_API_KEY` | — | API authentication key (must match dms-gui Settings) |
| `DMS_API_SIZE` | `1024` | Maximum request payload size |

---

## 🔒 Security

### 🔐 Authentication
- Crypto-secure hashed passwords (scrypt) with per-user salt
- HTTP-Only cookies with JWT access and refresh tokens
- JWT secrets regenerated daily via scheduled container restart
- Per-IP rate limiting on login and password reset endpoints
- `crypto.timingSafeEqual()` for password comparison (timing-attack safe)

### 🛡️ Authorization

| Access | 🔧 Admin | 👤 User | 📧 Linked Mailbox |
|--------|----------|---------|-------------------|
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

### 🔏 Data Protection
- AES-256-CBC encryption for stored DNS provider credentials
- Command injection prevention via `escapeShellArg()` on all shell commands
- REST API uses `subprocess.Popen` (not `shell=True`)
- CORS restricted to configured origins
- SQL parameterized via named bindings (no string interpolation)

---

## 🏗️ Architecture

```
Browser
  │
  ▼
[Reverse Proxy] (Traefik / Nginx / ...)
  │
  ▼
[dms-gui container]
  ├── nginx (:80) ── serves React SPA
  │                   proxies /api/* to backend
  └── node (:3001) ── Express API server
       │                ├── SQLite database
       │                └── JWT auth
       ▼
  [DMS container]
  └── rest-api.py (:8888) ── executes setup/doveadm commands
```

### 🐍 REST API

The Python REST API runs inside DMS as a supervisor service. It accepts authenticated POST requests, executes system commands (`setup`, `doveadm`, etc.), and returns JSON results. The API key is verified on every request, and the port is only exposed on the Docker network.

Both `rest-api.py` and `rest-api.conf` are generated by dms-gui when you create the API key in Settings. The source template is embedded in `backend/env.mjs`.

---

## 🛠️ Development

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

### 📁 Project structure

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

---

## 🎭 Demo Mode

Set `isDEMO=true` in your `.dms-gui.env` to run dms-gui with realistic anonymized data — no DMS container required. All pages are fully populated with fake accounts, aliases, domains, DNS records, rspamd statistics, and log entries. Write operations (add/delete accounts, learn spam, push DNS, etc.) return success without doing anything.

Demo mode is useful for:
- **Evaluating the UI** before connecting to a real DMS instance
- **Screenshots and documentation** with safe, anonymized data
- **Development and testing** without a running mail server

Default login: `admin` / `changeme`

---

## ❓ FAQ

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

---

## 📄 License

AGPL-3.0-only
