import React, { useState, useEffect } from 'react';
import { Badge, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useLocalStorage } from '../hooks/useLocalStorage';
import {
  getDomains,
  getDnsLookup,
  generateDkim,
  getDkimSelector,
  getDnsblCheck,
  updateDomain,
  getConfigs,
  getSettings,
  pushDnsRecord,
} from '../services/api.mjs';
import { regexEmailStrict } from '../../../common.mjs';

import {
  AlertMessage,
  Button,
  Card,
  DataTable,
  DkimGenerateModal,
  DnsBadge,
  DnsDetailsModal,
  DnsblResultModal,
  LoadingSpinner,
  OptionalBadge,
  Translate,
} from '../components/index.jsx';
import {
  RECOMMENDED_KEYTYPE,
  RECOMMENDED_KEYSIZE,
  spfGrade,
  dmarcGrade,
  keytypeBadge,
  keysizeBadge,
} from '../utils/dns.mjs';

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-once probe; tracked in #105 sweep
      setLoading(false);
      return;
    }
    // eslint-disable-next-line react-hooks/immutability -- forward-declared fetchDomains; tracked in #105 sweep
    fetchDomains();
    // Fetch DKIM selector from DMS rspamd config
    getDkimSelector(containerName)
      .then((result) => {
        if (result.selector) setConfigDkimSelector(result.selector);
      })
      .catch(() => {});
    // Fetch saved DNS provider profiles from settings (configured in Settings > DNS Providers)
    getSettings('dnscontrol', containerName, undefined, true, 'dnscontrol')
      .then((result) => {
        if (result.success && result.message) {
          const items = Array.isArray(result.message) ? result.message : [];
          const providers = items.map((p) => p.name).filter(Boolean);
          if (providers.length) {
            setDnsProviders(providers);
            return;
          }
        }
        // No saved profiles — fall back to template names
        return getConfigs('dnscontrol').then((r) => {
          if (r.success && r.message) {
            setDnsProviders(r.message.map((p) => p.name).filter(Boolean));
          }
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- forward-declared fetchDomains/getDkimSelector/getSettings; intentional re-fire only on containerName change; tracked in #105 sweep
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
    setProviderSaving((prev) => ({ ...prev, [domain]: true }));
    try {
      const result = await updateDomain(containerName, domain, {
        dnsProvider: provider,
      });
      if (result.success) {
        setDomains((prev) =>
          prev.map((d) =>
            d.domain === domain ? { ...d, dnsProvider: provider || null } : d
          )
        );
      }
    } catch (err) {
      // silently fail
    } finally {
      setProviderSaving((prev) => ({ ...prev, [domain]: false }));
    }
  };

  const checkDns = async (domain) => {
    setDnsLoading((prev) => ({ ...prev, [domain]: true }));
    setDnsErrors((prev) => ({ ...prev, [domain]: null }));
    try {
      const result = await getDnsLookup(containerName, domain);
      if (result.success) {
        setDnsResults((prev) => ({ ...prev, [domain]: result.message }));
      } else {
        setDnsErrors((prev) => ({ ...prev, [domain]: true }));
      }
    } catch (err) {
      setDnsErrors((prev) => ({ ...prev, [domain]: true }));
    } finally {
      setDnsLoading((prev) => ({ ...prev, [domain]: false }));
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
    setDnsblLoading((prev) => ({ ...prev, [domain]: true }));
    setDnsblErrors((prev) => ({ ...prev, [domain]: null }));
    try {
      const result = await getDnsblCheck(containerName, domain);
      if (result.success) {
        setDnsblResults((prev) => ({ ...prev, [domain]: result.message }));
      } else {
        setDnsblErrors((prev) => ({ ...prev, [domain]: true }));
      }
    } catch (err) {
      setDnsblErrors((prev) => ({ ...prev, [domain]: true }));
    } finally {
      setDnsblLoading((prev) => ({ ...prev, [domain]: false }));
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
    const domainData = domains.find((d) => d.domain === domain);
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
          setGeneratedDkimRecords((prev) => ({
            ...prev,
            [domain]: {
              record: result.message.dnsRecord,
              selector: result.message.selector,
              domain: domain,
            },
          }));
        }
        // Refresh DNS and domains list in background
        checkDns(domain);
        getDomains(containerName)
          .then((r) => {
            if (r.success) setDomains(r.message || []);
          })
          .catch(() => {});
      } else {
        setDkimError(result.error || 'domains.dkimError');
      }
    } catch (err) {
      setDkimError('domains.dkimError');
    } finally {
      setDkimLoading(false);
    }
  };

  const domainHasProvider = (domain) =>
    !!domains.find((d) => d.domain === domain)?.dnsProvider;

  const startEditSpf = (currentSpf) => {
    setEditError(null);
    setEditSuccess(null);
    // The dropdown only offers the two recommended qualifiers (~all
    // and -all). If the current record uses +all (no protection),
    // ?all (neutral), or bare `all` (== +all), default the editor to
    // ~all — the safer of the two supported options. Anything that
    // was already -all is preserved. Case-insensitive per RFC 7208
    // §4.6.1.
    if (currentSpf) {
      const match = currentSpf.match(/([~\-?+]?all)\s*$/i);
      const captured = match ? match[1].toLowerCase() : null;
      setSpfAllMode(captured === '-all' ? '-all' : '~all');
    } else {
      setSpfAllMode('~all');
    }
    setEditingSection('spf');
  };

  // The SPF/DMARC record strings are computed inside DnsDetailsModal
  // (the editor state is owned by the modal's inputs); the parent's
  // save handlers receive the computed record as a parameter and
  // dispatch the API call + state updates.
  const handleSaveSpf = async (record) => {
    setEditSaving(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      const result = await pushDnsRecord(containerName, modalDomain, {
        name: modalDomain,
        type: 'TXT',
        data: record,
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
      setDmarcPolicy(
        currentDmarc.match(/;\s*p=([^;\s]+)/i)?.[1]?.toLowerCase() || 'none'
      );
      setDmarcRua(currentDmarc.match(/rua=mailto:([^;\s]+)/i)?.[1] || '');
      setDmarcRuf(currentDmarc.match(/ruf=mailto:([^;\s]+)/i)?.[1] || '');
    } else {
      setDmarcPolicy('none');
      setDmarcRua('');
      setDmarcRuf('');
    }
    setEditingSection('dmarc');
  };

  const handleSaveDmarc = async (record) => {
    setEditSaving(true);
    setEditError(null);
    setEditSuccess(null);
    if (dmarcRua && !regexEmailStrict.test(dmarcRua.trim())) {
      setEditError('domains.invalidEmail');
      setEditSaving(false);
      return;
    }
    if (dmarcRuf && !regexEmailStrict.test(dmarcRuf.trim())) {
      setEditError('domains.invalidEmail');
      setEditSaving(false);
      return;
    }
    try {
      const result = await pushDnsRecord(containerName, modalDomain, {
        name: `_dmarc.${modalDomain}`,
        type: 'TXT',
        data: record,
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
      setDkimPushResult({
        success: false,
        error: err.message || 'domains.dkimPushError',
      });
    } finally {
      setDkimPushing(false);
    }
  };

  const columns = [
    { key: 'domain', label: 'domains.domain' },
    {
      key: 'dkim',
      label: 'domains.dkim',
      render: (item) =>
        item.dkim ? (
          <code style={{ fontSize: '0.85em' }}>{item.dkim}</code>
        ) : (
          <Badge bg="danger">{t('domains.noDkimKey')}</Badge>
        ),
    },
    {
      key: 'keytype',
      label: 'domains.keytype',
      render: (item) =>
        item.keytype ? (
          <Badge bg={keytypeBadge(item.keytype)}>
            {item.keytype.toUpperCase()}
          </Badge>
        ) : (
          <Badge bg="danger">{t('domains.noDkimKey')}</Badge>
        ),
    },
    {
      key: 'keysize',
      label: 'domains.keysize',
      render: (item) =>
        item.keysize ? (
          <Badge bg={keysizeBadge(item.keysize)}>{item.keysize}</Badge>
        ) : (
          <Badge bg="danger">{t('domains.noDkimKey')}</Badge>
        ),
    },
    {
      key: 'accountCount',
      label: 'domains.accounts',
      render: (item) => (
        <span title={t('domains.accounts')}>
          <i className="bi bi-person me-1" />
          {item.accountCount || 0}
        </span>
      ),
    },
    {
      key: 'aliasCount',
      label: 'domains.aliases',
      render: (item) => (
        <span title={t('domains.aliases')}>
          <i className="bi bi-envelope me-1" />
          {item.aliasCount || 0}
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
          {dnsProviders.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
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
              <Badge bg="danger">
                <i className="bi bi-exclamation-triangle me-1" />
                {t('common.error')}
              </Badge>
              <Button
                variant="outline-primary"
                size="sm"
                icon="arrow-clockwise"
                onClick={() => checkDns(item.domain)}
              />
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
          <div
            className="d-flex align-items-center gap-1"
            style={{ cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            onClick={() => showDetails(item.domain)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showDetails(item.domain);
              }
            }}
          >
            <DnsBadge label="A" value={dns.a?.length} />
            <DnsBadge label="MX" value={dns.mx?.length} />
            <DnsBadge label="SPF" value={dns.spf} grade={spfGrade(dns.spf)} />
            <DnsBadge label="DKIM" value={dns.dkim} />
            <DnsBadge
              label="DMARC"
              value={dns.dmarc}
              grade={dmarcGrade(dns.dmarc)}
            />
            <OptionalBadge label="TLSA" value={dns.tlsa?.length} />
            <OptionalBadge label="SRV" value={dns.srv?.length} />
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
              <Badge bg="danger">
                <i className="bi bi-exclamation-triangle me-1" />
                {t('common.error')}
              </Badge>
              <Button
                variant="outline-secondary"
                size="sm"
                icon="arrow-clockwise"
                onClick={() => checkDnsbl(item.domain)}
              />
            </div>
          );
        }

        if (!bl) {
          return (
            <Button
              variant="outline-secondary"
              size="sm"
              icon="shield-check"
              onClick={() => checkDnsbl(item.domain)}
            />
          );
        }

        const listedCount = bl.results?.filter((r) => r.listed).length || 0;

        return (
          <div
            className="d-flex align-items-center gap-1"
            style={{ cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            onClick={() => showDnsblDetails(item.domain)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showDnsblDetails(item.domain);
              }
            }}
          >
            {listedCount > 0 ? (
              <Badge bg="danger">
                {Translate('domains.blacklistListed')} ({listedCount})
              </Badge>
            ) : (
              <Badge bg="success">{Translate('domains.blacklistClean')}</Badge>
            )}
          </div>
        );
      },
    },
  ];

  if (loading) return <LoadingSpinner />;
  if (!containerName)
    return (
      <Card title="domains.title">
        <AlertMessage type="warning" message="domains.noContainer" />
      </Card>
    );

  const modalDns = modalDomain ? dnsResults[modalDomain] : null;
  const dnsblModalData = dnsblModalDomain
    ? dnsblResults[dnsblModalDomain]
    : null;
  const dkimDomainConfig = domains.find((d) => d.domain === dkimDomain);

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

      <DnsDetailsModal
        show={showModal}
        onHide={() => setShowModal(false)}
        domain={modalDomain}
        dns={modalDns}
        hasProvider={domainHasProvider(modalDomain)}
        editingSection={editingSection}
        spfAllMode={spfAllMode}
        dmarcPolicy={dmarcPolicy}
        dmarcRua={dmarcRua}
        dmarcRuf={dmarcRuf}
        editSaving={editSaving}
        editError={editError}
        editSuccess={editSuccess}
        onSpfAllModeChange={setSpfAllMode}
        onDmarcPolicyChange={setDmarcPolicy}
        onDmarcRuaChange={setDmarcRua}
        onDmarcRufChange={setDmarcRuf}
        onStartEditSpf={startEditSpf}
        onStartEditDmarc={startEditDmarc}
        onSaveSpf={handleSaveSpf}
        onSaveDmarc={handleSaveDmarc}
        onCancelEdit={() => setEditingSection(null)}
        onOpenDkim={openDkimModal}
        generatedDkimRecord={
          modalDomain ? generatedDkimRecords[modalDomain] : null
        }
        dkimPushing={dkimPushing}
        dkimPushResult={dkimPushResult}
        onPushDkim={handlePushDkim}
      />

      <DkimGenerateModal
        show={showDkimModal}
        onHide={() => setShowDkimModal(false)}
        domain={dkimDomain}
        keytype={dkimKeytype}
        keysize={dkimKeysize}
        selector={dkimSelector}
        force={dkimForce}
        onKeytypeChange={setDkimKeytype}
        onKeysizeChange={setDkimKeysize}
        onSelectorChange={setDkimSelector}
        onForceChange={setDkimForce}
        loading={dkimLoading}
        error={dkimError}
        result={dkimResult}
        onGenerate={handleGenerateDkim}
        hasProvider={domainHasProvider(dkimDomain)}
        pushing={dkimPushing}
        pushResult={dkimPushResult}
        onPushDkim={handlePushDkim}
        currentKeytype={dkimDomainConfig?.keytype}
        currentKeysize={dkimDomainConfig?.keysize}
      />

      <DnsblResultModal
        show={showDnsblModal}
        onHide={() => setShowDnsblModal(false)}
        domain={dnsblModalDomain}
        data={dnsblModalData}
      />
    </>
  );
};

export default Domains;
