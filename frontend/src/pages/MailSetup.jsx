import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  errorLog,
} from '../../frontend.mjs';
import {
  getUserSettings,
} from '../services/api.mjs';

import {
  AlertMessage,
  Card,
  LoadingSpinner,
  Translate,
} from '../components/index.jsx';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../hooks/useAuth';

import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

const MailSetup = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [containerName] = useLocalStorage("containerName", '');

  const [settings, setSettings] = useState(null);
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    fetchSettings();
  }, [containerName]);

  const fetchSettings = async () => {
    if (!containerName) return;
    try {
      setLoading(true);
      setErrorMessage(null);
      const result = await getUserSettings(containerName);
      if (result.success) {
        setSettings(result.message);
      } else {
        setErrorMessage(result?.error);
      }
    } catch (error) {
      errorLog('MailSetup fetchSettings', error);
      setErrorMessage('api.errors.fetchSettings');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = (type) => {
    // Direct browser download via API endpoint (cookies sent automatically)
    window.location.href = `/api/mail-profile/${containerName}/${type}`;
  };

  if (isLoading) return <LoadingSpinner />;

  const hasSettings = settings && (settings.IMAP_HOST || settings.SMTP_HOST);

  return (
    <div>
      <h2 className="mb-4">{Translate('mailSetup.title')}</h2>
      <AlertMessage type="danger" message={errorMessage} />

      {!hasSettings ? (
        <AlertMessage type="warning" message="mailSetup.noSettings" />
      ) : (
        <>
          {/* Server settings display */}
          <Row>
            <Col md={8} className="mb-3">
              <Card title="mailSetup.serverSettings" icon="hdd-rack">
                <table className="table table-sm mb-0">
                  <tbody>
                    {settings.IMAP_HOST && (
                      <tr>
                        <td className="text-muted fw-bold" style={{width:'120px'}}>IMAP</td>
                        <td><code>{settings.IMAP_HOST}:{settings.IMAP_PORT || '993'}</code> (SSL/TLS)</td>
                      </tr>
                    )}
                    {settings.SMTP_HOST && (
                      <tr>
                        <td className="text-muted fw-bold">SMTP</td>
                        <td><code>{settings.SMTP_HOST}:{settings.SMTP_PORT || '587'}</code> (STARTTLS)</td>
                      </tr>
                    )}
                    {settings.POP3_HOST && (
                      <tr>
                        <td className="text-muted fw-bold">POP3</td>
                        <td><code>{settings.POP3_HOST}:{settings.POP3_PORT || '995'}</code> (SSL/TLS)</td>
                      </tr>
                    )}
                    <tr>
                      <td className="text-muted fw-bold">{t('mailSetup.username')}</td>
                      <td><code>{user.mailbox || t('dashboard.user.yourEmail')}</code></td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            </Col>
          </Row>

          {/* How to use */}
          <Row>
            <Col md={8} className="mb-3">
              <p className="text-muted">{t('mailSetup.howTo')}</p>
            </Col>
          </Row>

          {/* Download buttons */}
          <Row>
            <Col md={4} className="mb-3">
              <Card title="mailSetup.downloadThunderbird" icon="pc-display">
                <p className="text-muted small mb-3">{t('mailSetup.thunderbirdDesc')}</p>
                <button
                  className="btn btn-primary w-100"
                  onClick={() => handleDownload('autoconfig')}
                >
                  <i className="bi bi-download me-2"></i>
                  {t('mailSetup.downloadThunderbird')}
                </button>
              </Card>
            </Col>
            <Col md={4} className="mb-3">
              <Card title="mailSetup.downloadApple" icon="phone">
                <p className="text-muted small mb-3">{t('mailSetup.appleDesc')}</p>
                <button
                  className="btn btn-dark w-100"
                  onClick={() => handleDownload('mobileconfig')}
                >
                  <i className="bi bi-apple me-2"></i>
                  {t('mailSetup.downloadApple')}
                </button>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
};

export default MailSetup;
