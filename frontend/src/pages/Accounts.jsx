import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  debugLog,
  errorLog,
} from '../../frontend.mjs';
import {
//   regexColors,
//   regexPrintOnly,
//   regexFindEmailRegex,
//   regexFindEmailStrict,
//   regexFindEmailLax,
//   regexEmailRegex,
  regexEmailStrict,
//   regexEmailLax,
//   regexMatchPostfix,
//   regexUsername,
//   funcName,
//   fixStringType,
//   arrayOfStringToDict,
//   obj2ArrayOfObj,
//   reduxArrayOfObjByKey,
//   reduxArrayOfObjByValue,
//   reduxPropertiesOfObj,
//   mergeArrayOfObj,
  getValueFromArrayOfObj,
//   getValuesFromArrayOfObj,
//   pluck,
//   byteSize2HumanSize,
  humanSize2ByteSize,
//   moveKeyToLast,
} from '../../../common.mjs';

import {
  getAccounts,
  getDomains,
  getDovecotSessions,
  generatePassword,
  getServerEnvs,
  addAccount,
  deleteAccount,
  updateAccount,
  setAccountQuota,
  doveadm,
} from '../services/api.mjs';

import {
  AlertMessage,
  Accordion,
  Button,
  DataTable,
  FormField,
  LoadingSpinner,
  Translate,
} from '../components/index.jsx';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../hooks/useAuth';

import { useRef } from 'react';
import Modal from 'react-bootstrap/Modal'; // Import Modal
import ProgressBar from 'react-bootstrap/ProgressBar'; // Import ProgressBar

