import React, { useState, useEffect } from 'react';
import { Badge, Modal, Form, Table } from 'react-bootstrap';
import { Trans, useTranslation } from 'react-i18next';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getDomains, getDnsLookup, generateDkim, getDnsblCheck } from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  Card,
  DataTable,
  LoadingSpinner,
  Translate,
} from '../components/index.jsx';

const i18nHtmlComponents = { strong: <strong />, i: <i />, br: <br />, a: <a />, pre: <pre /> };


const Domains = () => {
  const { t } = useTranslation();
  const [containerName] = useLocalStorage('containerName', '');
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dnsResults, setDnsResults] = useState({});
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
  const [dnsblLoading, setDnsblLoading] = useState({});
  const [checkingAllDnsbl, setCheckingAllDnsbl] = useState(false);
  const [showDnsblModal, setShowDnsblModal] = useState(false);
  const [dnsblModalDomain, setDnsblModalDomain] = useState(null);

  useEffect(() => {
    if (!containerName) return;
    fetchDomains();
  }, [containerName]);

  const fetchDomains = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getDomains(containerName);
      if (result.success) {
        const domainList = result.message || [];
        setDomains(domainList);
        for (const d of domainList) {
          await checkDns(d.domain);
        }
      } else {
        setError(result.error || 'api.errors.fetchDomains');
      }
    } catch (err) {
      setError('api.errors.fetchDomains');
    } finally {
      setLoading(false);
    }
  };

  const checkDns = async (domain) => {
    setDnsLoading(prev => ({ ...prev, [domain]: true }));
    try {
      const result = await getDnsLookup(containerName, domain);
      if (result.success) {
        setDnsResults(prev => ({ ...prev, [domain]: result.message }));
      }
    } catch (err) {
      // silently fail per-domain
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
    try {
      const result = await getDnsblCheck(containerName, domain);
      if (result.success) {
        setDnsblResults(prev => ({ ...prev, [domain]: result.message }));
      }
    } catch (err) {
      // silently fail per-domain
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
    setShowModal(true);
  };

  const showDnsblDetails = (domain) => {
    setDnsblModalDomain(domain);
    setShowDnsblModal(true);
  };

  const RECOMMENDED_KEYTYPE = 'rsa';
  const RECOMMENDED_KEYSIZE = '2048';

  const openDkimModal = (domain) => {
    const domainData = domains.find(d => d.domain === domain);
    setDkimDomain(domain);
    setDkimKeytype(RECOMMENDED_KEYTYPE);
    setDkimKeysize(RECOMMENDED_KEYSIZE);
    setDkimSelector(domainData?.dkim || 'mail');
    setDkimForce(false);
    setDkimResult(null);
    setDkimError(null);
    setShowDkimModal(true);
  };

  const handleGenerateDkim = async () => {
    setDkimLoading(true);
    setDkimError(null);
    setDkimResult(null);
    try {
      const result = await generateDkim(containerName, dkimDomain, {
        keytype: dkimKeytype,
        keysize: dkimKeysize,
        selector: dkimSelector,
        force: dkimForce,
      });
      if (result.success) {
        setDkimResult(result.message);
        // Refresh DNS for this domain to check if record is published
        await checkDns(dkimDomain);
        // Refresh domains list to get updated DKIM info
        const domainsResult = await getDomains(containerName);
        if (domainsResult.success) setDomains(domainsResult.message || []);
      } else {
        setDkimError(result.error || Translate('domains.dkimError'));
      }
    } catch (err) {
      setDkimError(Translate('domains.dkimError'));
    } finally {
      setDkimLoading(false);
    }
  };

  const DnsBadge = ({ label, value }) => (
    <Badge bg={value ? 'success' : 'danger'} className="me-1">
      {label}
    </Badge>
  );

  const OptionalBadge = ({ label, value }) => (
    <Badge bg={value ? 'success' : 'secondary'} className="me-1">
      {label}
    </Badge>
  );

  const TLSA_USAGE = { 0: 'PKIX-TA', 1: 'PKIX-EE', 2: 'DANE-TA', 3: 'DANE-EE' };
  const TLSA_SELECTOR = { 0: 'Full cert', 1: 'SubjectPublicKeyInfo' };
  const TLSA_MATCH = { 0: 'Exact', 1: 'SHA-256', 2: 'SHA-512' };

  const columns = [
    { key: 'domain', label: 'domains.domain' },
    { key: 'dkim', label: 'domains.dkim' },
    { key: 'keytype', label: 'domains.keytype' },
    { key: 'keysize', label: 'domains.keysize' },
    {
      key: 'accountCount',
      label: 'domains.accounts',
      render: (item) => (
        <span title={Translate('domains.accounts')}>
          <i className="bi bi-person me-1" />{item.accountCount || 0}
        </span>
      ),
    },
    {
      key: 'aliasCount',
      label: 'domains.aliases',
      render: (item) => (
        <span title={Translate('domains.aliases')}>
          <i className="bi bi-envelope me-1" />{item.aliasCount || 0}
        </span>
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

        if (isLoading) return <LoadingSpinner />;

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
            <DnsBadge label="SPF" value={dns.spf} />
            <DnsBadge label="DKIM" value={dns.dkim} />
            <DnsBadge label="DMARC" value={dns.dmarc} />
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

        if (isLoading) return <LoadingSpinner />;

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
    {
      key: 'actions',
      label: 'common.actions',
      noSort: true,
      noFilter: true,
      render: (item) => item.accountCount > 0 ? (
        <Button
          variant="outline-primary"
          size="sm"
          icon="key"
          text="domains.generateDkim"
          onClick={() => openDkimModal(item.domain)}
        />
      ) : (
        <span className="btn btn-sm btn-outline-secondary disabled" title={t('domains.notManagedHere')}>
          <i className="bi bi-globe2 me-1" />{t('domains.externalDomain')}
        </span>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;

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

              <h6><DnsBadge label="SPF" value={modalDns.spf} /> {Translate('domains.spfRecord')}</h6>
              {modalDns.spf ? (
                <pre className="bg-light p-2 rounded">{modalDns.spf}</pre>
              ) : <p className="text-muted">{Translate('domains.missing')}</p>}

              <h6><DnsBadge label="DKIM" value={modalDns.dkim} /> {Translate('domains.dkimRecord')}</h6>
              {modalDns.dkim ? (
                <pre className="bg-light p-2 rounded" style={{whiteSpace: 'pre-wrap', wordBreak: 'break-all'}}>{modalDns.dkim}</pre>
              ) : <p className="text-muted">{Translate('domains.missing')}</p>}

              <h6><DnsBadge label="DMARC" value={modalDns.dmarc} /> {Translate('domains.dmarcRecord')}</h6>
              {modalDns.dmarc ? (
                <pre className="bg-light p-2 rounded">{modalDns.dmarc}</pre>
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
                  placeholder="mail"
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
          <Button variant="secondary" text="common.cancel" onClick={() => setShowDkimModal(false)} />
          {!dkimResult && (
            <Button
              variant="primary"
              icon="key"
              text="domains.generateDkim"
              onClick={handleGenerateDkim}
              disabled={dkimLoading}
            />
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
