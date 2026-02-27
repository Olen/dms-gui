import React, { useState, useEffect } from 'react';
import { Badge, Modal, Form, Table } from 'react-bootstrap';
import { Trans, useTranslation } from 'react-i18next';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getDomains, getDnsLookup, generateDkim, getDkimSelector, getDnsblCheck, updateDomain, getConfigs, getSettings, pushDnsRecord } from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  Card,
  DataTable,
  LoadingSpinner,
  Translate,
} from '../components/index.jsx';

const i18nHtmlComponents = { strong: <strong />, i: <i />, br: <br />, a: <a />, pre: <pre /> };
const RECOMMENDED_KEYTYPE = 'rsa';
const RECOMMENDED_KEYSIZE = '2048';
const TLSA_USAGE = { 0: 'PKIX-TA', 1: 'PKIX-EE', 2: 'DANE-TA', 3: 'DANE-EE' };
const TLSA_SELECTOR = { 0: 'Full cert', 1: 'SubjectPublicKeyInfo' };
const TLSA_MATCH = { 0: 'Exact', 1: 'SHA-256', 2: 'SHA-512' };


const Domains = () => {
  const { t } = useTranslation();
  const [containerName] = useLocalStorage('containerName', '');
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dnsResults, setDnsResults] = useState({});
  const [dnsErrors, setDnsErrors] = useState({});
  const [dnsLoading, setDnsLoading] = useState({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalDomain, setModalDomain] = useState(null);

  // DKIM generation state
  const [showDkimModal, setShowDkimModal] = useState(false);
  const [dkimDomain, setDkimDomain] = useState(null);
  const [dkimKeytype, setDkimKeytype] = useState('rsa');
  const [dkimKeysize, setDkimKeysize] = useState('2048');
  const [dkimSelector, setDkimSelector] = useState('mail');
  const [dkimForce, setDkimForce] = useState(false);
  const [dkimLoading, setDkimLoading] = useState(false);
  const [dkimResult, setDkimResult] = useState(null);
  const [dkimError, setDkimError] = useState(null);

  // DNSBL state
  const [dnsblResults, setDnsblResults] = useState({});
  const [dnsblErrors, setDnsblErrors] = useState({});
  const [dnsblLoading, setDnsblLoading] = useState({});
  const [checkingAllDnsbl, setCheckingAllDnsbl] = useState(false);
  const [showDnsblModal, setShowDnsblModal] = useState(false);
  const [dnsblModalDomain, setDnsblModalDomain] = useState(null);

  // Generated DKIM records (persisted across modal close, keyed by domain)
  const [generatedDkimRecords, setGeneratedDkimRecords] = useState({});


  // DNS provider state
  const [dnsProviders, setDnsProviders] = useState([]);
  const [providerSaving, setProviderSaving] = useState({});

  // DKIM selector from DMS rspamd config
  const [configDkimSelector, setConfigDkimSelector] = useState('mail');

  // DNS record editing state
  const [editingSection, setEditingSection] = useState(null); // 'spf' | 'dmarc'
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editSuccess, setEditSuccess] = useState(null);
  const [spfAllMode, setSpfAllMode] = useState('~all');
  const [dmarcPolicy, setDmarcPolicy] = useState('none');
  const [dmarcRua, setDmarcRua] = useState('');
  const [dmarcRuf, setDmarcRuf] = useState('');
  const [dkimPushing, setDkimPushing] = useState(false);
  const [dkimPushResult, setDkimPushResult] = useState(null);

  useEffect(() => {
    if (!containerName) {
      setLoading(false);
      return;
    }
    fetchDomains();
    // Fetch DKIM selector from DMS rspamd config
    getDkimSelector(containerName)
      .then(result => { if (result.selector) setConfigDkimSelector(result.selector); })
      .catch(() => {});
    // Fetch saved DNS provider profiles from settings (configured in Settings > DNS Providers)
    getSettings('dnscontrol', containerName, undefined, true, 'dnscontrol')
      .then(result => {
        if (result.success && result.message) {
          const items = Array.isArray(result.message) ? result.message : [];
          const providers = items.map(p => p.name).filter(Boolean);
          if (providers.length) {
            setDnsProviders(providers);
            return;
          }
        }
        // No saved profiles — fall back to template names
        return getConfigs('dnscontrol').then(r => {
          if (r.success && r.message) {
            setDnsProviders(r.message.map(p => p.name).filter(Boolean));
          }
        });
      })
      .catch(() => {});
  }, [containerName]);

  const fetchDomains = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getDomains(containerName);
      if (result.success) {
        const domainList = result.message || [];
        setDomains(domainList);
        setLoading(false);
        // Fire DNS checks async per-row (don't block table rendering)
        for (const d of domainList) {
          checkDns(d.domain);
        }
      } else {
        setError(result.error || 'api.errors.fetchDomains');
        setLoading(false);
      }
    } catch (err) {
      setError('api.errors.fetchDomains');
      setLoading(false);
    }
  };

  const handleProviderChange = async (domain, provider) => {
    setProviderSaving(prev => ({ ...prev, [domain]: true }));
    try {
      const result = await updateDomain(containerName, domain, { dnsProvider: provider || null });
      if (result.success) {
        setDomains(prev => prev.map(d => d.domain === domain ? { ...d, dnsProvider: provider || null } : d));
      }
    } catch (err) {
      // silently fail
    } finally {
      setProviderSaving(prev => ({ ...prev, [domain]: false }));
    }
  };

  const checkDns = async (domain) => {
    setDnsLoading(prev => ({ ...prev, [domain]: true }));
    setDnsErrors(prev => ({ ...prev, [domain]: null }));
    try {
      const result = await getDnsLookup(containerName, domain);
      if (result.success) {
        setDnsResults(prev => ({ ...prev, [domain]: result.message }));
      } else {
        setDnsErrors(prev => ({ ...prev, [domain]: true }));
      }
    } catch (err) {
      setDnsErrors(prev => ({ ...prev, [domain]: true }));
    } finally {
      setDnsLoading(prev => ({ ...prev, [domain]: false }));
    }
  };

  const checkAllDns = async () => {
    setCheckingAll(true);
    for (const d of domains) {
      await checkDns(d.domain);
    }
    setCheckingAll(false);
  };

  const checkDnsbl = async (domain) => {
    setDnsblLoading(prev => ({ ...prev, [domain]: true }));
    setDnsblErrors(prev => ({ ...prev, [domain]: null }));
    try {
      const result = await getDnsblCheck(containerName, domain);
      if (result.success) {
        setDnsblResults(prev => ({ ...prev, [domain]: result.message }));
      } else {
        setDnsblErrors(prev => ({ ...prev, [domain]: true }));
      }
    } catch (err) {
      setDnsblErrors(prev => ({ ...prev, [domain]: true }));
    } finally {
      setDnsblLoading(prev => ({ ...prev, [domain]: false }));
    }
  };

  const checkAllDnsbl = async () => {
    setCheckingAllDnsbl(true);
    for (const d of domains) {
      await checkDnsbl(d.domain);
    }
    setCheckingAllDnsbl(false);
  };

  const showDetails = (domain) => {
    setModalDomain(domain);
    setEditingSection(null);
    setEditError(null);
    setEditSuccess(null);
    setDkimPushResult(null);
    setShowModal(true);
  };

  const showDnsblDetails = (domain) => {
    setDnsblModalDomain(domain);
    setShowDnsblModal(true);
  };

  const openDkimModal = (domain) => {
    const domainData = domains.find(d => d.domain === domain);
    setDkimDomain(domain);
    setDkimKeytype(RECOMMENDED_KEYTYPE);
    setDkimKeysize(RECOMMENDED_KEYSIZE);
    setDkimSelector(domainData?.dkim || configDkimSelector);
    setDkimForce(false);
    setDkimResult(null);
    setDkimError(null);
    setShowDkimModal(true);
  };

  const handleGenerateDkim = async () => {
    const domain = dkimDomain;
    setDkimLoading(true);
    setDkimError(null);
    setDkimResult(null);
    try {
      const result = await generateDkim(containerName, domain, {
        keytype: dkimKeytype,
        keysize: dkimKeysize,
        selector: dkimSelector,
        force: dkimForce,
      });
      if (result.success) {
        setDkimResult(result.message);
        // Store generated record for later access
        if (result.message?.dnsRecord) {
          setGeneratedDkimRecords(prev => ({ ...prev, [domain]: {
            record: result.message.dnsRecord,
            selector: result.message.selector,
            domain: domain,
          }}));
        }
        // Refresh DNS and domains list in background
        checkDns(domain);
        getDomains(containerName).then(r => {
          if (r.success) setDomains(r.message || []);
        }).catch(() => {});
      } else {
        setDkimError(result.error || 'domains.dkimError');
      }
    } catch (err) {
      setDkimError('domains.dkimError');
    } finally {
      setDkimLoading(false);
    }
  };

  const spfGrade = (spf) => {
    if (!spf) return 'danger';
    if (/-all\s*$/.test(spf)) return 'success';
    if (/~all\s*$/.test(spf)) return 'warning';
    return 'danger'; // ?all, +all, or missing mechanism
  };

  const dmarcGrade = (dmarc) => {
    if (!dmarc) return 'danger';
    const policy = dmarc.match(/;\s*p=([^;\s]+)/i)?.[1]?.toLowerCase();
    if (policy === 'reject') return 'success';
    if (policy === 'quarantine') return 'success';
    return 'warning'; // p=none
  };

  // --- DNS record editing helpers ---

  const domainHasProvider = (domain) => !!domains.find(d => d.domain === domain)?.dnsProvider;

  const startEditSpf = (currentSpf) => {
    setEditError(null);
    setEditSuccess(null);
    if (currentSpf) {
      const match = currentSpf.match(/([~\-?+]all)\s*$/);
      setSpfAllMode(match ? match[1] : '~all');
    } else {
      setSpfAllMode('~all');
    }
    setEditingSection('spf');
  };

  const computeSpfRecord = () => {
    const currentSpf = modalDns?.spf;
    if (currentSpf) {
      return currentSpf.replace(/[~\-?+]all\s*$/, spfAllMode);
    }
    // Build a reasonable default: include mx, a, and any MX hosts
    const mechanisms = ['mx', 'a'];
    if (modalDns?.mx?.length) {
      for (const mx of modalDns.mx) {
        const host = mx.exchange?.replace(/\.$/, '');
        if (host && host !== modalDomain) {
          mechanisms.push(`include:${host}`);
        }
      }
    }
    return `v=spf1 ${mechanisms.join(' ')} ${spfAllMode}`;
  };

  const handleSaveSpf = async () => {
    setEditSaving(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      const result = await pushDnsRecord(containerName, modalDomain, {
        name: modalDomain,
        type: 'TXT',
        data: computeSpfRecord(),
      });
      if (result.success) {
        setEditSuccess('domains.dnsRecordSaved');
        checkDns(modalDomain);
        setTimeout(() => setEditingSection(null), 1500);
      } else {
        setEditError(result.error || 'domains.dnsRecordError');
      }
    } catch (err) {
      setEditError(err.message || 'domains.dnsRecordError');
    } finally {
      setEditSaving(false);
    }
  };

  const startEditDmarc = (currentDmarc) => {
    setEditError(null);
    setEditSuccess(null);
    if (currentDmarc) {
      setDmarcPolicy(currentDmarc.match(/;\s*p=([^;\s]+)/i)?.[1]?.toLowerCase() || 'none');
      setDmarcRua(currentDmarc.match(/rua=mailto:([^;\s]+)/i)?.[1] || '');
      setDmarcRuf(currentDmarc.match(/ruf=mailto:([^;\s]+)/i)?.[1] || '');
    } else {
      setDmarcPolicy('none');
      setDmarcRua('');
      setDmarcRuf('');
    }
    setEditingSection('dmarc');
  };

  const computeDmarcRecord = () => {
    let record = `v=DMARC1; p=${dmarcPolicy}`;
    if (dmarcRua.trim()) record += `; rua=mailto:${dmarcRua.trim()}`;
    if (dmarcRuf.trim()) record += `; ruf=mailto:${dmarcRuf.trim()}`;
    return record;
  };

  const handleSaveDmarc = async () => {
    setEditSaving(true);
    setEditError(null);
    setEditSuccess(null);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (dmarcRua && !emailRe.test(dmarcRua.trim())) {
      setEditError('domains.invalidEmail');
      setEditSaving(false);
      return;
    }
    if (dmarcRuf && !emailRe.test(dmarcRuf.trim())) {
      setEditError('domains.invalidEmail');
      setEditSaving(false);
      return;
    }
    try {
      const result = await pushDnsRecord(containerName, modalDomain, {
        name: `_dmarc.${modalDomain}`,
        type: 'TXT',
        data: computeDmarcRecord(),
      });
      if (result.success) {
        setEditSuccess('domains.dnsRecordSaved');
        checkDns(modalDomain);
        setTimeout(() => setEditingSection(null), 1500);
      } else {
        setEditError(result.error || 'domains.dnsRecordError');
      }
    } catch (err) {
      setEditError(err.message || 'domains.dnsRecordError');
    } finally {
      setEditSaving(false);
    }
  };

  const handlePushDkim = async (domain, selector, record) => {
    setDkimPushing(true);
    setDkimPushResult(null);
    try {
      const result = await pushDnsRecord(containerName, domain, {
        name: `${selector}._domainkey.${domain}`,
        type: 'TXT',
        data: record,
      });
      setDkimPushResult(result);
      if (result.success) checkDns(domain);
    } catch (err) {
      setDkimPushResult({ success: false, error: err.message || 'domains.dkimPushError' });
    } finally {
      setDkimPushing(false);
    }
  };

  const DnsBadge = ({ label, value, grade }) => (
    <Badge bg={grade || (value ? 'success' : 'danger')} className="me-1">
      {label}
    </Badge>
  );

  const OptionalBadge = ({ label, value }) => (
    <Badge bg={value ? 'success' : 'secondary'} className="me-1">
      {label}
    </Badge>
  );

  const keytypeBadge = (type) => {
    if (!type) return 'danger';
    if (type === 'rsa') return 'success';
    if (type === 'ed25519') return 'warning';
    return 'secondary';
  };

  const keysizeBadge = (size) => {
    if (!size) return 'danger';
    const n = Number(size);
    if (n >= 2048) return 'success';
    if (n >= 1024) return 'warning';
    return 'danger';
  };

  const columns = [
    { key: 'domain', label: 'domains.domain' },
    {
      key: 'dkim', label: 'domains.dkim',
      render: (item) => item.dkim
        ? <Badge bg="secondary">{item.dkim}</Badge>
        : <Badge bg="danger">{t('domains.noDkimKey')}</Badge>,
    },
    {
      key: 'keytype', label: 'domains.keytype',
      render: (item) => item.keytype
        ? <Badge bg={keytypeBadge(item.keytype)}>{item.keytype.toUpperCase()}</Badge>
        : <Badge bg="danger">{t('domains.noDkimKey')}</Badge>,
    },
    {
      key: 'keysize', label: 'domains.keysize',
      render: (item) => item.keysize
        ? <Badge bg={keysizeBadge(item.keysize)}>{item.keysize}</Badge>
        : <Badge bg="danger">{t('domains.noDkimKey')}</Badge>,
    },
    {
      key: 'accountCount',
      label: 'domains.accounts',
      render: (item) => (
        <span title={t('domains.accounts')}>
          <i className="bi bi-person me-1" />{item.accountCount || 0}
        </span>
      ),
    },
    {
      key: 'aliasCount',
      label: 'domains.aliases',
      render: (item) => (
        <span title={t('domains.aliases')}>
          <i className="bi bi-envelope me-1" />{item.aliasCount || 0}
        </span>
      ),
    },
    {
      key: 'dnsProvider',
      label: 'domains.dnsProvider',
      noFilter: true,
      render: (item) => (
        <Form.Select
          size="sm"
          value={item.dnsProvider || ''}
          onChange={(e) => handleProviderChange(item.domain, e.target.value)}
          disabled={providerSaving[item.domain]}
          style={{ minWidth: '120px', fontSize: '0.8rem' }}
        >
          <option value="">{t('domains.noProvider')}</option>
          {dnsProviders.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Form.Select>
      ),
    },
    {
      key: 'dns',
      label: 'domains.dnsStatus',
      noSort: true,
      noFilter: true,
      render: (item) => {
        const dns = dnsResults[item.domain];
        const isLoading = dnsLoading[item.domain];
        const hasError = dnsErrors[item.domain];

        if (isLoading) return <LoadingSpinner />;

        if (hasError && !dns) {
          return (
            <div className="d-flex align-items-center gap-1">
              <Badge bg="danger"><i className="bi bi-exclamation-triangle me-1" />{t('common.error')}</Badge>
              <Button variant="outline-primary" size="sm" icon="arrow-clockwise" onClick={() => checkDns(item.domain)} />
            </div>
          );
        }

        if (!dns) {
          return (
            <Button
              variant="outline-primary"
              size="sm"
              icon="search"
              text="domains.checkDns"
              onClick={() => checkDns(item.domain)}
            />
          );
        }

        return (
          <div className="d-flex align-items-center gap-1">
            <DnsBadge label="A" value={dns.a?.length} />
            <DnsBadge label="MX" value={dns.mx?.length} />
            <DnsBadge label="SPF" value={dns.spf} grade={spfGrade(dns.spf)} />
            <DnsBadge label="DKIM" value={dns.dkim} />
            <DnsBadge label="DMARC" value={dns.dmarc} grade={dmarcGrade(dns.dmarc)} />
            <OptionalBadge label="TLSA" value={dns.tlsa?.length} />
            <OptionalBadge label="SRV" value={dns.srv?.length} />
            <Button
              variant="outline-secondary"
              size="sm"
              icon="eye"
              onClick={() => showDetails(item.domain)}
              className="ms-1"
            />
          </div>
        );
      },
    },
    {
      key: 'blacklist',
      label: 'domains.blacklist',
      noSort: true,
      noFilter: true,
      render: (item) => {
        const bl = dnsblResults[item.domain];
        const isLoading = dnsblLoading[item.domain];
        const hasError = dnsblErrors[item.domain];

        if (isLoading) return <LoadingSpinner />;

        if (hasError && !bl) {
          return (
            <div className="d-flex align-items-center gap-1">
              <Badge bg="danger"><i className="bi bi-exclamation-triangle me-1" />{t('common.error')}</Badge>
              <Button variant="outline-secondary" size="sm" icon="arrow-clockwise" onClick={() => checkDnsbl(item.domain)} />
            </div>
          );
        }

        if (!bl) {
          return (
            <Button
              variant="outline-secondary"
              size="sm"
              icon="shield-check"
              text="domains.blacklistCheck"
              onClick={() => checkDnsbl(item.domain)}
            />
          );
        }

        const listedCount = bl.results?.filter(r => r.listed).length || 0;

        return (
          <div className="d-flex align-items-center gap-1" style={{ cursor: 'pointer' }} onClick={() => showDnsblDetails(item.domain)}>
            {listedCount > 0 ? (
              <Badge bg="danger">{Translate('domains.blacklistListed')} ({listedCount})</Badge>
            ) : (
              <Badge bg="success">{Translate('domains.blacklistClean')}</Badge>
            )}
          </div>
        );
      },
    },
  ];

  if (loading) return <LoadingSpinner />;
  if (!containerName) return <Card title="domains.title"><AlertMessage type="warning" message="domains.noContainer" /></Card>;

  const modalDns = modalDomain ? dnsResults[modalDomain] : null;
  const dnsblModalData = dnsblModalDomain ? dnsblResults[dnsblModalDomain] : null;

  return (
    <>
      <Card title="domains.title">
        {error && <AlertMessage type="danger" message={error} />}

        <div className="mb-3 d-flex gap-2">
          <Button
            variant="outline-primary"
            icon="globe"
            text="domains.checkAllDns"
            onClick={checkAllDns}
            disabled={checkingAll || !domains.length}
          />
          <Button
            variant="outline-secondary"
            icon="shield-check"
            text="domains.blacklistCheck"
            onClick={checkAllDnsbl}
            disabled={checkingAllDnsbl || !domains.length}
          />
        </div>

        <DataTable
          columns={columns}
          data={domains}
          keyExtractor={(item) => item.domain}
          emptyMessage="domains.noDomains"
          isLoading={loading}
          noSort={false}
          noFilter={false}
        />
      </Card>

      {/* DNS Details Modal */}
      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{Translate('domains.dnsDetails')} — {modalDomain}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modalDns ? (
            <div>
              <h6><DnsBadge label="A" value={modalDns.a?.length} /> {Translate('domains.aRecord')}</h6>
              {modalDns.a?.length ? (
                <ul>{modalDns.a.map((r, i) => <li key={i}>{r}</li>)}</ul>
              ) : <p className="text-muted">{Translate('domains.missing')}</p>}

              <h6><DnsBadge label="MX" value={modalDns.mx?.length} /> {Translate('domains.mxRecord')}</h6>
              {modalDns.mx?.length ? (
                <ul>{modalDns.mx.map((r, i) => <li key={i}>{r.priority} — {r.exchange}</li>)}</ul>
              ) : <p className="text-muted">{Translate('domains.missing')}</p>}

              <h6 className="d-flex align-items-center">
                <DnsBadge label="SPF" value={modalDns.spf} grade={spfGrade(modalDns.spf)} />
                <span className="flex-grow-1">{Translate('domains.spfRecord')}</span>
                {domainHasProvider(modalDomain) && editingSection !== 'spf' && (
                  <Button variant="outline-secondary" size="sm" icon="pencil"
                    onClick={() => startEditSpf(modalDns.spf)} />
                )}
              </h6>
              {editingSection === 'spf' ? (
                <div className="border rounded p-3 mb-3 bg-light">
                  <Form.Group className="mb-3">
                    <Form.Label>{t('domains.spfAllMechanism')}</Form.Label>
                    <Form.Select value={spfAllMode} onChange={(e) => setSpfAllMode(e.target.value)}>
                      <option value="~all">{t('domains.spfSoftfail')}</option>
                      <option value="-all">{t('domains.spfHardfail')}</option>
                    </Form.Select>
                    <Form.Text className="text-muted">
                      {spfAllMode === '-all' ? t('domains.spfHardfailDesc') : t('domains.spfSoftfailDesc')}
                    </Form.Text>
                  </Form.Group>
                  <p className="mb-1"><strong>{t('domains.dnsPreview')}:</strong></p>
                  <pre className="bg-dark text-light p-2 rounded">{computeSpfRecord()}</pre>
                  {editError && <AlertMessage type="danger" message={editError} translate={false} />}
                  {editSuccess && <AlertMessage type="success" message={editSuccess} />}
                  <div className="d-flex gap-2">
                    <Button variant="primary" size="sm" icon="cloud-upload" text="domains.pushToDns"
                      onClick={handleSaveSpf} disabled={editSaving} />
                    <Button variant="secondary" size="sm" text="common.cancel"
                      onClick={() => setEditingSection(null)} disabled={editSaving} />
                    {editSaving && <span className="spinner-border spinner-border-sm align-self-center" />}
                  </div>
                </div>
              ) : modalDns.spf ? (
                <>
                  <pre className="bg-light p-2 rounded">{modalDns.spf}</pre>
                  {spfGrade(modalDns.spf) === 'warning' && (
                    <div className="alert alert-warning py-2"><i className="bi bi-exclamation-triangle me-1" /><Trans i18nKey="domains.spfSoftfailHint" components={i18nHtmlComponents} /></div>
                  )}
                  {spfGrade(modalDns.spf) === 'danger' && (
                    <div className="alert alert-danger py-2"><i className="bi bi-exclamation-triangle me-1" /><Trans i18nKey="domains.spfWeakHint" components={i18nHtmlComponents} /></div>
                  )}
                </>
              ) : <p className="text-muted">{Translate('domains.missing')}</p>}

              <h6 className="d-flex align-items-center">
                <DnsBadge label="DKIM" value={modalDns.dkim} />
                <span className="flex-grow-1">{Translate('domains.dkimRecord')}</span>
                <Button variant="outline-secondary" size="sm" icon="key"
                  onClick={() => openDkimModal(modalDomain)} />
              </h6>
              {modalDns.dkim ? (
                <pre className="bg-light p-2 rounded" style={{whiteSpace: 'pre-wrap', wordBreak: 'break-all'}}>{modalDns.dkim}</pre>
              ) : <p className="text-muted">{Translate('domains.missing')}</p>}
              {!modalDns.dkim && generatedDkimRecords[modalDomain] && (
                <div className="alert alert-info py-2 mt-1">
                  <strong><i className="bi bi-info-circle me-1" />{Translate('domains.dkimPendingDns')}</strong>
                  <pre className="bg-dark text-light p-2 rounded mt-2 mb-1" style={{whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.85em'}}>
                    {generatedDkimRecords[modalDomain].selector}._domainkey.{modalDomain} IN TXT "{generatedDkimRecords[modalDomain].record}"
                  </pre>
                  {domainHasProvider(modalDomain) && (
                    <div className="mt-2">
                      <Button variant="primary" size="sm" icon="cloud-upload" text="domains.pushDkimToDns"
                        onClick={() => handlePushDkim(modalDomain, generatedDkimRecords[modalDomain].selector, generatedDkimRecords[modalDomain].record)}
                        disabled={dkimPushing} />
                      {dkimPushing && <span className="spinner-border spinner-border-sm ms-2" />}
                      {dkimPushResult?.success && <AlertMessage type="success" message="domains.dkimPushed" />}
                      {dkimPushResult && !dkimPushResult.success && <AlertMessage type="danger" message={dkimPushResult.error} translate={false} />}
                    </div>
                  )}
                </div>
              )}

              <h6 className="d-flex align-items-center">
                <DnsBadge label="DMARC" value={modalDns.dmarc} grade={dmarcGrade(modalDns.dmarc)} />
                <span className="flex-grow-1">{Translate('domains.dmarcRecord')}</span>
                {domainHasProvider(modalDomain) && editingSection !== 'dmarc' && (
                  <Button variant="outline-secondary" size="sm" icon="pencil"
                    onClick={() => startEditDmarc(modalDns.dmarc)} />
                )}
              </h6>
              {editingSection === 'dmarc' ? (
                <div className="border rounded p-3 mb-3 bg-light">
                  <Form.Group className="mb-3">
                    <Form.Label>{t('domains.dmarcPolicyLabel')}</Form.Label>
                    <Form.Select value={dmarcPolicy} onChange={(e) => setDmarcPolicy(e.target.value)}>
                      <option value="none">{t('domains.dmarcPolicyNone')}</option>
                      <option value="quarantine">{t('domains.dmarcPolicyQuarantine')}</option>
                      <option value="reject">{t('domains.dmarcPolicyReject')}</option>
                    </Form.Select>
                    <Form.Text className="text-muted">
                      {t(`domains.dmarcPolicy${dmarcPolicy.charAt(0).toUpperCase() + dmarcPolicy.slice(1)}Desc`)}
                    </Form.Text>
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>{t('domains.dmarcRuaLabel')}</Form.Label>
                    <Form.Control type="email" value={dmarcRua}
                      onChange={(e) => setDmarcRua(e.target.value)}
                      placeholder="dmarc-reports@example.com" />
                    <Form.Text className="text-muted">{t('domains.dmarcRuaDesc')}</Form.Text>
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>{t('domains.dmarcRufLabel')}</Form.Label>
                    <Form.Control type="email" value={dmarcRuf}
                      onChange={(e) => setDmarcRuf(e.target.value)}
                      placeholder="dmarc-forensic@example.com" />
                    <Form.Text className="text-muted">{t('domains.dmarcRufDesc')}</Form.Text>
                  </Form.Group>
                  <p className="mb-1"><strong>{t('domains.dnsPreview')}:</strong></p>
                  <pre className="bg-dark text-light p-2 rounded" style={{whiteSpace:'pre-wrap',wordBreak:'break-all'}}>{computeDmarcRecord()}</pre>
                  {editError && <AlertMessage type="danger" message={editError} translate={false} />}
                  {editSuccess && <AlertMessage type="success" message={editSuccess} />}
                  <div className="d-flex gap-2">
                    <Button variant="primary" size="sm" icon="cloud-upload" text="domains.pushToDns"
                      onClick={handleSaveDmarc} disabled={editSaving} />
                    <Button variant="secondary" size="sm" text="common.cancel"
                      onClick={() => setEditingSection(null)} disabled={editSaving} />
                    {editSaving && <span className="spinner-border spinner-border-sm align-self-center" />}
                  </div>
                </div>
              ) : modalDns.dmarc ? (
                <>
                  <pre className="bg-light p-2 rounded">{modalDns.dmarc}</pre>
                  {(() => {
                    const policy = modalDns.dmarc.match(/;\s*p=([^;\s]+)/i)?.[1]?.toLowerCase();
                    const hasRua = /rua=/i.test(modalDns.dmarc);
                    const hasRuf = /ruf=/i.test(modalDns.dmarc);
                    return (
                      <>
                        {policy === 'none' && (
                          <div className="alert alert-warning py-2"><i className="bi bi-exclamation-triangle me-1" /><Trans i18nKey="domains.dmarcNoneHint" components={i18nHtmlComponents} /></div>
                        )}
                        {policy === 'quarantine' && (
                          <div className="alert alert-warning py-2"><i className="bi bi-info-circle me-1" /><Trans i18nKey="domains.dmarcQuarantineHint" components={i18nHtmlComponents} /></div>
                        )}
                        {(!hasRua || !hasRuf) && (
                          <div className="alert alert-info py-2">
                            <i className="bi bi-envelope-paper me-1" /><Trans i18nKey="domains.dmarcReportingHint" components={i18nHtmlComponents} />
                            {!hasRua && <div className="mt-2"><Trans i18nKey="domains.dmarcRuaHint" components={i18nHtmlComponents} /></div>}
                            {!hasRuf && <div className="mt-2"><Trans i18nKey="domains.dmarcRufHint" components={i18nHtmlComponents} /></div>}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </>
              ) : <p className="text-muted">{Translate('domains.missing')}</p>}

              <h6><OptionalBadge label="TLSA" value={modalDns.tlsa?.length} /> {Translate('domains.tlsa')}</h6>
              {modalDns.tlsa?.length ? (
                <Table size="sm" bordered>
                  <thead>
                    <tr>
                      <th>{Translate('domains.srvPort')}</th>
                      <th>{Translate('domains.tlsaUsage')}</th>
                      <th>{Translate('domains.tlsaSelector')}</th>
                      <th>{Translate('domains.tlsaMatch')}</th>
                      <th>{Translate('domains.tlsaData')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalDns.tlsa.map((r, i) => (
                      <tr key={i}>
                        <td>{r.port}</td>
                        <td>{TLSA_USAGE[r.usage] || r.usage}</td>
                        <td>{TLSA_SELECTOR[r.selector] || r.selector}</td>
                        <td>{TLSA_MATCH[r.matchingType] || r.matchingType}</td>
                        <td><code style={{fontSize: '0.75em', wordBreak: 'break-all'}}>{r.data}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : <p className="text-muted">{Translate('domains.missing')}</p>}

              <h6><OptionalBadge label="SRV" value={modalDns.srv?.length} /> {Translate('domains.srvRecord')}</h6>
              {modalDns.srv?.length ? (
                <Table size="sm" bordered>
                  <thead>
                    <tr>
                      <th>{Translate('domains.srvService')}</th>
                      <th>{Translate('domains.srvPriority')}</th>
                      <th>{Translate('domains.srvWeight')}</th>
                      <th>{Translate('domains.srvPort')}</th>
                      <th>{Translate('domains.srvTarget')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalDns.srv.map((r, i) => (
                      <tr key={i}>
                        <td>{r.service}</td>
                        <td>{r.priority}</td>
                        <td>{r.weight}</td>
                        <td>{r.port}</td>
                        <td>{r.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : <p className="text-muted">{Translate('domains.missing')}</p>}
            </div>
          ) : (
            <p className="text-muted">{Translate('domains.noDnsData')}</p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" text="common.cancel" onClick={() => setShowModal(false)} />
        </Modal.Footer>
      </Modal>

      {/* DKIM Generation Modal */}
      <Modal show={showDkimModal} onHide={() => setShowDkimModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{Translate('domains.dkimGenerate')} — {dkimDomain}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {dkimResult ? (
            <div>
              <AlertMessage type="success" message="domains.dkimSuccess" />
              {dkimResult.dnsRecord && (
                <>
                  <p><strong>{Translate('domains.dkimCopyHint')}</strong></p>
                  <pre className="bg-dark text-light p-3 rounded" style={{whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.85em'}}>
                    {dkimResult.selector}._domainkey.{dkimDomain} IN TXT "{dkimResult.dnsRecord}"
                  </pre>
                  {domainHasProvider(dkimDomain) && (
                    <div className="mb-3">
                      <Button variant="primary" size="sm" icon="cloud-upload" text="domains.pushDkimToDns"
                        onClick={() => handlePushDkim(dkimDomain, dkimResult.selector, dkimResult.dnsRecord)}
                        disabled={dkimPushing} />
                      {dkimPushing && <span className="spinner-border spinner-border-sm ms-2" />}
                      {dkimPushResult?.success && <AlertMessage type="success" message="domains.dkimPushed" />}
                      {dkimPushResult && !dkimPushResult.success && <AlertMessage type="danger" message={dkimPushResult.error} translate={false} />}
                    </div>
                  )}
                </>
              )}
              <p className="text-muted mb-3">
                {Translate('domains.dkimSelector')}: {dkimResult.selector} | {Translate('domains.dkimKeytype')}: {dkimResult.keytype} | {Translate('domains.dkimKeysize')}: {dkimResult.keysize}
              </p>
              <h6>{Translate('domains.dkimNextSteps')}</h6>
              <ol className="mb-0">
                <li>{Translate('domains.dkimStep1')}</li>
                <li><Trans i18nKey="domains.dkimStep2" values={{selector: dkimResult.selector, domain: dkimDomain}} components={i18nHtmlComponents} /></li>
                <li>{Translate('domains.dkimStep3')}</li>
                <li><Trans i18nKey="domains.dkimStep4" components={i18nHtmlComponents} /></li>
                <li>{Translate('domains.dkimStep5')}</li>
              </ol>
            </div>
          ) : (
            <Form>
              <p className="text-muted mb-3">{Translate('domains.dkimIntro')}</p>

              <div className="mb-3 p-3 bg-light rounded">
                <strong>{Translate('domains.dkimProcessTitle')}</strong>
                <ol className="mb-1 mt-2">
                  <li>{Translate('domains.dkimProcessStep1')}</li>
                  <li>{Translate('domains.dkimProcessStep2')}</li>
                  <li><Trans i18nKey="domains.dkimProcessStep3" components={i18nHtmlComponents} /></li>
                  <li>{Translate('domains.dkimProcessStep4')}</li>
                </ol>
                <p className="mb-0 mt-2"><Trans i18nKey="domains.dkimExistsNote" components={i18nHtmlComponents} /></p>
              </div>

              {dkimError && <AlertMessage type="danger" message={dkimError} />}
              {(() => {
                const cur = domains.find(d => d.domain === dkimDomain);
                const curType = cur?.keytype;
                const curSize = cur?.keysize;
                const hasCurrent = curType && curSize;
                const differs = hasCurrent && (curType !== RECOMMENDED_KEYTYPE || curSize !== RECOMMENDED_KEYSIZE);
                return differs ? (
                  <div className="alert alert-info py-2 mb-3">
                    <Trans i18nKey="domains.dkimCurrentNotice" values={{keytype: curType.toUpperCase(), keysize: curSize}} components={i18nHtmlComponents} />
                  </div>
                ) : null;
              })()}

              <Form.Group className="mb-3">
                <Form.Label>{Translate('domains.dkimKeytype')}</Form.Label>
                <Form.Select value={dkimKeytype} onChange={(e) => setDkimKeytype(e.target.value)}>
                  <option value="rsa">RSA ({Translate('domains.dkimRecommended')})</option>
                  <option value="ed25519">Ed25519</option>
                </Form.Select>
                <Form.Text className="text-muted"><Trans i18nKey="domains.dkimKeytypeHelp" components={i18nHtmlComponents} /></Form.Text>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>{Translate('domains.dkimKeysize')}</Form.Label>
                <Form.Select
                  value={dkimKeysize}
                  onChange={(e) => setDkimKeysize(e.target.value)}
                  disabled={dkimKeytype === 'ed25519'}
                >
                  <option value="1024">1024</option>
                  <option value="2048">2048 ({Translate('domains.dkimRecommended')})</option>
                  <option value="4096">4096</option>
                </Form.Select>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>{Translate('domains.dkimSelector')}</Form.Label>
                <Form.Control
                  type="text"
                  value={dkimSelector}
                  onChange={(e) => setDkimSelector(e.target.value)}
                  placeholder="default"
                />
                <Form.Text className="text-muted"><Trans i18nKey="domains.dkimSelectorHelp" components={i18nHtmlComponents} /></Form.Text>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Check
                  type="checkbox"
                  label={Translate('domains.dkimForce')}
                  checked={dkimForce}
                  onChange={(e) => setDkimForce(e.target.checked)}
                />
                {dkimForce && <div className="alert alert-warning py-2 mt-2 mb-0"><Trans i18nKey="domains.dkimForceWarning" components={i18nHtmlComponents} /></div>}
              </Form.Group>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          {dkimResult ? (
            <Button variant="primary" icon="check-lg" text="common.done" onClick={() => setShowDkimModal(false)} />
          ) : (
            <>
              <Button variant="secondary" text="common.cancel" onClick={() => setShowDkimModal(false)} disabled={dkimLoading} />
              <Button
                variant="primary"
                onClick={handleGenerateDkim}
                disabled={dkimLoading}
              >
                {dkimLoading ? (
                  <><span className="spinner-border spinner-border-sm me-2" role="status" />{t('domains.dkimGenerating')}</>
                ) : (
                  <><i className="bi bi-key me-2" />{t('domains.generateDkim')}</>
                )}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal>

      {/* DNSBL Details Modal */}
      <Modal show={showDnsblModal} onHide={() => setShowDnsblModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{Translate('domains.blacklistDetails')} — {dnsblModalDomain}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {dnsblModalData ? (
            <div>
              <p><strong>{Translate('domains.blacklistServerIp')}:</strong> {dnsblModalData.serverIp}</p>
              <Table size="sm" bordered hover>
                <thead>
                  <tr>
                    <th>{Translate('domains.blacklistRbl')}</th>
                    <th>{Translate('domains.blacklistType')}</th>
                    <th>{Translate('domains.blacklistStatus')}</th>
                    <th>{Translate('domains.blacklistReturnCode')}</th>
                  </tr>
                </thead>
                <tbody>
                  {dnsblModalData.results?.map((r, i) => (
                    <tr key={i} className={r.listed ? 'table-danger' : ''}>
                      <td>{r.name}</td>
                      <td><Badge bg={r.type === 'ip' ? 'info' : 'warning'}>{r.type}</Badge></td>
                      <td>
                        <Badge bg={r.listed ? 'danger' : 'success'}>
                          {r.listed ? Translate('domains.blacklistListed') : Translate('domains.blacklistClean')}
                        </Badge>
                      </td>
                      <td>{r.returnCode || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <p className="text-muted">{Translate('domains.noBlacklistData')}</p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" text="common.cancel" onClick={() => setShowDnsblModal(false)} />
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default Domains;
