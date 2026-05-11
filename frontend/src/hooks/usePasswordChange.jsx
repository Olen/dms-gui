import { useState, useRef, useCallback } from 'react';

/**
 * Shared password-change machinery. Used by Accounts, Logins, Profile —
 * each used to triplicate ~80 lines of state + handlers with tiny
 * variations.
 *
 * Caller responsibilities:
 *   - Provide `onSubmit(subject, { newPassword })` that calls the right
 *     API (updateLogin / updateAccount / etc.) and returns the result.
 *   - Render `<PasswordChangeModal {...passwordChange.modalProps} />`
 *     (modalProps assembles every prop the modal needs).
 *   - Wire success/error to a flash-message hook (or wherever).
 *
 * Differences captured as options:
 *   - `allowShortPasswords`: bypass the 8-char minimum. Profile passes
 *     `!user.isAdmin === false` here so admins can set short passwords.
 *   - `mismatchErrorKey`: i18n key for "passwords don't match". Defaults
 *     to `'logins.passwordsNotMatch'` (matches Logins.jsx + Profile.jsx).
 *     Accounts.jsx historically used `'password.passwordsNotMatch'`;
 *     pass it explicitly there to preserve the existing translation
 *     surface.
 */
export const usePasswordChange = ({
  onSubmit,
  allowShortPasswords = false,
  mismatchErrorKey = 'logins.passwordsNotMatch',
} = {}) => {
  const [subject, setSubject] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const formRef = useRef(null);

  // Open the modal for a specific subject (account/login/user object).
  const open = useCallback((sub) => {
    setSubject(sub);
    setFormData({ newPassword: '', confirmPassword: '' });
    setFormErrors({});
    setShowModal(true);
  }, []);

  const close = useCallback(() => {
    setShowModal(false);
    setSubject(null);
  }, []);

  const handleInputChange = useCallback(
    (e) => {
      const { name, value, type } = e.target;
      setFormData((prev) => ({
        ...prev,
        [name]: type === 'number' ? Number(value) : value,
      }));
      // Clear the error for this field while typing
      if (formErrors[name]) {
        setFormErrors((prev) => ({ ...prev, [name]: null }));
      }
    },
    [formErrors]
  );

  const validate = useCallback(() => {
    const errors = {};
    if (!formData.newPassword) {
      errors.newPassword = 'password.passwordRequired';
    } else if (formData.newPassword.length < 8 && !allowShortPasswords) {
      errors.newPassword = 'password.passwordLength';
    }
    if (formData.newPassword !== formData.confirmPassword) {
      errors.confirmPassword = mismatchErrorKey;
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData, allowShortPasswords, mismatchErrorKey]);

  /**
   * Run the submission. Returns:
   *   - { handled: true }                      validation failed, errors are
   *                                            already in formErrors
   *   - the result of onSubmit()               on a "real" submission attempt
   *                                            (which itself signals success
   *                                            via `result.success`)
   *   - { success: false, error, cause }       on thrown error
   *
   * On success, the modal is closed automatically.
   */
  const submit = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (!validate()) return { handled: true };
      try {
        const result = await onSubmit(subject, formData);
        if (result?.success) close();
        return result;
      } catch (cause) {
        return { success: false, error: 'api.errors.changePassword', cause };
      }
    },
    [validate, onSubmit, subject, formData, close]
  );

  // Convenience: every PasswordChangeModal invocation in the codebase
  // passes the same dozen props through. Bundle them so callers can
  // `<PasswordChangeModal {...modalProps} />` and add their own
  // `subjectField` / `showNotMailboxNotice` overrides as needed.
  const modalProps = {
    subject,
    show: showModal,
    onClose: close,
    onSubmit: submit,
    formRef,
    formData,
    formErrors,
    onChange: handleInputChange,
  };

  return {
    subject,
    showModal,
    formData,
    formErrors,
    formRef,
    open,
    close,
    handleInputChange,
    submit,
    validate,
    modalProps,
  };
};

export default usePasswordChange;
