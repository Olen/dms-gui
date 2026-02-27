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


// Syntax coloring rules for log lines
const colorRules = [
  // Timestamps: ISO 8601 (mail.log) and rspamd-style
  { pattern: /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[\d.+:\-Z]*)/,  color: '#6A9955' },
  // Syslog hostname
  { pattern: /^(?:\S+\s+)(mail)\b/,                                      color: '#569cd6' },
  // Service names: postfix/*, dovecot*, fetchmail, opendkim, rspamd*
  { pattern: /\b(postfix\/\w+|dovecot(?::\s*\w[\w-]*)?|fetchmail|opendkim|rspamd(?:_\w+)?)\b/i, color: '#4EC9B0' },
  // Session/process IDs: [12345], <hex>, (hex)
  { pattern: /(\[\d+\]|<[A-Fa-f0-9+/]+>)/g,                             color: '#C586C0' },
  // Email addresses
  { pattern: /<?(\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)>?/g, color: '#DCDCAA' },
  // IP addresses (v4)
  { pattern: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,              color: '#9CDCFE' },
  // Error/warning keywords
  { pattern: /\b(error|warning|fatal|panic|reject|refused|failed|mismatch|timeout|timed out|auth failed)\b/gi, color: '#F44747' },
  // Success/info keywords
  { pattern: /\b(Login|connect(?:ed)?|delivered|PASS OLD|PASS NEW|accepted|stored)\b/gi, color: '#B5CEA8' },
  // Disconnect/close (neutral-warning)
  { pattern: /\b(Disconnect(?:ed)?|Connection closed|removed)\b/gi,      color: '#CE9178' },
];

const colorizeLine = (line) => {
  // Build a list of colored spans from the line
  // Use a simple approach: find all matches, sort by position, render segments
  const segments = [];
  const used = new Array(line.length).fill(false);

  for (const rule of colorRules) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g');
    let match;
    while ((match = regex.exec(line)) !== null) {
      // Use the first capture group if available, otherwise the full match
      const text = match[1] || match[0];
      const start = match.index + (match[1] ? match[0].indexOf(match[1]) : 0);
      const end = start + text.length;

      // Skip if this region overlaps with an earlier-matched rule
      let overlap = false;
      for (let k = start; k < end; k++) {
        if (used[k]) { overlap = true; break; }
      }
      if (overlap) continue;

      for (let k = start; k < end; k++) used[k] = true;
      segments.push({ start, end, text, color: rule.color });
    }
  }

  if (segments.length === 0) return line;

  segments.sort((a, b) => a.start - b.start);

  const parts = [];
  let cursor = 0;
  for (const seg of segments) {
    if (seg.start > cursor) {
      parts.push(<span key={`t${cursor}`}>{line.slice(cursor, seg.start)}</span>);
    }
    parts.push(<span key={`c${seg.start}`} style={{ color: seg.color }}>{seg.text}</span>);
    cursor = seg.end;
  }
  if (cursor < line.length) {
    parts.push(<span key={`t${cursor}`}>{line.slice(cursor)}</span>);
  }

  return parts;
};


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
                    // Highlight matching text over syntax coloring
                    const regex = new RegExp(`(${filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                    const parts = line.split(regex);
                    return (
                      <div key={i}>
                        {parts.map((part, j) =>
                          regex.test(part) ? (
                            <mark key={j} style={{ backgroundColor: '#ffc107', color: '#000', padding: 0 }}>{part}</mark>
                          ) : (
                            <span key={j}>{colorizeLine(part)}</span>
                          )
                        )}
                      </div>
                    );
                  }
                  return <div key={i}>{colorizeLine(line)}</div>;
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
