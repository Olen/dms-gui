import React from 'react';
import { Modal, Form, Table } from 'react-bootstrap';
import { Trans, useTranslation } from 'react-i18next';
import AlertMessage from './AlertMessage.jsx';
import Button from './Button.jsx';
import Translate from './Translate.jsx';
import { DnsBadge, OptionalBadge } from './DnsBadge.jsx';
import {
  spfGrade,
  dmarcGrade,
  TLSA_USAGE,
  TLSA_SELECTOR,
  TLSA_MATCH,
} from '../utils/dns.mjs';

const i18nHtmlComponents = {
  strong: <strong />,
  i: <i />,
  br: <br />,
  a: <a />,
  pre: <pre />,
};

// Build the SPF record that the inline editor will publish: keeps the
// existing mechanisms (mx/a/include:...) if the domain already has an
// SPF, otherwise infers reasonable defaults from the MX records.
const computeSpfRecord = (dns, domain, spfAllMode) => {
  const currentSpf = dns?.spf;
  if (currentSpf) {
    return currentSpf.replace(/[~\-?+]all\s*$/, spfAllMode);
  }
  const mechanisms = ['mx', 'a'];
  if (dns?.mx?.length) {
    for (const mx of dns.mx) {
      const host = mx.exchange?.replace(/\.$/, '');
      if (host && host !== domain) {
        mechanisms.push(`include:${host}`);
      }
    }
  }
  return `v=spf1 ${mechanisms.join(' ')} ${spfAllMode}`;
};

// Build the DMARC record from the editor state. Always includes the
// policy; rua/ruf are optional.
const computeDmarcRecord = (policy, rua, ruf) => {
  const parts = [`v=DMARC1`, `p=${policy}`];
  if (rua?.trim()) parts.push(`rua=mailto:${rua.trim()}`);
  if (ruf?.trim()) parts.push(`ruf=mailto:${ruf.trim()}`);
  return parts.join('; ') + ';';
};

