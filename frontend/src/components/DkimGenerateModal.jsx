import React from 'react';
import { Modal, Form } from 'react-bootstrap';
import { Trans, useTranslation } from 'react-i18next';
import AlertMessage from './AlertMessage.jsx';
import Button from './Button.jsx';
import Translate from './Translate.jsx';
import { RECOMMENDED_KEYTYPE, RECOMMENDED_KEYSIZE } from '../utils/dns.mjs';

const i18nHtmlComponents = {
  strong: <strong />,
  i: <i />,
  br: <br />,
  a: <a />,
  pre: <pre />,
};

// Modal driving DKIM key generation. Two phases:
//   1. Before generation: form for keytype/keysize/selector/force +
//      a "current keytype differs from recommended" hint when the
//      domain already has a (suboptimal) key.
//   2. After generation: success message + the DNS record to publish,
//      with a one-click "push to DNS" option when the domain has a
//      configured DNS provider.
//
// All state lives in the parent so the result can persist across
// modal close/reopen (the parent keeps generatedDkimRecords keyed by
// domain). Form state, result, push state, and the current-config
// hint inputs are all passed in.
const DkimGenerateModal = ({
  show,
  onHide,
  domain,
  // Form state
  keytype,
  keysize,
  selector,
  force,
  onKeytypeChange,
  onKeysizeChange,
  onSelectorChange,
  onForceChange,
  // Action state
  loading,
  error,
  result,
  onGenerate,
  // DKIM-push integration
  hasProvider,
  pushing,
  pushResult,
  onPushDkim,
  // Domain's current DKIM config (for the "current differs" notice)
  currentKeytype,
  currentKeysize,
}) => {
  const { t } = useTranslation();
  const hasCurrent = currentKeytype && currentKeysize;
  const differs =
    hasCurrent &&
    (currentKeytype !== RECOMMENDED_KEYTYPE ||
      currentKeysize !== RECOMMENDED_KEYSIZE);

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          {Translate('domains.dkimGenerate')} — {domain}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {result ? (
          <div>
            <AlertMessage type="success" message="domains.dkimSuccess" />
            {result.dnsRecord && (
              <>
                <p>
                  <strong>{Translate('domains.dkimCopyHint')}</strong>
                </p>
                <pre
                  className="bg-dark text-light p-3 rounded"
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    fontSize: '0.85em',
                  }}
                >
                  {/* Single template literal so <pre> sees the record as
                      one continuous line. Splitting it across JSX text
                      nodes would inject a newline+indent between
                      `IN TXT` and the quoted value — copy/paste would
                      produce a broken DNS record. */}
                  {`${result.selector}._domainkey.${domain} IN TXT "${result.dnsRecord}"`}
                </pre>
                {hasProvider && (
                  <div className="mb-3">
                    <Button
                      variant="primary"
                      size="sm"
                      icon="cloud-upload"
                      text="domains.pushDkimToDns"
                      onClick={() =>
                        onPushDkim(domain, result.selector, result.dnsRecord)
                      }
                      disabled={pushing}
                    />
                    {pushing && (
                      <span className="spinner-border spinner-border-sm ms-2" />
                    )}
                    {pushResult?.success && (
                      <AlertMessage
                        type="success"
                        message="domains.dkimPushed"
                      />
                    )}
                    {pushResult && !pushResult.success && (
                      <AlertMessage
                        type="danger"
                        message={pushResult.error}
                        translate={false}
                      />
                    )}
                  </div>
                )}
              </>
            )}
            <p className="text-muted mb-3">
              {Translate('domains.dkimSelector')}: {result.selector} |{' '}
              {Translate('domains.dkimKeytype')}: {result.keytype} |{' '}
              {Translate('domains.dkimKeysize')}: {result.keysize}
            </p>
            <h6>{Translate('domains.dkimNextSteps')}</h6>
            <ol className="mb-0">
              <li>{Translate('domains.dkimStep1')}</li>
              <li>
                <Trans
                  i18nKey="domains.dkimStep2"
                  values={{ selector: result.selector, domain: domain }}
                  components={i18nHtmlComponents}
                />
              </li>
              <li>{Translate('domains.dkimStep3')}</li>
              <li>
                <Trans
                  i18nKey="domains.dkimStep4"
                  components={i18nHtmlComponents}
                />
              </li>
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
                <li>
                  <Trans
                    i18nKey="domains.dkimProcessStep3"
                    components={i18nHtmlComponents}
                  />
                </li>
                <li>{Translate('domains.dkimProcessStep4')}</li>
              </ol>
              <p className="mb-0 mt-2">
                <Trans
                  i18nKey="domains.dkimExistsNote"
                  components={i18nHtmlComponents}
                />
              </p>
            </div>

            {error && <AlertMessage type="danger" message={error} />}
            {differs ? (
              <div className="alert alert-info py-2 mb-3">
                <Trans
                  i18nKey="domains.dkimCurrentNotice"
                  values={{
                    keytype: currentKeytype.toUpperCase(),
                    keysize: currentKeysize,
                  }}
                  components={i18nHtmlComponents}
                />
              </div>
            ) : null}

            <Form.Group className="mb-3">
              <Form.Label>{Translate('domains.dkimKeytype')}</Form.Label>
              <Form.Select
                value={keytype}
                onChange={(e) => onKeytypeChange(e.target.value)}
              >
                <option value="rsa">
                  RSA ({Translate('domains.dkimRecommended')})
                </option>
                <option value="ed25519">Ed25519</option>
              </Form.Select>
              <Form.Text className="text-muted">
                <Trans
                  i18nKey="domains.dkimKeytypeHelp"
                  components={i18nHtmlComponents}
                />
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>{Translate('domains.dkimKeysize')}</Form.Label>
              <Form.Select
                value={keysize}
                onChange={(e) => onKeysizeChange(e.target.value)}
                disabled={keytype === 'ed25519'}
              >
                <option value="1024">1024</option>
                <option value="2048">
                  2048 ({Translate('domains.dkimRecommended')})
                </option>
                <option value="4096">4096</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>{Translate('domains.dkimSelector')}</Form.Label>
              <Form.Control
                type="text"
                value={selector}
                onChange={(e) => onSelectorChange(e.target.value)}
                placeholder="default"
              />
              <Form.Text className="text-muted">
                <Trans
                  i18nKey="domains.dkimSelectorHelp"
                  components={i18nHtmlComponents}
                />
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Check
                type="checkbox"
                label={Translate('domains.dkimForce')}
                checked={force}
                onChange={(e) => onForceChange(e.target.checked)}
              />
              {force && (
                <div className="alert alert-warning py-2 mt-2 mb-0">
                  <Trans
                    i18nKey="domains.dkimForceWarning"
                    components={i18nHtmlComponents}
                  />
                </div>
              )}
            </Form.Group>
          </Form>
        )}
      </Modal.Body>
      <Modal.Footer>
        {result ? (
          <Button
            variant="primary"
            icon="check-lg"
            text="common.done"
            onClick={onHide}
          />
        ) : (
          <>
            <Button
              variant="secondary"
              text="common.cancel"
              onClick={onHide}
              disabled={loading}
            />
            <Button variant="primary" onClick={onGenerate} disabled={loading}>
              {loading ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    role="status"
                  />
                  {t('domains.dkimGenerating')}
                </>
              ) : (
                <>
                  <i className="bi bi-key me-2" />
                  {t('domains.generateDkim')}
                </>
              )}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default DkimGenerateModal;
