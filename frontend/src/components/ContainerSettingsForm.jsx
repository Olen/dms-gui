import React from 'react';
import { Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { getValueFromArrayOfObj } from '../../../common.mjs';
import Button from './Button.jsx';
import FormField from './FormField.jsx';
import SelectField from './SelectField.jsx';

const PROTOCOLS = [
  { value: 'http', label: 'http' },
  { value: 'https', label: 'https' },
];

const SCHEMAS = [
  { value: 'dms', label: 'DMS' },
  { value: 'poste', label: 'Poste.io' },
];

// Container settings form. Extracted from FormContainerAdd.jsx during
// the #87 split. All state lives in the parent — this component is a
// pure JSX shell that re-renders with the parent's `formValues` and
// `formErrors`. The PROTOCOLS / SCHEMAS option lists are
// module-level constants here because neither list is ever mutated
// at runtime; the parent does not need to pass them.
const ContainerSettingsForm = ({
  formValues,
  formErrors,
  pingResult,
  apiInjected,
  formValidated,
  makeFavoriteRef,
  onSubmit,
  onChangeSettings,
  onPingTest,
  onInjectAPI,
  onApiTest,
  onApiKeyRegen,
  onSetSuccessMessage,
}) => {
  const { t } = useTranslation();

  return (
    <form onSubmit={onSubmit} className="form-wrapper">
      <SelectField
        id="schema"
        name="schema"
        label="settings.schema"
        value={getValueFromArrayOfObj(formValues, 'schema') || SCHEMAS[0].value}
        onChange={onChangeSettings}
        options={SCHEMAS}
        placeholder="settings.schema"
        helpText="settings.schemaHelp"
        required
      />

      <FormField
        type="text"
        id="containerName"
        name="containerName"
        label="settings.containerName"
        value={getValueFromArrayOfObj(formValues, 'containerName')}
        onChange={onChangeSettings}
        placeholder="dms"
        error={formErrors.containerName}
        helpText="settings.containerNameHelp"
        required
      >
        <Button
          variant={(pingResult && 'success') || 'danger'}
          icon={(pingResult && 'check') || 'x'}
          title={(pingResult && t('common.pingUp')) || t('common.pingDown')}
          disabled
        />
        <Button
          variant="info"
          icon="send"
          title={t('common.ping')}
          onClick={() => onPingTest()}
          disabled={!getValueFromArrayOfObj(formValues, 'containerName')}
        />
      </FormField>

      <SelectField
        id="protocol"
        name="protocol"
        label="settings.protocol"
        value={
          getValueFromArrayOfObj(formValues, 'protocol') || PROTOCOLS[0].value
        }
        onChange={onChangeSettings}
        options={PROTOCOLS}
        placeholder="common.protocol"
        helpText="settings.protocolHelp"
        required
      />

      <FormField
        type="number"
        id="DMS_API_PORT"
        name="DMS_API_PORT"
        label="settings.DMS_API_PORT"
        value={getValueFromArrayOfObj(formValues, 'DMS_API_PORT')}
        onChange={onChangeSettings}
        placeholder="settings.DMS_API_PORTdefault"
        error={formErrors.DMS_API_PORT}
        helpText="settings.DMS_API_PORTHelp"
        required
      />

      <FormField
        type="text"
        id="DMS_API_KEY"
        name="DMS_API_KEY"
        label="settings.DMS_API_KEY"
        value={getValueFromArrayOfObj(formValues, 'DMS_API_KEY')}
        onChange={onChangeSettings}
        placeholder="DMS_API_KEY"
        error={formErrors.DMS_API_KEY}
        helpText="settings.DMS_API_KEYHelp"
        required
      >
        <Button
          variant="warning"
          icon="recycle"
          title={t('settings.DMS_API_KEYregen')}
          onClick={() => onApiKeyRegen()}
        />
        <Button
          variant="outline-secondary"
          icon="question-circle"
          title={t('settings.DMS_API_KEYinitHelp')}
          onClick={() =>
            onSetSuccessMessage(
              t('settings.DMS_API_KEYinit', {
                containerName: getValueFromArrayOfObj(
                  formValues,
                  'containerName'
                ),
                DMS_API_KEY: getValueFromArrayOfObj(formValues, 'DMS_API_KEY'),
                DMS_API_PORT: getValueFromArrayOfObj(
                  formValues,
                  'DMS_API_PORT'
                ),
              })
            )
          }
        />
        <Button
          variant="outline-secondary"
          icon="clipboard-plus"
          title={t('common.copy')}
          onClick={() =>
            // writeText() returns a Promise; on insecure context /
            // permission denial / no Clipboard API it rejects. Swallow
            // explicitly so the unhandled-rejection doesn't end up in
            // DevTools — the user already sees the lack of paste in
            // their target window.
            navigator.clipboard
              .writeText(getValueFromArrayOfObj(formValues, 'DMS_API_KEY'))
              .catch(() => {})
          }
        />
      </FormField>

      <FormField
        type="number"
        id="timeout"
        name="timeout"
        label="settings.timeout"
        value={getValueFromArrayOfObj(formValues, 'timeout')}
        onChange={onChangeSettings}
        placeholder="settings.timeoutdefault"
        error={formErrors.timeout}
        helpText="settings.timeoutHelp"
        required
      />

      <FormField
        type="text"
        id="setupPath"
        name="setupPath"
        label="settings.setupPath"
        value={getValueFromArrayOfObj(formValues, 'setupPath')}
        onChange={onChangeSettings}
        placeholder="/usr/local/bin/setup"
        error={formErrors.setupPath}
        helpText="settings.setupPathHelp"
        required
      />

      <div className="d-flex align-items-center">
        <Button
          variant={(apiInjected && 'success') || 'info'}
          icon="box-arrow-in-up-right"
          text="settings.DMS_API_inject"
          title={
            (apiInjected && t('settings.DMS_API_injectSuccess')) ||
            t('settings.DMS_API_injectFailed')
          }
          className="me-2"
          onClick={() => onInjectAPI()}
          disabled={!pingResult}
        />
        <Button
          variant="info"
          icon="hdd-network"
          text="settings.apiTest"
          className="me-2"
          onClick={() => onApiTest()}
          disabled={!pingResult || !apiInjected || !formValidated}
        />
        <Button
          type="submit"
          variant="primary"
          text="settings.saveButtonSettings"
          className="me-2"
          disabled={!formValidated}
        />
        {/* FormField is a function component without forwardRef, so a
            `ref={…}` prop wouldn't reach the underlying input. The
            caller reads `makeFavoriteRef.current.checked` to decide
            whether to add the new container to the user's favorites
            after save — use a native Form.Check here so the ref
            actually attaches to the DOM checkbox. */}
        <Form.Check
          type="checkbox"
          id="makeFavorite"
          name="makeFavorite"
          label={t('settings.makeFavorite')}
          ref={makeFavoriteRef}
          disabled={!formValidated}
        />
      </div>
    </form>
  );
};

// Re-export the option lists so callers that need to read defaults
// (e.g. the formValues initial state in the parent) don't duplicate
// the data.
export { PROTOCOLS, SCHEMAS };

export default ContainerSettingsForm;
