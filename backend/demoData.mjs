// Static fake data for demo mode — all anonymized with RFC 5737 IPs and fictional domains

const _now = Math.floor(Date.now() / 1000);

// --- Accounts (14) ---
const accounts = [
  { mailbox: 'admin@example.com',  domain: 'example.com', storage: { used: '1.2G', usedBytes: 1288490188, total: '5G', percent: '24' }, username: 'admin@example.com' },
  { mailbox: 'alice@example.com',  domain: 'example.com', storage: { used: '3.8G', usedBytes: 4080218931, total: '5G', percent: '76' }, username: 'alice@example.com' },
  { mailbox: 'bob@example.com',    domain: 'example.com', storage: { used: '890M', usedBytes: 933232640,  total: '5G', percent: '17' }, username: 'bob@example.com' },
  { mailbox: 'carol@example.com',  domain: 'example.com', storage: { used: '2.1G', usedBytes: 2254857830, total: '5G', percent: '42' }, username: 'carol@example.com' },
  { mailbox: 'dave@example.com',   domain: 'example.com', storage: { used: '456M', usedBytes: 478150656,  total: '5G', percent: '9'  }, username: 'dave@example.com' },
  { mailbox: 'eve@example.com',    domain: 'example.com', storage: { used: '67M',  usedBytes: 70254592,   total: '5G', percent: '1'  }, username: 'eve@example.com' },
  { mailbox: 'frank@example.com',  domain: 'example.com', storage: { used: '1.5G', usedBytes: 1610612736, total: '5G', percent: '30' }, username: 'frank@example.com' },
  { mailbox: 'grace@example.com',  domain: 'example.com', storage: { used: '230M', usedBytes: 241172480,  total: '5G', percent: '4'  }, username: 'grace@example.com' },
  { mailbox: 'admin@demo.org',     domain: 'demo.org',    storage: { used: '560M', usedBytes: 587202560,  total: '5G', percent: '11' }, username: 'admin@demo.org' },
  { mailbox: 'alice@demo.org',     domain: 'demo.org',    storage: { used: '1.9G', usedBytes: 2040109465, total: '5G', percent: '38' }, username: 'alice@demo.org' },
  { mailbox: 'bob@demo.org',       domain: 'demo.org',    storage: { used: '320M', usedBytes: 335544320,  total: '5G', percent: '6'  }, username: 'bob@demo.org' },
  { mailbox: 'carol@demo.org',     domain: 'demo.org',    storage: { used: '1.1G', usedBytes: 1181116006, total: '5G', percent: '22' }, username: 'carol@demo.org' },
  { mailbox: 'admin@acme.io',      domain: 'acme.io',     storage: { used: '780M', usedBytes: 817889280,  total: '10G', percent: '7' }, username: 'admin@acme.io' },
  { mailbox: 'support@acme.io',    domain: 'acme.io',     storage: { used: '2.4G', usedBytes: 2576980377, total: '10G', percent: '24' }, username: 'support@acme.io' },
];

// --- Aliases (20) ---
const aliases = [
  { source: 'postmaster@example.com',  destination: 'admin@example.com',                  regex: 0, username: 'admin@example.com' },
  { source: 'abuse@example.com',       destination: 'admin@example.com',                  regex: 0, username: 'admin@example.com' },
  { source: 'webmaster@example.com',   destination: 'admin@example.com',                  regex: 0, username: 'admin@example.com' },
  { source: 'noreply@example.com',     destination: 'admin@example.com',                  regex: 0, username: 'admin@example.com' },
  { source: 'info@example.com',        destination: 'alice@example.com',                  regex: 0, username: 'alice@example.com' },
  { source: 'sales@example.com',       destination: 'alice@example.com',                  regex: 0, username: 'alice@example.com' },
  { source: 'newsletter@example.com',  destination: 'alice@example.com',                  regex: 0, username: 'alice@example.com' },
  { source: 'hr@example.com',          destination: 'eve@example.com',                    regex: 0, username: 'eve@example.com' },
  { source: 'support@example.com',     destination: 'frank@example.com',                  regex: 0, username: 'frank@example.com' },
  { source: 'postmaster@demo.org',     destination: 'admin@demo.org',                     regex: 0, username: 'admin@demo.org' },
  { source: 'abuse@demo.org',          destination: 'admin@demo.org',                     regex: 0, username: 'admin@demo.org' },
  { source: 'sales@demo.org',          destination: 'alice@demo.org,bob@demo.org',        regex: 0, username: 'alice@demo.org' },
  { source: 'support@demo.org',        destination: 'carol@demo.org',                     regex: 0, username: 'carol@demo.org' },
  { source: 'postmaster@acme.io',      destination: 'admin@acme.io',                      regex: 0, username: 'admin@acme.io' },
  { source: 'abuse@acme.io',           destination: 'admin@acme.io',                      regex: 0, username: 'admin@acme.io' },
  { source: 'billing@acme.io',         destination: 'admin@acme.io',                      regex: 0, username: 'admin@acme.io' },
  { source: 'info@test-corp.net',      destination: 'admin@example.com',                  regex: 0, username: 'admin@example.com' },
  { source: 'postmaster@test-corp.net', destination: 'admin@example.com',                 regex: 0, username: 'admin@example.com' },
  { source: 'abuse@test-corp.net',     destination: 'admin@example.com',                  regex: 0, username: 'admin@example.com' },
  { source: '"/^bounce.*@example.com/"', destination: 'admin@example.com',                regex: 1, username: 'admin@example.com' },
  { source: '"/^postmaster.*@.*/"',      destination: 'admin@example.com',                regex: 1, username: 'admin@example.com' },
];

// --- Domains (4) ---
const domains = [
  { domain: 'example.com',   dkim: 'default', keytype: 'rsa', keysize: '2048', dnsProvider: 'cloudflare-main', accountCount: 8, aliasCount: 11 },
  { domain: 'demo.org',      dkim: 'default', keytype: 'rsa', keysize: '2048', dnsProvider: 'domeneshop-prod', accountCount: 4, aliasCount: 4 },
  { domain: 'acme.io',       dkim: 'default', keytype: 'ed25519', keysize: '256', dnsProvider: null, accountCount: 2, aliasCount: 3 },
  { domain: 'test-corp.net', dkim: null,       keytype: null,  keysize: null,   dnsProvider: null, accountCount: 0, aliasCount: 3 },
];

