import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Row, Col, Badge, ProgressBar, Table, Form } from 'react-bootstrap';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getRspamdStats, getRspamdCounters } from '../services/api.mjs';

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
  const [rspamdUrl, setRspamdUrl] = useLocalStorage('rspamdUrl', '');
  const [urlInput, setUrlInput] = useState(rspamdUrl || '');
  const [stat, setStat] = useState(null);
  const [counters, setCounters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    if (!containerName) return;
    setLoading(true);
    setError(null);
    try {
      const [statResult, countersResult] = await Promise.all([
        getRspamdStats(containerName),
        getRspamdCounters(containerName),
      ]);
      if (statResult.success) setStat(statResult.message);
      else setError(statResult.error);
      if (countersResult.success) setCounters(countersResult.message || []);
    } catch (err) {
      setError('Failed to fetch rspamd data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [containerName]);

  const handleSaveUrl = (e) => {
    e.preventDefault();
    setRspamdUrl(urlInput.trim());
  };

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
          {rspamdUrl ? (
            <>
              <Button
                variant="outline-primary"
                icon="box-arrow-up-right"
                text="rspamd.openExternal"
                onClick={() => window.open(rspamdUrl, '_blank')}
              />
              <Button
                variant="outline-secondary"
                icon="x-circle"
                text="rspamd.clearUrl"
                onClick={() => { setRspamdUrl(''); setUrlInput(''); }}
              />
            </>
          ) : (
            <Form onSubmit={handleSaveUrl} className="d-flex gap-2 align-items-center flex-grow-1" style={{maxWidth: '500px'}}>
              <Form.Control
                type="url"
                size="sm"
                placeholder="https://rspamd.example.com"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                required
              />
              <Button type="submit" variant="outline-primary" size="sm" text="rspamd.saveUrl" />
            </Form>
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

      {/* Top symbols */}
      {counters.length > 0 && (
        <Card title="rspamd.topSymbols">
          <Table size="sm" striped hover responsive>
            <thead>
              <tr>
                <th>{Translate('rspamd.symbol')}</th>
                <th>{Translate('rspamd.frequency')}</th>
                <th>{Translate('rspamd.weight')}</th>
                <th>{Translate('rspamd.hits')}</th>
                <th>{Translate('rspamd.time')}</th>
              </tr>
            </thead>
            <tbody>
              {counters.map((c, i) => (
                <tr key={i}>
                  <td><code>{c.symbol}</code></td>
                  <td>{c.frequency > 0 ? `${(c.frequency * 100).toFixed(1)}%` : '—'}</td>
                  <td>
                    <span className={c.weight > 0 ? 'text-danger' : c.weight < 0 ? 'text-success' : ''}>
                      {c.weight?.toFixed(2)}
                    </span>
                  </td>
                  <td>{c.hits?.toLocaleString()}</td>
                  <td>{c.time?.toFixed(3)}s</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
};

export default Rspamd;
