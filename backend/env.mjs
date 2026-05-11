import { REST_API_MANIFEST } from './restApiManifest.mjs';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

// Read the rest-api.py template at module load. Source-of-truth lives
// in ./rest-api.py.in as a real .py file so the embedded Python gets
// proper syntax highlighting, linting, and version-control diff
// readability. The placeholder `{DMSGUI_VERSION}` is substituted at
// write time by createAPIfiles in settings.mjs.
const REST_API_PY_TEMPLATE = readFileSync(
  new URL('./rest-api.py.in', import.meta.url),
  'utf8'
);

// Resolve the SMTP_TLS_VERIFY default. Exported for unit tests; the
// resolution rules are documented next to the env consumer below.
export const resolveSmtpTlsVerify = (procEnv) => {
  const v = (procEnv.SMTP_TLS_VERIFY || '').toLowerCase();
  if (v === 'false') return false;
  if (v === 'true') return true;
  return Boolean(procEnv.SMTP_HOST);
};
export const env = {
  debug: (process.env.DEBUG || '').toLowerCase() == 'true' ? true : false,

  // const { name, version, description }: require('./package.json');
  DMSGUI_VERSION:
    process.env.DMSGUI_VERSION.split('v').length == 2
      ? process.env.DMSGUI_VERSION.split('v')[1]
      : process.env.DMSGUI_VERSION,
  DMSGUI_DESCRIPTION: process.env.DMSGUI_DESCRIPTION,
  HOSTNAME: process.env.HOSTNAME,
  NODE_ENV: process.env.NODE_ENV || 'production',
  PORT_NODEJS: Number(process.env.PORT_NODEJS) || 3001,
  TZ: process.env.TZ || 'UTC',

  // internals of dms-gui
  FRONTEND_URL: process.env.FRONTEND_URL || '/api', // for cors if you really are crazy with this sort of security
  API_URL: process.env.API_URL || '/api', // for cors too
  DMSGUI_CONFIG_PATH: process.env.DMSGUI_CONFIG_PATH || '/app/config',
  DATABASE:
    process.env.isDEMO === 'true'
      ? '/app/config/dms-gui-demo.sqlite3'
      : process.env.DATABASE || '/app/config/dms-gui.sqlite3',
  DATABASE_SAMPLE: '/app/config/dms-gui-example.sqlite3',
  DATABASE_SAMPLE_LIVE: '/app/config/dms-gui-demo.sqlite3',

  // some selectors in the DKIM UI
  DKIM_KEYTYPES: ['rsa', 'ed25519'],
  DKIM_KEYSIZES: ['1024', '2048'],
  DKIM_KEYTYPE_DEFAULT: 'rsa',
  DKIM_KEYSIZE_DEFAULT: 2048,

  // variables we will capture from DMS
  DMS_OPTIONS: [
    'TZ',
    'HOSTNAME',
    'DMS_RELEASE',
    'ENABLE_RSPAMD',
    'ENABLE_XAPIAN',
    'ENABLE_MTA_STS',
    'PERMIT_DOCKER',
    'DOVECOT_MAILBOX_FORMAT',
    'POSTFIX_MAILBOX_SIZE_LIMIT',
  ],

  isMutable: 1,
  isImmutable: 0,

  // other DMS internals defaults
  DMS_SETUP_SCRIPT: process.env.DMS_SETUP_SCRIPT
    ? process.env.DMS_SETUP_SCRIPT
    : '/usr/local/bin/setup',
  DMS_CONFIG_PATH: process.env.DMS_CONFIG_PATH
    ? process.env.DMS_CONFIG_PATH
    : '/tmp/docker-mailserver',
  DKIM_SELECTOR_DEFAULT: process.env.DKIM_SELECTOR_DEFAULT
    ? process.env.DKIM_SELECTOR_DEFAULT
    : 'mail', // hardcoded in DMS
  protocol: 'http',
  port: 8888,
  timeout: 4,
  containerName: 'dms',

  // JWT_SECRET and JWT_SECRET_REFRESH regenerated when container starts, and will invalidates all sessions
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_SECRET_REFRESH: process.env.JWT_SECRET_REFRESH,
  // ACCESS_TOKEN_EXPIRY and REFRESH_TOKEN_EXPIRY control the behavior of the /loginUser and /refresh API
  ACCESS_TOKEN_EXPIRY: process.env.ACCESS_TOKEN_EXPIRY || '1h',
  REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY || '7d',

  // IV_LEN is the length of the unique Initialization Vector (IV) = random salt used for encryption and hashing
  IV_LEN: Number(process.env.IV_LEN) || 16,
  // HASH_LEN is the length of the hashed keys for passwords
  HASH_LEN: Number(process.env.HASH_LEN) || 64,
  // AES_SECRET = encrypted data secret key, that one is set in the environment as well but must never change or you won;t be able to read your encrypted data anymore
  // generate it once and for all with node or openssl:
  // // openssl rand -hex 32
  // // node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  AES_SECRET: process.env.AES_SECRET || 'changeme',
  // encrypted data algorithm
  AES_ALGO: process.env.AES_ALGO || 'aes-256-cbc',
  // AES_HASH is the used to hash the secret key
  AES_HASH: process.env.AES_HASH || 'sha512',
  // Derive a 256-bit key from your secretKey (raw 32 bytes for true AES-256)
  AES_KEY: crypto
    .createHash(process.env.AES_HASH || 'sha512')
    .update(process.env.AES_SECRET || 'changeme')
    .digest()
    .subarray(0, 32),

  // doveadm API port, possible to especially with dovecot 2.4, but not used and likely never will
  // DOVEADM_PORT: ((process.env.DOVEADM_PORT) ? process.env.DOVEADM_PORT : 8080),

  // enable a daily restart of the container with this simple trick: default is 11PM
  //                                              ┌────────────── second (optional)
  //                                              │ ┌──────────── minute
  //                                              │ │ ┌────────── hour
  //                                              │ │ │  ┌──────── day of month
  //                                              │ │ │  │ ┌────── month
  //                                              │ │ │  │ │ ┌──── day of week
  //                                              │ │ │  │ │ │
  //                                              │ │ │  │ │ │
  //                                              * * *  * * *
  DMSGUI_CRON:
    process.env.isDEMO === 'true'
      ? '6 7 *  * * *'
      : process.env.DMSGUI_CRON || '* 1 23 * * *',

  // Mount the OpenAPI / Swagger UI at /docs. Default off — the docs
  // disclose every endpoint and request shape, which is useful in
  // dev/staging but provides reconnaissance value in prod (and is
  // typically already accessible through the Traefik OIDC gate
  // anyway, so the second-layer admin guard below is purely
  // defence-in-depth). Set ENABLE_SWAGGER=true in .dms-gui.env to
  // enable; even when enabled, the route is wrapped in
  // authenticateToken + requireActive + requireAdmin, so anonymous
  // traffic gets 401, inactive accounts are blocked by the active-
  // account check, and active non-admin users get 403.
  ENABLE_SWAGGER:
    (process.env.ENABLE_SWAGGER || '').toLowerCase() === 'true' ? true : false,

  // SMTP for password reset emails (local delivery to DMS container, no auth)
  SMTP_HOST: process.env.SMTP_HOST || 'mailserver',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 25,
  // SMTP TLS certificate verification. The resolution order:
  //   1. SMTP_TLS_VERIFY=true|false → explicit override, always wins.
  //   2. SMTP_HOST is set explicitly → default true (proper CA
  //      validation; the cohort using a real SMTP relay has, almost
  //      certainly, configured SMTP_HOST and we should validate
  //      their cert).
  //   3. SMTP_HOST is not set → default false (the user is using
  //      our default 'mailserver' Docker container hostname; that
  //      cert is self-signed and the CN won't match the container
  //      name. Verifying would just make password-reset email fail
  //      out of the box on every default deployment).
  // requireTLS stays true regardless — verification disabled does
  // not mean plaintext fallback, only that we accept a self-signed
  // peer.
  SMTP_TLS_VERIFY: resolveSmtpTlsVerify(process.env),

  // Base URL for password reset links (e.g., https://epost.example.com)
  // If not set, derived from X-Forwarded-Proto/Host headers (set by reverse proxy)
  RESET_BASE_URL: process.env.RESET_BASE_URL || '',

  LOG_COLORS:
    (process.env.LOG_COLORS || '').toLowerCase() === 'false' ? false : true,

  // DEMO will activate a mock database and disable all refresh options
  isDEMO: (process.env?.isDEMO || '').toLowerCase() == 'true' ? true : false,
  github: 'https://github.com/audioscavenger/dms-gui',
  wiki: 'https://github.com/audioscavenger/dms-gui',
  dockerhub: 'https://hub.docker.com/repositories/audioscavenger',
};