// --- Server status ---
const serverStatus = {
  status: { status: 'running', error: null },
  resources: { cpuUsage: 3.2, memoryUsage: 28.7, diskUsage: 1842, error: null },
  db: { logins: 7, accounts: 14, aliases: 21, error: null },
};

// --- Server envs (DMS environment) ---
const serverEnvs = [
  { name: 'DKIM_SELECTOR_DEFAULT', value: 'mail' },
  { name: 'DMS_RELEASE', value: 'v15.1.0' },
  { name: 'TZ', value: 'UTC' },
  { name: 'ENABLE_RSPAMD', value: '1' },
  { name: 'ENABLE_MTA_STS', value: '1' },
  { name: 'PERMIT_DOCKER', value: 'none' },
  { name: 'DOVECOT_MAILBOX_FORMAT', value: 'maildir' },
  { name: 'POSTFIX_MAILBOX_SIZE_LIMIT', value: '5242880000' },
  { name: 'DOVECOT_VERSION', value: '2.3.21.1' },
  { name: 'DOVECOT_FTS_PLUGIN', value: 'xapian' },
  { name: 'DOVECOT_FTS_AUTOINDEX', value: 'yes' },
  { name: 'DOVECOT_QUOTA', value: '1' },
  { name: 'DKIM_ENABLED', value: 'true' },
  { name: 'DKIM_SELECTOR', value: 'default' },
];

// --- Rspamd stats ---
const rspamdStats = {
  version: '3.11.1',
  config_id: 'demo-config-id-0123456789abcdef',
  uptime: 432000,
  read_only: false,
  scanned: 5432,
  learned: 320,
  actions: {
    reject: 23,
    'soft reject': 0,
    'rewrite subject': 5,
    'add header': 156,
    greylist: 89,
    'no action': 5159,
  },
  spam_count: 184,
  ham_count: 5159,
  connections: 5432,
  control_connections: 245,
  pools_allocated: 1876,
  pools_freed: 1654,
  bytes_allocated: 18743296,
  chunks_allocated: 342,
  shared_chunks_allocated: 67,
  chunks_freed: 298,
  chunks_oversized: 8,
  fragmented: 12,
  total_learns: 320,
  statfiles: [
    { symbol: 'BAYES_SPAM', type: 'redis', revision: 456, size: 0, users: 8, languages: 0 },
    { symbol: 'BAYES_HAM',  type: 'redis', revision: 789, size: 0, users: 8, languages: 0 },
  ],
};

// --- Rspamd config ---
const rspamdConfig = {
  actions: { reject: 20, add_header: 6, greylist: 4, rewrite_subject: null },
  bayes: { min_learns: 10, spam_threshold: 6.0, ham_threshold: -0.5 },
};

// --- Rspamd Bayes users (8) ---
const rspamdBayesUsers = [
  { user: 'admin@example.com',  ham: 45,  spam: 12 },
  { user: 'alice@example.com',  ham: 120, spam: 34 },
  { user: 'bob@example.com',    ham: 67,  spam: 18 },
  { user: 'carol@example.com',  ham: 89,  spam: 7 },
  { user: 'dave@example.com',   ham: 23,  spam: 3 },
  { user: 'admin@demo.org',     ham: 56,  spam: 15 },
  { user: 'alice@demo.org',     ham: 34,  spam: 9 },
  { user: 'admin@acme.io',      ham: 41,  spam: 11 },
];

// --- Rspamd counters (top symbols, 20) ---
const rspamdCounters = [
  { symbol: 'BAYES_HAM',           direction: null, hits: 187, avgScore: -3.00,  frequency: 0.748 },
  { symbol: 'NEURAL_HAM_LONG',     direction: null, hits: 142, avgScore: -2.00,  frequency: 0.568 },
  { symbol: 'R_SPF_ALLOW',         direction: null, hits: 210, avgScore: -0.20,  frequency: 0.840 },
  { symbol: 'R_DKIM_ALLOW',        direction: null, hits: 198, avgScore: -0.20,  frequency: 0.792 },
  { symbol: 'DMARC_POLICY_ALLOW',  direction: null, hits: 185, avgScore: -0.50,  frequency: 0.740 },
  { symbol: 'ARC_ALLOW',           direction: null, hits: 56,  avgScore: -1.00,  frequency: 0.224 },
  { symbol: 'MIME_GOOD',           direction: null, hits: 220, avgScore: -0.10,  frequency: 0.880 },
  { symbol: 'MID_CONTAINS_FROM',   direction: null, hits: 178, avgScore: 0.50,   frequency: 0.712 },
  { symbol: 'RCVD_COUNT_THREE',    direction: null, hits: 89,  avgScore: 0.00,   frequency: 0.356 },
  { symbol: 'TO_DN_ALL',           direction: null, hits: 145, avgScore: 0.00,   frequency: 0.580 },
  { symbol: 'BAYES_SPAM',          direction: null, hits: 38,  avgScore: 5.48,   frequency: 0.152 },
  { symbol: 'NEURAL_SPAM_LONG',    direction: null, hits: 29,  avgScore: 3.00,   frequency: 0.116 },
  { symbol: 'RBL_SPAMHAUS_ZEN',    direction: null, hits: 12,  avgScore: 4.00,   frequency: 0.048 },
  { symbol: 'FUZZY_DENIED',        direction: null, hits: 15,  avgScore: 12.00,  frequency: 0.060 },
  { symbol: 'MIME_HTML_ONLY',      direction: null, hits: 67,  avgScore: 0.20,   frequency: 0.268 },
  { symbol: 'FROM_NO_DN',          direction: null, hits: 34,  avgScore: 0.00,   frequency: 0.136 },
  { symbol: 'RCPT_COUNT_ONE',      direction: null, hits: 156, avgScore: 0.00,   frequency: 0.624 },
  { symbol: 'HAS_ATTACHMENT',      direction: null, hits: 78,  avgScore: 0.00,   frequency: 0.312 },
  { symbol: 'PREVIOUSLY_DELIVERED', direction: null, hits: 92, avgScore: -0.01,  frequency: 0.368 },
  { symbol: 'FORGED_SENDER',       direction: null, hits: 8,   avgScore: 0.30,   frequency: 0.032 },
];