// "DNS Details" modal — the centerpiece of the domains page.
// Shows A/MX/SPF/DKIM/DMARC/TLSA/SRV records for a single domain,
// with inline-editable SPF and DMARC sections when the domain has a
// configured DNS provider.
const DnsDetailsModal = ({
  show,
  onHide,
  domain,
  dns,
  hasProvider,
  // SPF/DMARC editing state
  editingSection,
  spfAllMode,
  dmarcPolicy,
  dmarcRua,
  dmarcRuf,
  editSaving,
  editError,
  editSuccess,
  onSpfAllModeChange,
  onDmarcPolicyChange,
  onDmarcRuaChange,
  onDmarcRufChange,
  onStartEditSpf,
  onStartEditDmarc,
  onSaveSpf,
  onSaveDmarc,
  onCancelEdit,
  // DKIM integration
  onOpenDkim,
  generatedDkimRecord,
  dkimPushing,
  dkimPushResult,
  onPushDkim,
}) => {
  const { t } = useTranslation();

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          {Translate('domains.dnsDetails')} — {domain}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {dns ? (
          <div>
            <h6>
              <DnsBadge label="A" value={dns.a?.length} />{' '}
              {Translate('domains.aRecord')}
            </h6>
            {dns.a?.length ? (
              <ul>
                {dns.a.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">{Translate('domains.missing')}</p>
            )}

            <h6>
              <DnsBadge label="MX" value={dns.mx?.length} />{' '}
              {Translate('domains.mxRecord')}
            </h6>
            {dns.mx?.length ? (
              <ul>
                {dns.mx.map((r, i) => (
                  <li key={i}>
                    {r.priority} — {r.exchange}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">{Translate('domains.missing')}</p>
            )}

            <h6 className="d-flex align-items-center">
              <DnsBadge label="SPF" value={dns.spf} grade={spfGrade(dns.spf)} />
              <span className="flex-grow-1">
                {Translate('domains.spfRecord')}
              </span>
              {hasProvider && editingSection !== 'spf' && (
                <Button
                  variant="outline-secondary"
                  size="sm"
                  icon="pencil"
                  onClick={() => onStartEditSpf(dns.spf)}
                />
              )}
            </h6>
            {editingSection === 'spf' ? (
              <div className="border rounded p-3 mb-3 bg-light">
                <Form.Group className="mb-3">
                  <Form.Label>{t('domains.spfAllMechanism')}</Form.Label>
                  <Form.Select
                    value={spfAllMode}
                    onChange={(e) => onSpfAllModeChange(e.target.value)}
                  >
                    <option value="~all">{t('domains.spfSoftfail')}</option>
                    <option value="-all">{t('domains.spfHardfail')}</option>
                  </Form.Select>
                  <Form.Text className="text-muted">
                    {spfAllMode === '-all'
                      ? t('domains.spfHardfailDesc')
                      : t('domains.spfSoftfailDesc')}
                  </Form.Text>
                </Form.Group>
                <p className="mb-1">
                  <strong>{t('domains.dnsPreview')}:</strong>
                </p>
                <pre className="bg-dark text-light p-2 rounded">
                  {computeSpfRecord(dns, domain, spfAllMode)}
                </pre>
                {editError && (
                  <AlertMessage
                    type="danger"
                    message={editError}
                    translate={false}
                  />
                )}
                {editSuccess && (
                  <AlertMessage type="success" message={editSuccess} />
                )}
                <div className="d-flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    icon="cloud-upload"
                    text="domains.pushToDns"
                    onClick={() =>
                      onSaveSpf(computeSpfRecord(dns, domain, spfAllMode))
                    }
                    disabled={editSaving}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    text="common.cancel"
                    onClick={onCancelEdit}
                    disabled={editSaving}
                  />
                  {editSaving && (
                    <span className="spinner-border spinner-border-sm align-self-center" />
                  )}
                </div>
              </div>
            ) : dns.spf ? (
              <>
                <pre className="bg-light p-2 rounded">{dns.spf}</pre>
                {spfGrade(dns.spf) === 'warning' && (
                  <div className="alert alert-warning py-2">
                    <i className="bi bi-exclamation-triangle me-1" />
                    <Trans
                      i18nKey="domains.spfSoftfailHint"
                      components={i18nHtmlComponents}
                    />
                  </div>
                )}
                {spfGrade(dns.spf) === 'danger' && (
                  <div className="alert alert-danger py-2">
                    <i className="bi bi-exclamation-triangle me-1" />
                    <Trans
                      i18nKey="domains.spfWeakHint"
                      components={i18nHtmlComponents}
                    />
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted">{Translate('domains.missing')}</p>
            )}

            <h6 className="d-flex align-items-center">
              <DnsBadge label="DKIM" value={dns.dkim} />
              <span className="flex-grow-1">
                {Translate('domains.dkimRecord')}
              </span>
              <Button
                variant="outline-secondary"
                size="sm"
                icon="key"
                onClick={() => onOpenDkim(domain)}
              />
            </h6>
            {dns.dkim ? (
              <pre
                className="bg-light p-2 rounded"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
              >
                {dns.dkim}
              </pre>
            ) : (
              <p className="text-muted">{Translate('domains.missing')}</p>
            )}
            {!dns.dkim && generatedDkimRecord && (
              <div className="alert alert-info py-2 mt-1">
                <strong>
                  <i className="bi bi-info-circle me-1" />
                  {Translate('domains.dkimPendingDns')}
                </strong>
                <pre
                  className="bg-dark text-light p-2 rounded mt-2 mb-1"
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    fontSize: '0.85em',
                  }}
                >
                  {generatedDkimRecord.selector}._domainkey.{domain} IN TXT
                  &quot;
                  {generatedDkimRecord.record}&quot;
                </pre>
                {hasProvider && (
                  <div className="mt-2">
                    <Button
                      variant="primary"
                      size="sm"
                      icon="cloud-upload"
                      text="domains.pushDkimToDns"
                      onClick={() =>
                        onPushDkim(
                          domain,
                          generatedDkimRecord.selector,
                          generatedDkimRecord.record
                        )
                      }
                      disabled={dkimPushing}
                    />
                    {dkimPushing && (
                      <span className="spinner-border spinner-border-sm ms-2" />
                    )}
                    {dkimPushResult?.success && (
                      <AlertMessage
                        type="success"
                        message="domains.dkimPushed"
                      />
                    )}
                    {dkimPushResult && !dkimPushResult.success && (
                      <AlertMessage
                        type="danger"
                        message={dkimPushResult.error}
                        translate={false}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            <h6 className="d-flex align-items-center">
              <DnsBadge
                label="DMARC"
                value={dns.dmarc}
                grade={dmarcGrade(dns.dmarc)}
              />
              <span className="flex-grow-1">
                {Translate('domains.dmarcRecord')}
              </span>
              {hasProvider && editingSection !== 'dmarc' && (
                <Button
                  variant="outline-secondary"
                  size="sm"
                  icon="pencil"
                  onClick={() => onStartEditDmarc(dns.dmarc)}
                />
              )}
            </h6>
            {editingSection === 'dmarc' ? (
              <div className="border rounded p-3 mb-3 bg-light">
                <Form.Group className="mb-3">
                  <Form.Label>{t('domains.dmarcPolicyLabel')}</Form.Label>
                  <Form.Select
                    value={dmarcPolicy}
                    onChange={(e) => onDmarcPolicyChange(e.target.value)}
                  >
                    <option value="none">{t('domains.dmarcPolicyNone')}</option>
                    <option value="quarantine">
                      {t('domains.dmarcPolicyQuarantine')}
                    </option>
                    <option value="reject">
                      {t('domains.dmarcPolicyReject')}
                    </option>
                  </Form.Select>
                  <Form.Text className="text-muted">
                    {t(
                      `domains.dmarcPolicy${
                        dmarcPolicy.charAt(0).toUpperCase() +
                        dmarcPolicy.slice(1)
                      }Desc`
                    )}
                  </Form.Text>
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>{t('domains.dmarcRuaLabel')}</Form.Label>
                  <Form.Control
                    type="email"
                    value={dmarcRua}
                    onChange={(e) => onDmarcRuaChange(e.target.value)}
                    placeholder="dmarc-reports@example.com"
                  />
                  <Form.Text className="text-muted">
                    {t('domains.dmarcRuaDesc')}
                  </Form.Text>
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>{t('domains.dmarcRufLabel')}</Form.Label>
                  <Form.Control
                    type="email"
                    value={dmarcRuf}
                    onChange={(e) => onDmarcRufChange(e.target.value)}
                    placeholder="dmarc-forensic@example.com"
                  />
                  <Form.Text className="text-muted">
                    {t('domains.dmarcRufDesc')}
                  </Form.Text>
                </Form.Group>
                <p className="mb-1">
                  <strong>{t('domains.dnsPreview')}:</strong>
                </p>
                <pre
                  className="bg-dark text-light p-2 rounded"
                  style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                >
                  {computeDmarcRecord(dmarcPolicy, dmarcRua, dmarcRuf)}
                </pre>
                {editError && (
                  <AlertMessage
                    type="danger"
                    message={editError}
                    translate={false}
                  />
                )}
                {editSuccess && (
                  <AlertMessage type="success" message={editSuccess} />
                )}
                <div className="d-flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    icon="cloud-upload"
                    text="domains.pushToDns"
                    onClick={() =>
                      onSaveDmarc(
                        computeDmarcRecord(dmarcPolicy, dmarcRua, dmarcRuf)
                      )
                    }
                    disabled={editSaving}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    text="common.cancel"
                    onClick={onCancelEdit}
                    disabled={editSaving}
                  />
                  {editSaving && (
                    <span className="spinner-border spinner-border-sm align-self-center" />
                  )}
                </div>
              </div>
            ) : dns.dmarc ? (
              <>
                <pre className="bg-light p-2 rounded">{dns.dmarc}</pre>
                {(() => {
                  const policy = dns.dmarc
                    .match(/;\s*p=([^;\s]+)/i)?.[1]
                    ?.toLowerCase();
                  const hasRua = /rua=/i.test(dns.dmarc);
                  const hasRuf = /ruf=/i.test(dns.dmarc);
                  return (
                    <>
                      {policy === 'none' && (
                        <div className="alert alert-warning py-2">
                          <i className="bi bi-exclamation-triangle me-1" />
                          <Trans
                            i18nKey="domains.dmarcNoneHint"
                            components={i18nHtmlComponents}
                          />
                        </div>
                      )}
                      {policy === 'quarantine' && (
                        <div className="alert alert-warning py-2">
                          <i className="bi bi-info-circle me-1" />
                          <Trans
                            i18nKey="domains.dmarcQuarantineHint"
                            components={i18nHtmlComponents}
                          />
                        </div>
                      )}
                      {(!hasRua || !hasRuf) && (
                        <div className="alert alert-info py-2">
                          <i className="bi bi-envelope-paper me-1" />
                          <Trans
                            i18nKey="domains.dmarcReportingHint"
                            components={i18nHtmlComponents}
                          />
                          {!hasRua && (
                            <div className="mt-2">
                              <Trans
                                i18nKey="domains.dmarcRuaHint"
                                components={i18nHtmlComponents}
                              />
                            </div>
                          )}
                          {!hasRuf && (
                            <div className="mt-2">
                              <Trans
                                i18nKey="domains.dmarcRufHint"
                                components={i18nHtmlComponents}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            ) : (
              <p className="text-muted">{Translate('domains.missing')}</p>
            )}

            <h6>
              <OptionalBadge label="TLSA" value={dns.tlsa?.length} />{' '}
              {Translate('domains.tlsa')}
            </h6>
            {dns.tlsa?.length ? (
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
                  {dns.tlsa.map((r, i) => (
                    <tr key={i}>
                      <td>{r.port}</td>
                      <td>{TLSA_USAGE[r.usage] || r.usage}</td>
                      <td>{TLSA_SELECTOR[r.selector] || r.selector}</td>
                      <td>{TLSA_MATCH[r.matchingType] || r.matchingType}</td>
                      <td>
                        <code
                          style={{
                            fontSize: '0.75em',
                            wordBreak: 'break-all',
                          }}
                        >
                          {r.data}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-muted">{Translate('domains.missing')}</p>
            )}

            <h6>
              <OptionalBadge label="SRV" value={dns.srv?.length} />{' '}
              {Translate('domains.srvRecord')}
            </h6>
            {dns.srv?.length ? (
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
                  {dns.srv.map((r, i) => (
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
            ) : (
              <p className="text-muted">{Translate('domains.missing')}</p>
            )}
          </div>
        ) : (
          <p className="text-muted">{Translate('domains.noDnsData')}</p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" text="common.done" onClick={onHide} />
      </Modal.Footer>
    </Modal>
  );
};

export default DnsDetailsModal;