// we don't set any defaults here, as they will override whatever users set // cancelled, we only use the db
// export var live = {
// // Docker container name for docker-mailserver  // cancelled
// DMS_CONTAINER: process.env.DMS_CONTAINER,
// containers: {},   // used to hold the DMS Docker.containers but we don't use docker.sock anymore

// // DMS API key and port we need, to execute commands in DMS container; must be in DMS environement too // cancelled
// DMS_API_KEY: process.env.DMS_API_KEY,
// DMS_API_PORT: process.env.DMS_API_PORT,

// };

/*
  sh: {
    desc: 'python API server launcher - cancelled'
    path: DMSGUI_CONFIG_PATH + '/rest-api.sh',
    content:
`# this script is executed on startup

nohup /usr/bin/python3 $(dirname $0)/rest-api.py &
`,
  },
*/

export const mailserverRESTAPI = {
  dms: {
    manifest: {
      desc: 'Action manifest consumed by rest-api.py at startup. Generated from REST_API_MANIFEST in restApiManifest.mjs; do not hand-edit on the DMS volume.',
      path: env.DMSGUI_CONFIG_PATH + '/rest-api-manifest.json',
      content: JSON.stringify(REST_API_MANIFEST, null, 2),
    },
    api: {
      desc: 'python API server - should be created at /tmp/docker-mailserver/dms-gui/rest-api.py',
      path: env.DMSGUI_CONFIG_PATH + '/rest-api.py',
      content: REST_API_PY_TEMPLATE,
    },
    cron: {
      desc: 'https://github.com/orgs/docker-mailserver/discussions/2908 - mount this to /etc/supervisor/conf.d/rest-api.conf',
      path: env.DMSGUI_CONFIG_PATH + '/rest-api.conf',
      content: `
[program:rest-api]
startsecs=1
stopwaitsecs=0
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisor/%(program_name)s.log
stderr_logfile=/var/log/supervisor/%(program_name)s.log
command=/usr/bin/python3 /tmp/docker-mailserver/dms-gui/rest-api.py
`,
    },
  },
};

