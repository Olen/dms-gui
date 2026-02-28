import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
  errorLog,
} from '../../frontend.mjs';
import {
  getValueFromArrayOfObj,
} from '../../../common.mjs';
import {
  getAccounts,
  getServerStatus,
  getUserSettings,
  getRspamdUserSummary,
  killContainer,
} from '../services/api.mjs';

import {
  AlertMessage,
  Card,
  DashboardCard,
  Button,
  Translate,
} from '../components/index.jsx';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../hooks/useAuth';

import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import ProgressBar from 'react-bootstrap/ProgressBar';

const actionStyles = {
  'no action':       { bg: 'success',   label: 'clean',   tip: 'Message delivered normally' },
  'add header':      { bg: 'warning',   label: 'header',  tip: 'Spam header added, delivered to Junk' },
  'rewrite subject': { bg: 'warning',   label: 'rewrite', tip: 'Subject rewritten with spam tag' },
  'reject':          { bg: 'danger',    label: 'reject',  tip: 'Message rejected by server' },
  'soft reject':     { bg: 'info',      label: 'defer',   tip: 'Temporarily rejected (greylisting)' },
  'greylist':        { bg: 'info',      label: 'greylist', tip: 'Greylisted, retried later' },
};

const ActionBadge = ({ action }) => {
  const style = actionStyles[action] || { bg: 'dark', label: action, tip: action };
  return (
    <span className={`badge text-bg-${style.bg}`} title={style.tip}>
      {style.label}
    </span>
  );
};