// --- Rspamd user history ---
const rspamdUserHistory = {
  total: 142,
  ham: 118,
  spam: 24,
  avgScore: 1.8,
  since: _now - 86400 * 7,
  recentSpam: [
    { subject: 'You won a prize! Claim now',     score: 18.5, time: _now - 1200,  action: 'reject',         rcpt: 'alice@example.com' },
    { subject: 'Urgent: Verify your account',     score: 14.2, time: _now - 3600,  action: 'reject',         rcpt: 'alice@example.com' },
    { subject: 'Special discount 90% off',        score: 8.7,  time: _now - 7200,  action: 'add header',     rcpt: 'alice@example.com' },
    { subject: 'Re: Invoice #38291',              score: 7.3,  time: _now - 14400, action: 'add header',     rcpt: 'alice@example.com' },
    { subject: 'Limited time offer!!!',            score: 9.1,  time: _now - 21600, action: 'add header',     rcpt: 'alice@example.com' },
    { subject: 'Fw: Important document',           score: 6.8,  time: _now - 28800, action: 'add header',     rcpt: 'alice@example.com' },
    { subject: 'Dear Customer, your order',        score: 15.9, time: _now - 43200, action: 'reject',         rcpt: 'alice@example.com' },
    { subject: 'Make money fast',                  score: 7.4,  time: _now - 54000, action: 'add header',     rcpt: 'alice@example.com' },
    { subject: 'Congratulations winner',           score: 6.5,  time: _now - 64800, action: 'add header',     rcpt: 'alice@example.com' },
    { subject: 'Click here for free gift',         score: 11.3, time: _now - 72000, action: 'add header',     rcpt: 'alice@example.com' },
  ],
};

// --- Rspamd history (50 messages) ---
const _subjects = [
  'Weekly team standup notes',    'Re: Project timeline update',  'Meeting agenda for Monday',
  'Q4 budget review',            'Invoice #2847 attached',       'Travel itinerary confirmation',
  'New hire onboarding docs',     'Client feedback summary',      'Re: Server maintenance window',
  'Product launch timeline',      'Monthly metrics report',       'Updated design mockups',
  'Re: API documentation',        'Holiday schedule reminder',    'Security audit findings',
  'Re: Deployment checklist',     'Quarterly OKR review',         'Vendor contract renewal',
  'Re: Bug fix for login page',   'Team building event RSVP',     'Performance review schedule',
  'Re: Database migration plan',  'Newsletter draft v2',          'Infrastructure cost report',
  'Release notes v3.2.1',         'Customer onboarding flow',     'Re: SSL certificate renewal',
  'Sprint retrospective notes',   'Compliance training reminder', 'Board meeting preparation',
  'You won a million dollars!',   'URGENT: Verify account now',   'Cheap pharmaceuticals online',
  'Hot singles in your area',     'Congratulations! You were selected', 'Re: Your package delivery',
  'INVOICE: Payment overdue',     'Fw: Wire transfer request',    'Act now - limited time offer',
  'Free iPhone 15 giveaway',      'Your account has been compromised', 'Claim your reward today',
  'Update your billing info',     'Meeting rescheduled to 3pm',   'Office supplies order',
  'Lunch plans for Friday?',      'Re: Git merge conflict help',  'VPN access request',
  'New company policy update',    'Server monitoring alert',
];
const _senders = [
  'john.smith@gmail.com',    'sarah.jones@outlook.com', 'mike.chen@yahoo.com',
  'emma.wilson@company.co',  'david.kim@fastmail.com',  'newsletter@updates.example.com',
  'noreply@service.demo.org', 'billing@store.acme.io',  'support@helpdesk.net',
  'alerts@monitoring.dev',    'hr@bigcorp.com',          'marketing@promo-blast.biz',
  'x4829@spam-botnet.ru',     'prize-winner@lucky99.xyz', 'admin@phishing-site.tk',
];
const _rcpts = [
  'alice@example.com', 'bob@example.com', 'carol@example.com', 'admin@example.com',
  'dave@example.com', 'admin@demo.org', 'alice@demo.org', 'admin@acme.io',
];
const _actions = [
  'no action','no action','no action','no action','no action','no action','no action',
  'no action','no action','no action','no action','no action','no action','no action',
  'no action','no action','no action','no action','no action','no action','no action',
  'no action','no action','no action','no action','no action','no action','no action',
  'no action','no action','no action','no action','no action','no action','no action',
  'add header','add header','add header','add header','add header','add header','add header','add header',
  'greylist','greylist','greylist','greylist',
  'reject','reject','reject',
];

// Seeded pseudo-random for repeatable demo data
const _seed = (i) => ((i * 2654435761) >>> 0) % 1000;
const _pick = (arr, i) => arr[_seed(i) % arr.length];

const rspamdHistory = {
  rows: Array.from({ length: 50 }, (_, i) => {
    const action = _actions[i] || 'no action';
    const isSpam = action !== 'no action' && action !== 'greylist';
    const score = action === 'reject' ? 15 + (i % 8) :
                  action === 'add header' ? 6 + (i % 5) * 0.8 :
                  action === 'greylist' ? 4 + (i % 3) * 0.5 :
                  -1 + (i % 20) * 0.3;
    return {
      message_id: `<demo-${1000 + i}@${_pick(['mail.gmail.com', 'mx.outlook.com', 'mta.yahoo.com', 'smtp.fastmail.com'], i)}>`,
      sender: _pick(_senders, i + 3),
      rcpt: _pick(_rcpts, i + 7),
      subject: _subjects[i] || `Message #${i}`,
      score: Math.round(score * 10) / 10,
      bayes: isSpam ? Math.round((2 + (i % 4)) * 10) / 10 : Math.round((-2 - (i % 3)) * 10) / 10,
      action,
      unix_time: _now - (i * 1800 + _seed(i) % 600),
    };
  }),
  learnedMap: {
    '<demo-1031@mail.gmail.com>': 'spam',
    '<demo-1035@mail.gmail.com>': 'spam',
    '<demo-1038@mx.outlook.com>': 'ham',
  },
  thresholds: {},
};

