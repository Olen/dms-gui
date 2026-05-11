import React, { useState, useCallback } from 'react';
import AlertMessage from '../components/AlertMessage.jsx';

// Stable module-level component. Defined outside the hook so React's
// element-type reconciliation sees the same function reference across
// renders — render it inline via `{flash.messages}` and the subtree
// keeps its identity even when the message state changes.
const FlashAlerts = ({ error, success, warning }) => (
  <>
    <AlertMessage type="danger" message={error} />
    <AlertMessage type="success" message={success} />
    {warning !== null && <AlertMessage type="warning" message={warning} />}
  </>
);

/**
 * `[errorMessage, successMessage, warningMessage]` triple shared by
 * ~14 pages, plus the common `<AlertMessage type=… message=… />`
 * render pattern next to the page header.
 *
 * Usage:
 *
 *   const flash = useFlashMessages();
 *   …
 *   flash.error('something broke');     // set error
 *   flash.success('saved');             // set success
 *   flash.clear();                      // clear all three
 *   {flash.messages}                    // render the three alerts
 *
 * Direct setters are also exposed for places that prefer
 * `setErrorMessage(…)`-style assignment to ease migration.
 */
export const useFlashMessages = () => {
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [warningMessage, setWarningMessage] = useState(null);

  const clear = useCallback(() => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setWarningMessage(null);
  }, []);

  const messages = (
    <FlashAlerts
      error={errorMessage}
      success={successMessage}
      warning={warningMessage}
    />
  );

  return {
    errorMessage,
    successMessage,
    warningMessage,
    setErrorMessage,
    setSuccessMessage,
    setWarningMessage,
    error: setErrorMessage,
    success: setSuccessMessage,
    warning: setWarningMessage,
    clear,
    messages,
  };
};

export default useFlashMessages;
