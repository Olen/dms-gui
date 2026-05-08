import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal'; // Import Modal
import { useAuth } from '../hooks/useAuth';
import { useLocalStorage } from '../hooks/useLocalStorage';

import {
  debugLog,
  errorLog,
} from '../../frontend.mjs';
import {
  getValueFromArrayOfObj,
  regexEmailStrict,
} from '../../../common.mjs';

import {
  updateAccount,
  updateLogin,
  getConfigs,
} from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  FormField,
  LoadingSpinner,
  PasswordChangeModal,
  SieveModal,
  Translate,
  SelectField,
} from '../components/index.jsx';
import { useSieveRules } from '../hooks/useSieveRules';


const Profile = () => {
  // const sortKeysInObject = ['mailbox', 'username'];   // not needed as they are not objects, just rendered FormControl
  const { t } = useTranslation();
  const { user, login } = useAuth();

  const [containerName] = useLocalStorage("containerName", '');
  const [mailservers, setMailservers] = useLocalStorage("mailservers", []);

  // Common states -------------------------------------------------
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  
  // State for new login inputs ----------------------------------
  const [loginFormData, setloginFormData] = useState(user);
  const [loginFormErrors, setloginFormErrors] = useState({});

  // State for password change modal -------------------------------
  const [selectedLogin, setSelectedLogin] = useState(null);
  const passwordFormRef = useRef(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordFormData, setPasswordFormData] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordFormErrors, setPasswordFormErrors] = useState({});

  // Sieve state + handlers extracted to a shared hook.
  const sieve = useSieveRules({ containerName, setErrorMessage, setSuccessMessage });

  useEffect(() => {
    debugLog('user', user);
    // Initial setup is synchronous: copy user into the form. The previous
    // setLoading(true)/setLoading(false) sandwich never let the spinner
    // render because both calls fired in the same React batch. mailservers
    // is fired and awaited so the spinner stays up until the list is ready.
    setloginFormData(user);
    if (!mailservers || !mailservers.length) {
      setLoading(true);
      fetchMailservers().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [user]);

  // const fetchProfile = async () => {
    
  //   try {
  //     setErrorMessage(null);
  //     setSuccessMessage(null);

  //     // this does not need to be fetched lol
  //     setloginFormData({
  //       ...loginFormData,
  //       ...user
  //     });

  //   } catch (error) {
  //     errorLog(t('api.errors.fetchProfile'), error);
  //     setErrorMessage('api.errors.fetchProfile');
  //   }
  // };


  const fetchMailservers = async () => {
    
    debugLog(`fetchMailservers call getConfigs()`);
    try {
      const [mailserversData] = await Promise.all([
        getConfigs('mailserver'),
      ]);

      if (mailserversData.success) {
        // this will be all containers in db except dms-gui
        debugLog('fetchMailservers: mailserversData', mailserversData);   // [ {value:'containerName'}, .. ]
 
        // update selector list
        setMailservers(mailserversData.message.map(mailserver => { return { ...mailserver, label:mailserver.value } }));   // duplicate value as label for the select field

      } else setErrorMessage(mailserversData?.error);

    } catch (error) {
      errorLog(t('api.errors.fetchSettings'), error);
      setErrorMessage('api.errors.fetchSettings');
    }
  };


  const handleLoginInputChange = (e) => {
    debugLog('loginFormData',loginFormData);
    const { name, value, type } = e.target;
    
    debugLog('ddebug loginFormData', loginFormData);

    setloginFormData({
      ...loginFormData,
      [name]: type === 'number' ? Number(value) : value
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
      const result = await updateLogin(
        user.id,
        {username:loginFormData.username, email:loginFormData.email, mailserver:loginFormData.mailserver},
      );
      if (result.success) {
        login(loginFormData); // reset new values for that user in frontend state
        setSuccessMessage(t('logins.saved', {username:user.mailbox}));
        
      } else setErrorMessage(result?.error);
      
    } catch (error) {
      errorLog(error.message);
      setErrorMessage('api.errors.updateLogin');
    }
  };


  // Open password change modal
  const handleChangePassword = () => {
    setSelectedLogin(user);
    
    setPasswordFormData({
      newPassword: '',
      confirmPassword: '',
    });
    setPasswordFormErrors({});
    setShowPasswordModal(true);
  };

  // Close password change modal
  const handleClosePasswordModal = () => {
    setShowPasswordModal(false);
    setSelectedLogin(null);
  };

  // Handle input changes for password change form
  const handlePasswordInputChange = (e) => {
    const { name, value, type } = e.target;
    
    setPasswordFormData({
      ...passwordFormData,
      [name]: type === 'number' ? Number(value) : value,
    });

    // Clear the error for this field while typing
    if (passwordFormErrors[name]) {
      setPasswordFormErrors({
        ...passwordFormErrors,
        [name]: null,
      });
    }
  };

  // Validate password change form
  const validatePasswordForm = () => {
    const errors = {};

    if (!passwordFormData.newPassword) {
      errors.newPassword = 'password.passwordRequired';

    // admins can do anything including disregard password length
    } else if (passwordFormData.newPassword.length < 8 && !user.isAdmin) {
      errors.newPassword = 'password.passwordLength';
    }

    if (passwordFormData.newPassword !== passwordFormData.confirmPassword) {
      errors.confirmPassword = 'logins.passwordsNotMatch';
    }

    setPasswordFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit password change
  const handleSubmitPasswordChange = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!validatePasswordForm()) {
      return;
    }

    try {
      let result;
      if (selectedLogin.isAccount) {
        result = await updateAccount(
          getValueFromArrayOfObj(mailservers, containerName, 'value', 'schema'), 
          containerName,
          selectedLogin.mailbox,
          { password: passwordFormData.newPassword }
        );
      
      // normal dms-gui account
      } else {
        result = await updateLogin(
          selectedLogin.id,
          { password: passwordFormData.newPassword }
        );
      }
      if (result.success) {
        setSuccessMessage(t('password.passwordUpdated', {username:selectedLogin.mailbox}));
        handleClosePasswordModal(); // Close the modal
        
      } else setErrorMessage(result?.error);
      
    } catch (error) {
      errorLog(t('api.errors.changePassword'), error);
      setErrorMessage('api.errors.changePassword');
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
      
      <AlertMessage type="danger" message={errorMessage} />
      <AlertMessage type="success" message={successMessage} />
      
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
              value={loginFormData?.mailserver || mailservers[0]?.containerName || null}
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
          onClick={() => handleChangePassword()}
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
        subject={selectedLogin}
        subjectField="username"
        showNotMailboxNotice={!selectedLogin?.isAdmin && !selectedLogin?.isAccount}
        show={showPasswordModal}
        onClose={handleClosePasswordModal}
        onSubmit={handleSubmitPasswordChange}
        formRef={passwordFormRef}
        formData={passwordFormData}
        formErrors={passwordFormErrors}
        onChange={handlePasswordInputChange}
      />

      <SieveModal sieve={sieve} titleMailbox={user?.mailbox} />

    </div>
  );
};

export default Profile;
