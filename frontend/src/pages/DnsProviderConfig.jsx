import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

import {
  debugLog,
  errorLog,
} from '../../frontend.mjs';

import {
  getConfigs,
  getSettings,
  saveSettings,
  testDnsProvider,
} from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  FormField,
  Translate,
} from '../components/index.jsx';
import { useLocalStorage } from '../hooks/useLocalStorage';


function DnsProviderConfig() {
  const { t } = useTranslation();
  const [containerName] = useLocalStorage("containerName", '');

  const [isLoading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Provider type templates from backend (keyed by template name)
  const [templates, setTemplates] = useState({});
  // Saved profiles: array of {name, type, ...credentials}
  const [profiles, setProfiles] = useState([]);

  // Add profile form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileType, setNewProfileType] = useState('');
  const [addError, setAddError] = useState(null);

  // Per-profile test results: { profileName: { loading, success, message } }
  const [testResults, setTestResults] = useState({});

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    if (containerName) loadProfiles();
  }, [containerName]);

  const loadTemplates = async () => {
    try {
      const result = await getConfigs('dnscontrol');
      debugLog('DnsProviderConfig loadTemplates result:', result);
      if (result.success && result.message) {
        // result.message is an array of {name, value} where name is template key, value is the template object
        const tmpl = {};
        for (const item of result.message) {
          if (item.name && item.value) {
            tmpl[item.name] = typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
          }
        }
        setTemplates(tmpl);
      }
    } catch (error) {
      errorLog('DnsProviderConfig loadTemplates error:', error);
    }
  };

  const loadProfiles = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      const result = await getSettings('dnscontrol', containerName, undefined, true, 'dnscontrol');
      debugLog('DnsProviderConfig loadProfiles result:', result);

      const loaded = [];
      if (result.success && result.message) {
        const items = Array.isArray(result.message) ? result.message : [];
        for (const item of items) {
          try {
            const parsed = typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
            loaded.push({ name: item.name, ...parsed });
          } catch (e) {
            debugLog('DnsProviderConfig: could not parse profile', item.name, e);
          }
        }
      }
      setProfiles(loaded);
    } catch (error) {
      errorLog('DnsProviderConfig loadProfiles error:', error);
      setErrorMessage('api.errors.fetchSettings');
    } finally {
      setLoading(false);
    }
  };

  const handleAddProfile = () => {
    setAddError(null);
    if (!newProfileName.trim()) {
      setAddError('settings.dnsProvider.nameRequired');
      return;
    }
    if (profiles.some(p => p.name === newProfileName.trim())) {
      setAddError('settings.dnsProvider.nameExists');
      return;
    }
    if (!newProfileType) {
      return;
    }

    const template = templates[newProfileType];
    if (!template) return;

    // Create a new profile with empty credential fields
    const profile = { name: newProfileName.trim(), type: newProfileType };
    for (const [key, val] of Object.entries(template)) {
      if (key === 'desc' || key === 'TYPE') continue;
      profile[key] = '';
    }

    setProfiles([...profiles, profile]);
    setNewProfileName('');
    setNewProfileType('');
    setShowAddForm(false);
  };

  const handleProfileFieldChange = (profileName, field, value) => {
    setProfiles(profiles.map(p =>
      p.name === profileName ? { ...p, [field]: value } : p
    ));
    // Clear test result when credentials change
    setTestResults(prev => { const next = { ...prev }; delete next[profileName]; return next; });
  };

  const handleSaveProfile = async (profile) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const { name, ...creds } = profile;
      const jsonArrayOfObjects = [{
        name: name,
        value: JSON.stringify(creds),
      }];

      debugLog('DnsProviderConfig saveProfile:', jsonArrayOfObjects);
      const result = await saveSettings('dnscontrol', 'dnscontrol', 'dnscontrol', containerName, jsonArrayOfObjects, true);

      if (result.success) {
        setSuccessMessage('settings.dnsProvider.saved');
      } else {
        setErrorMessage(result?.error || 'settings.cannotSaveSettings');
      }
    } catch (error) {
      errorLog('DnsProviderConfig save error:', error);
      setErrorMessage('api.errors.saveSettings');
    }
  };

  const handleTestProfile = async (profile) => {
    const { name, type, ...creds } = profile;
    const template = getTemplateForType(type);

    setTestResults(prev => ({ ...prev, [name]: { loading: true } }));

    try {
      const result = await testDnsProvider({ ...creds, type: template?.TYPE || type });
      setTestResults(prev => ({ ...prev, [name]: { loading: false, ...result } }));
    } catch (error) {
      setTestResults(prev => ({ ...prev, [name]: { loading: false, success: false, error: error.message } }));
    }
  };

  const handleDeleteProfile = async (profileName) => {
    if (!window.confirm(t('settings.dnsProvider.confirmDelete', { name: profileName }))) return;

    try {
      // Save with empty value to delete
      const jsonArrayOfObjects = [{
        name: profileName,
        value: '',
      }];
      await saveSettings('dnscontrol', 'dnscontrol', 'dnscontrol', containerName, jsonArrayOfObjects, true);
      setProfiles(profiles.filter(p => p.name !== profileName));
      setSuccessMessage('settings.dnsProvider.deleted');
    } catch (error) {
      errorLog('DnsProviderConfig delete error:', error);
      setErrorMessage('api.errors.saveSettings');
    }
  };

  const getTemplateForType = (type) => {
    for (const [key, tmpl] of Object.entries(templates)) {
      if (key === type) return tmpl;
    }
    return null;
  };

  const getCredentialFields = (profile) => {
    const template = getTemplateForType(profile.type);
    if (!template) return [];
    return Object.keys(template).filter(k => k !== 'desc' && k !== 'TYPE');
  };

  if (!containerName) {
    return <AlertMessage type="warning" message="settings.dnsProvider.noContainer" />;
  }

  const templateNames = Object.keys(templates);

  return (
    <>
      <AlertMessage type="danger" message={errorMessage} />
      <AlertMessage type="success" message={successMessage} />

      <p className="text-muted mb-3">{Translate('settings.dnsProvider.description')}</p>

      {profiles.map((profile) => {
        const template = getTemplateForType(profile.type);
        const fields = getCredentialFields(profile);
        const test = testResults[profile.name];

        return (
          <div key={profile.name} className="border rounded p-3 mb-3">
            <div className="d-flex justify-content-between align-items-start mb-2">
              <div>
                <h6 className="mb-1">
                  <i className="bi bi-globe2 me-2" />
                  {profile.name}
                  <span className="badge bg-secondary ms-2">{template?.TYPE || profile.type}</span>
                </h6>
                {template?.desc && (
                  <a href={template.desc} target="_blank" rel="noopener noreferrer" className="text-muted small">
                    <i className="bi bi-box-arrow-up-right me-1" />{t('settings.dnsProvider.docsLink')}
                  </a>
                )}
              </div>
              <Button
                variant="outline-danger"
                size="sm"
                icon="trash"
                onClick={() => handleDeleteProfile(profile.name)}
              />
            </div>

            <Row>
              {fields.map((field) => (
                <Col md={6} key={field}>
                  <FormField
                    type="text"
                    id={`${profile.name}-${field}`}
                    name={field}
                    label={field}
                    translate={false}
                    value={profile[field] || ''}
                    onChange={(e) => handleProfileFieldChange(profile.name, field, e.target.value)}
                    placeholder={template?.[field] || ''}
                  />
                </Col>
              ))}
            </Row>

            {test && !test.loading && (
              <div className={`alert alert-${test.success ? 'success' : 'danger'} py-2 mb-2`}>
                <i className={`bi bi-${test.success ? 'check-circle' : 'exclamation-triangle'} me-1`} />
                {test.success ? test.message : test.error}
              </div>
            )}

            <div className="d-flex gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                icon="floppy"
                text="settings.saveSettings"
                onClick={() => handleSaveProfile(profile)}
              />
              <Button
                type="button"
                variant="outline-secondary"
                size="sm"
                icon="plug"
                text="settings.dnsProvider.testButton"
                onClick={() => handleTestProfile(profile)}
                disabled={test?.loading}
              />
              {test?.loading && <span className="spinner-border spinner-border-sm align-self-center" />}
            </div>
          </div>
        );
      })}

      {showAddForm ? (
        <div className="border rounded p-3 mb-3 bg-light">
          <h6 className="mb-3">{Translate('settings.dnsProvider.addProfile')}</h6>
          {addError && <AlertMessage type="danger" message={addError} />}

          <Row>
            <Col md={6}>
              <FormField
                type="text"
                id="newProfileName"
                name="newProfileName"
                label="settings.dnsProvider.profileName"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="settings.dnsProvider.profileNamePlaceholder"
              />
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="newProfileType">
                <Form.Label>{t('settings.dnsProvider.providerType')}</Form.Label>
                <Form.Select
                  value={newProfileType}
                  onChange={(e) => setNewProfileType(e.target.value)}
                >
                  <option value="">—</option>
                  {templateNames.map(name => (
                    <option key={name} value={name}>{name} ({templates[name]?.TYPE})</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          <div className="d-flex gap-2">
            <Button variant="primary" size="sm" icon="plus-lg" text="settings.dnsProvider.addProfile" onClick={handleAddProfile} />
            <Button variant="secondary" size="sm" text="common.cancel" onClick={() => { setShowAddForm(false); setAddError(null); }} />
          </div>
        </div>
      ) : (
        <Button variant="outline-primary" icon="plus-lg" text="settings.dnsProvider.addProfile" onClick={() => setShowAddForm(true)} />
      )}
    </>
  );
}

export default DnsProviderConfig;
