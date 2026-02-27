import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Row, Col, Badge, ProgressBar, Spinner, Table } from 'react-bootstrap';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getRspamdStats, getRspamdCounters, getRspamdBayesUsers, getRspamdHistory, rspamdLearnMessage } from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  Card,
  LoadingSpinner,
  Translate,
} from '../components/index.jsx';


const formatUptime = (seconds) => {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
};

const pct = (n, total) => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';


const Rspamd = () => {
  const { t } = useTranslation();
  const [containerName] = useLocalStorage('containerName', '');
  const [rspamdUrl] = useLocalStorage('rspamdUrl', '');
  const [adminRspamdUrl, setAdminRspamdUrl] = useState('');
  const [stat, setStat] = useState(null);
  const [counters, setCounters] = useState([]);
  const [bayesUsers, setBayesUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // History & Bayes training state
  const [historyData, setHistoryData] = useState([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [learnedMap, setLearnedMap] = useState({});
  const [learningIds, setLearningIds] = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [thresholds, setThresholds] = useState({});
  const HISTORY_PAGE_SIZE = 50;

  const fetchData = useCallback(async () => {
    if (!containerName) return;
    setLoading(true);
    setError(null);
    try {
      const [statResult, countersResult, bayesUsersResult] = await Promise.all([
        getRspamdStats(containerName),
        getRspamdCounters(containerName),
        getRspamdBayesUsers(containerName),
      ]);
      if (statResult.success) setStat(statResult.message);
      else setError(statResult.error);
      if (countersResult.success) setCounters(countersResult.message || []);
      if (bayesUsersResult.success) setBayesUsers(bayesUsersResult.message || []);

      // Use admin-configured RSPAMD_URL if available (from user-experience PR)
      try {
        const api = await import('../services/api.mjs');
        if (typeof api.getUserSettings === 'function') {
          const settings = await api.getUserSettings(containerName);
          if (settings.success && settings.message?.RSPAMD_URL) setAdminRspamdUrl(settings.message.RSPAMD_URL);
        }
      } catch (e) { /* getUserSettings not available */ }
    } catch (err) {
      setError('Failed to fetch rspamd data');
    } finally {
      setLoading(false);
    }
  }, [containerName]);

  const fetchHistory = useCallback(async () => {
    if (!containerName) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await getRspamdHistory(containerName);
      if (result.success) {
        setHistoryData(result.message.rows || []);
        setLearnedMap(result.message.learnedMap || {});
        setThresholds(result.message.thresholds || {});
        setHistoryPage(0);
      } else {
        setHistoryError(result.error);
      }
    } catch (err) {
      setHistoryError('Failed to fetch history');
    } finally {
      setHistoryLoading(false);
    }
  }, [containerName]);

  const handleLearn = async (messageId, action) => {
    setLearningIds(prev => ({ ...prev, [messageId]: action }));
    try {
      const result = await rspamdLearnMessage(containerName, messageId, action);
      if (result.success) {
        setLearnedMap(prev => ({ ...prev, [messageId]: action }));
      } else {
        alert(result.error || 'Learn failed');
      }
    } catch (err) {
      alert(err.message || 'Learn failed');
    } finally {
      setLearningIds(prev => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    }
  };

  const externalUrl = adminRspamdUrl || rspamdUrl;

  useEffect(() => { fetchData(); }, [containerName]);

  if (loading) return <LoadingSpinner />;
  if (error) return <Card title="rspamd.title"><AlertMessage type="danger" message={error} /></Card>;
  if (!stat) return <Card title="rspamd.title"><AlertMessage type="warning" message="rspamd.noData" /></Card>;

  const scanned = stat.scanned || 0;
  const ham = stat.actions?.['no action'] || 0;
  const addHeader = stat.actions?.['add header'] || 0;
  const greylist = stat.actions?.greylist || 0;
  const reject = stat.actions?.reject || 0;
  const softReject = stat.actions?.['soft reject'] || 0;
  const rewrite = (stat.actions?.['rewrite subject'] || 0) + (stat.actions?.['rewrite header'] || 0);
  const spamTotal = addHeader + greylist + reject + softReject + rewrite;

  const bayesHam = stat.statfiles?.find(s => s.symbol === 'BAYES_HAM');
  const bayesSpam = stat.statfiles?.find(s => s.symbol === 'BAYES_SPAM');

  return (
    <>
      <Card title="rspamd.title">
        <div className="mb-3 d-flex gap-2 flex-wrap align-items-center">
          <Button
            variant="outline-primary"
            icon="arrow-clockwise"
            text="common.refresh"
            onClick={fetchData}
          />
          {externalUrl && (
            <Button
              variant="outline-primary"
              icon="box-arrow-up-right"
              text="rspamd.openExternal"
              onClick={() => window.open(externalUrl, '_blank')}
            />
          )}
        </div>

        {/* Overview */}
        <Row className="mb-4">
          <Col md={3}>
            <div className="border rounded p-3 text-center">
              <div className="text-muted small">{Translate('rspamd.version')}</div>
              <div className="fw-bold fs-5">{stat.version || '—'}</div>
            </div>
          </Col>
          <Col md={3}>
            <div className="border rounded p-3 text-center">
              <div className="text-muted small">{Translate('rspamd.uptime')}</div>
              <div className="fw-bold fs-5">{formatUptime(stat.uptime)}</div>
            </div>
          </Col>
          <Col md={3}>
            <div className="border rounded p-3 text-center">
              <div className="text-muted small">{Translate('rspamd.scanned')}</div>
              <div className="fw-bold fs-5">{scanned.toLocaleString()}</div>
            </div>
          </Col>
          <Col md={3}>
            <div className="border rounded p-3 text-center">
              <div className="text-muted small">{Translate('rspamd.scanTime')}</div>
              <div className="fw-bold fs-5">
                {stat.scan_times?.length ? `${(stat.scan_times.reduce((a, b) => a + b, 0) / stat.scan_times.length).toFixed(3)}s` : '—'}
              </div>
            </div>
          </Col>
        </Row>

        {/* Actions breakdown */}
        <h6 className="mb-2">{Translate('rspamd.actions')}</h6>
        {scanned > 0 && (
          <ProgressBar className="mb-2" style={{height: '24px'}}>
            <ProgressBar variant="success" now={pct(ham, scanned)} key="ham" label={`${t('rspamd.ham')} ${pct(ham, scanned)}%`} />
            <ProgressBar variant="warning" now={pct(addHeader, scanned)} key="header" label={addHeader > 0 ? `${t('rspamd.addHeader')} ${pct(addHeader, scanned)}%` : ''} />
            <ProgressBar variant="info" now={pct(greylist, scanned)} key="grey" label={greylist > 0 ? `${t('rspamd.greylist')} ${pct(greylist, scanned)}%` : ''} />
            <ProgressBar variant="danger" now={pct(reject, scanned)} key="reject" label={reject > 0 ? `${t('rspamd.reject')} ${pct(reject, scanned)}%` : ''} />
          </ProgressBar>
        )}
        <Row className="mb-4">
          <Col>
            <Badge bg="success" className="me-2">{Translate('rspamd.ham')}: {ham}</Badge>
            <Badge bg="warning" text="dark" className="me-2">{Translate('rspamd.addHeader')}: {addHeader}</Badge>
            <Badge bg="info" className="me-2">{Translate('rspamd.greylist')}: {greylist}</Badge>
            <Badge bg="danger" className="me-2">{Translate('rspamd.reject')}: {reject}</Badge>
            {softReject > 0 && <Badge bg="secondary" className="me-2">Soft reject: {softReject}</Badge>}
            {rewrite > 0 && <Badge bg="dark" className="me-2">Rewrite: {rewrite}</Badge>}
          </Col>
        </Row>

        {/* Bayes learning */}
        <Row className="mb-4">
          <Col md={6}>
            <h6>{Translate('rspamd.bayesLearning')}</h6>
            <Table size="sm" bordered>
              <thead>
                <tr>
                  <th>{Translate('rspamd.classifier')}</th>
                  <th>{Translate('rspamd.learned')}</th>
                  <th>{Translate('rspamd.users')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><Badge bg="success">HAM</Badge></td>
                  <td>{bayesHam?.revision || 0}</td>
                  <td>{bayesHam?.users || 0}</td>
                </tr>
                <tr>
                  <td><Badge bg="danger">SPAM</Badge></td>
                  <td>{bayesSpam?.revision || 0}</td>
                  <td>{bayesSpam?.users || 0}</td>
                </tr>
              </tbody>
            </Table>
          </Col>
          <Col md={6}>
            <h6>{Translate('rspamd.resources')}</h6>
            <Table size="sm" bordered>
              <tbody>
                <tr>
                  <td className="text-muted">{Translate('rspamd.memory')}</td>
                  <td>{formatBytes(stat.bytes_allocated)}</td>
                </tr>
                <tr>
                  <td className="text-muted">{Translate('rspamd.fuzzyHashes')}</td>
                  <td>{(stat.fuzzy_hashes?.local || 0).toLocaleString()}</td>
                </tr>
                <tr>
                  <td className="text-muted">{Translate('rspamd.totalLearned')}</td>
                  <td>{(stat.learned || 0).toLocaleString()}</td>
                </tr>
              </tbody>
            </Table>
          </Col>
        </Row>
      </Card>

      {/* Per-user Bayes stats */}
      {bayesUsers.length > 0 && (
        <Card title="rspamd.bayesUsers.title">
          <Table size="sm" striped hover responsive>
            <thead>
              <tr>
                <th>{Translate('rspamd.bayesUsers.user')}</th>
                <th className="text-end">{Translate('rspamd.bayesUsers.ham')}</th>
                <th className="text-end">{Translate('rspamd.bayesUsers.spam')}</th>
                <th className="text-end">{Translate('rspamd.bayesUsers.total')}</th>
              </tr>
            </thead>
            <tbody>
              {bayesUsers.map((u, i) => (
                <tr key={i}>
                  <td><code>{u.user}</code></td>
                  <td className="text-end">
                    <Badge bg="success">{u.ham}</Badge>
                  </td>
                  <td className="text-end">
                    <Badge bg="danger">{u.spam}</Badge>
                  </td>
                  <td className="text-end">{u.ham + u.spam}</td>
                </tr>
              ))}
              {bayesUsers.length > 1 && (
                <tr className="fw-bold">
                  <td>{Translate('rspamd.bayesUsers.total')}</td>
                  <td className="text-end">
                    <Badge bg="success">{bayesUsers.reduce((s, u) => s + u.ham, 0)}</Badge>
                  </td>
                  <td className="text-end">
                    <Badge bg="danger">{bayesUsers.reduce((s, u) => s + u.spam, 0)}</Badge>
                  </td>
                  <td className="text-end">{bayesUsers.reduce((s, u) => s + u.ham + u.spam, 0)}</td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Top symbols by score impact */}
      {counters.length > 0 && (
        <Card title="rspamd.topSymbols">
          <Table size="sm" striped hover responsive>
            <thead>
              <tr>
                <th>{Translate('rspamd.symbol')}</th>
                <th className="text-end">{Translate('rspamd.avgScore')}</th>
                <th className="text-end">{Translate('rspamd.hits')}</th>
                <th className="text-end">{Translate('rspamd.frequency')}</th>
              </tr>
            </thead>
            <tbody>
              {counters.map((c, i) => (
                <tr key={i}>
                  <td>
                    <code>{c.symbol}</code>
                    {c.direction && <Badge bg="secondary" className="ms-1" style={{fontSize: '0.7em'}}>{c.direction}</Badge>}
                  </td>
                  <td className="text-end">
                    <Badge bg={c.avgScore > 0 ? 'danger' : 'success'}>
                      {c.avgScore > 0 ? '+' : ''}{c.avgScore?.toFixed(2)}
                    </Badge>
                  </td>
                  <td className="text-end">{c.hits?.toLocaleString()}</td>
                  <td className="text-end">{c.frequency > 0 ? `${(c.frequency * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Message History & Bayes Training */}
      <Card title="rspamd.history.title">
        <div className="mb-3 d-flex gap-2 flex-wrap align-items-center">
          <Button
            variant="outline-primary"
            icon="arrow-clockwise"
            text={historyData.length ? 'common.refresh' : 'rspamd.history.title'}
            onClick={fetchHistory}
          />
          {historyData.length > 0 && (
            <span className="text-muted small">
              {t('rspamd.history.showing', {
                from: historyPage * HISTORY_PAGE_SIZE + 1,
                to: Math.min((historyPage + 1) * HISTORY_PAGE_SIZE, historyData.length),
                total: historyData.length,
              })}
            </span>
          )}
        </div>

        {historyLoading && <LoadingSpinner />}
        {historyError && <AlertMessage type="danger" message={historyError} />}

        {!historyLoading && historyData.length > 0 && (() => {
          const totalPages = Math.ceil(historyData.length / HISTORY_PAGE_SIZE);
          const pageRows = historyData.slice(
            historyPage * HISTORY_PAGE_SIZE,
            (historyPage + 1) * HISTORY_PAGE_SIZE
          );

          return (
            <>
              <Table size="sm" striped hover responsive>
                <thead>
                  <tr>
                    <th>{Translate('rspamd.history.time')}</th>
                    <th>{Translate('rspamd.history.sender')}</th>
                    <th>{Translate('rspamd.history.recipient')}</th>
                    <th>{Translate('rspamd.history.subject')}</th>
                    <th>{Translate('rspamd.history.score')}</th>
                    <th>{Translate('rspamd.history.bayes')}</th>
                    <th>{Translate('rspamd.history.action')}</th>
                    <th>{Translate('rspamd.history.status')}</th>
                    <th>{Translate('rspamd.history.learn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => {
                    const learned = learnedMap[row.message_id];
                    const isLearning = learningIds[row.message_id];
                    const rowClass = learned === 'ham' ? 'table-success' : learned === 'spam' ? 'table-danger' : '';

                    return (
                      <tr key={`${row.message_id}-${i}`} className={rowClass}>
                        <td className="text-nowrap small">
                          {row.unix_time ? new Date(row.unix_time * 1000).toLocaleString() : '—'}
                        </td>
                        <td className="small" style={{maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={row.sender}>
                          {row.sender}
                        </td>
                        <td className="small" style={{maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={row.rcpt}>
                          {row.rcpt}
                        </td>
                        <td className="small" style={{maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={row.subject}>
                          {row.subject || '(no subject)'}
                        </td>
                        <td>
                          <Badge bg={
                            row.score < 0 ? 'success'
                            : (thresholds['add header'] && row.score >= thresholds['add header']) ? 'danger'
                            : 'warning'
                          } text={
                            row.score >= 0 && !(thresholds['add header'] && row.score >= thresholds['add header']) ? 'dark' : undefined
                          }>
                            {row.score?.toFixed(1)}
                          </Badge>
                        </td>
                        <td className="small text-nowrap">
                          {row.bayes != null ? (
                            <Badge bg={row.bayes > 0 ? 'danger' : row.bayes < 0 ? 'success' : 'secondary'} text={row.bayes === 0 ? 'light' : undefined}>
                              {row.bayes > 0 ? '+' : ''}{row.bayes?.toFixed(1)}
                            </Badge>
                          ) : '—'}
                        </td>
                        <td className="small">
                          <Badge bg={
                            row.action === 'reject' ? 'danger'
                            : row.action === 'add header' || row.action === 'rewrite subject' ? 'warning'
                            : row.action === 'greylist' ? 'info'
                            : row.action === 'no action' ? 'success'
                            : 'secondary'
                          } text={
                            (row.action === 'add header' || row.action === 'rewrite subject') ? 'dark' : undefined
                          }>
                            {row.action}
                          </Badge>
                        </td>
                        <td>
                          {learned && (
                            <Badge bg={learned === 'ham' ? 'success' : 'danger'}>
                              {learned.toUpperCase()}
                            </Badge>
                          )}
                        </td>
                        <td className="text-nowrap">
                          {isLearning ? (
                            <Spinner animation="border" size="sm" />
                          ) : (
                            <>
                              <button
                                className={`btn btn-sm ${learned === 'ham' ? 'btn-success' : 'btn-outline-success'} me-1`}
                                onClick={() => handleLearn(row.message_id, 'ham')}
                                title={t('rspamd.history.learnHam')}
                                disabled={!row.message_id}
                              >
                                <i className="bi bi-hand-thumbs-up"></i>
                              </button>
                              <button
                                className={`btn btn-sm ${learned === 'spam' ? 'btn-danger' : 'btn-outline-danger'}`}
                                onClick={() => handleLearn(row.message_id, 'spam')}
                                title={t('rspamd.history.learnSpam')}
                                disabled={!row.message_id}
                              >
                                <i className="bi bi-hand-thumbs-down"></i>
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="d-flex justify-content-between align-items-center">
                  <Button
                    variant="outline-secondary"
                    text="rspamd.history.prev"
                    onClick={() => setHistoryPage(p => Math.max(0, p - 1))}
                    disabled={historyPage === 0}
                  />
                  <span className="text-muted small">
                    {t('rspamd.history.page', { page: historyPage + 1, total: totalPages })}
                  </span>
                  <Button
                    variant="outline-secondary"
                    text="rspamd.history.next"
                    onClick={() => setHistoryPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={historyPage >= totalPages - 1}
                  />
                </div>
              )}
            </>
          );
        })()}
      </Card>
    </>
  );
};

export default Rspamd;
