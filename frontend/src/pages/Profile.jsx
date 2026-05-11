import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Form from 'react-bootstrap/Form';
import { useAuth } from '../hooks/useAuth';
import { useLocalStorage } from '../hooks/useLocalStorage';

import { debugLog, errorLog } from '../../frontend.mjs';
import { getValueFromArrayOfObj } from '../../../common.mjs';

import { updateAccount, updateLogin, getConfigs } from '../services/api.mjs';

import {
  Button,
  FormField,
  LoadingSpinner,
  PasswordChangeModal,
  SieveModal,
  Translate,
  SelectField,
} from '../components/index.jsx';
import { useSieveRules } from '../hooks/useSieveRules';
import { useFlashMessages } from '../hooks/useFlashMessages';
import { usePasswordChange } from '../hooks/usePasswordChange';

const Profile = () => {
  // const sortKeysInObject = ['mailbox', 'username'];   // not needed as they are not objects, just rendered FormControl
  const { t } = useTranslation();
  const { user, login } = useAuth();

  const [containerName] = useLocalStorage('containerName', '');
  const [mailservers, setMailservers] = useLocalStorage('mailservers', []);

  // Common states -------------------------------------------------
  const [isLoading, setLoading] = useState(true);
  const flash = useFlashMessages();
  const { setErrorMessage, setSuccessMessage } = flash;

  // State for new login inputs ----------------------------------
  const [loginFormData, setloginFormData] = useState(user);
  const [loginFormErrors, setloginFormErrors] = useState({});

  // Password change modal — state + handlers come from the shared hook.
  // Profile is the one site that needs `allowShortPasswords` (admins are
  // allowed to set short passwords) and that dispatches between
  // updateAccount (when the login is tied to a real mailbox) and
  // updateLogin (for the non-account / admin case).
  const passwordChange = usePasswordChange({
    allowShortPasswords: user?.isAdmin,
    onSubmit: async (subject, formData) => {
      if (subject.isAccount) {
        return updateAccount(
          getValueFromArrayOfObj(mailservers, containerName, 'value', 'schema'),
          containerName,
          subject.mailbox,
          { password: formData.newPassword }
        );
      }
      return updateLogin(subject.id, { password: formData.newPassword });
    },
  });

  // Sieve state + handlers extracted to a shared hook.
  const sieve = useSieveRules({
    containerName,
    setErrorMessage,
    setSuccessMessage,
  });

  const fetchMailservers = async () => {
    debugLog(`fetchMailservers call getConfigs()`);
    try {
      const [mailserversData] = await Promise.all([getConfigs('mailserver')]);

      if (mailserversData.success) {
        // this will be all containers in db except dms-gui
        debugLog('fetchMailservers: mailserversData', mailserversData); // [ {value:'containerName'}, .. ]

        // update selector list
        setMailservers(
          mailserversData.message.map((mailserver) => {
            return { ...mailserver, label: mailserver.value };
          })
        ); // duplicate value as label for the select field
      } else setErrorMessage(mailserversData?.error);
    } catch (error) {
      errorLog(t('api.errors.fetchSettings'), error);
      setErrorMessage('api.errors.fetchSettings');
    }
  };

  useEffect(() => {
    debugLog('user', user);
    // Initial setup is synchronous: copy user into the form. The previous
    // setLoading(true)/setLoading(false) sandwich never let the spinner
    // render because both calls fired in the same React batch. mailservers
    // is fired and awaited so the spinner stays up until the list is ready.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time copy at mount
    setloginFormData(user);
    if (!mailservers || !mailservers.length) {
      setLoading(true);
      fetchMailservers().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchMailservers + mailservers are intentionally stable in this effect; running them again would loop
  }, [user]);

  const handleLoginInputChange = (e) => {
    debugLog('loginFormData', loginFormData);
    const { name, value, type } = e.target;

    debugLog('ddebug loginFormData', loginFormData);

    setloginFormData({
      ...loginFormData,
      [name]: type === 'number' ? Number(value) : value,
    });

    // Clear the error for this field while typing
    if (loginFormErrors[name]) {
      setloginFormErrors({
        ...loginFormErrors,
        [name]: null,
      });
    }
  };

  const validateloginForm = () => {
    const errors = {};

    if (!loginFormData.mailserver.trim()) {
      errors.mailserver = 'logins.mailserverRequired';
    }

    // if (!loginFormData.username.trim()) {
    //   errors.username = 'logins.usernameRequired';
    // } else if (!regexUsername.test(loginFormData.username)) {
    //   errors.username = 'logins.usernameInvalid';
    // }

    // this is done by react
    // if (!loginFormData.mailbox.trim()) {
    // errors.mailbox = 'logins.emailRequired';
    // } else if (!regexEmailStrict.test(loginFormData.mailbox)) {
    // errors.mailbox = 'logins.invalidEmail';
    // }

    // this is done by react
    // if (!loginFormData.email.trim()) {
    // errors.email = 'logins.emailRequired';
    // } else if (!regexEmailStrict.test(loginFormData.email)) {
    // errors.email = 'logins.invalidEmail';
    // }

    setloginFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleLoginSave = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!validateloginForm()) {
      return;
    }

    try {
      // send only the editedData from id: {mailbox:newEmail, username:newValue, email:newEmail, roles:[whatever]}
      // ATTENTION the key field=mailbox must come last or else subsequent db updates will fail when you modify it!
      // moveKeyToLast(loginFormData, 'mailbox')  // no need for that, we just init loginFormData with mailbox last!
      // debugLog('ddebug loginFormData', loginFormData)
      // const result = await updateLogin(
      //   user.mailbox,
      //   loginFormData,
      // );

      // how about we push only the fields we want? like, the only fields the users can modify? hm??
      const result = await updateLogin(user.id, {
        username: loginFormData.username,
        email: loginFormData.email,
        mailserver: loginFormData.mailserver,
      });
      if (result.success) {
        login(loginFormData); // reset new values for that user in frontend state
        setSuccessMessage(t('logins.saved', { username: user.mailbox }));
      } else setErrorMessage(result?.error);
    } catch (error) {
      errorLog(error.message);
      setErrorMessage('api.errors.updateLogin');
    }
  };

  // Submit handler: the hook does validation + dispatches the API
  // call; this wrapper wires the result into flash messages and the
  // i18n'd success label.
  const handleSubmitPasswordChange = async (e) => {
    flash.clear();
    const result = await passwordChange.submit(e);
    if (!result || result.handled) return;
    if (result.success) {
      setSuccessMessage(
        t('password.passwordUpdated', {
          username: passwordChange.subject?.mailbox,
        })
      );
    } else {
      setErrorMessage(result.error);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  // BUG: passing defaultActiveKey to Accordion as string does not activate said key, while setting it up as "1" in Accordion also does not
  // icons: https://icons.getbootstrap.com/
  return (
    <div>
      <h2 className="mb-4">{Translate('logins.profilePage')}</h2>

      <flash.Messages />

      <Form onSubmit={handleLoginSave} className="form-wrapper">
        {user?.isAdmin == 1 && (
          <>
            <FormField
              type="checkbox"
              id="isAdmin"
              name="isAdmin"
              label="logins.isAdmin"
              error={loginFormErrors.isAdmin}
              defaultChecked={loginFormData.isAdmin}
              disabled
            />

            <FormField
              type="checkbox"
              id="isAccount"
              name="isAccount"
              label="logins.isAccountChoice"
              error={loginFormErrors.isAccount}
              defaultChecked={loginFormData.isAccount && !loginFormData.isAdmin}
              disabled
            />

            <SelectField
              id="mailserver"
              name="mailserver"
              label="logins.mailserver"
              value={
                loginFormData?.mailserver ||
                mailservers[0]?.containerName ||
                null
              }
              onChange={handleLoginInputChange}
              options={mailservers}
              placeholder="logins.mailserverRequired"
              error={loginFormErrors.mailserver}
              helpText="logins.mailserverRequired"
              required
            />
          </>
        )}

        {!loginFormData.isAccount && (
          <FormField
            type="mailbox"
            id="mailbox"
            name="mailbox"
            label="logins.mailbox"
            value={loginFormData.mailbox}
            onChange={handleLoginInputChange}
            placeholder="user@domain.com"
            error={loginFormErrors.mailbox}
            helpText="logins.mailboxHelp"
            required
            disabled
          />
        )}

        <FormField
          type="text"
          id="username"
          name="username"
          label="logins.username"
          value={loginFormData.username}
          onChange={handleLoginInputChange}
          placeholder="admin"
          error={loginFormErrors.username}
          helpText="logins.usernameHelp"
          required
          disabled={user?.isAdmin != 1}
        />

        <FormField
          type="email"
          id="email"
          name="email"
          label="logins.email"
          value={loginFormData.email}
          onChange={handleLoginInputChange}
          placeholder="user@domain.com"
          error={loginFormErrors.email}
          helpText="logins.emailHelp"
          disabled={user?.isAdmin != 1}
        />

        {user?.isAdmin == 1 && (
          <FormField
            type="checkbox"
            id="isActive"
            name="isActive"
            label="logins.isActive"
            error={loginFormErrors.isActive}
            defaultChecked={loginFormData.isActive}
            disabled
          />
        )}

        <Button
          variant="primary"
          type="submit"
          icon="floppy"
          text="logins.updateLogin"
          className="me-2"
        />
        <Button
          variant="primary"
          icon="key"
          text={t('password.changePassword')}
          onClick={() => passwordChange.open(user)}
          className="me-2"
        />
        {user?.isAccount == 1 && (
          <Button
            variant="secondary"
            icon="funnel"
            text={t('accounts.sieve.title')}
            onClick={() => sieve.handleOpenSieve(user.mailbox)}
            className="me-2"
          />
        )}
      </Form>

      <PasswordChangeModal
        {...passwordChange.modalProps}
        subjectField="username"
        showNotMailboxNotice={
          !passwordChange.subject?.isAdmin && !passwordChange.subject?.isAccount
        }
        onSubmit={handleSubmitPasswordChange}
      />

      <SieveModal sieve={sieve} titleMailbox={user?.mailbox} />
    </div>
  );
};

export default Profile;