// --- DNS lookup (per-domain) ---
const dnsLookup = {
  'example.com': {
    domain: 'example.com',
    a: ['198.51.100.25'],
    mx: [{ priority: 10, exchange: 'mail.example.com' }],
    spf: 'v=spf1 mx a:mail.example.com ip4:198.51.100.25 -all',
    dkim: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2K4P...demo-truncated',
    dmarc: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; pct=100',
    tlsa: [],
    srv: [{ service: '_submission._tcp', priority: 0, weight: 1, port: 587, name: 'mail.example.com' }],
  },
  'demo.org': {
    domain: 'demo.org',
    a: ['198.51.100.25'],
    mx: [{ priority: 10, exchange: 'mail.demo.org' }],
    spf: 'v=spf1 mx ip4:198.51.100.25 ~all',
    dkim: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7xR3...demo-truncated',
    dmarc: 'v=DMARC1; p=none; rua=mailto:postmaster@demo.org',
    tlsa: [],
    srv: [],
  },
  'acme.io': {
    domain: 'acme.io',
    a: ['198.51.100.25'],
    mx: [{ priority: 10, exchange: 'mail.acme.io' }],
    spf: 'v=spf1 mx -all',
    dkim: 'v=DKIM1; k=ed25519; p=YWJjZGVm...demo-truncated',
    dmarc: 'v=DMARC1; p=reject; rua=mailto:dmarc@acme.io; pct=100',
    tlsa: [],
    srv: [],
  },
  'test-corp.net': {
    domain: 'test-corp.net',
    a: ['203.0.113.50'],
    mx: [{ priority: 10, exchange: 'mail.example.com' }],
    spf: 'v=spf1 include:example.com -all',
    dkim: null,
    dmarc: null,
    tlsa: [],
    srv: [],
  },
  _fallback: {
    domain: 'unknown',
    a: [],
    mx: [],
    spf: null,
    dkim: null,
    dmarc: null,
    tlsa: [],
    srv: [],
  },
};

// --- DNSBL check (per-domain) ---
const _dnsblResults = [
  { name: 'Barracuda',       type: 'ip',     listed: false, returnCode: null },
  { name: 'SpamCop',         type: 'ip',     listed: false, returnCode: null },
  { name: 'UCEProtect-1',    type: 'ip',     listed: false, returnCode: null },
  { name: 'PSBL',            type: 'ip',     listed: false, returnCode: null },
  { name: 'Mailspike',       type: 'ip',     listed: false, returnCode: null },
  { name: 'Spamhaus ZEN',    type: 'ip',     listed: false, returnCode: null },
  { name: 'Abusix Combined', type: 'ip',     listed: false, returnCode: null },
  { name: 'Spamhaus DBL',    type: 'domain', listed: false, returnCode: null },
  { name: 'Abusix DBL',      type: 'domain', listed: false, returnCode: null },
];

const dnsblCheck = {
  'example.com':   { domain: 'example.com',   serverIp: '198.51.100.25', results: _dnsblResults },
  'demo.org':      { domain: 'demo.org',       serverIp: '198.51.100.25', results: _dnsblResults },
  'acme.io':       { domain: 'acme.io',        serverIp: '198.51.100.25', results: _dnsblResults },
  'test-corp.net': { domain: 'test-corp.net',  serverIp: '203.0.113.50',  results: _dnsblResults },
  _fallback:       { domain: 'unknown',         serverIp: '198.51.100.25', results: _dnsblResults },
};

// --- Dovecot sessions (4) ---
const dovecotSessions = [
  { username: 'alice@example.com', connections: 3, services: ['imap'],         ips: ['192.0.2.10'] },
  { username: 'bob@example.com',   connections: 1, services: ['imap', 'pop3'], ips: ['192.0.2.20'] },
  { username: 'admin@demo.org',    connections: 2, services: ['imap'],         ips: ['203.0.113.15'] },
  { username: 'admin@acme.io',     connections: 1, services: ['imap'],         ips: ['203.0.113.30'] },
];

// --- DKIM selector ---
const dkimSelector = 'default';

// --- Generate DKIM response ---
const generateDkim = {
  dnsRecord: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...demo-generated-key',
  selector: 'default',
  keytype: 'rsa',
  keysize: '2048',
};

// --- Mail logs (100 lines) ---
const _ts = (offset) => {
  const d = new Date((_now - offset) * 1000);
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const day = String(d.getDate()).padStart(2, ' ');
  const time = d.toTimeString().slice(0, 8);
  return `${mon} ${day} ${time}`;
};
const _qid = (i) => (0xA00000 + i * 0x1111).toString(16).toUpperCase();

