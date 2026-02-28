# 📬 Docker Mailserver GUI

[![Docker Pulls](https://img.shields.io/docker/pulls/audioscavenger/dms-gui)](https://hub.docker.com/r/audioscavenger/dms-gui)

A web-based management interface for [Docker-Mailserver](https://github.com/docker-mailserver/docker-mailserver) (DMS). Manage email accounts, aliases, domains, DNS records, spam filtering, and more — all from a single dashboard.

Built as a single Docker container: React frontend (Vite, Bootstrap) + Node.js/Express backend + nginx reverse proxy. Communicates with DMS via a lightweight Python REST API running inside the DMS container.

![Dashboard](assets/dashboard.webp)

---

## 📖 Table of Contents

- [✨ Features](#-features)
  - [🔧 Admin Features](#-admin-features)
  - [👤 User Features](#-user-features)
- [📋 Compatibility](#-compatibility)
- [📸 Screenshots](#-screenshots)
- [🚀 Quick Start](#-quick-start)
- [⚙️ Configuration](#️-configuration)
- [🔒 Security](#-security)
- [🏗️ Architecture](#️-architecture)
- [🛠️ Development](#️-development)
- [❓ FAQ](#-faq)
- [📄 License](#-license)

---

## ✨ Features

### 🔧 Admin Features

| Feature | Description |
|---------|-------------|
| 📊 **Dashboard** | Server status, CPU/memory/disk usage, account/alias/login counts |
| 👥 **Accounts** | Create, delete, and manage email accounts with storage quota, active IMAP session indicators |
| 📨 **Aliases** | Single and multi-destination aliases, regex aliases, catch-all (`@domain.com`) |
| 🌐 **Domains & DNS** | Live A, MX, SPF, DKIM, DMARC, TLSA, SRV checks with color-coded status badges |
| 🔑 **DKIM Generation** | Configurable selector, key type (RSA/Ed25519), key size; runs `setup config dkim` inside DMS |
| ✏️ **SPF/DMARC Editor** | Click-to-edit with guided setup and grading |
| 🚀 **DNS Push** | One-click record push to Domeneshop or Cloudflare (more providers available) |
| 🛡️ **DNSBL Checks** | Spamhaus, Abusix, Barracuda, SpamCop, UCEProtect, and others |
| 🧹 **Rspamd** | Server stats, message action breakdown, per-user Bayes learning, top symbols, message history |
| 👤 **Logins** | Three user types: admins, users (manage multiple mailboxes), and linked mailbox users (Dovecot auth) |
| ⚙️ **Settings** | DMS connection config, REST API key generation, branding (name, logo, icon, colors) |
| 🔗 **Multi-DMS** | Connect and switch between multiple DMS instances |

### 👤 User Features

| Feature | Description |
|---------|-------------|
| 📊 **Dashboard** | Personal mailbox quota with usage bar, spam summary, webmail link, alias count |
| 📨 **Aliases** | View aliases that deliver to your mailbox (configurable by admin) |
| ✉️ **Mail Setup** | Downloadable Thunderbird autoconfig and Apple .mobileconfig profiles |
| 🔐 **Profile** | Change password for both GUI and DMS Dovecot account |
| 🔑 **Password Reset** | Self-service email-based reset with rate limiting and token expiry |

### 🌍 Shared

- **Multilingual** — English, Norwegian (Bokmål), Polish; language preference saved per user
- **Responsive** — Bootstrap-based UI works on desktop and mobile
- **SQLite database** — better-sqlite3 with automatic migration patches

---

## 📋 Compatibility

| DMS     | dms-gui | x86_64 | aarch64 |
|---------|---------|--------|---------|
| v15.x   | v1.5    | ✅     | ✅      |

---

## 📸 Screenshots

> Screenshots use anonymized demo data. Sensitive information has been redacted.

### 🔧 Admin Views

| Dashboard |
|-----------|
| <img width="1555" height="522" alt="image" src="https://github.com/user-attachments/assets/475b240c-ca19-4558-b9a2-4370a18a01b1" /> |

| Email Accounts |
|----------------|
| <img width="1555" height="859" alt="image" src="https://github.com/user-attachments/assets/39889d0f-bfd5-4306-8a26-9244303514b8" /> |
| Check quotas, change password, create and delete accounts |


| Aliases |
|---------|
| <img width="1555" height="859" alt="image" src="https://github.com/user-attachments/assets/7688ec93-0577-40ec-a1e2-e619a5e52310" /> |

| User logins |
|-------------|
| <img width="1529" height="709" alt="image" src="https://github.com/user-attachments/assets/3a2869ff-6ba0-4138-8786-3a9ca4f825dc" /> |
| All accounts can also be allowed to log in as Users in DMS-GUI to be able to change password, see their own quotas, aliases etc |




| Domains & DNS |
|---------------|
| <img width="1533" height="455" alt="image" src="https://github.com/user-attachments/assets/581ac687-38be-454f-a1aa-e8b210b75896" /> |

| DNS Details per domain | Blacklist Details per domain |
|------------------------|------------------------------|
| <img width="813" height="913" alt="image" src="https://github.com/user-attachments/assets/88f9d756-5d2a-4694-9f48-c21a17717254" /> | <img width="814" height="576" alt="image" src="https://github.com/user-attachments/assets/9f734c96-075a-423e-81d0-9c42206d9c8b" /> |
| You can update important parameters of SPF and DMARC, as well as generating and deploying new DKIM-keys | |



| Rspamd |
|--------|
|  |

| Logs |
|------|
| <img width="1555" height="821" alt="image" src="https://github.com/user-attachments/assets/bf72ae15-78d5-47e9-b8ec-975afbff274e" /> |
| Check the logs from the DMS-GUI container, the DMS Container and Rspamd |


| Settings |
|----------|
| <img width="1555" height="841" alt="image" src="https://github.com/user-attachments/assets/d01bdab0-ebee-4889-8c58-ed1bd02a2fcb" /> |
| Control user related data.  Turn on and off user control of their own aliases |
| <img width="1555" height="841" alt="image" src="https://github.com/user-attachments/assets/fddb17e4-b700-48fd-9268-563f75910f46" />
| Siimple branding - Set the site name, add a logo, set primary and sidebar color |
| |
| Set up DNS-providers to push SPF, DKIM and DMARC-settings directly to your DNS provider |

### 👤 User Views

| Dashboard |
|-----------|
| <img width="1538" height="861" alt="image" src="https://github.com/user-attachments/assets/22f1d569-a583-4ecb-8801-7b7a4187174a" /> |

| Profile | Change Password |
|---------|-----------------|
| <img width="654" height="372" alt="image" src="https://github.com/user-attachments/assets/4fd60d02-fd09-4164-9373-c9aaa2088efc" /> | <img width="522" height="400" alt="image" src="https://github.com/user-attachments/assets/8a966914-f807-4172-a878-fb8fc3be5ed8" /> |

| Alias handling |
|----------------|
| <img width="1544" height="469" alt="image" src="https://github.com/user-attachments/assets/6fde0b95-5b7d-4ef6-bd93-6a5d104a52c0" /> |
| Admin can allow or deny users to manage their own aliases, or just see the current list of aliases |

| Mail Setup |
|------------|
| <img width="1053" height="612" alt="image" src="https://github.com/user-attachments/assets/6a05c08d-9ee6-46f4-a551-da142305bfe7" /> |
| Easy access to configuration of different email clients |



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
