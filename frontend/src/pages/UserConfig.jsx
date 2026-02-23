import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

import {
  debugLog,
  errorLog,
} from '../../frontend.mjs';

import {
  getSettings,
  getServerEnvs,
  saveSettings,
} from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  FormField,
  Translate,
} from '../components/index.jsx';
import { useLocalStorage } from '../hooks/useLocalStorage';


function UserConfig() {
  const { t } = useTranslation();
  const [containerName] = useLocalStorage("containerName", '');

  const [isLoading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const [formData, setFormData] = useState({
    WEBMAIL_URL: '',
    IMAP_HOST: '',
    IMAP_PORT: '993',
    SMTP_HOST: '',
    SMTP_PORT: '587',
    POP3_HOST: '',
    POP3_PORT: '995',
    ALLOW_USER_ALIASES: '',
    RSPAMD_URL: '',
  });

  const settingNames = ['WEBMAIL_URL', 'IMAP_HOST', 'IMAP_PORT', 'SMTP_HOST', 'SMTP_PORT', 'POP3_HOST', 'POP3_PORT', 'ALLOW_USER_ALIASES', 'RSPAMD_URL'];

  useEffect(() => {
    if (containerName) loadSettings();
  }, [containerName]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      // Load existing settings from DB
      const result = await getSettings('userconfig', containerName);
      debugLog('UserConfig loadSettings result:', result);

      const loaded = { ...formData };
      if (result.success && result.message) {
        const settings = Array.isArray(result.message) ? result.message : [result.message];
        for (const s of settings) {
          if (s.name && settingNames.includes(s.name)) {
            loaded[s.name] = s.value || '';
          }
        }
      }

      // Auto-populate fields from DMS HOSTNAME if empty
      if (!loaded.IMAP_HOST || !loaded.SMTP_HOST) {
        try {
          // Try cached first, then force refresh if empty
          let envResult = await getServerEnvs('mailserver', containerName, false, 'HOSTNAME');
          let hostname = envResult?.message?.value || envResult?.message || '';
          if (!hostname || typeof hostname !== 'string') {
            envResult = await getServerEnvs('mailserver', containerName, true, 'HOSTNAME');
            hostname = envResult?.message?.value || envResult?.message || '';
          }
          debugLog('UserConfig HOSTNAME result:', hostname);
          if (hostname && typeof hostname === 'string') {
            if (!loaded.IMAP_HOST) loaded.IMAP_HOST = hostname;
            if (!loaded.SMTP_HOST) loaded.SMTP_HOST = hostname;
            if (!loaded.POP3_HOST) loaded.POP3_HOST = hostname;
            // Extract base domain (e.g. "mail.nytt.no" -> "nytt.no")
            const parts = hostname.split('.');
            const domain = parts.length > 2 ? parts.slice(1).join('.') : hostname;
            if (!loaded.WEBMAIL_URL) loaded.WEBMAIL_URL = `https://webmail.${domain}`;
            if (!loaded.RSPAMD_URL) loaded.RSPAMD_URL = `https://rspamd.${domain}`;
          }
        } catch (e) {
          debugLog('Could not fetch HOSTNAME for auto-populate:', e.message);
        }
      }

      setFormData(loaded);
    } catch (error) {
      errorLog('UserConfig loadSettings error:', error);
      setErrorMessage('api.errors.fetchSettings');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? (checked ? 'true' : '') : value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const jsonArrayOfObjects = settingNames.map(name => ({
        name,
        value: formData[name] || '',
      }));

      debugLog('UserConfig saveSettings:', jsonArrayOfObjects);
      const result = await saveSettings('userconfig', 'userconfig', 'userconfig', containerName, jsonArrayOfObjects);

      if (result.success) {
        setSuccessMessage('settings.saveSuccess');
      } else {
        setErrorMessage(result?.error || 'settings.cannotSaveSettings');
      }
    } catch (error) {
      errorLog('UserConfig save error:', error);
      setErrorMessage('api.errors.saveSettings');
    }
  };

  return (
    <>
      <AlertMessage type="danger" message={errorMessage} />
      <AlertMessage type="success" message={successMessage} />

      <Form onSubmit={handleSubmit} className="form-wrapper">
        <h6 className="mb-3">{Translate('settings.userConfig.webmail')}</h6>
        <FormField
          type="url"
          id="WEBMAIL_URL"
          name="WEBMAIL_URL"
          label="settings.userConfig.webmailUrl"
          value={formData.WEBMAIL_URL}
          onChange={handleInputChange}
          placeholder="https://webmail.example.com"
          helpText="settings.userConfig.webmailUrlHelp"
        />

        <h6 className="mb-3 mt-4">{Translate('settings.userConfig.mailConfig')}</h6>
        <Row>
          <Col md={8}>
            <FormField
              type="text"
              id="IMAP_HOST"
              name="IMAP_HOST"
              label="settings.userConfig.imapHost"
              value={formData.IMAP_HOST}
              onChange={handleInputChange}
              placeholder="mail.example.com"
            />
          </Col>
          <Col md={4}>
            <FormField
              type="number"
              id="IMAP_PORT"
              name="IMAP_PORT"
              label="settings.userConfig.imapPort"
              value={formData.IMAP_PORT}
              onChange={handleInputChange}
              placeholder="993"
            />
          </Col>
        </Row>
        <Row>
          <Col md={8}>
            <FormField
              type="text"
              id="SMTP_HOST"
              name="SMTP_HOST"
              label="settings.userConfig.smtpHost"
              value={formData.SMTP_HOST}
              onChange={handleInputChange}
              placeholder="mail.example.com"
            />
          </Col>
          <Col md={4}>
            <FormField
              type="number"
              id="SMTP_PORT"
              name="SMTP_PORT"
              label="settings.userConfig.smtpPort"
              value={formData.SMTP_PORT}
              onChange={handleInputChange}
              placeholder="587"
            />
          </Col>
        </Row>
        <Row>
          <Col md={8}>
            <FormField
              type="text"
              id="POP3_HOST"
              name="POP3_HOST"
              label="settings.userConfig.pop3Host"
              value={formData.POP3_HOST}
              onChange={handleInputChange}
              placeholder="mail.example.com"
            />
          </Col>
          <Col md={4}>
            <FormField
              type="number"
              id="POP3_PORT"
              name="POP3_PORT"
              label="settings.userConfig.pop3Port"
              value={formData.POP3_PORT}
              onChange={handleInputChange}
              placeholder="995"
            />
          </Col>
        </Row>

        <h6 className="mb-3 mt-4">{Translate('settings.userConfig.permissions')}</h6>
        <FormField
          type="checkbox"
          id="ALLOW_USER_ALIASES"
          name="ALLOW_USER_ALIASES"
          label="settings.userConfig.allowUserAliases"
          isChecked={formData.ALLOW_USER_ALIASES === 'true'}
          onChange={handleInputChange}
        />

        <h6 className="mb-3 mt-4">{Translate('settings.userConfig.rspamd')}</h6>
        <FormField
          type="url"
          id="RSPAMD_URL"
          name="RSPAMD_URL"
          label="settings.userConfig.rspamdUrl"
          value={formData.RSPAMD_URL}
          onChange={handleInputChange}
          placeholder="https://rspamd.example.com"
          helpText="settings.userConfig.rspamdUrlHelp"
        />

        <Button type="submit" variant="primary" icon="floppy" text="settings.saveSettings" className="mt-3" />
      </Form>
    </>
  );
}

export default UserConfig;
