import * as crypto from 'crypto';

/**
 * Generate Mozilla Thunderbird autoconfig XML
 * @see https://wiki.mozilla.org/Thunderbird:Autoconfiguration:ConfigFileFormat
 */
export const generateAutoconfig = (email, settings) => {
  const emailDomain = email.split('@')[1];
  const imapHost = settings.IMAP_HOST || `mail.${emailDomain}`;
  const imapPort = settings.IMAP_PORT || '993';
  const smtpHost = settings.SMTP_HOST || `mail.${emailDomain}`;
  const smtpPort = settings.SMTP_PORT || '587';
  // Use the mail server's domain for the provider identity (e.g. "nytt.no" from "mail.nytt.no")
  const serverDomain = imapHost.replace(/^mail\./, '') || emailDomain;

  // Determine socket type from port
  const imapSocket = imapPort === '993' ? 'SSL' : imapPort === '143' ? 'STARTTLS' : 'SSL';
  const smtpSocket = smtpPort === '465' ? 'SSL' : 'STARTTLS';

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="${escapeXml(serverDomain)}">
    <domain>${escapeXml(serverDomain)}</domain>
    <displayName>${escapeXml(serverDomain)} Mail</displayName>
    <displayShortName>${escapeXml(serverDomain)}</displayShortName>
    <incomingServer type="imap">
      <hostname>${escapeXml(imapHost)}</hostname>
      <port>${escapeXml(imapPort)}</port>
      <socketType>${imapSocket}</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>${escapeXml(smtpHost)}</hostname>
      <port>${escapeXml(smtpPort)}</port>
      <socketType>${smtpSocket}</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>`;

  // Add POP3 if configured
  if (settings.POP3_HOST) {
    const pop3Port = settings.POP3_PORT || '995';
    const pop3Socket = pop3Port === '995' ? 'SSL' : 'STARTTLS';
    xml += `
    <incomingServer type="pop3">
      <hostname>${escapeXml(settings.POP3_HOST)}</hostname>
      <port>${escapeXml(pop3Port)}</port>
      <socketType>${pop3Socket}</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>`;
  }

  xml += `
  </emailProvider>
</clientConfig>
`;

  return xml;
};


/**
 * Generate Apple .mobileconfig profile XML plist
 * Unsigned but functional — user gets a standard warning on install.
 */
export const generateMobileconfig = (email, settings) => {
  const emailDomain = email.split('@')[1];
  const imapHost = settings.IMAP_HOST || `mail.${emailDomain}`;
  const imapPort = settings.IMAP_PORT || '993';
  const smtpHost = settings.SMTP_HOST || `mail.${emailDomain}`;
  const smtpPort = settings.SMTP_PORT || '587';
  // Use the mail server's domain for display/identifiers
  const serverDomain = imapHost.replace(/^mail\./, '') || emailDomain;

  const profileUUID = crypto.randomUUID();
  const imapUUID = crypto.randomUUID();
  const smtpUUID = crypto.randomUUID();

  const imapSSL = imapPort === '993';
  const smtpSSL = smtpPort === '465';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>EmailAccountDescription</key>
      <string>${escapeXml(serverDomain)} Mail</string>
      <key>EmailAccountName</key>
      <string>${escapeXml(email)}</string>
      <key>EmailAccountType</key>
      <string>EmailTypeIMAP</string>
      <key>EmailAddress</key>
      <string>${escapeXml(email)}</string>
      <key>IncomingMailServerAuthentication</key>
      <string>EmailAuthPassword</string>
      <key>IncomingMailServerHostName</key>
      <string>${escapeXml(imapHost)}</string>
      <key>IncomingMailServerPortNumber</key>
      <integer>${parseInt(imapPort)}</integer>
      <key>IncomingMailServerUseSSL</key>
      <${imapSSL}/>
      <key>IncomingMailServerUsername</key>
      <string>${escapeXml(email)}</string>
      <key>OutgoingMailServerAuthentication</key>
      <string>EmailAuthPassword</string>
      <key>OutgoingMailServerHostName</key>
      <string>${escapeXml(smtpHost)}</string>
      <key>OutgoingMailServerPortNumber</key>
      <integer>${parseInt(smtpPort)}</integer>
      <key>OutgoingMailServerUseSSL</key>
      <${smtpSSL}/>
      <key>OutgoingMailServerUsername</key>
      <string>${escapeXml(email)}</string>
      <key>OutgoingPasswordSameAsIncomingPassword</key>
      <true/>
      <key>PayloadDescription</key>
      <string>Email account for ${escapeXml(email)}</string>
      <key>PayloadDisplayName</key>
      <string>${escapeXml(serverDomain)} Mail</string>
      <key>PayloadIdentifier</key>
      <string>com.${escapeXml(serverDomain.split('.').reverse().join('.'))}.mail.${imapUUID}</string>
      <key>PayloadType</key>
      <string>com.apple.mail.managed</string>
      <key>PayloadUUID</key>
      <string>${imapUUID}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Mail configuration for ${escapeXml(email)}</string>
  <key>PayloadDisplayName</key>
  <string>${escapeXml(serverDomain)} Mail</string>
  <key>PayloadIdentifier</key>
  <string>com.${escapeXml(serverDomain.split('.').reverse().join('.'))}.mailprofile</string>
  <key>PayloadOrganization</key>
  <string>${escapeXml(serverDomain)}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profileUUID}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
};


/** Escape special XML characters */
const escapeXml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};