const Dashboard = () => {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [containerName] = useLocalStorage("containerName", '');
  const [mailservers] = useLocalStorage("mailservers", []);

  const [status, setServerStatus] = useState({
    status: {
      status: 'loading',
      error: null,
    },
    resources: {
      cpuUsage: 0,
      memoryUsage: 0,
      diskUsage: 0,
    },
    db: {
      logins: 0,
      accounts: 0,
      aliases: 0,
    },
  });

  const [isStatusLoading, setStatusLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [userSettings, setUserSettings] = useState(null);
  const [spamSummary, setSpamSummary] = useState(null);
  const [userQuota, setUserQuota] = useState(null);

  const fetchAll = useCallback(async () => {
    fetchDashboard();
    if (user?.isAdmin !== 1) {
      fetchUserSettings();
      fetchSpamSummary();
      fetchUserQuota();
    }
  }, [containerName, user, mailservers]);

  useEffect(() => {
    fetchAll();

    // Refresh data every 30 seconds (fetchAll covers both admin and user data)
    const interval = setInterval(fetchAll, 30000);

    return () => clearInterval(interval);
  }, [fetchAll]);

  const fetchUserSettings = async () => {
    if (!containerName) return;
    try {
      const result = await getUserSettings(containerName);
      if (result.success) setUserSettings(result.message);
    } catch (error) {
      // Non-critical - settings may not be configured yet
    }
  };

  const fetchSpamSummary = async () => {
    if (!containerName) return;
    try {
      const result = await getRspamdUserSummary(containerName);
      if (result.success) setSpamSummary(result.message);
    } catch (error) {
      // Non-critical - rspamd may not be enabled
    }
  };

  const fetchUserQuota = async () => {
    if (!containerName) return;
    try {
      const result = await getAccounts(containerName);
      if (result.success && result.message) {
        const mailbox = user.mailbox || (user.roles && user.roles[0]);
        const account = result.message.find(a => a.mailbox === mailbox);
        if (account?.storage) setUserQuota(account.storage);
      }
    } catch (error) {
      // Non-critical - quota may not be available
    }
  };

  const fetchDashboard = async () => {
    if (!mailservers || !mailservers.length) return;
    if (!containerName) return;

    try {
      setStatusLoading(true);

      const statusData = await getServerStatus('mailserver', containerName);
      if (statusData.success) {

        setErrorMessage(null);
        setServerStatus(statusData.message);
        if (['api_gen', 'api_miss', 'api_match', 'api_unset', 'api_error', 'port_closed', 'port_timeout', 'port_unknown', 'unknown'].includes(statusData.message.status.status)) setErrorMessage(`dashboard.errors.${statusData.message.status.status}`);

      } else setErrorMessage(statusData?.error);

    } catch (error) {
      errorLog(t('api.errors.fetchServerStatus'), error);
      setErrorMessage('api.errors.fetchServerStatus');

    } finally {
      setStatusLoading(false);
    }
  };

  const rebootMe = async () => {

    killContainer('dms-gui', 'dms-gui', 'dms-gui');
    logout();
  };

  const getStatusColor = () => {
    if (status.status.status === 'loading') return 'secondary';
    if (status.status.status === 'alive') return 'warning';
    if (status.status.status === 'missing') return 'danger';
    if (status.status.status === 'api_gen') return 'warning';
    if (status.status.status === 'api_miss') return 'warning';
    if (status.status.status === 'api_match') return 'warning';
    if (status.status.status === 'api_unset') return 'warning';
    if (status.status.status === 'api_error') return 'danger';
    if (status.status.status === 'port_closed') return 'danger';
    if (status.status.status === 'port_timeout') return 'warning';
    if (status.status.status === 'port_unknown') return 'danger';
    if (status.status.status === 'running') return 'success';
    if (status.status.status === 'stopped') return 'danger';
    if (status.status.status === 'unknown') return 'danger';
    return 'danger';
  };

  const getStatusText = () => {
    return `dashboard.status.${status.status.status}`;
  };

  if (!user) {
    return <LoadingSpinner />;
  }

  // Admin dashboard view
  if (user?.isAdmin === 1) {
    return (
      <div>
        <div className="float-end position-sticky z-1">
          <Button
            variant="warning"
            size="sm"
            icon="arrow-repeat"
            title={t('common.refresh')}
            className="me-2"
            onClick={() => fetchAll(true)}
          />
        </div>

        <h2 className="mb-4">{Translate('dashboard.title')} {t('common.for', {what:containerName})}</h2>
        <AlertMessage type="danger" message={errorMessage} />

        <Row>
          <Col md={3} className="mb-3">
            <DashboardCard
              title="dashboard.serverStatus"
              icon="hdd-rack-fill"
              iconColor={getStatusColor()}
              badgeColor={getStatusColor()}
              badgeText={getStatusText()}
              isLoading={isStatusLoading}
            >
              <Button
                variant="danger"
                size="sm"
                icon="recycle"
                title={t('dashboard.rebootMe')}
                className="position-absolute top-right shadow"
                onClick={() => rebootMe()}
              />
            </DashboardCard>
          </Col>
          <Col md={3} className="mb-3">
            <DashboardCard
              title="dashboard.cpuUsage"
              icon="cpu"
              iconColor={isStatusLoading ? "secondary" : "primary"}
              isLoading={isStatusLoading}
              value={Number(status.resources.cpuUsage).toFixed(2)+'%'}
            />
          </Col>
          <Col md={3} className="mb-3">
            <DashboardCard
              title="dashboard.memoryUsage"
              icon="memory"
              iconColor={isStatusLoading ? "secondary" : "info"}
              isLoading={isStatusLoading}
              value={Number(status.resources.memoryUsage).toFixed(2)+'%'}
            />
          </Col>
          <Col md={3} className="mb-3">
            <DashboardCard
              title="dashboard.diskUsage"
              icon="hdd"
              iconColor={isStatusLoading ? "secondary" : "warning"}
              isLoading={isStatusLoading}
              value={status.resources.diskUsage+'MB'}
            />
          </Col>
        </Row>

        {user?.isAccount != 1 &&
        <Row>
          <Col md={4} className="mb-3">
            <DashboardCard
              title="dashboard.logins"
              icon="person-lock"
              iconColor={isStatusLoading ? "secondary" : "success"}
              isLoading={isStatusLoading}
              value={status.db.logins}
              href="/logins"
            />
          </Col>
          <Col md={4} className="mb-3">
            <DashboardCard
              title="dashboard.mailboxAccounts"
              icon="inboxes-fill"
              iconColor={isStatusLoading ? "secondary" : "success"}
              isLoading={isStatusLoading}
              value={status.db.accounts}
              href="/accounts"
            />
          </Col>
          <Col md={4} className="mb-3">
            <DashboardCard
              title="dashboard.aliases"
              icon="arrow-left-right"
              iconColor={isStatusLoading ? "secondary" : "success"}
              isLoading={isStatusLoading}
              value={status.db.aliases}
              href="/aliases"
            />
          </Col>
        </Row>
        }
      </div>
    );
  }

  // Non-admin user dashboard view
  return (
    <div>
      <div className="float-end position-sticky z-1">
        <Button
          variant="warning"
          size="sm"
          icon="arrow-repeat"
          title={t('common.refresh')}
          className="me-2"
          onClick={() => fetchAll(true)}
        />
      </div>

      <h2 className="mb-4">{Translate('dashboard.title')}</h2>
      <AlertMessage type="danger" message={errorMessage} />

      {/* Quick actions */}
      <Row>
        <Col md={3} className="mb-3">
          <DashboardCard
            title="dashboard.serverStatus"
            icon="hdd-rack-fill"
            iconColor={getStatusColor()}
            badgeColor={getStatusColor()}
            badgeText={getStatusText()}
            isLoading={isStatusLoading}
          />
        </Col>
        {userSettings?.WEBMAIL_URL && (
          <Col md={3} className="mb-3">
            <DashboardCard
              title="dashboard.user.webmail"
              icon="envelope-open"
              iconColor="primary"
            >
              <a href={userSettings.WEBMAIL_URL} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                {t('dashboard.user.openWebmail')}
              </a>
            </DashboardCard>
          </Col>
        )}
        <Col md={3} className="mb-3">
          <DashboardCard
            title="dashboard.aliases"
            icon="arrow-left-right"
            iconColor="success"
            href="/aliases"
            value={userSettings?.USER_ALIAS_COUNT ?? '...'}
          />
        </Col>
        <Col md={3} className="mb-3">
          <DashboardCard
            title="dashboard.user.profile"
            icon="person-gear"
            iconColor="info"
            href="/profile"
            value={user.mailbox}
          />
        </Col>
      </Row>

      {/* Mailbox quota */}
      {userQuota && (
        <Row>
          <Col md={12} className="mb-3">
            <Card title="dashboard.quota" icon="hdd">
              <div className="mb-1">
                <span className="fw-bold">{userQuota.used}</span>
                <span className="text-muted"> / {userQuota.total === '0' ? t('dashboard.quotaUnlimited') : userQuota.total}</span>
              </div>
              {userQuota.total !== '0' && (
                <ProgressBar
                  now={parseInt(userQuota.percent) || 0}
                  variant={parseInt(userQuota.percent) > 90 ? 'danger' : parseInt(userQuota.percent) > 75 ? 'warning' : 'success'}
                  label={`${userQuota.percent}%`}
                  style={{ height: '20px' }}
                />
              )}
            </Card>
          </Col>
        </Row>
      )}

      {/* Mail client configuration */}
      {userSettings?.IMAP_HOST && (
        <Row>
          <Col md={12} className="mb-3">
            <Card title="dashboard.user.mailConfig" icon="gear">
              <table className="table table-sm mb-0">
                <tbody>
                  <tr>
                    <td className="text-muted fw-bold" style={{width:'120px'}}>IMAP</td>
                    <td><code>{userSettings.IMAP_HOST}:{userSettings.IMAP_PORT || '993'}</code> (SSL/TLS)</td>
                  </tr>
                  <tr>
                    <td className="text-muted fw-bold">SMTP</td>
                    <td><code>{userSettings.SMTP_HOST}:{userSettings.SMTP_PORT || '587'}</code> (STARTTLS)</td>
                  </tr>
                  {userSettings.POP3_HOST && (
                    <tr>
                      <td className="text-muted fw-bold">POP3</td>
                      <td><code>{userSettings.POP3_HOST}:{userSettings.POP3_PORT || '995'}</code> (SSL/TLS)</td>
                    </tr>
                  )}
                  <tr>
                    <td className="text-muted fw-bold">{t('dashboard.user.username')}</td>
                    <td><code>{user.mailbox || t('dashboard.user.yourEmail')}</code></td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </Col>
        </Row>
      )}

      {/* Spam summary */}
      {spamSummary && (
        <Row>
          <Col md={12} className="mb-3">
            <Card title="dashboard.user.spamSummary" icon="shield-check">
              <p className="mb-2">
                {t('dashboard.user.messagesScanned', { total: spamSummary.total })} &mdash;{' '}
                <span className="text-success">{t('dashboard.user.hamCount', { count: spamSummary.ham })}</span>,{' '}
                <span className="text-danger">{t('dashboard.user.spamCount', { count: spamSummary.spam })}</span>
                {spamSummary.since && (
                  <span className="text-muted ms-2">
                    ({t('dashboard.user.since')} {new Date(spamSummary.since * 1000).toLocaleDateString()})
                  </span>
                )}
              </p>
              {spamSummary.recentSpam && spamSummary.recentSpam.length > 0 && (
                <>
                  <h6 className="mb-2">{t('dashboard.user.recentSpam')}</h6>
                  <table className="table table-sm mb-0">
                    <thead>
                      <tr>
                        <th>{t('dashboard.user.date')}</th>
                        <th>{t('dashboard.user.to')}</th>
                        <th>{t('dashboard.user.subject')}</th>
                        <th>{t('dashboard.user.score')}</th>
                        <th>{t('dashboard.user.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spamSummary.recentSpam.map((item, i) => (
                        <tr key={i}>
                          <td className="text-muted text-nowrap">{item.time ? new Date(item.time * 1000).toLocaleString() : ''}</td>
                          <td className="text-truncate" style={{maxWidth:'200px'}}>{item.rcpt}</td>
                          <td className="text-truncate" style={{maxWidth:'300px'}}>{item.subject}</td>
                          <td><span className="text-danger">{item.score?.toFixed(1)}</span></td>
                          <td><ActionBadge action={item.action} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
};

export default Dashboard;
