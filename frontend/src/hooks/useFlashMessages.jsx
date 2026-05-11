import React, { useState, useCallback } from 'react';
import AlertMessage from '../components/AlertMessage.jsx';

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
 *   <flash.Messages />                  // render the three alerts
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

  const Messages = useCallback(
    () => (
      <>
        <AlertMessage type="danger" message={errorMessage} />
        <AlertMessage type="success" message={successMessage} />
        {warningMessage !== null && (
          <AlertMessage type="warning" message={warningMessage} />
        )}
      </>
    ),
    [errorMessage, successMessage, warningMessage]
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
    Messages,
  };
};

export default useFlashMessages;