const mailLogs = [
  // Recent activity block (postfix SMTP session)
  `${_ts(60)} mail postfix/smtpd[2341]: connect from mail-sor-f41.google.com[192.0.2.41]`,
  `${_ts(59)} mail postfix/smtpd[2341]: ${_qid(1)}: client=mail-sor-f41.google.com[192.0.2.41]`,
  `${_ts(58)} mail postfix/cleanup[2342]: ${_qid(1)}: message-id=<demo-msg-001@mail.gmail.com>`,
  `${_ts(57)} mail postfix/qmgr[789]: ${_qid(1)}: from=<john.smith@gmail.com>, size=4521, nrcpt=1 (queue active)`,
  `${_ts(56)} mail rspamd[456]: <demo-msg-001>; task; rspamd_task_write_log: id: <demo-msg-001@mail.gmail.com>, qid: <${_qid(1)}>, ip: 192.0.2.41, from: <john.smith@gmail.com>, (default: F (no action): [1.20/20.00] [BAYES_HAM(-3.00),R_SPF_ALLOW(-0.20),R_DKIM_ALLOW(-0.20),DMARC_POLICY_ALLOW(-0.50),MID_CONTAINS_FROM(0.50),MIME_GOOD(-0.10),RCPT_COUNT_ONE(0.00),TO_DN_ALL(0.00)]), len: 4521, time: 45.234ms, dns: 12.100ms`,
  `${_ts(55)} mail postfix/lmtp[2343]: ${_qid(1)}: to=<alice@example.com>, relay=dovecot, delay=2.1, delays=0.8/0.01/0.09/1.2, dsn=2.0.0, status=sent (250 2.0.0 <alice@example.com> Saved)`,
  `${_ts(54)} mail postfix/qmgr[789]: ${_qid(1)}: removed`,
  `${_ts(53)} mail postfix/smtpd[2341]: disconnect from mail-sor-f41.google.com[192.0.2.41] ehlo=2 starttls=1 mail=1 rcpt=1 data=1 quit=1 commands=7`,

  // Dovecot IMAP session
  `${_ts(120)} mail dovecot: imap-login: Login: user=<alice@example.com>, method=PLAIN, rip=192.0.2.10, lip=172.18.0.5, mpid=2401, TLS, session=<abc123def456>`,
  `${_ts(90)} mail dovecot: imap(alice@example.com)<2401><abc123def456>: Logged out in=1234 out=56789 deleted=0 expunged=0 trashed=0 hdr_count=45 hdr_bytes=12340 body_count=3 body_bytes=89012`,

  // Spam rejection
  `${_ts(180)} mail postfix/smtpd[2350]: connect from unknown[203.0.113.99]`,
  `${_ts(179)} mail postfix/smtpd[2350]: ${_qid(2)}: client=unknown[203.0.113.99]`,
  `${_ts(178)} mail rspamd[456]: <demo-msg-002>; task; rspamd_task_write_log: id: <spam-001@botnet.example>, qid: <${_qid(2)}>, ip: 203.0.113.99, from: <spammer@botnet.example>, (default: T (reject): [24.50/20.00] [BAYES_SPAM(5.48),FUZZY_DENIED(12.00),RBL_SPAMHAUS_ZEN(4.00),NEURAL_SPAM_LONG(3.00),MIME_HTML_ONLY(0.20),FORGED_SENDER(0.30)]), len: 8921, time: 234.567ms, dns: 45.200ms`,
  `${_ts(177)} mail postfix/smtpd[2350]: ${_qid(2)}: reject: RCPT from unknown[203.0.113.99]: 550 5.7.1 Spam message rejected`,
  `${_ts(176)} mail postfix/smtpd[2350]: disconnect from unknown[203.0.113.99] ehlo=1 mail=1 rcpt=0/1 quit=1 commands=3/4`,

  // Another clean delivery
  `${_ts(300)} mail postfix/smtpd[2355]: connect from mx.outlook.com[192.0.2.50]`,
  `${_ts(299)} mail postfix/smtpd[2355]: ${_qid(3)}: client=mx.outlook.com[192.0.2.50]`,
  `${_ts(298)} mail postfix/cleanup[2356]: ${_qid(3)}: message-id=<demo-msg-003@outlook.com>`,
  `${_ts(297)} mail postfix/qmgr[789]: ${_qid(3)}: from=<sarah.jones@outlook.com>, size=12340, nrcpt=1 (queue active)`,
  `${_ts(296)} mail rspamd[456]: <demo-msg-003>; task; rspamd_task_write_log: id: <demo-msg-003@outlook.com>, qid: <${_qid(3)}>, ip: 192.0.2.50, from: <sarah.jones@outlook.com>, (default: F (no action): [-0.80/20.00] [BAYES_HAM(-3.00),R_SPF_ALLOW(-0.20),R_DKIM_ALLOW(-0.20),DMARC_POLICY_ALLOW(-0.50),ARC_ALLOW(-1.00),NEURAL_HAM_LONG(-2.00),MIME_GOOD(-0.10),PREVIOUSLY_DELIVERED(-0.01),HAS_ATTACHMENT(0.00)]), len: 12340, time: 67.890ms, dns: 18.300ms`,
  `${_ts(295)} mail postfix/lmtp[2357]: ${_qid(3)}: to=<bob@example.com>, relay=dovecot, delay=1.8, delays=0.5/0.01/0.08/1.21, dsn=2.0.0, status=sent (250 2.0.0 <bob@example.com> Saved)`,
  `${_ts(294)} mail postfix/qmgr[789]: ${_qid(3)}: removed`,
  `${_ts(293)} mail postfix/smtpd[2355]: disconnect from mx.outlook.com[192.0.2.50] ehlo=2 starttls=1 mail=1 rcpt=1 data=1 quit=1 commands=7`,

  // Greylisting
  `${_ts(450)} mail postfix/smtpd[2360]: connect from mta-out.newdomain.example[203.0.113.42]`,
  `${_ts(449)} mail postfix/smtpd[2360]: ${_qid(4)}: client=mta-out.newdomain.example[203.0.113.42]`,
  `${_ts(448)} mail rspamd[456]: <demo-msg-004>; task; rspamd_task_write_log: id: <demo-msg-004@newdomain.example>, qid: <${_qid(4)}>, ip: 203.0.113.42, from: <newsletter@newdomain.example>, (default: F (greylist): [4.50/20.00] [MID_CONTAINS_FROM(0.50),MIME_HTML_ONLY(0.20),FROM_NO_DN(0.00),RCPT_COUNT_ONE(0.00)]), len: 3200, time: 120.456ms, dns: 32.100ms`,
  `${_ts(447)} mail postfix/smtpd[2360]: NOQUEUE: reject: RCPT from mta-out.newdomain.example[203.0.113.42]: 451 4.7.1 Try again later`,
  `${_ts(446)} mail postfix/smtpd[2360]: disconnect from mta-out.newdomain.example[203.0.113.42] ehlo=1 mail=1 rcpt=0/1 quit=1 commands=3/4`,

  // Dovecot sessions
  `${_ts(500)} mail dovecot: imap-login: Login: user=<bob@example.com>, method=PLAIN, rip=192.0.2.20, lip=172.18.0.5, mpid=2410, TLS, session=<def456ghi789>`,
  `${_ts(480)} mail dovecot: pop3-login: Login: user=<bob@example.com>, method=PLAIN, rip=192.0.2.20, lip=172.18.0.5, mpid=2411, TLS, session=<ghi789jkl012>`,

  // Outgoing mail (submission)
  `${_ts(600)} mail postfix/submission/smtpd[2370]: connect from client.example.com[192.0.2.10]`,
  `${_ts(599)} mail postfix/submission/smtpd[2370]: ${_qid(5)}: client=client.example.com[192.0.2.10], sasl_method=PLAIN, sasl_username=alice@example.com`,
  `${_ts(598)} mail postfix/cleanup[2371]: ${_qid(5)}: message-id=<outgoing-001@example.com>`,
  `${_ts(597)} mail postfix/qmgr[789]: ${_qid(5)}: from=<alice@example.com>, size=2890, nrcpt=1 (queue active)`,
  `${_ts(596)} mail postfix/smtp[2372]: ${_qid(5)}: to=<external-user@gmail.com>, relay=gmail-smtp-in.l.google.com[192.0.2.100]:25, delay=1.5, delays=0.1/0.01/0.5/0.89, dsn=2.0.0, status=sent (250 2.0.0 OK)`,
  `${_ts(595)} mail postfix/qmgr[789]: ${_qid(5)}: removed`,

  // Add header (spam detected but not rejected)
  `${_ts(700)} mail postfix/smtpd[2375]: connect from bulk-sender.example[203.0.113.77]`,
  `${_ts(699)} mail postfix/smtpd[2375]: ${_qid(6)}: client=bulk-sender.example[203.0.113.77]`,
  `${_ts(698)} mail postfix/cleanup[2376]: ${_qid(6)}: message-id=<promo-123@bulk-sender.example>`,
  `${_ts(697)} mail postfix/qmgr[789]: ${_qid(6)}: from=<promo@bulk-sender.example>, size=18450, nrcpt=1 (queue active)`,
  `${_ts(696)} mail rspamd[456]: <promo-123>; task; rspamd_task_write_log: id: <promo-123@bulk-sender.example>, qid: <${_qid(6)}>, ip: 203.0.113.77, from: <promo@bulk-sender.example>, (default: F (add header): [8.70/20.00] [BAYES_SPAM(5.48),NEURAL_SPAM_LONG(3.00),MIME_HTML_ONLY(0.20),FROM_NO_DN(0.00)]), len: 18450, time: 156.789ms, dns: 28.400ms`,
  `${_ts(695)} mail postfix/lmtp[2377]: ${_qid(6)}: to=<carol@example.com>, relay=dovecot, delay=2.8, delays=0.9/0.01/0.09/1.8, dsn=2.0.0, status=sent (250 2.0.0 <carol@example.com> Saved)`,
  `${_ts(694)} mail postfix/qmgr[789]: ${_qid(6)}: removed`,
  `${_ts(693)} mail postfix/smtpd[2375]: disconnect from bulk-sender.example[203.0.113.77] ehlo=1 mail=1 rcpt=1 data=1 quit=1 commands=5`,

  // Another dovecot session
  `${_ts(800)} mail dovecot: imap-login: Login: user=<admin@demo.org>, method=PLAIN, rip=203.0.113.15, lip=172.18.0.5, mpid=2420, TLS, session=<jkl012mno345>`,
  `${_ts(750)} mail dovecot: imap(admin@demo.org)<2420><jkl012mno345>: Logged out in=567 out=23456 deleted=0 expunged=2 trashed=2 hdr_count=12 hdr_bytes=4560 body_count=1 body_bytes=34567`,

  // More deliveries
  `${_ts(900)} mail postfix/smtpd[2380]: connect from mta.yahoo.com[192.0.2.60]`,
  `${_ts(899)} mail postfix/smtpd[2380]: ${_qid(7)}: client=mta.yahoo.com[192.0.2.60]`,
  `${_ts(898)} mail postfix/cleanup[2381]: ${_qid(7)}: message-id=<demo-msg-007@yahoo.com>`,
  `${_ts(897)} mail postfix/qmgr[789]: ${_qid(7)}: from=<mike.chen@yahoo.com>, size=5678, nrcpt=1 (queue active)`,
  `${_ts(896)} mail rspamd[456]: <demo-msg-007>; task; rspamd_task_write_log: id: <demo-msg-007@yahoo.com>, qid: <${_qid(7)}>, ip: 192.0.2.60, from: <mike.chen@yahoo.com>, (default: F (no action): [0.30/20.00] [BAYES_HAM(-3.00),R_SPF_ALLOW(-0.20),R_DKIM_ALLOW(-0.20),MIME_GOOD(-0.10),MID_CONTAINS_FROM(0.50),RCVD_COUNT_THREE(0.00)]), len: 5678, time: 89.012ms, dns: 15.600ms`,
  `${_ts(895)} mail postfix/lmtp[2382]: ${_qid(7)}: to=<dave@example.com>, relay=dovecot, delay=1.6, delays=0.4/0.01/0.09/1.1, dsn=2.0.0, status=sent (250 2.0.0 <dave@example.com> Saved)`,
  `${_ts(894)} mail postfix/qmgr[789]: ${_qid(7)}: removed`,
  `${_ts(893)} mail postfix/smtpd[2380]: disconnect from mta.yahoo.com[192.0.2.60] ehlo=2 starttls=1 mail=1 rcpt=1 data=1 quit=1 commands=7`,

  // Delivery to demo.org
  `${_ts(1000)} mail postfix/smtpd[2385]: connect from smtp.fastmail.com[192.0.2.70]`,
  `${_ts(999)} mail postfix/smtpd[2385]: ${_qid(8)}: client=smtp.fastmail.com[192.0.2.70]`,
  `${_ts(998)} mail postfix/cleanup[2386]: ${_qid(8)}: message-id=<demo-msg-008@fastmail.com>`,
  `${_ts(997)} mail postfix/qmgr[789]: ${_qid(8)}: from=<david.kim@fastmail.com>, size=3456, nrcpt=1 (queue active)`,
  `${_ts(996)} mail rspamd[456]: <demo-msg-008>; task; rspamd_task_write_log: id: <demo-msg-008@fastmail.com>, qid: <${_qid(8)}>, ip: 192.0.2.70, from: <david.kim@fastmail.com>, (default: F (no action): [-1.50/20.00] [BAYES_HAM(-3.00),R_SPF_ALLOW(-0.20),R_DKIM_ALLOW(-0.20),DMARC_POLICY_ALLOW(-0.50),MIME_GOOD(-0.10),TO_DN_ALL(0.00)]), len: 3456, time: 55.678ms, dns: 10.200ms`,
  `${_ts(995)} mail postfix/lmtp[2387]: ${_qid(8)}: to=<alice@demo.org>, relay=dovecot, delay=1.4, delays=0.3/0.01/0.08/1.01, dsn=2.0.0, status=sent (250 2.0.0 <alice@demo.org> Saved)`,
  `${_ts(994)} mail postfix/qmgr[789]: ${_qid(8)}: removed`,
  `${_ts(993)} mail postfix/smtpd[2385]: disconnect from smtp.fastmail.com[192.0.2.70] ehlo=2 starttls=1 mail=1 rcpt=1 data=1 quit=1 commands=7`,

  // Dovecot IMAP login for acme.io
  `${_ts(1100)} mail dovecot: imap-login: Login: user=<admin@acme.io>, method=PLAIN, rip=203.0.113.30, lip=172.18.0.5, mpid=2430, TLS, session=<mno345pqr678>`,

  // Another spam reject
  `${_ts(1200)} mail postfix/smtpd[2390]: connect from unknown[203.0.113.88]`,
  `${_ts(1199)} mail postfix/smtpd[2390]: ${_qid(9)}: client=unknown[203.0.113.88]`,
  `${_ts(1198)} mail rspamd[456]: <demo-msg-009>; task; rspamd_task_write_log: id: <spam-002@phishing.example>, qid: <${_qid(9)}>, ip: 203.0.113.88, from: <scam@phishing.example>, (default: T (reject): [28.30/20.00] [FUZZY_DENIED(12.00),BAYES_SPAM(5.48),RBL_SPAMHAUS_ZEN(4.00),NEURAL_SPAM_LONG(3.00),FORGED_SENDER(0.30),MIME_HTML_ONLY(0.20)]), len: 15670, time: 345.678ms, dns: 56.300ms`,
  `${_ts(1197)} mail postfix/smtpd[2390]: ${_qid(9)}: reject: RCPT from unknown[203.0.113.88]: 550 5.7.1 Spam message rejected`,
  `${_ts(1196)} mail postfix/smtpd[2390]: disconnect from unknown[203.0.113.88] ehlo=1 mail=1 rcpt=0/1 quit=1 commands=3/4`,

  // Outgoing from bob
  `${_ts(1300)} mail postfix/submission/smtpd[2395]: connect from client2.example.com[192.0.2.20]`,
  `${_ts(1299)} mail postfix/submission/smtpd[2395]: ${_qid(10)}: client=client2.example.com[192.0.2.20], sasl_method=PLAIN, sasl_username=bob@example.com`,
  `${_ts(1298)} mail postfix/cleanup[2396]: ${_qid(10)}: message-id=<outgoing-002@example.com>`,
  `${_ts(1297)} mail postfix/qmgr[789]: ${_qid(10)}: from=<bob@example.com>, size=7890, nrcpt=2 (queue active)`,
  `${_ts(1296)} mail postfix/smtp[2397]: ${_qid(10)}: to=<partner@company.co>, relay=mx.company.co[192.0.2.80]:25, delay=2.1, delays=0.2/0.01/0.8/1.09, dsn=2.0.0, status=sent (250 2.0.0 OK)`,
  `${_ts(1295)} mail postfix/smtp[2397]: ${_qid(10)}: to=<vendor@supplier.net>, relay=mail.supplier.net[192.0.2.90]:25, delay=2.3, delays=0.2/0.01/1.0/1.09, dsn=2.0.0, status=sent (250 2.0.0 OK)`,
  `${_ts(1294)} mail postfix/qmgr[789]: ${_qid(10)}: removed`,

  // More clean deliveries
  `${_ts(1400)} mail postfix/smtpd[2400]: connect from mail-pj1-f49.google.com[192.0.2.49]`,
  `${_ts(1399)} mail postfix/smtpd[2400]: ${_qid(11)}: client=mail-pj1-f49.google.com[192.0.2.49]`,
  `${_ts(1398)} mail rspamd[456]: <demo-msg-011>; task; rspamd_task_write_log: id: <demo-msg-011@mail.gmail.com>, qid: <${_qid(11)}>, ip: 192.0.2.49, from: <emma.wilson@gmail.com>, (default: F (no action): [-2.10/20.00]), len: 9870, time: 78.901ms, dns: 14.500ms`,
  `${_ts(1397)} mail postfix/lmtp[2401]: ${_qid(11)}: to=<frank@example.com>, relay=dovecot, delay=1.9, delays=0.6/0.01/0.09/1.2, dsn=2.0.0, status=sent (250 2.0.0 <frank@example.com> Saved)`,
  `${_ts(1396)} mail postfix/qmgr[789]: ${_qid(11)}: removed`,
  `${_ts(1395)} mail postfix/smtpd[2400]: disconnect from mail-pj1-f49.google.com[192.0.2.49] ehlo=2 starttls=1 mail=1 rcpt=1 data=1 quit=1 commands=7`,

  // Delivery to acme.io
  `${_ts(1500)} mail postfix/smtpd[2405]: connect from mta2.outlook.com[192.0.2.55]`,
  `${_ts(1499)} mail postfix/smtpd[2405]: ${_qid(12)}: client=mta2.outlook.com[192.0.2.55]`,
  `${_ts(1498)} mail rspamd[456]: <demo-msg-012>; task; rspamd_task_write_log: id: <demo-msg-012@outlook.com>, qid: <${_qid(12)}>, ip: 192.0.2.55, from: <support-ticket@helpdesk.net>, (default: F (no action): [0.80/20.00]), len: 6543, time: 92.345ms, dns: 16.800ms`,
  `${_ts(1497)} mail postfix/lmtp[2406]: ${_qid(12)}: to=<support@acme.io>, relay=dovecot, delay=1.7, delays=0.5/0.01/0.09/1.1, dsn=2.0.0, status=sent (250 2.0.0 <support@acme.io> Saved)`,
  `${_ts(1496)} mail postfix/qmgr[789]: ${_qid(12)}: removed`,

  // Dovecot logout
  `${_ts(1600)} mail dovecot: imap(bob@example.com)<2410><def456ghi789>: Logged out in=890 out=34567 deleted=1 expunged=1 trashed=0 hdr_count=23 hdr_bytes=7890 body_count=2 body_bytes=45678`,

  // Connection from internal service
  `${_ts(1700)} mail postfix/smtpd[2410]: connect from localhost[127.0.0.1]`,
  `${_ts(1699)} mail postfix/smtpd[2410]: ${_qid(13)}: client=localhost[127.0.0.1]`,
  `${_ts(1698)} mail postfix/cleanup[2411]: ${_qid(13)}: message-id=<cron-report@example.com>`,
  `${_ts(1697)} mail postfix/qmgr[789]: ${_qid(13)}: from=<root@example.com>, size=1234, nrcpt=1 (queue active)`,
  `${_ts(1696)} mail postfix/lmtp[2412]: ${_qid(13)}: to=<admin@example.com>, relay=dovecot, delay=0.5, delays=0.1/0.01/0.09/0.3, dsn=2.0.0, status=sent (250 2.0.0 <admin@example.com> Saved)`,
  `${_ts(1695)} mail postfix/qmgr[789]: ${_qid(13)}: removed`,
  `${_ts(1694)} mail postfix/smtpd[2410]: disconnect from localhost[127.0.0.1] ehlo=1 mail=1 rcpt=1 data=1 quit=1 commands=5`,

  // Tail with changedetector and supervisord
  `${_ts(1800)} mail changedetector[100]: Checking for changes in /tmp/docker-mailserver`,
  `${_ts(1801)} mail changedetector[100]: No changes detected`,
];


