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
  getSieveRules,
  saveSieveRules,
  deleteSieveRules,
} from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  FormField,
  LoadingSpinner,
  Translate,
  SelectField,
} from '../components/index.jsx';


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

  // State for sieve rules modal ---------------------------------
  const [showSieveModal, setShowSieveModal] = useState(false);
  const [sieveRules, setSieveRules] = useState(null);
  const [sieveScriptExists, setSieveScriptExists] = useState(false);
  const [sieveExternalScript, setSieveExternalScript] = useState(null);
  const [isSieveLoading, setIsSieveLoading] = useState(false);
  const [isSieveSaving, setIsSieveSaving] = useState(false);
  const [newBlockAddress, setNewBlockAddress] = useState('');

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


  // Sieve rule handlers ------------------------------------------
  const handleOpenSieve = async () => {
    setShowSieveModal(true);
    setIsSieveLoading(true);
    setSieveExternalScript(null);
    setSieveRules(null);
    setSieveScriptExists(false);
    setNewBlockAddress('');

    try {
      const result = await getSieveRules(containerName, user.mailbox);
      if (result.success) {
        const data = result.message;
        setSieveScriptExists(data.scriptExists);
        if (data.rules) {
          setSieveRules(data.rules);
        } else if (data.scriptExists && data.rawScript) {
          setSieveExternalScript(data.rawScript);
          setSieveRules({
            forward: { enabled: false, address: '', keepCopy: true },
            vacation: { enabled: false, subject: '', message: '', days: 7 },
            block: { enabled: false, addresses: [] },
          });
        } else {
          setSieveRules({
            forward: { enabled: false, address: '', keepCopy: true },
            vacation: { enabled: false, subject: '', message: '', days: 7 },
            block: { enabled: false, addresses: [] },
          });
        }
      } else {
        setErrorMessage(result?.error);
      }
    } catch (error) {
      errorLog('getSieveRules', error);
      setErrorMessage('accounts.sieve.errorFetch');
    } finally {
      setIsSieveLoading(false);
    }
  };

  const handleCloseSieve = () => {
    setShowSieveModal(false);
    setSieveRules(null);
    setSieveExternalScript(null);
  };

  const handleSaveSieve = async () => {
    if (!sieveRules) return;
    setIsSieveSaving(true);
    try {
      const result = await saveSieveRules(containerName, user.mailbox, sieveRules);
      if (result.success) {
        setSuccessMessage('accounts.sieve.saved');
        setSieveExternalScript(null);
        setSieveScriptExists(true);
      } else {
        setErrorMessage(result?.error);
      }
    } catch (error) {
      errorLog('saveSieveRules', error);
      setErrorMessage('accounts.sieve.errorSave');
    } finally {
      setIsSieveSaving(false);
    }
  };

  const handleDeleteSieve = async () => {
    if (!window.confirm(t('accounts.sieve.confirmDelete'))) return;
    setIsSieveSaving(true);
    try {
      const result = await deleteSieveRules(containerName, user.mailbox);
      if (result.success) {
        setSuccessMessage('accounts.sieve.deleted');
        handleCloseSieve();
      } else {
        setErrorMessage(result?.error);
      }
    } catch (error) {
      errorLog('deleteSieveRules', error);
      setErrorMessage('accounts.sieve.errorDelete');
    } finally {
      setIsSieveSaving(false);
    }
  };

  const updateSieveRule = (section, key, value) => {
    setSieveRules(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  };

  const addBlockAddress = () => {
    const addr = newBlockAddress.trim();
    if (!addr || !regexEmailStrict.test(addr)) return;
    if (sieveRules.block.addresses.includes(addr)) return;
    updateSieveRule('block', 'addresses', [...sieveRules.block.addresses, addr]);
    setNewBlockAddress('');
  };

  const removeBlockAddress = (addr) => {
    updateSieveRule('block', 'addresses', sieveRules.block.addresses.filter(a => a !== addr));
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
            onClick={handleOpenSieve}
            className="me-2"
          />
        )}
      </Form>

      {/* Password Change Modal using react-bootstrap */}
      <Modal show={showPasswordModal} onHide={handleClosePasswordModal}>
        <Modal.Header closeButton>
          <Modal.Title>
            {Translate('password.changePassword')} - {selectedLogin?.username}{' '}
            {/* Use optional chaining */}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!selectedLogin?.isAdmin && !selectedLogin?.isAccount && <AlertMessage type="info" message={t('password.notMailbox')} />}
          {selectedLogin && ( // Ensure selectedLogin exists before rendering form
            <form onSubmit={handleSubmitPasswordChange} ref={passwordFormRef}>
              <FormField
                type="password"
                id="newPassword"
                name="newPassword"
                label="password.newPassword"
                value={passwordFormData.newPassword}
                onChange={handlePasswordInputChange}
                error={passwordFormErrors.newPassword}
                required
              />

              <FormField
                type="password"
                id="confirmPasswordModal"
                name="confirmPassword"
                label="password.confirmPassword"
                value={passwordFormData.confirmPassword}
                onChange={handlePasswordInputChange}
                error={passwordFormErrors.confirmPassword}
                required
              />
            </form>
          )}
        </Modal.Body>
        <Modal.Footer>
          {/* Use refactored Button component */}
          <Button
            variant="secondary"
            onClick={handleClosePasswordModal}
            text="common.cancel"
          />
          <Button
            variant="primary"
            onClick={handleSubmitPasswordChange}
            text="password.changePassword"
          />
        </Modal.Footer>
      </Modal>

      {/* Sieve Rules Modal */}
      <Modal show={showSieveModal} onHide={handleCloseSieve} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {Translate('accounts.sieve.title')} - {user?.mailbox}
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

    </div>
  );
};

export default Profile;
