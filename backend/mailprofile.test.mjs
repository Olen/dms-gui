import { describe, it, expect } from 'vitest';
import { generateAutoconfig, generateMobileconfig } from './mailprofile.mjs';

const defaultSettings = {
  IMAP_HOST: 'mail.example.com',
  IMAP_PORT: '993',
  SMTP_HOST: 'mail.example.com',
  SMTP_PORT: '587',
};

describe('generateAutoconfig', () => {
  it('produces valid XML with xml declaration', () => {
    const xml = generateAutoconfig('user@example.com', defaultSettings);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<clientConfig');
    expect(xml).toContain('</clientConfig>');
  });

  it('uses IMAP and SMTP hosts from settings', () => {
    const xml = generateAutoconfig('user@example.com', defaultSettings);
    expect(xml).toContain('<hostname>mail.example.com</hostname>');
  });

  it('maps IMAP port 993 to SSL socket type', () => {
    const xml = generateAutoconfig('user@example.com', { ...defaultSettings, IMAP_PORT: '993' });
    expect(xml).toMatch(/<incomingServer type="imap">[\s\S]*?<socketType>SSL<\/socketType>/);
  });

  it('maps IMAP port 143 to STARTTLS socket type', () => {
    const xml = generateAutoconfig('user@example.com', { ...defaultSettings, IMAP_PORT: '143' });
    expect(xml).toMatch(/<incomingServer type="imap">[\s\S]*?<socketType>STARTTLS<\/socketType>/);
  });

  it('maps SMTP port 465 to SSL socket type', () => {
    const xml = generateAutoconfig('user@example.com', { ...defaultSettings, SMTP_PORT: '465' });
    expect(xml).toMatch(/<outgoingServer type="smtp">[\s\S]*?<socketType>SSL<\/socketType>/);
  });

  it('maps SMTP port 587 to STARTTLS socket type', () => {
    const xml = generateAutoconfig('user@example.com', { ...defaultSettings, SMTP_PORT: '587' });
    expect(xml).toMatch(/<outgoingServer type="smtp">[\s\S]*?<socketType>STARTTLS<\/socketType>/);
  });

  it('includes POP3 section when POP3_HOST is configured', () => {
    const settings = { ...defaultSettings, POP3_HOST: 'pop.example.com', POP3_PORT: '995' };
    const xml = generateAutoconfig('user@example.com', settings);
    expect(xml).toContain('<incomingServer type="pop3">');
    expect(xml).toContain('<hostname>pop.example.com</hostname>');
    expect(xml).toContain('<socketType>SSL</socketType>');
  });

  it('omits POP3 section when POP3_HOST is not configured', () => {
    const xml = generateAutoconfig('user@example.com', defaultSettings);
    expect(xml).not.toContain('pop3');
  });

  it('defaults host from email domain when not in settings', () => {
    const xml = generateAutoconfig('user@nytt.no', {});
    expect(xml).toContain('<hostname>mail.nytt.no</hostname>');
  });

  it('escapes XML special characters in settings', () => {
    const settings = { ...defaultSettings, IMAP_HOST: 'mail.test&co.com' };
    const xml = generateAutoconfig('user@example.com', settings);
    expect(xml).toContain('mail.test&amp;co.com');
    expect(xml).not.toContain('mail.test&co.com');
  });
});


describe('generateMobileconfig', () => {
  it('produces valid plist XML', () => {
    const xml = generateMobileconfig('user@example.com', defaultSettings);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<!DOCTYPE plist');
    expect(xml).toContain('<plist version="1.0">');
    expect(xml).toContain('</plist>');
  });

  it('contains the email address', () => {
    const xml = generateMobileconfig('user@example.com', defaultSettings);
    expect(xml).toContain('<string>user@example.com</string>');
  });

  it('sets SSL boolean based on IMAP port', () => {
    const xml993 = generateMobileconfig('user@example.com', { ...defaultSettings, IMAP_PORT: '993' });
    expect(xml993).toContain('<key>IncomingMailServerUseSSL</key>');
    expect(xml993).toContain('<true/>');

    const xml143 = generateMobileconfig('user@example.com', { ...defaultSettings, IMAP_PORT: '143' });
    expect(xml143).toContain('<key>IncomingMailServerUseSSL</key>');
    expect(xml143).toContain('<false/>');
  });

  it('generates unique UUIDs across calls', () => {
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const xml1 = generateMobileconfig('user@example.com', defaultSettings);
    const xml2 = generateMobileconfig('other@example.com', defaultSettings);
    const uuids1 = xml1.match(uuidRegex);
    const uuids2 = xml2.match(uuidRegex);
    expect(uuids1.length).toBeGreaterThanOrEqual(3);
    // At least some UUIDs should differ between calls
    expect(uuids1.join()).not.toBe(uuids2.join());
  });
});