// https://github.com/orgs/docker-mailserver/discussions/2908
// Much better to just use a supervisord service config like I had shown over a month ago:

// /etc/supervisor/conf.d/dms-api.conf:

// [program:dms-api]
// startsecs=5
// stopwaitsecs=0
// autostart=true
// autorestart=true
// stdout_logfile=/var/log/supervisor/%(program_name)s.log
// stderr_logfile=/var/log/supervisor/%(program_name)s.log
// command=/usr/bin/python3 /tmp/docker-mailserver/rest-api.py

// plugins are only for settings where isMutable=1 and not the environment where isMutable=0 or anything else
// TODO: plugins and schemas should be in their own table really
export const plugins = {
  'dms-gui': {
    DB_VERSION: {
      config: env.DMSGUI_VERSION,
      settings: env.DMSGUI_VERSION,
      logins: env.DMSGUI_VERSION,
      roles: env.DMSGUI_VERSION,
      accounts: env.DMSGUI_VERSION,
      aliases: env.DMSGUI_VERSION,
      domains: env.DMSGUI_VERSION,
      dns: env.DMSGUI_VERSION,
    },
  },

  // login: {
  //   profile: {
  //     mailbox:'mailbox',
  //     username:'username',
  //     email:'',
  //     salt:'',
  //     hash:'',
  //     isAdmin:0,
  //     isAccount:1,
  //     isActive:1,
  //     mailserver:'',
  //     roles:[],
  //   },

  mailserver: {
    dms: {
      keys: {
        containerName: 'containerName',
        protocol: 'protocol',
        host: 'containerName',
        port: 'DMS_API_PORT',
        Authorization: 'DMS_API_KEY',
        setupPath: 'setupPath',
        timeout: 'timeout',
      },
      defaults: {
        containerName: env.containerName,
        protocol: env.protocol,
        DMS_API_PORT: env.DMS_API_PORT,
        DMS_API_KEY: env.DMS_API_KEY,
        setupPath: env.DMS_SETUP_SCRIPT,
        timeout: env.timeout,
      },
    },
    dmsEnv: {
      DKIM_SELECTOR_DEFAULT: 'mail',
      ENABLE_MTA_STS: 1,
      ENABLE_RSPAMD: 1,
      DMS_RELEASE: 'v15.1.0',
      PERMIT_DOCKER: 'none',
      DOVECOT_MAILBOX_FORMAT: 'maildir',
      POSTFIX_MAILBOX_SIZE_LIMIT: 5242880000,
      TZ: 'UTC',
      DOVECOT_VERSION: '2.3.19.1',
      DOVECOT_FTS_PLUGIN: 'xapian',
      DOVECOT_FTS_AUTOINDEX: 'yes',
      DOVECOT_QUOTA: 1,
      DOVECOT_FTS: 1,
      DOVECOT_FTS_XAPIAN: 1,
      DOVECOT_ZLIB: 1,
      DKIM_ENABLED: 'true',
      DKIM_SELECTOR: 'dkim',
      DKIM_PATH:
        '/tmp/docker-mailserver/rspamd/dkim/rsa-2048-$selector-$domain.private.txt',
    },
  },

  dnscontrol: {
    cloudflare: {
      desc: 'https://developers.cloudflare.com/api/',
      TYPE: 'CLOUDFLAREAPI',
      apitoken: 'your-cloudflare-api-token',
    },
    domeneshop: {
      desc: 'https://api.domeneshop.no/docs/',
      TYPE: 'DOMAINNAMESHOP',
      token: 'your-api-token',
      secret: 'your-api-secret',
    },
    digitalocean: {
      desc: 'https://docs.digitalocean.com/reference/api/',
      TYPE: 'DIGITALOCEAN',
      apitoken: 'your-digitalocean-api-token',
    },
    hetzner: {
      desc: 'https://dns.hetzner.com/api-docs',
      TYPE: 'HETZNER',
      apitoken: 'your-hetzner-dns-api-token',
    },
  },
};

// Per-plugin reboot configuration.
//
// `kill` (free-form shell): runs locally on the dms-gui host via
//   childProcess.exec. Used to restart dms-gui itself, where the
//   target process lives in the same container/process namespace as
//   the caller.
// `actionId` (manifest action id): runs inside the target container
//   via the rest-api action protocol. Used to restart another
//   container (e.g. mailserver). The literal string must match a
//   manifest entry — the build-time test in restApiManifest.test.mjs
//   greps `actionId: '<id>'` and asserts the id exists in
//   REST_API_MANIFEST, which catches typos and accidental drift.
export const command = {
  'dms-gui': {
    'dms-gui': {
      kill: `sleep 1 && kill -9 $(pgrep "master process nginx")`,
    },
  },

  mailserver: {
    dms: {
      actionId: 'pkill_supervisord',
    },
  },
};