const Accounts = () => {
  const sortKeysInObject = ['usedBytes'];
  const { t } = useTranslation();
  const { user } = useAuth();
  const [containerName] = useLocalStorage("containerName", '');
  const [mailservers] = useLocalStorage("mailservers", []);

  const [accounts, setAccounts] = useState([]);
  const [DOVECOT_FTS, setDOVECOT_FTS] = useState(0);
  const [sessions, setSessions] = useState({});

  // Common states -------------------------------------------------
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  
  // State for new account inputs ----------------------------------
  const [newAccountformData, setNewAccountFormData] = useState({
    mailbox: '',
    password: '',
    confirmPassword: '',
    createLogin: 1,
  });
  const [newAccountFormErrors, setNewAccountFormErrors] = useState({});
  const [suggestedPassword, setSuggestedPassword] = useState(null);

  // State for password change modal -------------------------------
  const [selectedAccount, setSelectedAccount] = useState(null);
  const passwordFormRef = useRef(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordFormData, setPasswordFormData] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordFormErrors, setPasswordFormErrors] = useState({});

  // State for quota modal -----------------------------------------
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [quotaFormData, setQuotaFormData] = useState({
    value: '',
    unit: 'M',
    unlimited: false,
  });


  // https://www.w3schools.com/react/react_useeffect.asp
  useEffect(() => {
    // Auto-refresh from DMS once per session; manual refresh button always available
    const refreshed = sessionStorage.getItem('accountsRefreshed');
    fetchAccounts(!refreshed);
  }, [mailservers, containerName]);

  const fetchAccounts = async (refresh=false) => {
    refresh = !user.isAdmin ? false : refresh;
    
    try {
      setLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      
      // const [accountsData, DOVECOT_FTSdata] = await Promise.all([
      //   getAccounts(containerName, refresh),
      //   getServerEnvs('mailserver', containerName, refresh, 'DOVECOT_FTS'),
      // ]);
      const accountsData = await getAccounts(containerName, refresh);
      if (accountsData.success) {
        if (refresh) sessionStorage.setItem('accountsRefreshed', '1');
        // Ensure usedBytes exists for sorting (computed from human-readable 'used' field)
        const enriched = accountsData.message.map(a => {
          if (a.storage && a.storage.used && !a.storage.usedBytes) {
            a.storage.usedBytes = Number(humanSize2ByteSize(a.storage.used));
          }
          return a;
        });
        setAccounts(enriched);
        debugLog('ddebug accountsData', accountsData);

        const DOVECOT_FTSdata = await getServerEnvs('mailserver', containerName, refresh, 'DOVECOT_FTS');
        debugLog('ddebug DOVECOT_FTSdata', DOVECOT_FTSdata);
        if (DOVECOT_FTSdata.success) {
          setDOVECOT_FTS(DOVECOT_FTSdata.message);

        } else setErrorMessage(DOVECOT_FTSdata?.error);

        // Fetch active sessions (admin only, non-critical)
        if (user.isAdmin) {
          try {
            const sessionsData = await getDovecotSessions(containerName);
            if (sessionsData.success && sessionsData.message) {
              const sessionMap = {};
              for (const s of sessionsData.message) {
                sessionMap[s.username] = s;
              }
              setSessions(sessionMap);
            }
          } catch (e) { /* non-critical */ }
        }

      } else setErrorMessage(accountsData?.error);

    } catch (error) {
      errorLog(t('api.errors.fetchAccounts'), error);
      setErrorMessage(t('api.errors.fetchAccounts'), ": ", error);
      
    } finally {
      setLoading(false);
    }
  };

  const handleNewAccountInputChange = (e) => {
    const { name, value, type } = e.target;
    setNewAccountFormData({
      ...newAccountformData,
      [name]: type === 'number' ? Number(value) : value,
    });

    // Clear the error for this field while typing
    if (newAccountFormErrors[name]) {
      setNewAccountFormErrors({
        ...newAccountFormErrors,
        [name]: null,
      });
    }
  };

  const handleSuggestPassword = async () => {
    try {
      const result = await generatePassword(4);
      if (result.success) {
        const passphrase = result.message;
        setNewAccountFormData({
          ...newAccountformData,
          password: passphrase,
          confirmPassword: passphrase,
        });
        setSuggestedPassword(passphrase);
        setNewAccountFormErrors({ ...newAccountFormErrors, password: null, confirmPassword: null });
      }
    } catch (error) {
      errorLog('generatePassword', error);
    }
  };

  const validateNewAccountForm = () => {
    const errors = {};

    if (!newAccountformData.mailbox.trim()) {
      errors.mailbox = 'accounts.mailboxRequired';
    } else if (!regexEmailStrict.test(newAccountformData.mailbox)) {
      errors.mailbox = 'accounts.invalidMailbox';
    } else {
      // Check if domain is known (from existing accounts)
      const domain = newAccountformData.mailbox.split('@')[1];
      const knownDomains = [...new Set(accounts.map(a => a.domain).filter(Boolean))];
      if (domain && knownDomains.length && !knownDomains.includes(domain)) {
        if (!window.confirm(t('accounts.unknownDomain', { domain }))) {
          errors.mailbox = 'accounts.unknownDomainError';
        }
      }
    }

    if (!newAccountformData.password) {
      errors.password = 'password.passwordRequired';
    } else if (newAccountformData.password.length < 8) {
      errors.password = 'password.passwordLength';
    }

    if (newAccountformData.password !== newAccountformData.confirmPassword) {
      errors.confirmPassword = 'password.passwordsNotMatch';
    }

    setNewAccountFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmitNewAccount = async (e) => {
    e.preventDefault();
    setSuccessMessage(null);

    if (!validateNewAccountForm()) {
      return;
    }

    try {
      const result = await addAccount(
        getValueFromArrayOfObj(mailservers, containerName, 'value', 'schema'), 
        containerName,
        newAccountformData.mailbox,
        newAccountformData.password,
        newAccountformData.createLogin,
      );
      if (result.success) {
        setNewAccountFormData({
          mailbox: '',
          password: '',
          confirmPassword: '',
          createLogin: 1,
        });
        setSuggestedPassword(null);
        fetchAccounts(true); // Refresh the accounts list
        setSuccessMessage('accounts.accountCreated');
        
      } else setErrorMessage(result?.error);
      
    } catch (error) {
      errorLog(t('api.errors.addAccount'), error.message);
      setErrorMessage('api.errors.addAccount', error.message);
    }
  };

  const handleDelete = async (mailbox) => {
    setErrorMessage(null);
    if (window.confirm(t('accounts.confirmDelete', { mailbox:mailbox }))) {
      try {
        const result = await deleteAccount(getValueFromArrayOfObj(mailservers, containerName, 'value', 'schema'), containerName, mailbox);
        if (result.success) {
          fetchAccounts(true); // Refresh the accounts list
          setSuccessMessage('accounts.accountDeleted');
          
        } else setErrorMessage(result?.error);
        
      } catch (error) {
        errorLog(t('api.errors.deleteAccount'), error.message);
        setErrorMessage('api.errors.deleteAccount', error.message);
      }
    }
  };

  const handleDoveadm = async (command, mailbox) => {
    setErrorMessage(null);
    
    try {
      const result = await doveadm(getValueFromArrayOfObj(mailservers, containerName, 'value', 'schema'), containerName, command, mailbox);
      debugLog('result',result);
      if (result.success) {
        // setSuccessMessage('accounts.doveadmExecuted');
        setSuccessMessage(result.message);
      
      } else setErrorMessage(result?.error);
      
    } catch (error) {
      errorLog(t('api.errors.doveadm'), error.message);
      setErrorMessage('api.errors.doveadm', error.message);
    }
  };



  // Open password change modal for an account
  const handleChangePassword = (account) => {
    setSelectedAccount(account);
    
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
    setSelectedAccount(null);
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
    } else if (passwordFormData.newPassword.length < 8) {
      errors.newPassword = 'password.passwordLength';
    }

    if (passwordFormData.newPassword !== passwordFormData.confirmPassword) {
      errors.confirmPassword = 'password.passwordsNotMatch';
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
      const result = await updateAccount(
        getValueFromArrayOfObj(mailservers, containerName, 'value', 'schema'), 
        containerName,
        selectedAccount.mailbox,
        { password: passwordFormData.newPassword }
      );
      if (result.success) {
        setSuccessMessage(t('password.passwordUpdated', {username:selectedAccount.mailbox}));
        handleClosePasswordModal(); // Close the modal
        
      } else setErrorMessage(result?.error);
      
    } catch (error) {
      errorLog(t('api.errors.changePassword'), error);
      setErrorMessage('api.errors.changePassword');
    }
  };
  
  
  
  // Open quota modal for an account
  const handleSetQuota = (account) => {
    setSelectedAccount(account);
    const currentTotal = account.storage?.total;
    if (currentTotal && currentTotal !== 'unlimited') {
      // Parse current quota value (e.g. "2G" -> value=2, unit=G)
      const match = currentTotal.match(/^([\d.]+)\s*([KMGT]?)$/i);
      if (match) {
        setQuotaFormData({
          value: match[1],
          unit: match[2]?.toUpperCase() || 'M',
          unlimited: false,
        });
      } else {
        setQuotaFormData({ value: '', unit: 'M', unlimited: false });
      }
    } else {
      setQuotaFormData({ value: '', unit: 'G', unlimited: !currentTotal || currentTotal === 'unlimited' });
    }
    setShowQuotaModal(true);
  };

  const handleCloseQuotaModal = () => {
    setShowQuotaModal(false);
    setSelectedAccount(null);
  };

  const handleSubmitQuota = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const quota = quotaFormData.unlimited ? '0' : `${quotaFormData.value}${quotaFormData.unit}`;
      if (!quotaFormData.unlimited && (!quotaFormData.value || isNaN(quotaFormData.value) || Number(quotaFormData.value) <= 0)) {
        setErrorMessage(t('accounts.quotaInvalid'));
        return;
      }
      const result = await setAccountQuota(containerName, selectedAccount.mailbox, quota);
      if (result.success) {
        setSuccessMessage(t('accounts.quotaUpdated'));
        handleCloseQuotaModal();
        fetchAccounts(true);
      } else {
        setErrorMessage(result?.error);
      }
    } catch (error) {
      errorLog('setQuota', error);
      setErrorMessage('api.errors.setQuota');
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }
  
  // Column definitions for existing accounts table
  const columns = [
    { 
      key: 'domain',
      label: 'accounts.domain',
      render: (account) => (
        <span>{account.domain}</span>
      ),
    },
    {
      key: 'mailbox',
      label: 'accounts.mailbox',
      render: (account) => (
        <span>
          {account.mailbox}
          {sessions[account.mailbox] && (
            <span
              className="ms-2"
              title={`${sessions[account.mailbox].connections} ${t('accounts.activeConnections')} (${sessions[account.mailbox].services.join(', ')}) — ${sessions[account.mailbox].ips.join(', ')}`}
            >
              <i className="bi bi-circle-fill text-success" style={{fontSize: '0.5rem', verticalAlign: 'middle'}}></i>
            </span>
          )}
        </span>
      ),
    },
    { 
      key: 'username',
      label: 'logins.login',
    },
    {
      key: 'storage',
      label: 'accounts.storage',
      noFilter: true,
      render: (account) => {
        if (!account.storage?.used) return <span>N/A</span>;
        const percent = parseInt(account.storage.percent) || 0;
        const variant = percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : 'success';
        return (
          <div
            style={user.isAdmin == 1 ? { cursor: 'pointer' } : {}}
            title={user.isAdmin == 1 ? t('accounts.setQuota') : ''}
            onClick={user.isAdmin == 1 ? () => handleSetQuota(account) : undefined}
          >
            <div>
              {account.storage.used} / {account.storage.total}
              {account.storage.percent && <small className="text-muted ms-1">({account.storage.percent}%)</small>}
            </div>
            <ProgressBar
              now={percent}
              variant={variant}
              style={{ height: '5px' }}
              className="mt-1"
            />
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: 'common.actions',
      noSort: true,
      noFilter: true,
      render: (account) => (
        <div className="d-flex">
          <Button
            variant="primary"
            size="sm"
            icon="key"
            title={t('password.changePassword')}
            onClick={() => handleChangePassword(account)}
            className="me-2"
          />
          {user.isAdmin == 1 &&
            <Button
              variant="danger"
              size="sm"
              icon="trash"
              title={t('accounts.confirmDelete', { mailbox: account.mailbox })}
              onClick={() => handleDelete(account.mailbox)}
              className="me-2"
            />
          }
          {DOVECOT_FTS && (
          <Button
            variant="warning"
            size="sm"
            icon="stack-overflow"
            title={t('accounts.index')}
            onClick={() => handleDoveadm('index', account.mailbox)}
            className="me-2"
          />
          )}
          <Button
            variant="warning"
            size="sm"
            icon="arrow-repeat"
            title={t('accounts.forceResync')}
            onClick={() => handleDoveadm('forceResync', account.mailbox)}
            className="me-2"
          />
          <Button
            variant="info"
            size="sm"
            icon="bar-chart-fill"
            title={t('accounts.mailboxStatus')}
            onClick={() => handleDoveadm('mailboxStatus', account.mailbox)}
            className="me-2"
          />
        </div>
      ),
    },
  ];


  const FormNewAccount = (
          <form onSubmit={handleSubmitNewAccount} className="form-wrapper">
            <FormField
              type="mailbox"
              id="mailbox"
              name="mailbox"
              label="accounts.mailbox"
              value={newAccountformData.mailbox}
              onChange={handleNewAccountInputChange}
              placeholder="user@domain.com"
              error={newAccountFormErrors.mailbox}
              required
            />

            <FormField
              type="password"
              id="password"
              name="password"
              label="password.password"
              value={newAccountformData.password}
              onChange={handleNewAccountInputChange}
              error={newAccountFormErrors.password}
              required
            >
              <Button
                variant="outline-secondary"
                icon="dice-5-fill"
                title={t('accounts.suggestPassword')}
                onClick={handleSuggestPassword}
              />
            </FormField>

            {suggestedPassword && (
              <div className="mb-3 p-2 bg-light border rounded d-flex align-items-center justify-content-between">
                <code className="fs-6 user-select-all">{suggestedPassword}</code>
                <small className="text-muted ms-2">{t('accounts.suggestPasswordHint')}</small>
              </div>
            )}

            <FormField
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              label="password.confirmPassword"
              value={newAccountformData.confirmPassword}
              onChange={handleNewAccountInputChange}
              error={newAccountFormErrors.confirmPassword}
              required
            />

            <FormField
              type="checkbox"
              id="createLogin"
              name="createLogin"
              label="accounts.createLogin"
              value={newAccountformData.createLogin}
              onChange={handleNewAccountInputChange}
              error={newAccountFormErrors.createLogin}
              isChecked={newAccountformData.createLogin}
            />

            <Button
              type="submit"
              variant="primary"
              text="accounts.addAccount"
            />
          </form>
  );
  
  const DataTableAccounts = (
            <DataTable
            columns={columns}
            data={accounts}
            keyExtractor={(account) => account.mailbox}
            isLoading={isLoading}
            emptyMessage="accounts.noAccounts"
            sortKeysInObject={sortKeysInObject}
            />
  );
  
  const accountTabs = [
    { id: 1, title: "accounts.existingAccounts",  titleExtra: `(${accounts.length})`, icon: "inboxes-fill", onClickRefresh: () => fetchAccounts(true), content: DataTableAccounts },
  ];
  if (user.isAdmin) accountTabs.push({ id: 2, title: "accounts.newAccount",        icon: "inbox", content: FormNewAccount });

  // BUG: passing defaultActiveKey to Accordion as string does not activate said key, while setting it up as "1" in Accordion also does not
  // icons: https://icons.getbootstrap.com/
  return (
    <div>
      <h2 className="mb-4">{Translate('accounts.title')} {t('common.for', {what:containerName})}</h2>
      
      <AlertMessage type="danger" message={errorMessage} />
      <AlertMessage type="success" message={successMessage} />
      
      <Accordion tabs={accountTabs}>
      </Accordion>

      {/* Password Change Modal using react-bootstrap */}
      <Modal show={showPasswordModal} onHide={handleClosePasswordModal}>
        <Modal.Header closeButton>
          <Modal.Title>
            {Translate('password.changePassword')} - {selectedAccount?.mailbox}{' '}
            {/* Use optional chaining */}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedAccount && ( // Ensure selectedAccount exists before rendering form
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

      {/* Quota Modal */}
      <Modal show={showQuotaModal} onHide={handleCloseQuotaModal}>
        <Modal.Header closeButton>
          <Modal.Title>
            {Translate('accounts.setQuota')} - {selectedAccount?.mailbox}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedAccount && (
            <form onSubmit={handleSubmitQuota}>
              <div className="mb-3">
                <div className="form-check mb-3">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="quotaUnlimited"
                    checked={quotaFormData.unlimited}
                    onChange={(e) => setQuotaFormData({ ...quotaFormData, unlimited: e.target.checked })}
                  />
                  <label className="form-check-label" htmlFor="quotaUnlimited">
                    {t('accounts.quotaUnlimited')}
                  </label>
                </div>
                {!quotaFormData.unlimited && (
                  <div className="input-group">
                    <input
                      type="number"
                      className="form-control"
                      value={quotaFormData.value}
                      onChange={(e) => setQuotaFormData({ ...quotaFormData, value: e.target.value })}
                      placeholder={t('accounts.quotaValue')}
                      min="1"
                      step="1"
                    />
                    <select
                      className="form-select"
                      style={{ maxWidth: '80px' }}
                      value={quotaFormData.unit}
                      onChange={(e) => setQuotaFormData({ ...quotaFormData, unit: e.target.value })}
                    >
                      <option value="M">MB</option>
                      <option value="G">GB</option>
                    </select>
                  </div>
                )}
              </div>
            </form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={handleCloseQuotaModal}
            text="common.cancel"
          />
          <Button
            variant="primary"
            onClick={handleSubmitQuota}
            text="accounts.setQuota"
          />
        </Modal.Footer>
      </Modal>

    </div>
  );
};

export default Accounts;
