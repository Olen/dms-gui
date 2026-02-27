import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Form, InputGroup } from 'react-bootstrap';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getMailLogs, getServerEnvs } from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  LoadingSpinner,
  Translate,
} from '../components/index.jsx';


const Logs = () => {
  const { t } = useTranslation();
  const [containerName] = useLocalStorage('containerName', '');

  const [logLines, setLogLines] = useState([]);
  const [source, setSource] = useState('mail');
  const [lines, setLines] = useState(100);
  const [filter, setFilter] = useState('');
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [enableRspamd, setEnableRspamd] = useState(false);
  const logEndRef = useRef(null);

  // Check if rspamd is enabled
  useEffect(() => {
    if (!containerName) return;
    const cached = sessionStorage.getItem(`rspamd_enabled_${containerName}`);
    if (cached !== null) {
      setEnableRspamd(cached === '1');
      return;
    }
    getServerEnvs('mailserver', containerName, false, 'ENABLE_RSPAMD')
      .then(result => {
        const enabled = result.success && (result.message === '1' || result.message === 1);
        setEnableRspamd(enabled);
        sessionStorage.setItem(`rspamd_enabled_${containerName}`, enabled ? '1' : '0');
      })
      .catch(() => setEnableRspamd(false));
  }, [containerName]);

  const fetchLogs = async () => {
    if (!containerName) return;
    try {
      setLoading(true);
      setErrorMessage(null);
      const result = await getMailLogs(containerName, source, lines);
      if (result.success) {
        setLogLines(result.message || []);
      } else {
        setErrorMessage(result?.error);
      }
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [containerName, source, lines]);

  // Auto-scroll to bottom when logs load
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logLines]);

  const filteredLines = filter
    ? logLines.filter(line => line.toLowerCase().includes(filter.toLowerCase()))
    : logLines;

  const sources = [
    { value: 'mail', label: t('logs.sourceMail') },
  ];
  if (enableRspamd) {
    sources.push({ value: 'rspamd', label: t('logs.sourceRspamd') });
  }

  return (
    <div>
      <h2 className="mb-4">{Translate('logs.title')} {t('common.for', { what: containerName })}</h2>

      <AlertMessage type="danger" message={errorMessage} />

      <div className="d-flex flex-wrap gap-3 mb-3 align-items-end">
        <Form.Group style={{ minWidth: '150px' }}>
          <Form.Label className="small mb-1">{t('logs.source')}</Form.Label>
          <Form.Select size="sm" value={source} onChange={(e) => setSource(e.target.value)}>
            {sources.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Form.Select>
        </Form.Group>

        <Form.Group style={{ minWidth: '100px' }}>
          <Form.Label className="small mb-1">{t('logs.lines')}</Form.Label>
          <Form.Select size="sm" value={lines} onChange={(e) => setLines(Number(e.target.value))}>
            {[50, 100, 200, 500].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Form.Select>
        </Form.Group>

        <Form.Group style={{ minWidth: '200px', flex: 1 }}>
          <Form.Label className="small mb-1">{t('logs.filter')}</Form.Label>
          <InputGroup size="sm">
            <Form.Control
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('logs.filterPlaceholder')}
            />
            {filter && (
              <Button
                variant="outline-secondary"
                size="sm"
                icon="x"
                onClick={() => setFilter('')}
              />
            )}
          </InputGroup>
        </Form.Group>

        <div>
          <Button
            variant="primary"
            size="sm"
            icon="arrow-clockwise"
            text="common.refresh"
            onClick={fetchLogs}
          />
        </div>
      </div>

      {filter && (
        <small className="text-muted mb-2 d-block">
          {filteredLines.length} / {logLines.length} {t('logs.lines').toLowerCase()}
        </small>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div
          style={{
            maxHeight: '70vh',
            overflowY: 'auto',
            backgroundColor: '#1e1e1e',
            color: '#d4d4d4',
            borderRadius: '4px',
            padding: '12px',
          }}
        >
          <pre style={{ margin: 0, fontSize: '0.8rem', lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {filteredLines.length > 0
              ? filteredLines.map((line, i) => {
                  if (filter) {
                    // Highlight matching text
                    const regex = new RegExp(`(${filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                    const parts = line.split(regex);
                    return (
                      <div key={i}>
                        {parts.map((part, j) =>
                          regex.test(part) ? (
                            <mark key={j} style={{ backgroundColor: '#ffc107', color: '#000', padding: 0 }}>{part}</mark>
                          ) : (
                            <span key={j}>{part}</span>
                          )
                        )}
                      </div>
                    );
                  }
                  return <div key={i}>{line}</div>;
                })
              : t('logs.noLogs')
            }
            <div ref={logEndRef} />
          </pre>
        </div>
      )}
    </div>
  );
};

export default Logs;