// --- Logins (GUI users) ---
const logins = [
  { id: 1, username: 'admin',             email: 'admin@dms-gui.com',   isAdmin: 1, isActive: 1, isAccount: 0, mailserver: 'dms', roles: [],                       mailbox: 'admin@dms-gui.com',   language: null },
  { id: 2, username: 'alice@example.com',  email: 'alice@example.com',   isAdmin: 0, isActive: 1, isAccount: 1, mailserver: 'dms', roles: ['alice@example.com'],     mailbox: 'alice@example.com',   language: 'en' },
  { id: 3, username: 'bob@example.com',    email: 'bob@example.com',     isAdmin: 0, isActive: 1, isAccount: 1, mailserver: 'dms', roles: ['bob@example.com'],       mailbox: 'bob@example.com',     language: null },
  { id: 4, username: 'carol',             email: 'carol@example.com',   isAdmin: 0, isActive: 1, isAccount: 0, mailserver: 'dms', roles: ['carol@example.com', 'carol@demo.org'], mailbox: 'carol@example.com', language: 'no' },
  { id: 5, username: 'admin@demo.org',    email: 'admin@demo.org',      isAdmin: 1, isActive: 1, isAccount: 1, mailserver: 'dms', roles: ['admin@demo.org'],        mailbox: 'admin@demo.org',      language: null },
  { id: 6, username: 'support@acme.io',   email: 'support@acme.io',     isAdmin: 0, isActive: 1, isAccount: 1, mailserver: 'dms', roles: ['support@acme.io'],       mailbox: 'support@acme.io',     language: null },
  { id: 7, username: 'eve@example.com',   email: 'eve@example.com',     isAdmin: 0, isActive: 0, isAccount: 1, mailserver: 'dms', roles: ['eve@example.com'],       mailbox: 'eve@example.com',     language: null },
];

