# Docker Mailserver GUI
[![Docker Pulls](https://img.shields.io/docker/pulls/audioscavenger/dms-gui)](https://hub.docker.com/r/audioscavenger/dms-gui)

A graphical user interface for managing DMS ([Docker-Mailserver](https://github.com/docker-mailserver/docker-mailserver)) and other non-gui mailservers like Poste.io. This gui aims to manage all aspects of DMS including: email accounts, aliases, xapian indexes, DNS entries, and other stuff.

It relies on a generic REST API written in python, that you have to mount in DMS compose.

> **Note:** This is the `deploy` branch — a maintained fork with significant additions over the upstream `main` branch. See [Changes from upstream](#changes-from-upstream) below.

## Features

- Multi-arch: x86_64 (amd64) + aarch64 (arm64)
- Login page, crypto-secure hashed passwords, HTTP-Only cookies
- Dashboard with server status, resource usage, and per-user spam summary
- User management with roles for their mailboxes
  - Profile page with password change (GUI + DMS Dovecot)
  - Mailbox account management with storage quota display and active session indicators
  - Email alias management (includes regex and multi-destination aliases)
- Domains & DNS page with live record checks, DKIM generation, SPF/DMARC grading, and DNSBL lookups
- Rspamd spam filtering dashboard with statistics, Bayes training, message history, and per-user stats
- Mail Setup page with downloadable Thunderbird autoconfig and Apple .mobileconfig profiles
- Self-service password reset via email (with rate limiting and token expiry)
- Per-container branding (custom name, logo, colors)
- DMS (Docker-Mailserver) connection configuration
  - Multiple-DMS ready!
  - REST API Key management for direct access
- better-sqlite3 database with auto-upgrade patches
- Multilingual support (English, Polish)
- Node.JS v24

## Compatibility Chart

| dms     | dms-gui | x86_64 | aarch64 | details |
|---------|---------|--------|---------|---------|
| v15.1.0 | v1.5 | yes | yes | dovecot 2.3 |
| v16?    | no | no | no | dovecot 2.4 |


### FAQ

* [x] How does dms-gui interact with DMS?
> Simply, by executing `system` and `doveadm` commands inside DMS, through a python REST API.

* [x] How does dms-gui execute commands in DMS?
> Python REST API script and its loader are generated from dms-gui, and then mounted as a single volume in DMS compose, along with the exposed port. You don't need to alter `user-patches.sh` at all. The REST API script is conveniently placed in a folder that is mouted in DMS: `./config/dms-gui/`.

* [x] How secure is this REST API?
> REST API Access security is handled with a key generated from dms-gui itself. The key is sent in query header of the http calls. Since the DMS REST API port is exposed on the docker network only, no one else has access to it.

* [x] I don't trust you, can I see the python code for this REST API?
> Sure, it's in the `/backend/env.js` file.

* [x] How about logon security?
> Top notch: best practice for React has been followed: CORS same-domain Strict + HTTPonly cookies + backend verification of credentials, zero trust of the frontend.

* [x] Tell me more about logon security?
> Two 32 bits secrets are generated when container starts: one for generateToken (valid 1h) and the other for refreshToken (valid 7 days). Refresh tokens are saved in the db for each user and invalidated when container restarts, since the secrets have changed.

* [x] Security really bothers me, anything more?
> Yes, the container relies on node-cron and restarts daily at 11PM to regenerate new secret keys. You can alter the schedule with the environment variable `DMSGUI_CRON`.

* [x] How about password security?
> Standard practice: passwords are stored in a local sqlite3 db as separate salt and hash. We only force users to use 8+ characters.

* [x] Can a linked mailbox user hack their way into admin or unauthorized commands?
> No, their credentials are set in the HTTPonly cookie and the backend only relies on its values to determine what's allowed.

* [x] Can a user do path transversal or sql injections or anything to exploit this portal?
> No, sql commands are stored in a backend dictionary, and no frontend module can send sql commands directly. SQL is variabilized in the backend and cannot be injected. Routes are also protected following React best practices. The separation between frontend and backend is complete and interfaced with an API, just like Electron.js.

* [x] What do users have access to, in this portal?

| user / Access  | password | Profile | Dashboard | Accounts | Aliases | Mail Setup | Logins | Settings | Domains | Rspamd | Backups | Imports |
| -------------- | -------- | ------- | --------- | -------- | ------- | ---------- | ------ | -------- | ------- | ------ | ------- | ------- |
| admins         | dms-gui  | yes     | yes       | yes      | yes     | yes        | yes    | yes      | yes     | yes    | yes     | yes     |
| users          | dms-gui  | yes     | yes       | partial  | partial | yes        | no     | no       | no      | no     | partial | no      |
| linked users   | DMS      | yes     | partial   | no       | partial | yes        | no     | no       | no      | no     | partial | no      |

* [x] Can normal users change their password?
> Yes, users can change both their dms-gui password in their profile, and each of the mailboxes they control under Accounts. Logon password in dms-gui is saved in the database. Mailbox-linked users can only change the mailbox password, and their logon is handled by DMS dovecot directly.

* [x] Can users reset their forgotten password?
> Yes. A "Forgot password?" link on the login page sends a time-limited reset token (1 hour) to the user's mailbox. Rate-limited to 3 requests per 15 minutes per mailbox. Works for both DMS accounts and GUI-only logins.

* [x] Is this project affected by React2Shell Critical Vulnerability [CVE-2025-55182](https://www.cmu.edu/iso/news/2025/react2shell-critical-vulnerability.html)?
> No. This project has none of the React or 3rd party affected components like react-server-dom-turbopack, and is not even of the React versions affected. As I understand it, turbopack is another memory unsafe web bundler written in Rust, yet again.

### Login page

As long as the default admin user (_admin_ / password=_changeme_) exist, you are greeted with this message:

![Login](/assets/dms-gui-Login.webp)

### Profile page

There you can change your dms-gui / DMS Dovecot password. Users managers of multiple mailboxes cannot change individual mailboxes yet.

![Login](/assets/dms-gui-Profile.webp)

### Logins Management

Logins are 3 types:

| type | perks | details |
| -----|-------|---------|
| admins | Administrator | Can even demote itself |
| users | Can manage multiple mailboxes | Not admin, cannot change managed mailboxes, Authentication by dms-gui |
| linked users | Can change their mailbox password | Authentication provided by DMS Dovecot |

![Logins](/assets/dms-gui-Logins-new-user.webp)

Mailbox selection list comes from DMS directly. Password will be saved in both dms-gui and Dovecot in DMS, but Authentication for linked mailbox users is provided by DMS.

![Logins](/assets/dms-gui-Logins-new-linkbox.webp)

Mailbox users are automatically created, based off the scan of DMS dovecot server. The mechanic does not check if mailboxes have been deleted, it only pulls the current list and update the local db.

![Logins](/assets/dms-gui-Logins-auto.webp)

### Accounts

Also called "_emails_", as per the DMS setup command to create new email boxes, I prefer calling them _mailboxes_. They are _Accounts_, that can receive/store/send emails.

Accounts are automatically discovered and pulled from DMS on first page load per session, and from the local database on subsequent loads. You can refresh the data manually with the refresh button.

The accounts table shows storage usage with sortable columns (human-readable sizes like "1.9G" are sorted by actual bytes), quota progress bars, and green dot indicators for accounts with active IMAP sessions (showing connection count, services, and source IPs on hover).

Creating accounts from here currently calls the DMS `setup` via `docker.sock`, but soon will rely on dovecot 2.4 API calls instead. Passwords entered are also stored in the local db.

![Accounts](/assets/dms-gui-Accounts.webp)

### Aliases

Supports single and multi-destination aliases, regex aliases, and catch-all aliases (`@domain.com`). Non-admin users can view their own aliases (configurable as read-only or editable by the admin via User Config settings).

![Aliases](/assets/dms-gui-Aliases.webp)

### Domains & DNS

Admin-only page showing all domains served by the mail server with:
- Account and alias counts per domain
- Live DNS record checks: A, MX, SPF, DKIM, DMARC, TLSA, SRV
- SPF and DMARC grading with actionable improvement hints
- DNSBL (blacklist) checks against Spamhaus, Abusix, and others
- DKIM key generation with configurable selector, key type (RSA/Ed25519), and key size
- One-click DNS record push to Domeneshop or Cloudflare
- Click-to-edit SPF and DMARC records with guided setup
- External domain indicators for domains not directly managed by this server

#### Setting up DNS — step by step

To push DNS records (SPF, DKIM, DMARC) directly from dms-gui, you need a **DNS Provider profile** configured first. Without one, you can still view DNS status and copy records manually.

##### 1. Create a DNS Provider profile

Go to **Settings > DNS Providers** and click **Add Profile**.

| Provider | Credentials needed | Test supported |
|----------|--------------------|----------------|
| **Domeneshop** | API token + secret ([generate at domeneshop.no/admin](https://www.domeneshop.no/admin?view=api)) | Yes |
| **Cloudflare** | API token with DNS edit permission | Yes |
| AWS Route53 | Access key + secret key (+ optional STS token) | No |
| Oracle Cloud | Compartment, fingerprint, private key, region, tenancy, user OCID | No |
| Azure Private DNS | Subscription ID, resource group, tenant/client ID + secret | No |

After entering credentials, click **Test** to verify they work, then **Save**. Credentials are stored encrypted (AES-256-CBC) in the local database.

##### 2. Assign a DNS Provider to each domain

On the **Domains & DNS** page, each domain row has a DNS Provider dropdown. Select the provider profile you created. This assignment is saved immediately — no extra "save" button needed.

Only domains with an assigned provider can push records to DNS. Domains without a provider still show DNS status badges and allow DKIM generation (you'll just need to copy-paste the records manually).

##### 3. Generate DKIM keys

Click the DNS status badges on any domain row to open the **DNS Details** modal, then click the key icon next to DKIM:

1. Select **key type** (RSA recommended) and **key size** (2048 recommended)
2. Enter a **selector** (defaults to the global selector from your rspamd config, typically `mail` or `default`)
3. Click **Generate** — dms-gui runs `setup config dkim` inside the DMS container
4. The generated DNS record is displayed. If the domain has a DNS provider, click **Push DKIM to DNS** to add it automatically. Otherwise, copy the record and add it to your DNS manually.

> **Note:** DKIM generation runs inside the DMS container via the REST API. The key files are placed in rspamd's `keys/{domain}/{selector}.private` path and ownership is set to `_rspamd:_rspamd`.

##### 4. Configure SPF

In the DNS Details modal, click the pencil icon next to the SPF record:

1. Choose **soft-fail** (`~all`, recommended during initial setup) or **hard-fail** (`-all`, recommended for production)
2. A preview of the SPF record is shown (auto-includes `mx`, `a`, and your MX hostname)
3. Click **Push to DNS** to create or update the TXT record at your DNS provider

##### 5. Configure DMARC

In the DNS Details modal, click the pencil icon next to the DMARC record:

1. Choose a **policy**: `none` (monitoring), `quarantine`, or `reject` (recommended after verifying SPF/DKIM work)
2. Optionally add **RUA** (aggregate report) and **RUF** (forensic report) email addresses
3. Click **Push to DNS** to create or update the `_dmarc.{domain}` TXT record

##### 6. Check blacklists (optional)

Click the shield icon on any domain row to run DNSBL checks against multiple blacklist providers:

- **Open RBLs** (no API key): Barracuda, SpamCop, UCEProtect, PSBL, Mailspike
- **Spamhaus ZEN + DBL** (requires `SPAMHAUS_DQS_KEY` in Settings > User Config)
- **Abusix Combined + DBL** (requires `ABUSIX_KEY` in Settings > User Config)

Results show listed/clean status for each RBL with return codes.

#### DNS status badges

Each domain row shows color-coded badges for A, MX, SPF, DKIM, DMARC (and optionally TLSA, SRV). Click the badges to open the DNS Details modal with full record information.

| Badge | Green | Orange | Red |
|-------|-------|--------|-----|
| **A** | Records found | — | Missing |
| **MX** | Records found | — | Missing |
| **SPF** | `-all` (hard-fail) | `~all` (soft-fail) | Missing or weak |
| **DKIM** | Record found | — | Missing |
| **DMARC** | `p=quarantine` or `p=reject` | `p=none` | Missing |

### Rspamd

Admin-only rspamd spam filtering dashboard with:
- Server statistics: version, uptime, scan counts, average processing time
- Message action breakdown (clean/add header/greylist/reject) with visual progress bars
- Per-user Bayes learning statistics (ham/spam counts, activity status)
- Top symbols by score impact, with dual-polarity symbol handling
- Message history browser with manual Bayes training (mark as ham/spam)
- Bayes configuration context display (autolearn thresholds, min_learns)

### Mail Setup

Available to all logged-in users. Displays the mail server connection settings (IMAP, SMTP, POP3 hosts and ports) and provides one-click downloads for:
- **Thunderbird autoconfig XML** — standard Mozilla ISP autoconfig format for desktop mail clients
- **Apple .mobileconfig** — configuration profile for iPhone, iPad, and Mac Mail

Profiles are generated server-side using the user's email address and admin-configured server settings.

### Dashboard

Admins see server status, CPU/memory/disk usage, and account/alias/login counts with clickable navigation cards.

Non-admin users see a personalized dashboard with:
- Server status indicator
- Webmail quick-link (if configured)
- Alias count and profile link
- Mailbox quota progress bar (color-coded: green < 75%, warning 75-90%, danger > 90%)
- Mail client configuration reference (IMAP/SMTP/POP3 settings)
- Personal spam summary with message counts, recent spam table, and action badges

### Settings

Multiple sections to save UI settings, DMS REST API access, and show some internals + DMS environment values.

![Settings](/assets/dms-gui-Settings.webp)

Includes:
- **User Config** — Admin-configurable settings exposed to regular users: webmail URL, IMAP/SMTP/POP3 hosts and ports, user permissions (e.g. allow user alias editing), rspamd URL
- **Branding** — Customizable per-container or global branding: name, icon, logo upload, primary button color, sidebar color

dms-gui internals come from Node environment, and DMS values come from a mox of the `env` command and parsing dkim and dovecot configuration.

Some environment values like FTS (Full Text Search) will enable some options on the _Accounts_ page (`reindex` for instance).

![Settings](/assets/dms-gui-ServerInfos.webp)

## Changes from upstream

This `deploy` branch includes the following additions over the upstream `main` branch:

### New pages
- **Domains & DNS** — Live DNS diagnostics, DKIM generation, SPF/DMARC grading, DNSBL checks
- **Rspamd** — Spam filter dashboard with statistics, Bayes training, message history
- **Mail Setup** — Downloadable Thunderbird and Apple mail client configuration profiles
- **Password Reset** — Self-service email-based password reset flow
- **User Config** — Admin settings for mail server URLs and user permissions
- **Branding** — Per-container customizable name, logo, and colors

### Enhanced existing pages
- **Dashboard** — User-specific view with quota bars, spam summary, webmail link, mail config
- **Accounts** — Storage sorting by actual bytes, active IMAP session indicators, auto-refresh from DMS
- **Aliases** — Multi-destination alias support, catch-all aliases, admin-configurable read-only mode
- **Profile** — Improved password change for linked DMS accounts

### Security hardening
- Command injection fix: `escapeShellArg()` for all shell commands
- REST API: shell pipes via `subprocess.Popen` chaining (not `shell=True`), redirect support
- Replaced `eval()` with `JSON.parse()` in JSON processing
- Password redaction in all backend logging
- Per-IP rate limiting on authentication and password reset endpoints
- Origin validation for password reset emails
- `.dockerignore` to prevent local node_modules from entering the build

### Infrastructure
- DataTable sort fixes: null-safe object sorting, `isFinite()` for zero-value detection, sample-row type inference
- Session-based account refresh (DMS pull once per browser session, instant DB reads after)
- Branding system with logo upload via multer
- Test files added for backend and frontend components

## Requirements

- [Docker-Mailserver](https://docker-mailserver.github.io/docker-mailserver/latest/) (installed and configured)
- dms-gui definition in DMS compose, will extra port, volumes, and environment variables in DMS section

## Project Structure

- Node.js (v24 is embedded)
- npm and a dozen of modules

The application consists of two parts:

- **Backend**: Node.js/Express API for communicating with Docker-Mailserver
- **Frontend**: React user interface with i18n support

## Installation

You have nothing to install, this is an all-included docker image that provides a GUI for DMS.

If you want to develop/pull requests and test, see README.docker.md and each README under the subfolders `backend` and `frontend`.

## Configuration

`./config/dms-gui/` will host dms-gui.sqlite3 and its environment config file. This is a subfolder of the DMS `config` repository, for convenience; use any folder you want and update all the mounting points accordingly.

Rename `./config/dms-gui/.dms-gui.env.example` as `./config/dms-gui/.dms-gui.env` and update for your own environment:

```
###############################################################################
## dms-gui Configuration: all is handled by React.
## Only the defaults used in dms-gui will be mentionned here.
###############################################################################
## JWT_SECRET = secret for salting the cookies, regenerated during container start, before starting node
## JWT_SECRET_REFRESH = secret for salting the refresh cookies, regenerated during container start, before starting node
## Those keys cannot be defined anywhere else then during container start, and are secret as the name suggests
## docker/start.sh creates them
###############################################################################

## Optional: Dev Environment
# NODE_ENV=development
NODE_ENV=production

## Debugging
# DEBUG=true

## how long before rotation of the secrets:
ACCESS_TOKEN_EXPIRY=1h
REFRESH_TOKEN_EXPIRY=1d

## encryption options:
## IV_LEN is the length of the unique Initialization Vector (IV) = random salt used for encryption and hashing
IV_LEN=16
## HASH_LEN is the length of the hashed keys for passwords
HASH_LEN=64
## AES_SECRET = encrypted data secret key, that one is set in the environment as well but must never change or you won;t be able to read your encrypted data anymore
## generate it once and for all with node or openssl:
##   openssl rand -hex 32
##   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
AES_SECRET=replaceme
## encrypted data algorithm
AES_ALGO=aes-256-cbc
## AES_HASH is the used to hash the secret key
AES_HASH=sha512

## utility paths for internal database
DMSGUI_CONFIG_PATH=/app/config
DATABASE=${DMSGUI_CONFIG_PATH}/dms-gui.sqlite3

## Override the daily restart of the container, with this simple trick: default is 11PM
## The container must restart regularly to regenerate the secret keys. Security first.
##           ┌────────────── second (optional)
##           │ ┌──────────── minute
##           │ │ ┌────────── hour
##           │ │ │  ┌──────── day of month
##           │ │ │  │ ┌────── month
##           │ │ │  │ │ ┌──── day of week
##           │ │ │  │ │ │
##           │ │ │  │ │ │
##           * * *  * * *
DMSGUI_CRON="0 1 23 * * *"

# make this a demo server
# isDEMO=true

# disable colors in backend logs, some terminals can't handle them
# LOG_COLORS=false
```

### Environment Variables for dms-gui in .dms-gui.env

All is optional, as they will be superseeded by the ones defined and saved within dms-gui:

- `DEBUG`: Node.js environment: (*production or development)
- `ACCESS_TOKEN_EXPIRY`: lifetime of the generated HTTPonly token (1h)
- `REFRESH_TOKEN_EXPIRY`: lifetime of the generated HTTPonly refresh token (1d)
- `DMSGUI_CRON`: crontab format for daily restarts ("0 1 23 * * *")
- `LOG_COLORS`: set false to disable colors in backend logs (*true)
- `isDEMO`: set false to disable colors in backend logs (*false)
The ones you should never alter unless you want to develop:

- `PORT_NODEJS`: Internal port for the Node.js server (*3001)
- `API_URL`: defaults to `http://localhost:3001`
- `NODE_ENV`: Node.js environment: (*production or development)

### Environment Variables for dms REST API in compose

- `DMS_API_HOST`: defaults to 0.0.0.0
- `DMS_API_PORT`: defaults to 8888
- `DMS_API_KEY`: format is "dms-uuid" or whatever you like, must be created in dms-gui first
- `DMS_API_SIZE`: defaults to 1024
- `LOG_LEVEL`: defaults to 'info', value is set in your `mailserver.env`

## Language Support

The application supports multiple languages throught i18n.js:

- English
- Polish

Languages can be switched using the language selector in the top navigation bar.

## Docker Deployment

There are two ways to deploy using Docker:

### Option 1: Docker Compose with dms + proxy (Recommended)

#### Compose for dms + dms-gui

Sample extract from `docker-compose.yml`, rename `dms` to the actual name of your docker-Mailserver container!

```yaml
services:
  dms:
    <your dms compose here>
    ...
    environment:
      # DMS_API_HOST:           # defaults to 0.0.0.0
      DMS_API_PORT: 8888        # defaults to 8888, must match what you se in dms-gui/Settings
      DMS_API_KEY: uuid-random  # key generated by you or dms-gui
      # DMS_API_SIZE: 1024      # defaults to 1024
    expose:
      - "8888"                  # local python REST API, must match what you se in dms-gui/Settings
    volumes:
      ...

      # 1. you MUST create a subfolder "dms-gui" under your DMS config folder and mount in in the dms-gui section as "/app/config/"
      # 2. AFTER you create and inject the API key under dms-gui Settings page, enable the API by uncommenting the line below and restart DMS
      # 2. DO NOT enable the mount below until you created and saved the API in dms-gui, as the file is read only and cannot be created otherwise
      - ./config/dms-gui/rest-api.conf:/etc/supervisor/conf.d/rest-api.conf:ro

    networks:
      frontend:                 # same network as dms-gui

  gui:
    container_name: dms-gui
    hostname: dms-gui
    image: audioscavenger/dms-gui:latest
    restart: unless-stopped
    depends_on:
      - dms

    # Use this environment file or the environment section, or both:
    # Note: the file is placed under DMS own config folder;
    # if using another one you will need to mount both the api.conf and api.py files in DMS
    env_file: ./config/dms-gui/.dms-gui.env

    environment:
      - TZ=${TZ:-UTC}

      # Debugging
      # - DEBUG=true

    expose:
      - 80                      # frontend
      - 3001                    # /docs

    volumes:
      - /etc/timezone:/etc/timezone:ro
      - /etc/localtime:/etc/localtime:ro
      # we are mounted under DMS own config folder:
      - ./config/dms-gui/:/app/config/

    networks:
      frontend:                 # same network as DMS

# use the network of your choice, or default internal;
# DMS and dms-gui must be on the same network to see each others
networks:
  frontend:
    external: true
    name: frontend
```

**Note:** Replace `dms` with the name of your docker-mailserver container.

**Note:** Replace `frontend` with the name of the external network your proxy also uses, or simply let compose use a default internal network

#### Reverse proxy

We recommend this reverse proxy for its simplicity: [swag](https://docs.linuxserver.io/general/swag/).

Sample proxy configuration:

```nginx
server {
    listen 443 ssl;
   listen 443 quic;
    listen [::]:443 ssl;
   listen [::]:443 quic;

  server_name dms.*;

  # swagger API docs
  location /docs {

    # enable the next two lines for http auth
    auth_basic "Restricted";
    auth_basic_user_file /config/nginx/.htpasswd;

    include /config/nginx/proxy.conf;
    include /config/nginx/resolver.conf;

    set $upstream_app dms-gui;
    set $upstream_port 3001;
    set $upstream_proto http;
    proxy_pass $upstream_proto://$upstream_app:$upstream_port;

  }

  location / {

    # enable the next two lines for http auth (use you own)
    # auth_basic "Restricted";
    # auth_basic_user_file /config/nginx/.htpasswd;

    include /config/nginx/proxy.conf;
    include /config/nginx/resolver.conf;

    set $upstream_app dms-gui;
    set $upstream_port 80;
    set $upstream_proto http;
    proxy_pass $upstream_proto://$upstream_app:$upstream_port;

  }

}
```

You can and _should_ add a form of authentication at the proxy level, unless you totally trust React AuthContext and its implementation (which I don't).

### Option 2: Manual using the pre-built image from Docker Hub

Untested, sample below is missing lots of variables, and I don't care since you are supposed to use compose.

```bash
docker run -d \
  --name dms-gui \
  --env-file ./config/dms-gui/.dms-gui.env \
  -p 127.0.0.1:80:80 \
  -p 127.0.0.1:3001:3001 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /etc/timezone:/etc/timezone:ro \
  -v /etc/localtime:/etc/localtime:ro \
  -v./config/dms-gui/:/app/config/ \
  audioscavenger/dms-gui:latest
```

**Note:** Replace `dms` with the name of your docker-mailserver container.

## Docker Features

- Single container with both frontend and backend
- Communication with docker-mailserver via Docker API
- Minimal configuration (just set the container name)
- optional Nginx to serve the React frontend and proxies API requests with http, disabled in Dockerfile

For detailed Docker setup instructions, please refer to:
- [README.docker.md](README.docker.md) - Detailed Docker setup guide
- [README.dockerhub.md](README.dockerhub.md) - Docker Hub specific information

## Available endpoints (non exhaustive)

Subject to heavily change over time, please use https://dms.domain.com/docs for current list.

- `GET /api/status` - Server status
- `GET /api/infos` - Server environment
- `GET /api/settings` - Get settings
- `GET /api/configs` - Get all config names in config table
- `GET /api/roles` - Get a login's roles
- `POST /api/envs` - Get DMS environment
- `POST /api/settings` - Save settings
- `GET /api/logins` - Get login
- `POST /api/logins` - Add login
- `PATCH /api/logins` - Update a login
- `DELETE /api/logins` - delete login
- `POST /api/loginUser` - login user true/false
- `POST /api/logout` - logout

- `PUT /api/doveadm` - send doveadm commands
- `GET /api/accounts` - List email accounts
- `POST /api/accounts` - Add a new account
- `DELETE /api/accounts` - Delete an account
- `PATCH /api/accounts` - Update account password
- `GET /api/aliases` - List aliases
- `POST /api/aliases` - Add a new alias
- `DELETE /api/aliases` - Delete an alias
- `GET /api/domains` - Get domains detected
- `GET /api/domains/:containerName/:domain` - Domain details with DKIM status
- `POST /api/domains/:containerName/:domain/dkim` - Generate DKIM keys
- `GET /api/dns/:containerName/:domain` - DNS record lookups
- `GET /api/dnsbl/:containerName/:domain` - DNSBL checks

- `GET /api/rspamd/:containerName/stat` - Rspamd statistics
- `GET /api/rspamd/:containerName/counters` - Top symbols
- `GET /api/rspamd/:containerName/bayes-users` - Per-user Bayes stats
- `GET /api/rspamd/:containerName/config` - Rspamd configuration
- `GET /api/rspamd/:containerName/history` - Message history
- `POST /api/rspamd/:containerName/learn` - Bayes training

- `GET /api/mail-profile/:containerName/autoconfig` - Thunderbird autoconfig XML
- `GET /api/mail-profile/:containerName/mobileconfig` - Apple configuration profile
- `GET /api/dovecot/:containerName/sessions` - Active IMAP sessions

- `POST /api/forgot-password` - Request password reset email
- `POST /api/reset-password` - Reset password with token

- `POST /api/getCount` - Get row count from a table
- `POST /api/initAPI` - Create DMS API files and key
- `POST /api/kill` - Reboot dms-gui


### Swagger API docs

OAS description of all API endpoints is available at:
* using compose + proxy: http://localhost/docs or https://dms.domain.com/docs (with proxy)
* using raw ports: http://localhost:3001/

<!--
![API](https://github.com/audioscavenger/dms-gui/blob/main/assets/dms-gui-docs.webp?raw=true)
-->
![API](/assets/dms-gui-docs.webp)


### API call Example:

```shell
curl -sSL https://dms.domain.com/api/status
```

Result (outdated):

```json
{
  "status": {
    "status": "running",
    "error": "",
  },
  "resources": {
    "cpuUsage": 0.0051578073089701,
    "memoryUsage": 200925184,
    "diskUsage": "N/A"
  }
}
```


## Behind the Scenes

### REST API

The REST API injected into DMS is *generic*: all it does is listen for POST requests, verify the KEY passed in the Authorization header, execute the system command passed in the body, and return the result in json format. You can use it free of charge in any other container having python3.

This API is started as a deamon by simply mounting this supervisor service inside DMS, and shall be placed in a subfolder named `dms-gui` under the `config` folder of DMS. dms-gui creates both those files when you generate the API key in Settings, and only the supervisor conf shall be mounted in DMS compose:

`./config/dms-gui/rest-api.conf:/etc/supervisor/conf.d/rest-api.conf:ro`

The supervisor code is pretty generic:

```
[program:rest-api]
startsecs=1
stopwaitsecs=0
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisor/%(program_name)s.log
stderr_logfile=/var/log/supervisor/%(program_name)s.log
command=/usr/bin/python3 /tmp/docker-mailserver/dms-gui/rest-api.py
```

This REST API logs in `logs/supervisor/rest-api.log` like any other supervisor service, and I have found that `PYTHONUNBUFFERED=1` will not print the messages in the docker log when run as a daemon.

To use it with a Node.js client, it's pretty basic and simple:

```js
const DMS_API_KEY = 'dms-uuid';
const jsonData = {
  command: 'ls -l /some/folder',
  timeout: 4,
  };
const response = await postJsonToApi(`http://dms:8888`, jsonData, DMS_API_KEY);

export const postJsonToApi = async (apiUrl, jsonData, Authorization) => {
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': Authorization
      },
      body: JSON.stringify(jsonData),
    });
    if (!response.ok) {
      <your error handling here>
    }
    return await response.json(); // Parse the JSON response

  } catch (error) {
    <your error handling here>
  }
}
```

Sample of a response from the REST API:

```
Response {
  status: 200,
  statusText: 'OK',
  headers: Headers {
    server: 'BaseHTTP/0.6 Python/3.11.2',
    date: 'Sun, 21 Dec 2025 05:35:39 GMT',
    'content-type': 'application/json'
  },
  body: ReadableStream { locked: false, state: 'readable', supportsBYOB: true },
  bodyUsed: false,
  ok: true,
  redirected: false,
  type: 'basic',
  url: 'http://dms:8888/'
}
```

Format of the json returned from the response by `postJsonToApi`:

```json
{
  error: <error>,
  returncode: 0,
  stdout: <stdout>,
  stderr: <stderr>
}
```

Cannot be simpler then that, and super secure since the script also controls the maximum size of the payload received in the POST request. The API key is added manually as an environment variable in DMS compose.

### Logging

Formatted logging with colors, that actually helps!
![Logins](/assets/dms-gui-logs.webp)

## Development

### Automatic Formatting

Absolutely unnecessary, but this project uses [Prettier](https://prettier.io/) for consistent code formatting. Configuration is defined in the root `.prettierrc.json` file.

Formatting was automatically applied to staged files before each commit using [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/okonet/lint-staged). This ensured that all committed code adheres to the defined style guide. I gave up using this as VScode does a fantastic job.

### Manual Formatting

You can also manually format the code using the npm scripts available in both the `backend` and `frontend` directories:

```bash
# Navigate to the respective directory (backend or frontend)
cd backend # or cd frontend

# Format all relevant files
npm run format

# Check if all relevant files are formatted correctly
npm run format:check
```

### Backend

```bash
cd backend
npx npm-check-updates -u
npm install
npm audit fix
```

### Frontend

```bash
cd frontend
npx npm-check-updates -u
npm install
npm audit fix
```

After running both parts, the application will be available at http://localhost:3001

## License

AGPL-3.0-only
