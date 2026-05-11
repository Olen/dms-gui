import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Modal from 'react-bootstrap/Modal'; // Import Modal

import Select from 'react-select';

import { debugLog, errorLog } from '../../frontend.mjs';
import { pluck, regexUsername } from '../../../common.mjs';

import {
  getLogins,
  addLogin,
  deleteLogin,
  updateLogin,
  getAccounts,
  getConfigs,
} from '../services/api.mjs';

import {
  AlertMessage,
  Accordion,
  Button,
  DataTable,
  FormField,
  PasswordChangeModal,
  SelectField,
  LoadingSpinner,
  Translate,
} from '../components/index.jsx';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../hooks/useAuth';
import { usePasswordChange } from '../hooks/usePasswordChange';

const Logins = () => {
  // const sortKeysInObject = ['email', 'username'];   // not needed as they are not objects, just rendered FormControl
  const { t } = useTranslation();
  const { user } = useAuth();
  const [containerName] = useLocalStorage('containerName', '');
  const [mailservers] = useLocalStorage('mailservers', []);

  // Common states -------------------------------------------------
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Password-change machinery extracted to a shared hook (PR #86).
  const passwordChange = usePasswordChange({
    onSubmit: (login, formData) =>
      updateLogin(login.id, { password: formData.newPassword }),
  });

  // Form states --------------------------------------------------
  const [accountOptions, setAccountOptions] = useState([]);

  // Roles states -------------------------------------------------- // https://mui.com/material-ui/react-autocomplete/#multiple-values
  const [rolesAvailable, setRolesAvailable] = useState([]);

  // changed data --------------------------------------------------
  // Track changes in a separate dictionary
  const [logins, setLogins] = useState([]);
  const [editedData, setEditedData] = useState({});

  // show and changes in fields without modifying logins state
  const getFieldValue = (id, fieldName) => {
    return (
      editedData[id]?.[fieldName] ??
      logins.find((r) => r.id === id)?.[fieldName]
    );
  };

  // change detector to enable save button
  const isRowChanged = (id) => {
    return editedData[id] !== undefined;
  };

  // State for new login inputs ----------------------------------
  const [newLoginformData, setNewLoginFormData] = useState({
    mailbox: '',
    username: '',
    password: '',
    confirmPassword: '',
    email: '',
    isAdmin: 0,
    isAccount: 0,
    isActive: 1,
    mailserver: '',
    roles: [],
  });
  const [newLoginFormErrors, setNewLoginFormErrors] = useState({});

  // fetchAll is declared as `const` further down. The effect callback
  // runs after the component body finishes, so the const is initialised
  // by the time it fires; ESLint's react-hooks/exhaustive-deps still
  // flags textual TDZ. Suppressed per the same pattern used in
  // FormContainerAdd.jsx and Login.jsx.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability, react-hooks/exhaustive-deps -- forward-declared fetchAll, intentional
    fetchAll();
  }, [containerName]);

  const formatLoginsForTable = async (data) => {
    // add bolder for admins
    data = data.map((login) => {
      return {
        ...login,
        color: login.isAdmin ? 'fw-bolder' : null,
      };
    });

    // add blue color for linked accounts
    data = data.map((login) => {
      return {
        ...login,
        color: login.isAccount ? login?.color + ' text-info' : login?.color,
      };
    });

    // add muted color for inactives
    data = data.map((login) => {
      return {
        ...login,
        color: login.isActive ? login?.color : login?.color + ' td-opacity-25',
      };
    });

    return data;
  };

  const fetchAll = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      await Promise.all([fetchAccounts(), fetchLogins()]);
    } catch (error) {
      errorLog(t('api.errors.fetchLogins'), error);
      setErrorMessage('api.errors.fetchLogins');
    } finally {
      setLoading(false);
    }
  };

  const fetchAccounts = async () => {
    debugLog('ddebug containerName', containerName);

    try {
      // debugLog('ddebug containerName',containerName)
      const [accountsData] = await Promise.all([
        // loginsData better have a uniq readOnly id field we can use, as we may modify each other fields
        // getAccounts(getValueFromArrayOfObj(mailservers, containerName, 'value', 'schema'), containerName),
        getAccounts(containerName),
      ]);
      debugLog('accountsData', accountsData);

      if (accountsData.success) {
        // Prepare account options for the select field
        setAccountOptions(
          accountsData.message.map((account) => ({
            value: account.mailbox,
            label: account.mailbox,
          }))
        );

        let mailboxes = pluck(accountsData.message, 'mailbox', true, false); // we keep only an array of uniq (true) mailbox names [box1@domain.com, ..], already sorted by domain and no extra sort (false)
        setRolesAvailable(mailboxes);
        debugLog('mailboxes', mailboxes);
      } else setErrorMessage(accountsData?.error);
    } catch (error) {
      errorLog(t('api.errors.fetchAccounts'), error);
      setErrorMessage('api.errors.fetchAccounts');
    }
    // No finally: fetchAll owns the isLoading lifecycle. Clearing it
    // here would flip isLoading=false the moment fetchAccounts settles,
    // even if fetchLogins is still in flight — the Select would then
    // render with empty options before the data arrives.
  };

  const fetchLogins = async () => {
    try {
      const [loginsData] = await Promise.all([
        // loginsData better have a uniq readOnly id field we can use, as we may modify each other fields
        getLogins(),
      ]);

      if (loginsData.success) {
        let loginsDataAltered = await formatLoginsForTable(loginsData.message);
        debugLog('loginsDataAltered', loginsDataAltered);
        setLogins(loginsDataAltered);
      } else setErrorMessage(loginsData?.error);
    } catch (error) {
      errorLog(t('api.errors.fetchLogins'), error);
      setErrorMessage('api.errors.fetchLogins');
    }
    // See fetchAccounts: fetchAll's finally clears isLoading once
    // BOTH fetches have settled.
  };

  const handleNewLoginInputChange = (e) => {
    debugLog(newLoginformData);
    const { name, value, type } = e.target;

    // special cases ------------------------------
    let jsonDict = { [name]: type === 'number' ? Number(value) : value };

    if (name == 'email' && newLoginformData.isAccount) {
      // we are attached to a mailbox and user just chose it from the SelectField
      debugLog(`roles ==> [${value}]`);
      jsonDict.roles = [value];
    }

    setNewLoginFormData({
      ...newLoginformData,
      ...jsonDict,
    });

    // Clear the error for this field while typing
    if (newLoginFormErrors[name]) {
      setNewLoginFormErrors({
        ...newLoginFormErrors,
        [name]: null,
      });
    }
  };

  const handleNewLoginCheckboxChange = (e) => {
    debugLog(newLoginformData);
    const { name, checked } = e.target;

    // special cases ------------------------------
    let jsonDict = { [name]: checked ? 1 : 0 };

    if (name == 'isAdmin' && checked) {
      debugLog('isAccount ==> 0');
      // disable isAccount checkbox and SelectField
      // but we keep the mailbox that was selected
      // setNewLoginFormData({
      // ...newLoginformData,
      // isAccount: 0
      // });
      jsonDict.isAccount = 0;
    }

    if (name == 'isAccount' && checked) {
      debugLog('isAccount ==> 1');
      jsonDict.roles = pluck(accountOptions, 'value').includes(
        newLoginformData.mailbox
      )
        ? [newLoginformData.mailbox]
        : [];
    }

    setNewLoginFormData({
      ...newLoginformData,
      ...jsonDict,
    });
  };

  const handleNewLoginRolesChange = (e, newValue) => {
    // newValue is an arrey with all the options selected

    debugLog('newValue', newValue);
    debugLog('newLoginformData', newLoginformData);

    setNewLoginFormData({
      ...newLoginformData,
      roles: newValue,
    });
  };

  const validateNewLoginForm = () => {
    const errors = {};

    if (!newLoginformData.username.trim()) {
      errors.username = 'logins.usernameRequired';
    } else if (!regexUsername.test(newLoginformData.username)) {
      errors.username = 'logins.usernameInvalid';
    }

    // this is done by react
    // if (!newLoginformData.mailbox.trim()) {
    // errors.mailbox = 'logins.emailRequired';
    // } else if (!regexEmailStrict.test(newLoginformData.mailbox)) {
    // errors.mailbox = 'logins.invalidEmail';
    // }

    // this is done by react
    // if (!newLoginformData.email.trim()) {
    // errors.email = 'logins.emailRequired';
    // } else if (!regexEmailStrict.test(newLoginformData.email)) {
    // errors.email = 'logins.invalidEmail';
    // }

    if (!newLoginformData.password) {
      errors.password = 'password.passwordRequired';

      // admins can do anything including disregard password length
    } else if (newLoginformData.password.length < 8 && !user.isAdmin) {
      errors.password = 'password.passwordLength';
    }

    if (newLoginformData.password !== newLoginformData.confirmPassword) {
      errors.confirmPassword = 'logins.passwordsNotMatch';
    }

    setNewLoginFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmitNewLogin = async (e) => {
    e.preventDefault();
    setSuccessMessage(null);

    if (!validateNewLoginForm()) {
      return;
    }

    try {
      const result = await addLogin(
        newLoginformData.mailbox,
        newLoginformData.username,
        newLoginformData.password,
        newLoginformData.email,
        newLoginformData.isAdmin,
        newLoginformData.isAccount,
        newLoginformData.isActive,
        newLoginformData.mailserver,
        newLoginformData.roles,
        []
      );
      if (result.success) {
        setSuccessMessage('logins.loginCreated');
        setNewLoginFormData({
          mailbox: '',
          username: '',
          password: '',
          confirmPassword: '',
          email: '',
          isAdmin: 0,
          isAccount: 0,
          isActive: 1,
          mailserver: '',
          roles: [],
        });
        fetchAll(); // Refresh the logins list
      } else setErrorMessage(result?.error);
    } catch (error) {
      errorLog(t('api.errors.addLogin'), error.message);
      setErrorMessage('api.errors.addLogin');
    }
  };

  const handleLoginChange = (e, login, key, newValue) => {
    // newValue is an arrey with all the options selected

    debugLog('login', login); // { id: 1, mailbox: "admin@domain.com", username: "admin", isAdmin: 1, isActive: 1, color: "" }
    debugLog('key', key); // roles, emails, username...
    debugLog('newValue', newValue); // role: _[ "box1@domain.com", .. ]_ or mailbox: _new.mailbox@gmail.com_ or username: _admin2_
    debugLog('editedData', editedData); // { 1:{mailbox:newValue, username:newValue}, .. }
    debugLog(`isRowChanged(${login.id})`, isRowChanged(login.id)); //

    // set state, with changes
    // setLogins(prevLogins =>
    // prevLogins.map(item =>
    // item.id === login.id                            // for that login...
    // ? { ...item, [key]: newValue }                // update the key with newValue
    // : item                                        // and keep other items as they are
    // )
    // );

    // register change in a new key for that id
    setEditedData((prevEdited) => ({
      ...prevEdited,
      [login.id]: {
        ...prevEdited[login.id],
        [key]: newValue,
      },
    }));
  };

  const handleLoginDelete = async (login) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (
      window.confirm(t('logins.confirmDelete', { username: login.username }))
    ) {
      try {
        const result = await deleteLogin(login.id);
        if (result.success) {
          setSuccessMessage('logins.loginDeleted');
          fetchAll(); // Refresh the logins list
        } else setErrorMessage(result?.error);
      } catch (error) {
        errorLog(t('api.errors.deleteLogin'), error.message);
        setErrorMessage('api.errors.deleteLogin');
      }
    }
  };

  const handleLoginFlipBit = async (login, what) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const jsonDict = { [what]: +!login[what] };

      // special cases here as well as in the backend
      // disable isAccount for admins:
      if (what == 'isAdmin' && +!login.isAdmin == 1) jsonDict.isAccount = 0;
      // disable isAdmin for linked accounts:
      if (what == 'isAccount' && +!login.isAccount == 1) jsonDict.isAdmin = 0;

      const result = await updateLogin(login.id, jsonDict);

      if (result.success) {
        // reflect changes in the table instead of fetching all again // edit: nope, because of the alteration of logins data after fetch, we need to reload
        // setLogins(prevLogins =>
        //   prevLogins.map(item =>
        //     item.id === login.id                          // for that login...
        //       ? { ...item, ...jsonDict }                  // Set state for what hasChanged
        //       : item                                      // and keep other items as they are
        //   )
        // );
        // setSuccessMessage(t('logins.updated', {username:login.mailbox}));  // no need for that, the table will reflect the changes
        fetchLogins();
      } else setErrorMessage(result?.error);
    } catch (error) {
      errorLog(t('api.errors.updateLogin'), error.message);
      setErrorMessage('api.errors.updateLogin');
    }
  };

  // the save operation is done per id
  const handleLoginSave = async (login) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // // process all rows in editedData
      // const updatedData = data.map((row) =>
      // editedData[row.id] ? { ...row, ...editedData[row.id] } : row
      // );

      // send only the editedData from id: {mailbox:newEmail, username:newValue, roles:[whatever]}
      // ATTENTION the key field=email must come last or else subsequent db updates will fail!
      // moveKeyToLast(editedData[login.id], 'mailbox')   // no need anymore we use id instead
      const result = await updateLogin(login.id, editedData[login.id]);
      if (result.success) {
        // TODO: handle individual change failure

        // apply actual logins data with the changes
        // reflect changes in the table instead of fetching all again
        setLogins((prevLogins) =>
          prevLogins.map(
            (item) =>
              item.id === login.id // for that login...
                ? { ...item, ...editedData[login.id] } // merge current state with editedData
                : item // and keep other items as they are
          )
        );

        // reset editedData without that id
        const editedDataReset = { ...editedData };
        delete editedDataReset[login.id];
        setEditedData(editedDataReset);

        setSuccessMessage(t('logins.saved', { username: login.mailbox }));
      } else setErrorMessage(result?.error);
    } catch (error) {
      errorLog(t('api.errors.updateLogin'), error.message);
      setErrorMessage('api.errors.updateLogin');
    }
  };

  // Submit handler: hook does validation + the updateLogin call;
  // this wrapper wires the result into flash messages and the
  // i18n'd success label (uses .username, not .mailbox — differs
  // from Accounts.jsx and Profile.jsx).
  const handleSubmitPasswordChange = async (e) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    const result = await passwordChange.submit(e);
    if (!result || result.handled) return;
    if (result.success) {
      setSuccessMessage(
        t('password.passwordUpdated', {
          username: passwordChange.subject?.username,
        })
      );
    } else {
      setErrorMessage(result.error);
    }
  };

  // highlight options by shades of yellow if they equal the login's mailbox
  // or share its domain. Returns a className suffix; the label component
  // uses it to colour the dropdown row inside react-select. The domain
  // comparison is a string-equality check on the parsed domains, NOT a
  // regex match — `String.prototype.match(s)` would treat `s` as a
  // regex and let metacharacters in `s` (e.g. the `.` in `example.com`)
  // match more than expected.
  const highlightClassByDomain = (option, mailbox = undefined) => {
    if (!mailbox) return '';
    if (mailbox === option) return 'bg-warning bg-opacity-25';
    if (mailbox.split('@')[1] === option.split('@')[1])
      return 'bg-warning bg-opacity-10';
    return '';
  };

  // Convert the flat string array `rolesAvailable` into the grouped
  // option shape react-select expects: [{label: domain, options: [{value, label}]}].
  // Memoised on rolesAvailable so unrelated state changes (typing in
  // form fields, toggling the modal, etc.) don't rebuild the whole
  // grouped structure on every render.
  const rolesGroupedOptions = useMemo(() => {
    const byDomain = new Map();
    for (const r of rolesAvailable) {
      const dom = r.split('@')[1] || '';
      if (!byDomain.has(dom)) byDomain.set(dom, []);
      byDomain.get(dom).push({ value: r, label: r });
    }
    return Array.from(byDomain, ([label, options]) => ({ label, options }));
  }, [rolesAvailable]);

  // String[] → {value,label}[] for react-select's `value` prop.
  const toRoleOptions = (strings) =>
    (strings || []).map((s) => ({ value: s, label: s }));

  if (isLoading || !user?.isAdmin) {
    return <LoadingSpinner />;
  }

  // getOptionLabel={rolesAvailable}    // requires a dict
  // placeholder={t('logins.roles2pick')}

  // Column definitions for existing logins table
  // adding hidden data in the span before the FormField let us sort also this column
  const columns = [
    {
      key: 'mailbox',
      label: 'logins.mailbox',
      render: (login) => (
        <>
          <span className="d-none">{login.mailbox}</span>
          <FormField
            type="mailbox"
            id="mailbox"
            name="mailbox"
            value={getFieldValue(login.id, 'mailbox')}
            onChange={(e) =>
              handleLoginChange(e, login, 'mailbox', e.target.value)
            }
            groupClass=""
            className="form-control-sm"
            required
          />
        </>
      ),
    },
    {
      key: 'username',
      label: 'logins.username',
      render: (login) => (
        <>
          <span className="d-none">{login.username}</span>
          <FormField
            type="username"
            id="username"
            name="username"
            value={getFieldValue(login.id, 'username')}
            onChange={(e) =>
              handleLoginChange(e, login, 'username', e.target.value)
            }
            groupClass=""
            className="form-control-sm"
            required
          />
        </>
      ),
    },
    {
      key: 'isAdmin',
      label: 'logins.isAdmin',
      noFilter: true,
      render: (login) => (
        <>
          <span>{login.isAdmin ? t('common.yes') : t('common.no')}</span>
          <Button
            variant={login.isAdmin ? 'info' : 'warning'}
            size="xs"
            icon={login.isAdmin ? 'chevron-double-down' : 'chevron-double-up'}
            title={
              login.isAdmin
                ? t('logins.demote', { username: login.username })
                : t('logins.promote', { username: login.username })
            }
            onClick={() => handleLoginFlipBit(login, 'isAdmin')}
            className="me-2 float-end"
          />
        </>
      ),
    },
    {
      key: 'isAccount',
      label: 'logins.isAccount',
      noFilter: true,
      render: (login) =>
        /* only render linkAccount button when isAccount=0 if rolesAvailable.includes(login.mailbox) */
        /* always render unlinkAccount button when isAccount=1 */
        (login.isAccount ||
          (rolesAvailable && rolesAvailable.includes(login.mailbox))) && (
          <>
            <span>{login.isAccount ? t('common.yes') : t('common.no')}</span>
            <Button
              variant={login.isAccount ? 'warning' : 'info'}
              size="xs"
              icon={login.isAccount ? 'heartbreak' : 'link-45deg'}
              title={
                login.isAccount
                  ? t('logins.unlinkAccount', { username: login.username })
                  : t('logins.linkAccount', { username: login.username })
              }
              onClick={() => handleLoginFlipBit(login, 'isAccount')}
              className="me-2 float-end"
            />
          </>
        ),
    },
    {
      key: 'roles',
      label: 'logins.roles',
      noSort: true,
      render: (login) => (
        <Select
          isMulti
          inputId={`roles-${login.id}`}
          aria-label={t('logins.roles')}
          options={rolesGroupedOptions}
          hideSelectedOptions
          isDisabled={login.isAccount}
          placeholder={t('logins.roles')}
          value={toRoleOptions(getFieldValue(login.id, 'roles'))}
          onChange={(selected) =>
            handleLoginChange(
              null,
              login,
              'roles',
              (selected || []).map((o) => o.value)
            )
          }
          formatOptionLabel={(option, { context }) =>
            context === 'menu' ? (
              <span
                className={highlightClassByDomain(option.value, login?.mailbox)}
              >
                {option.label}
              </span>
            ) : (
              option.label
            )
          }
        />
      ),
    },
    {
      key: 'actions',
      label: 'common.actions',
      noSort: true,
      noFilter: true,
      render: (login) => (
        <div className="d-flex">
          <Button
            variant="primary"
            size="sm"
            icon="key"
            title={t('password.changePassword')}
            onClick={() => passwordChange.open(login)}
            className="me-2"
          />
          <Button
            variant="danger"
            size="sm"
            icon="trash"
            title={t('logins.confirmDelete', { username: login.mailbox })}
            onClick={() => handleLoginDelete(login)}
            className="me-2"
          />
          <Button
            variant="secondary"
            size="sm"
            icon={login.isActive ? 'toggle-on' : 'toggle-off'}
            title={
              login.isActive
                ? t('logins.deactivate', { username: login.mailbox })
                : t('logins.activate', { username: login.mailbox })
            }
            onClick={() => handleLoginFlipBit(login, 'isActive')}
            className="me-2"
          />
          <Button
            variant="primary"
            size="sm"
            icon="floppy2-fill"
            title={t('logins.save')}
            onClick={() => handleLoginSave(login)}
            className="me-2"
            disabled={!isRowChanged(login.id)}
          />
        </div>
      ),
    },
  ];

  const FormNewLogin = (
    <Form onSubmit={handleSubmitNewLogin} className="form-wrapper">
      <FormField
        type="checkbox"
        id="isAdmin"
        name="isAdmin"
        label="logins.isAdmin"
        onChange={handleNewLoginCheckboxChange}
        error={newLoginFormErrors.isAdmin}
        isChecked={newLoginformData.isAdmin}
      />

      <FormField
        type="checkbox"
        id="isAccount"
        name="isAccount"
        label="logins.isAccountChoice"
        onChange={handleNewLoginCheckboxChange}
        error={newLoginFormErrors.isAccount}
        isChecked={newLoginformData.isAccount && !newLoginformData.isAdmin}
        disabled={newLoginformData.isAdmin}
      />

      <SelectField
        id="mailserver"
        name="mailserver"
        label="logins.mailserver"
        value={containerName}
        onChange={handleNewLoginInputChange}
        options={mailservers}
        placeholder="logins.mailserverRequired"
        error={newLoginFormErrors.mailserver}
        helpText="logins.mailserverRequired"
        required
      />

      {(newLoginformData.isAccount && (
        <SelectField
          id="mailbox"
          name="mailbox"
          label="accounts.mailbox"
          value={
            pluck(accountOptions, 'value').includes(newLoginformData.mailbox)
              ? newLoginformData.mailbox
              : ''
          }
          onChange={handleNewLoginInputChange}
          options={accountOptions}
          placeholder="accounts.mailboxRequired"
          error={newLoginFormErrors.mailbox}
          helpText="accounts.mailboxHelp"
          required
        />
      )) || (
        <FormField
          type="mailbox"
          id="mailbox"
          name="mailbox"
          label="logins.mailbox"
          value={newLoginformData.mailbox}
          onChange={handleNewLoginInputChange}
          placeholder="user@domain.com"
          error={newLoginFormErrors.mailbox}
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
        isDisabled={newLoginformData.isAccount}
        placeholder={t('logins.roles')}
        value={toRoleOptions(newLoginformData.roles)}
        onChange={(selected) =>
          handleNewLoginRolesChange(
            null,
            (selected || []).map((o) => o.value)
          )
        }
        formatOptionLabel={(option, { context }) =>
          context === 'menu' ? (
            <span
              className={highlightClassByDomain(
                option.value,
                newLoginformData?.mailbox
              )}
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
        value={newLoginformData.username}
        onChange={handleNewLoginInputChange}
        placeholder="admin"
        error={newLoginFormErrors.username}
        helpText="logins.usernameHelp"
        required
      />

      <FormField
        type="email"
        id="email"
        name="email"
        label="logins.email"
        value={newLoginformData.email}
        onChange={handleNewLoginInputChange}
        placeholder="user@domain.com"
        error={newLoginFormErrors.email}
        helpText="logins.emailHelp"
      />

      <Row className="mb-3">
        <FormField
          as={Col}
          type="password"
          id="password"
          name="password"
          label="password.password"
          value={newLoginformData.password}
          onChange={handleNewLoginInputChange}
          error={newLoginFormErrors.password}
          required
        />

        <FormField
          as={Col}
          type="password"
          id="confirmPassword"
          name="confirmPassword"
          label="password.confirmPassword"
          value={newLoginformData.confirmPassword}
          onChange={handleNewLoginInputChange}
          error={newLoginFormErrors.confirmPassword}
          required
        />
      </Row>

      <FormField
        type="checkbox"
        id="isActive"
        name="isActive"
        label="logins.isActive"
        onChange={handleNewLoginCheckboxChange}
        error={newLoginFormErrors.isActive}
        isChecked={newLoginformData.isActive}
      />

      <Button type="submit" variant="primary" text="logins.addLogin" />
    </Form>
  );

  const DataTableLogins = (
    <DataTable
      columns={columns}
      data={logins}
      keyExtractor={(login) => login.id}
      isLoading={isLoading}
      emptyMessage="logins.noLogins"
    />
  );

  // https://icons.getbootstrap.com/
  const loginTabs = [
    {
      id: 1,
      title: 'logins.existingLogins',
      titleExtra: `(${logins.length})`,
      icon: 'person-lines-fill',
      onClickRefresh: () => fetchAll(),
      content: DataTableLogins,
    },
    {
      id: 2,
      title: 'logins.newLogin',
      icon: 'person-fill-add',
      content: FormNewLogin,
    },
  ];

  // BUG: passing defaultActiveKey to Accordion as string does not activate said key, while setting it up as "1" in Accordion also does not
  // icons: https://icons.getbootstrap.com/
  return (
    <div>
      <h2 className="mb-4">{Translate('logins.title')}</h2>

      <AlertMessage type="danger" message={errorMessage} />
      <AlertMessage type="success" message={successMessage} />

      <Accordion tabs={loginTabs}></Accordion>

      <PasswordChangeModal
        {...passwordChange.modalProps}
        onSubmit={handleSubmitPasswordChange}
      />
    </div>
  );
};

export default Logins;
