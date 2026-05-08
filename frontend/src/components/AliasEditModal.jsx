import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from 'react-bootstrap/Modal';
import Form from 'react-bootstrap/Form';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';

import { regexEmailStrict } from '../../../common.mjs';
import Button from './Button';

const splitDestinations = (destStr) =>
  String(destStr || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => ({ value: d, label: d }));

const AliasEditModal = ({ show, alias, accountOptions = [], isAdmin, onSave, onCancel }) => {
  const { t } = useTranslation();
  const [destinations, setDestinations] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset internal state every time we open with a new alias.
  useEffect(() => {
    if (show && alias) {
      setDestinations(splitDestinations(alias.destination));
      setError(null);
      setSubmitting(false);
    }
  }, [show, alias]);

  const isValidNewOption = (input) =>
    input.trim().length > 0 && regexEmailStrict.test(input.trim());

  const handleSave = async () => {
    if (!destinations.length) {
      setError('aliases.destinationRequired');
      return;
    }
    const invalid = destinations.find((d) => !regexEmailStrict.test(d.value.trim()));
    if (invalid) {
      setError('aliases.invalidDestination');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSave(alias.source, destinations.map((d) => d.value).join(','));
    } finally {
      setSubmitting(false);
    }
  };

  const SelectComponent = isAdmin ? CreatableSelect : Select;

  // Avoid mounting heavy children when modal is closed.
  if (!show || !alias) return null;

  return (
    <Modal show={show} onHide={onCancel} backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>{t('aliases.editTitle')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label>{t('aliases.sourceAddress')}</Form.Label>
          <Form.Control type="text" value={alias.source} readOnly />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('aliases.destinationAddress')}</Form.Label>
          <SelectComponent
            isMulti
            value={destinations}
            onChange={(v) => setDestinations(v || [])}
            options={accountOptions}
            {...(isAdmin
              ? {
                  isValidNewOption,
                  placeholder: t('aliases.selectDestination'),
                  formatCreateLabel: (input) => `${t('aliases.addExternal')}: ${input}`,
                  noOptionsMessage: () => t('aliases.typeToAdd'),
                }
              : {
                  placeholder: t('aliases.selectDestination'),
                  noOptionsMessage: () => t('aliases.noRoles'),
                })}
          />
          {error && <div className="text-danger small mt-1">{t(error)}</div>}
          <Form.Text muted>{t('aliases.destinationInfo')}</Form.Text>
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" text="common.cancel" onClick={onCancel} />
        <Button variant="primary" text="aliases.save" onClick={handleSave} disabled={submitting} />
      </Modal.Footer>
    </Modal>
  );
};

export default AliasEditModal;
