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
  getCount,
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

const formatMB = (mb) => {
  const n = Number(mb);
  if (!n) return '0 MB';
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' TB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' GB';
  return n + ' MB';
};

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
      memoryTotal: 0,
      memoryUsed: 0,
      diskUsage: 0,
      diskUsed: 0,
      diskTotal: 0,
      diskPercent: 0,
      uptime: '',
      loadAverage: [],
    },
    db: {
      logins: 0,
      accounts: 0,
      aliases: 0,
    },
  });

  const [isStatusLoading, setStatusLoading] = useState(true);
  const [isDiskLoading, setDiskLoading] = useState(true);
  const [isCountsLoading, setCountsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [userSettings, setUserSettings] = useState(null);
  const [spamSummary, setSpamSummary] = useState(null);
  const [userQuota, setUserQuota] = useState(null);

  const fetchAll = useCallback(async () => {
    fetchStatus();
    fetchDisk();
    fetchCounts();
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

  const fetchStatus = async () => {
    if (!mailservers || !mailservers.length) return;
    if (!containerName) return;

    try {
      const statusData = await getServerStatus('mailserver', containerName, 'status');
      if (statusData.success) {

        setErrorMessage(null);
        const r = statusData.message.resources;
        setServerStatus(prev => ({ ...prev, status: statusData.message.status, resources: {
          ...prev.resources,
          cpuUsage: r.cpuUsage,
          memoryUsage: r.memoryUsage,
          memoryTotal: r.memoryTotal,
          memoryUsed: r.memoryUsed,
          uptime: r.uptime,
          loadAverage: r.loadAverage,
        }}));
        if (['api_gen', 'api_miss', 'api_match', 'api_unset', 'api_error', 'port_closed', 'port_timeout', 'port_unknown', 'unknown'].includes(statusData.message.status.status)) setErrorMessage(`dashboard.errors.${statusData.message.status.status}`);

      } else setErrorMessage(statusData?.error);

    } catch (error) {
      errorLog(t('api.errors.fetchServerStatus'), error);
      setErrorMessage('api.errors.fetchServerStatus');

    } finally {
      setStatusLoading(false);
    }
  };

  const fetchDisk = async () => {
    if (!mailservers || !mailservers.length) return;
    if (!containerName) return;

    try {
      const diskData = await getServerStatus('mailserver', containerName, 'disk');
      if (diskData.success) {
        setServerStatus(prev => ({
          ...prev,
          resources: {
            ...prev.resources,
            diskUsage: diskData.message.resources.diskUsage,
            diskUsed: diskData.message.resources.diskUsed,
            diskTotal: diskData.message.resources.diskTotal,
            diskPercent: diskData.message.resources.diskPercent,
          },
        }));
      }

    } catch (error) {
      errorLog(t('api.errors.fetchServerStatus'), error);

    } finally {
      setDiskLoading(false);
    }
  };

  const fetchCounts = async () => {
    if (!mailservers || !mailservers.length) return;
    if (!containerName) return;

    try {
      const [loginsRes, accountsRes, aliasesRes] = await Promise.all([
        getCount('logins', containerName),
        getCount('accounts', containerName),
        getCount('aliases', containerName),
      ]);

      setServerStatus(prev => ({
        ...prev,
        db: {
          logins: loginsRes.success ? loginsRes.message : prev.db.logins,
          accounts: accountsRes.success ? accountsRes.message : prev.db.accounts,
          aliases: aliasesRes.success ? aliasesRes.message : prev.db.aliases,
        },
      }));

    } catch (error) {
      errorLog(t('api.errors.fetchServerStatus'), error);

    } finally {
      setCountsLoading(false);
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
              value={Translate(getStatusText())}
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
              <div className="mt-auto">
                {!isStatusLoading && (
                  <ProgressBar now={100} variant={getStatusColor()} className="mt-2" style={{height:'20px'}} label={
                    status.resources.uptime ? <small>{t('dashboard.uptime')}: {status.resources.uptime} &mdash; load: {(status.resources.loadAverage || []).join(', ')}</small> : '\u00A0'
                  } />
                )}
              </div>
            </DashboardCard>
          </Col>
          <Col md={3} className="mb-3">
            <DashboardCard
              title="dashboard.cpuUsage"
              icon="cpu"
              iconColor={isStatusLoading ? "secondary" : "primary"}
              value={Number(status.resources.cpuUsage).toFixed(1)+'%'}
              isLoading={isStatusLoading}
            >
              <div className="mt-auto">
                {!isStatusLoading && (
                  <ProgressBar now={Number(status.resources.cpuUsage)} variant={Number(status.resources.cpuUsage) > 90 ? 'danger' : Number(status.resources.cpuUsage) > 60 ? 'warning' : 'primary'} className="mt-2" style={{height:'20px'}} />
                )}
              </div>
            </DashboardCard>
          </Col>
          <Col md={3} className="mb-3">
            <DashboardCard
              title="dashboard.memoryUsage"
              icon="memory"
              iconColor={isStatusLoading ? "secondary" : "info"}
              value={Number(status.resources.memoryUsage).toFixed(1)+'%'}
              isLoading={isStatusLoading}
            >
              <div className="mt-auto">
                {!isStatusLoading && (
                  <ProgressBar now={Number(status.resources.memoryUsage)} variant={Number(status.resources.memoryUsage) > 90 ? 'danger' : Number(status.resources.memoryUsage) > 75 ? 'warning' : 'info'} className="mt-2" style={{height:'20px'}} label={
                    <small>{formatMB(status.resources.memoryUsed)} / {formatMB(status.resources.memoryTotal)}</small>
                  } />
                )}
              </div>
            </DashboardCard>
          </Col>
          <Col md={3} className="mb-3">
            <DashboardCard
              title="dashboard.diskUsage"
              icon="hdd"
              iconColor={isDiskLoading ? "secondary" : "warning"}
              value={formatMB(status.resources.diskUsage)}
              isLoading={isDiskLoading}
            >
              <div className="mt-auto">
                {!isDiskLoading && status.resources.diskTotal > 0 && (
                  <ProgressBar now={status.resources.diskPercent} variant={status.resources.diskPercent > 90 ? 'danger' : status.resources.diskPercent > 75 ? 'warning' : 'success'} className="mt-2" style={{height:'20px'}} label={
                    <small>{formatMB(status.resources.diskUsed)} / {formatMB(status.resources.diskTotal)}</small>
                  } />
                )}
              </div>
            </DashboardCard>
          </Col>
        </Row>

        {user?.isAccount != 1 &&
        <Row>
          <Col md={4} className="mb-3">
            <DashboardCard
              title="dashboard.logins"
              icon="person-lock"
              iconColor={isCountsLoading ? "secondary" : "success"}
              isLoading={isCountsLoading}
              value={status.db.logins}
              href="/logins"
            />
          </Col>
          <Col md={4} className="mb-3">
            <DashboardCard
              title="dashboard.mailboxAccounts"
              icon="inboxes-fill"
              iconColor={isCountsLoading ? "secondary" : "success"}
              isLoading={isCountsLoading}
              value={status.db.accounts}
              href="/accounts"
            />
          </Col>
          <Col md={4} className="mb-3">
            <DashboardCard
              title="dashboard.aliases"
              icon="arrow-left-right"
              iconColor={isCountsLoading ? "secondary" : "success"}
              isLoading={isCountsLoading}
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
                    <td className="text-muted fw-bold" style={{width:'120px'}}>{t('mailSetup.username')}</td>
                    <td><code>{user.mailbox || t('dashboard.user.yourEmail')}</code></td>
                  </tr>
                  <tr><td colSpan="2" className="border-0">&nbsp;</td></tr>
                  <tr>
                    <td className="text-muted fw-bold">IMAP {t('mailSetup.server')}</td>
                    <td><code>{userSettings.IMAP_HOST}</code></td>
                  </tr>
                  <tr>
                    <td className="text-muted fw-bold">{t('mailSetup.port')}</td>
                    <td><code>{userSettings.IMAP_PORT || '993'}</code> (SSL/TLS)</td>
                  </tr>
                  <tr><td colSpan="2" className="border-0">&nbsp;</td></tr>
                  <tr>
                    <td className="text-muted fw-bold">SMTP {t('mailSetup.server')}</td>
                    <td><code>{userSettings.SMTP_HOST}</code></td>
                  </tr>
                  <tr>
                    <td className="text-muted fw-bold">{t('mailSetup.port')}</td>
                    <td><code>{userSettings.SMTP_PORT || '587'}</code> (STARTTLS)</td>
                  </tr>
                  {userSettings.POP3_HOST && (<>
                    <tr><td colSpan="2" className="border-0">&nbsp;</td></tr>
                    <tr>
                      <td className="text-muted fw-bold">POP3 {t('mailSetup.server')}</td>
                      <td><code>{userSettings.POP3_HOST}</code></td>
                    </tr>
                    <tr>
                      <td className="text-muted fw-bold">{t('mailSetup.port')}</td>
                      <td><code>{userSettings.POP3_PORT || '995'}</code> (SSL/TLS)</td>
                    </tr>
                  </>)}
                  {userSettings.WEBMAIL_URL && (<>
                    <tr><td colSpan="2" className="border-0">&nbsp;</td></tr>
                    <tr>
                      <td className="text-muted fw-bold">Webmail</td>
                      <td><a href={userSettings.WEBMAIL_URL} target="_blank" rel="noopener noreferrer"><code>{userSettings.WEBMAIL_URL}</code></a></td>
                    </tr>
                  </>)}
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
