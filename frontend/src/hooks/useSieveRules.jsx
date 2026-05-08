import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorLog } from '../../frontend.mjs';
import { regexEmailStrict } from '../../../common.mjs';
import {
  getSieveRules,
  saveSieveRules,
  deleteSieveRules,
} from '../services/api.mjs';

const emptyRules = () => ({
  forward: { enabled: false, address: '', keepCopy: true },
  vacation: { enabled: false, subject: '', message: '', days: 7 },
  block: { enabled: false, addresses: [] },
});

/**
 * State + handlers for the sieve-rules modal. Used by the per-account view
 * (Accounts.jsx, opens by row) and the per-user view (Profile.jsx, opens for
 * the logged-in user). Both feed the result into <SieveModal>.
 *
 * The hook accepts the parent's setErrorMessage / setSuccessMessage so its
 * notifications surface in whichever AlertMessage strip the page already has.
 */
export const useSieveRules = ({ containerName, setErrorMessage, setSuccessMessage }) => {
  const { t } = useTranslation();
  const [showSieveModal, setShowSieveModal] = useState(false);
  const [sieveMailbox, setSieveMailbox] = useState(null);
  const [sieveRules, setSieveRules] = useState(null);
  const [sieveScriptExists, setSieveScriptExists] = useState(false);
  const [sieveExternalScript, setSieveExternalScript] = useState(null);
  const [isSieveLoading, setIsSieveLoading] = useState(false);
  const [isSieveSaving, setIsSieveSaving] = useState(false);
  const [newBlockAddress, setNewBlockAddress] = useState('');

  const handleOpenSieve = async (mailbox) => {
    setSieveMailbox(mailbox);
    setShowSieveModal(true);
    setIsSieveLoading(true);
    setSieveExternalScript(null);
    setSieveRules(null);
    setSieveScriptExists(false);
    setNewBlockAddress('');

    try {
      const result = await getSieveRules(containerName, mailbox);
      if (result.success) {
        const data = result.message;
        setSieveScriptExists(data.scriptExists);
        if (data.rules) {
          setSieveRules(data.rules);
        } else if (data.scriptExists && data.rawScript) {
          // Script exists but has no dms-gui markers — show it read-only,
          // start from empty rules so the user can start fresh if they want.
          setSieveExternalScript(data.rawScript);
          setSieveRules(emptyRules());
        } else {
          setSieveRules(emptyRules());
        }
      } else {
        setErrorMessage?.(result?.error);
      }
    } catch (error) {
      errorLog('getSieveRules', error);
      setErrorMessage?.('accounts.sieve.errorFetch');
    } finally {
      setIsSieveLoading(false);
    }
  };

  const handleCloseSieve = () => {
    setShowSieveModal(false);
    setSieveMailbox(null);
    setSieveRules(null);
    setSieveExternalScript(null);
  };

  const handleSaveSieve = async () => {
    if (!sieveRules) return;
    setIsSieveSaving(true);
    try {
      const result = await saveSieveRules(containerName, sieveMailbox, sieveRules);
      if (result.success) {
        setSuccessMessage?.('accounts.sieve.saved');
        setSieveExternalScript(null);
        setSieveScriptExists(true);
      } else {
        setErrorMessage?.(result?.error);
      }
    } catch (error) {
      errorLog('saveSieveRules', error);
      setErrorMessage?.('accounts.sieve.errorSave');
    } finally {
      setIsSieveSaving(false);
    }
  };

  const handleDeleteSieve = async () => {
    if (!window.confirm(t('accounts.sieve.confirmDelete'))) return;
    setIsSieveSaving(true);
    try {
      const result = await deleteSieveRules(containerName, sieveMailbox);
      if (result.success) {
        setSuccessMessage?.('accounts.sieve.deleted');
        handleCloseSieve();
      } else {
        setErrorMessage?.(result?.error);
      }
    } catch (error) {
      errorLog('deleteSieveRules', error);
      setErrorMessage?.('accounts.sieve.errorDelete');
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

  return {
    // state
    showSieveModal,
    sieveMailbox,
    sieveRules,
    sieveScriptExists,
    sieveExternalScript,
    isSieveLoading,
    isSieveSaving,
    newBlockAddress,
    // handlers
    handleOpenSieve,
    handleCloseSieve,
    handleSaveSieve,
    handleDeleteSieve,
    updateSieveRule,
    addBlockAddress,
    removeBlockAddress,
    setNewBlockAddress,
  };
};
