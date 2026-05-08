import React from 'react';
import { useTranslation } from 'react-i18next';
import Modal from 'react-bootstrap/Modal';

import { Button, LoadingSpinner, Translate } from './index.jsx';

/**
 * Sieve-rules modal. State and handlers come from useSieveRules() — this
 * component is a pure render of those values plus a few presentational
 * concerns. Used by both Accounts.jsx (per-account row) and Profile.jsx
 * (per-user view); they only differ in the title (which mailbox).
 */
const SieveModal = ({ sieve, titleMailbox = null }) => {
  const { t } = useTranslation();
  const {
    showSieveModal,
    sieveMailbox,
    sieveRules,
    sieveScriptExists,
    sieveExternalScript,
    isSieveLoading,
    isSieveSaving,
    newBlockAddress,
    handleCloseSieve,
    handleSaveSieve,
    handleDeleteSieve,
    updateSieveRule,
    addBlockAddress,
    removeBlockAddress,
    setNewBlockAddress,
  } = sieve;

  // Profile.jsx passes user.mailbox via titleMailbox; Accounts.jsx leaves
  // it null and uses the per-row sieveMailbox the hook tracks.
  const displayMailbox = titleMailbox ?? sieveMailbox;

  return (
    <Modal show={showSieveModal} onHide={handleCloseSieve} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          {Translate('accounts.sieve.title')} - {displayMailbox}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {isSieveLoading ? (
          <LoadingSpinner />
        ) : sieveRules ? (
          <div>
            {sieveExternalScript && (
              <div className="alert alert-warning mb-3">
                <i className="bi bi-exclamation-triangle me-2"></i>
                {t('accounts.sieve.externalScript')}
                <pre className="mt-2 mb-0 small" style={{maxHeight: '150px', overflow: 'auto'}}>{sieveExternalScript}</pre>
              </div>
            )}

            {/* Forward */}
            <div className="card mb-3">
              <div className="card-header d-flex align-items-center justify-content-between">
                <span><i className="bi bi-forward me-2"></i>{t('accounts.sieve.forward')}</span>
                <div className="form-check form-switch mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={sieveRules.forward.enabled}
                    onChange={(e) => updateSieveRule('forward', 'enabled', e.target.checked)}
                  />
                </div>
              </div>
              {sieveRules.forward.enabled && (
                <div className="card-body">
                  <div className="mb-2">
                    <label className="form-label small">{t('accounts.sieve.forwardAddress')}</label>
                    <input
                      type="email"
                      className="form-control form-control-sm"
                      value={sieveRules.forward.address}
                      onChange={(e) => updateSieveRule('forward', 'address', e.target.value)}
                      placeholder="user@example.com"
                    />
                  </div>
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="sieveKeepCopy"
                      checked={sieveRules.forward.keepCopy}
                      onChange={(e) => updateSieveRule('forward', 'keepCopy', e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="sieveKeepCopy">
                      {t('accounts.sieve.keepCopy')}
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Vacation */}
            <div className="card mb-3">
              <div className="card-header d-flex align-items-center justify-content-between">
                <span><i className="bi bi-airplane me-2"></i>{t('accounts.sieve.vacation')}</span>
                <div className="form-check form-switch mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={sieveRules.vacation.enabled}
                    onChange={(e) => updateSieveRule('vacation', 'enabled', e.target.checked)}
                  />
                </div>
              </div>
              {sieveRules.vacation.enabled && (
                <div className="card-body">
                  <div className="mb-2">
                    <label className="form-label small">{t('accounts.sieve.vacationSubject')}</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={sieveRules.vacation.subject}
                      onChange={(e) => updateSieveRule('vacation', 'subject', e.target.value)}
                    />
                  </div>
                  <div className="mb-2">
                    <label className="form-label small">{t('accounts.sieve.vacationMessage')}</label>
                    <textarea
                      className="form-control form-control-sm"
                      rows="3"
                      value={sieveRules.vacation.message}
                      onChange={(e) => updateSieveRule('vacation', 'message', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label small">{t('accounts.sieve.vacationDays')}</label>
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      style={{ maxWidth: '100px' }}
                      value={sieveRules.vacation.days}
                      onChange={(e) => updateSieveRule('vacation', 'days', parseInt(e.target.value, 10) || 7)}
                      min="1"
                      max="365"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Block Senders */}
            <div className="card mb-3">
              <div className="card-header d-flex align-items-center justify-content-between">
                <span><i className="bi bi-slash-circle me-2"></i>{t('accounts.sieve.block')}</span>
                <div className="form-check form-switch mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={sieveRules.block.enabled}
                    onChange={(e) => updateSieveRule('block', 'enabled', e.target.checked)}
                  />
                </div>
              </div>
              {sieveRules.block.enabled && (
                <div className="card-body">
                  <div className="d-flex mb-2">
                    <input
                      type="email"
                      className="form-control form-control-sm me-2"
                      value={newBlockAddress}
                      onChange={(e) => setNewBlockAddress(e.target.value)}
                      placeholder={t('accounts.sieve.blockAddress')}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBlockAddress(); }}}
                    />
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      text="accounts.sieve.addAddress"
                      onClick={addBlockAddress}
                    />
                  </div>
                  {sieveRules.block.addresses.map((addr) => (
                    <div key={addr} className="d-flex align-items-center mb-1">
                      <span className="me-2 small">{addr}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger py-0 px-1"
                        onClick={() => removeBlockAddress(addr)}
                      >
                        <i className="bi bi-x"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-muted">{t('accounts.sieve.noRules')}</p>
        )}
      </Modal.Body>
      <Modal.Footer>
        {sieveScriptExists && (
          <Button
            variant="danger"
            onClick={handleDeleteSieve}
            text="accounts.sieve.delete"
            disabled={isSieveSaving}
            className="me-auto"
          />
        )}
        <Button
          variant="secondary"
          onClick={handleCloseSieve}
          text="common.cancel"
        />
        <Button
          variant="primary"
          onClick={handleSaveSieve}
          text="accounts.sieve.save"
          disabled={isSieveSaving || isSieveLoading || !sieveRules}
        />
      </Modal.Footer>
    </Modal>
  );
};

export default SieveModal;
