import React from 'react';
import { Form, Row, Col } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import Select from 'react-select';
import { pluck } from '../../../common.mjs';
import Button from './Button.jsx';
import FormField from './FormField.jsx';
import SelectField from './SelectField.jsx';

// Add-a-login form. Extracted from Logins.jsx during the #87 split.
// All state lives in the parent; this is a pure JSX shell that the
// parent re-renders with its current `data` and `errors`. The
// `containerName`, `mailservers`, `accountOptions`, and
// `rolesGroupedOptions` flow in as props rather than the component
// reading them from hooks itself, so the same component can be
// re-mounted for different mailservers without state leakage.
const NewLoginForm = ({
  data,
  errors,
  containerName,
  mailservers,
  accountOptions,
  rolesGroupedOptions,
  highlightClassByDomain,
  toRoleOptions,
  onInputChange,
  onCheckboxChange,
  onRolesChange,
  onSubmit,
}) => {
  const { t } = useTranslation();

  return (
    <Form onSubmit={onSubmit} className="form-wrapper">
      <FormField
        type="checkbox"
        id="isAdmin"
        name="isAdmin"
        label="logins.isAdmin"
        onChange={onCheckboxChange}
        error={errors.isAdmin}
        isChecked={data.isAdmin}
      />

      <FormField
        type="checkbox"
        id="isAccount"
        name="isAccount"
        label="logins.isAccountChoice"
        onChange={onCheckboxChange}
        error={errors.isAccount}
        isChecked={data.isAccount && !data.isAdmin}
        disabled={data.isAdmin}
      />

      <SelectField
        id="mailserver"
        name="mailserver"
        label="logins.mailserver"
        value={containerName}
        onChange={onInputChange}
        options={mailservers}
        placeholder="logins.mailserverRequired"
        error={errors.mailserver}
        helpText="logins.mailserverRequired"
        required
      />

      {(data.isAccount && (
        <SelectField
          id="mailbox"
          name="mailbox"
          label="accounts.mailbox"
          value={
            pluck(accountOptions, 'value').includes(data.mailbox)
              ? data.mailbox
              : ''
          }
          onChange={onInputChange}
          options={accountOptions}
          placeholder="accounts.mailboxRequired"
          error={errors.mailbox}
          helpText="accounts.mailboxHelp"
          required
        />
      )) || (
        <FormField
          type="mailbox"
          id="mailbox"
          name="mailbox"
          label="logins.mailbox"
          value={data.mailbox}
          onChange={onInputChange}
          placeholder="user@domain.com"
          error={errors.mailbox}
          helpText="logins.mailboxHelp"
          required
        />
      )}

      <Select
        isMulti
        inputId="roles-new"
        aria-label={t('logins.roles')}
        options={rolesGroupedOptions}
        hideSelectedOptions
        isDisabled={data.isAccount}
        placeholder={t('logins.roles')}
        value={toRoleOptions(data.roles)}
        onChange={(selected) =>
          onRolesChange(
            null,
            (selected || []).map((o) => o.value)
          )
        }
        formatOptionLabel={(option, { context }) =>
          context === 'menu' ? (
            <span
              className={highlightClassByDomain(option.value, data?.mailbox)}
            >
              {option.label}
            </span>
          ) : (
            option.label
          )
        }
      />

      <FormField
        type="text"
        id="username"
        name="username"
        label="logins.username"
        value={data.username}
        onChange={onInputChange}
        placeholder="admin"
        error={errors.username}
        helpText="logins.usernameHelp"
        required
      />

      <FormField
        type="email"
        id="email"
        name="email"
        label="logins.email"
        value={data.email}
        onChange={onInputChange}
        placeholder="user@domain.com"
        error={errors.email}
        helpText="logins.emailHelp"
      />

      <Row className="mb-3">
        <FormField
          as={Col}
          type="password"
          id="password"
          name="password"
          label="password.password"
          value={data.password}
          onChange={onInputChange}
          error={errors.password}
          required
        />

        <FormField
          as={Col}
          type="password"
          id="confirmPassword"
          name="confirmPassword"
          label="password.confirmPassword"
          value={data.confirmPassword}
          onChange={onInputChange}
          error={errors.confirmPassword}
          required
        />
      </Row>

      <FormField
        type="checkbox"
        id="isActive"
        name="isActive"
        label="logins.isActive"
        onChange={onCheckboxChange}
        error={errors.isActive}
        isChecked={data.isActive}
      />

      <Button type="submit" variant="primary" text="logins.addLogin" />
    </Form>
  );
};

export default NewLoginForm;