// --- User settings (public mail setup) ---
const userSettings = {
  IMAP_HOST: 'mail.example.com',
  IMAP_PORT: '993',
  SMTP_HOST: 'mail.example.com',
  SMTP_PORT: '587',
  POP3_HOST: 'mail.example.com',
  POP3_PORT: '995',
  WEBMAIL_URL: 'https://webmail.example.com',
  ALLOW_USER_ALIASES: 'true',
  RSPAMD_URL: 'https://rspamd.example.com',
};

// --- Configs (available containers) ---
const configs = [
  { value: 'dms', plugin: 'mailserver', schema: 'dms', scope: 'dms-gui' },
];

// --- Settings (DMS connection config) ---
const settings = [
  { name: 'containerName', value: 'dms' },
  { name: 'protocol', value: 'http' },
  { name: 'DMS_API_PORT', value: '8888' },
  { name: 'DMS_API_KEY', value: 'demo-key' },
  { name: 'setupPath', value: '/usr/local/bin/setup' },
  { name: 'timeout', value: '4' },
  { name: 'schema', value: 'dms' },
];

// --- DNS provider profiles (saved in settings with plugin=dnscontrol) ---
const dnsProviderSettings = [
  { name: 'cloudflare-main',  value: '{"type":"CLOUDFLAREAPI","apitoken":"demo-cf-token-redacted"}' },
  { name: 'domeneshop-prod',  value: '{"type":"DOMAINNAMESHOP","token":"demo-ds-token","secret":"demo-ds-secret"}' },
];

// --- Export ---
export const demoData = {
  configs,
  settings,
  dnsProviderSettings,
  logins,
  userSettings,
  accounts,
  aliases,
  domains,
  serverStatus,
  serverEnvs,
  rspamdStats,
  rspamdConfig,
  rspamdBayesUsers,
  rspamdCounters,
  rspamdUserHistory,
  rspamdHistory,
  dnsLookup,
  dnsblCheck,
  dovecotSessions,
  dkimSelector,
  generateDkim,
  mailLogs,
};
