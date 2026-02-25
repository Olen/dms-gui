import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Form from 'react-bootstrap/Form';

import {
  debugLog,
  errorLog,
} from '../../frontend.mjs';
import {
  getValueFromArrayOfObj,
  mergeArrayOfObj,
} from '../../../common.mjs';

import {
  getSettings,
  saveSettings,
  uploadLogo,
  deleteLogo,
} from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  Card,
  FormField,
} from '../components/index.jsx';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useBranding } from '../hooks/useBranding';


function FormBranding() {
  const { t } = useTranslation();
  const [containerName] = useLocalStorage('containerName', '');
  const [mailservers] = useLocalStorage('mailservers', []);
  const { refreshBranding } = useBranding();

  const [scope, setScope] = useState('_global');
  const [successMessage, setSuccessMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const [logoFile, setLogoFile] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const [formValues, setFormValues] = useState([
    { name: 'brandName', value: '' },
    { name: 'brandIcon', value: '' },
    { name: 'brandLogo', value: '' },
    { name: 'brandColorPrimary', value: '' },
    { name: 'brandColorSidebar', value: '' },
  ]);

  useEffect(() => {
    fetchBrandingSettings(scope);
  }, [scope]);

  const fetchBrandingSettings = async (scopeName) => {
    try {
      const result = await getSettings('dms-gui', scopeName);
      debugLog('FormBranding fetchBrandingSettings result:', result);

      if (result.success && result.message?.length) {
        setFormValues(prev => mergeArrayOfObj(prev, result.message));
      } else {
        // Reset to defaults when no settings exist for this scope
        setFormValues([
          { name: 'brandName', value: '' },
          { name: 'brandIcon', value: '' },
          { name: 'brandLogo', value: '' },
          { name: 'brandColorPrimary', value: '' },
          { name: 'brandColorSidebar', value: '' },
        ]);
      }
    } catch (error) {
      debugLog('FormBranding fetchBrandingSettings error:', error);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormValues(prev => mergeArrayOfObj(prev, [{ name, value }]));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const result = await saveSettings('dms-gui', 'branding', 'dms-gui', scope, formValues);
      debugLog('FormBranding saveSettings result:', result);

      if (result.success) {
        setSuccessMessage('settings.brandingSaved');
        refreshBranding();
      } else {
        setErrorMessage('settings.brandingSaveError');
      }
    } catch (error) {
      errorLog('FormBranding saveSettings error:', error);
      setErrorMessage('settings.brandingSaveError');
    }
  };

  const scopeOptions = [
    { value: '_global', label: t('settings.brandingScopeGlobal') },
    ...mailservers.map(ms => ({ value: ms.value, label: ms.label || ms.value })),
  ];

  const handleLogoUpload = async () => {
    if (!logoFile) return;
    setLogoUploading(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      const result = await uploadLogo(logoFile, scope === '_global' ? undefined : scope);
      if (result.success) {
        setFormValues(prev => mergeArrayOfObj(prev, [{ name: 'brandLogo', value: result.filename }]));
        setLogoFile(null);
        setSuccessMessage('settings.logoUploaded');
        refreshBranding();
      } else {
        setErrorMessage('settings.logoUploadError');
      }
    } catch {
      setErrorMessage('settings.logoUploadError');
    }
    setLogoUploading(false);
  };

  const handleLogoDelete = async () => {
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      const result = await deleteLogo(scope === '_global' ? undefined : scope);
      if (result.success) {
        setFormValues(prev => mergeArrayOfObj(prev, [{ name: 'brandLogo', value: '' }]));
        setSuccessMessage('settings.logoDeleted');
        refreshBranding();
      } else {
        setErrorMessage('settings.logoDeleteError');
      }
    } catch {
      setErrorMessage('settings.logoDeleteError');
    }
  };

  const currentLogo = getValueFromArrayOfObj(formValues, 'brandLogo') || '';
  const iconPreview = getValueFromArrayOfObj(formValues, 'brandIcon') || 'envelope-fill';

  return (
    <Card title="settings.titleBranding" icon="palette">

      <Form.Group className="mb-3">
        <Form.Label>{t('settings.brandingScope')}</Form.Label>
        <Form.Select value={scope} onChange={(e) => setScope(e.target.value)}>
          {scopeOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </Form.Select>
      </Form.Group>

      <form onSubmit={handleSave}>

        <FormField
          type="text"
          id="brandName"
          name="brandName"
          label="settings.brandName"
          helpText={t('settings.brandNameHelp')}
          value={getValueFromArrayOfObj(formValues, 'brandName') || ''}
          onChange={handleChange}
          placeholder="Docker-Mailserver GUI"
        />

        <Form.Group className="mb-3">
          <Form.Label>{t('settings.brandIcon')}</Form.Label>
          <div className="d-flex align-items-center gap-2">
            <Form.Control
              type="text"
              id="brandIcon"
              name="brandIcon"
              value={getValueFromArrayOfObj(formValues, 'brandIcon') || ''}
              onChange={handleChange}
              placeholder="envelope-fill"
            />
            <i className={`bi bi-${iconPreview} fs-4`}></i>
          </div>
          <Form.Text className="text-muted">
            {t('settings.brandIconHelp')}
          </Form.Text>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('settings.brandLogo')}</Form.Label>
          {currentLogo && (
            <div className="mb-2 d-flex align-items-center gap-2">
              <img src={`/uploads/${currentLogo}`} alt="Logo" style={{ height: '2rem', width: 'auto' }} />
              <Button
                variant="outline-danger"
                icon="trash"
                text="settings.logoDelete"
                size="sm"
                onClick={handleLogoDelete}
              />
            </div>
          )}
          <div className="d-flex align-items-center gap-2">
            <Form.Control
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files[0] || null)}
            />
            <Button
              variant="outline-primary"
              icon="upload"
              text="settings.logoUpload"
              size="sm"
              onClick={handleLogoUpload}
              disabled={!logoFile || logoUploading}
            />
          </div>
          <Form.Text className="text-muted">
            {t('settings.brandLogoHelp')}
          </Form.Text>
        </Form.Group>

        <FormField
          type="color"
          id="brandColorPrimary"
          name="brandColorPrimary"
          label="settings.brandColorPrimary"
          helpText={t('settings.brandColorPrimaryHelp')}
          value={getValueFromArrayOfObj(formValues, 'brandColorPrimary') || '#0d6efd'}
          onChange={handleChange}
        />

        <FormField
          type="color"
          id="brandColorSidebar"
          name="brandColorSidebar"
          label="settings.brandColorSidebar"
          helpText={t('settings.brandColorSidebarHelp')}
          value={getValueFromArrayOfObj(formValues, 'brandColorSidebar') || '#343a40'}
          onChange={handleChange}
        />

        <AlertMessage type="success" message={successMessage} />
        <AlertMessage type="danger" message={errorMessage} />

        <Button
          type="submit"
          variant="primary"
          icon="save"
          text="settings.saveSettings"
        />

      </form>
    </Card>
  );
}

export default FormBranding;
