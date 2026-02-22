import React, { useState, useEffect } from 'react';
import { Badge, Modal } from 'react-bootstrap';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getDomains, getDnsLookup } from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  Card,
  DataTable,
  LoadingSpinner,
  Translate,
} from '../components/index.jsx';


const Domains = () => {
  const [containerName] = useLocalStorage('containerName', '');
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dnsResults, setDnsResults] = useState({});    // { domain: {a, mx, spf, dkim, dmarc} }
  const [dnsLoading, setDnsLoading] = useState({});    // { domain: true/false }
  const [checkingAll, setCheckingAll] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalDomain, setModalDomain] = useState(null);

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
        // Auto-check DNS for all domains on load
        for (const d of domainList) {
          checkDns(d.domain);
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

  const showDetails = (domain) => {
    setModalDomain(domain);
    setShowModal(true);
  };

  const DnsBadge = ({ label, value }) => (
    <Badge bg={value ? 'success' : 'danger'} className="me-1">
      {label}
    </Badge>
  );

  const columns = [
    { key: 'domain', label: 'domains.domain' },
    { key: 'dkim', label: 'domains.dkim' },
    { key: 'keytype', label: 'domains.keytype' },
    { key: 'keysize', label: 'domains.keysize' },
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
  ];

  if (loading) return <LoadingSpinner />;

  const modalDns = modalDomain ? dnsResults[modalDomain] : null;

  return (
    <>
      <Card title="domains.title">
        {error && <AlertMessage type="danger" message={error} />}

        <div className="mb-3">
          <Button
            variant="outline-primary"
            icon="globe"
            text="domains.checkAllDns"
            onClick={checkAllDns}
            disabled={checkingAll || !domains.length}
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
            </div>
          ) : (
            <p className="text-muted">{Translate('domains.noDnsData')}</p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" text="common.cancel" onClick={() => setShowModal(false)} />
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default Domains;
