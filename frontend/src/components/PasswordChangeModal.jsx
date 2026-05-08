import React from 'react';
import Modal from 'react-bootstrap/Modal';

import { AlertMessage, Button, FormField, Translate } from './index.jsx';

/**
 * Password-change modal. Used by Accounts.jsx (per-row), Logins.jsx (per-row)
 * and Profile.jsx (per-user). The previous code triplicated this JSX with
 * tiny variations:
 *   - title displayed `mailbox` (Accounts/Logins) vs `username` (Profile)
 *   - Profile shows an "info" alert when the login isn't tied to a real
 *     mailbox (admin or non-account login) explaining the password change
 *     won't update a mailbox
 *
 * Props:
 *   - subject:        the entity being edited; supplies the title text
 *   - subjectField:   'mailbox' | 'username' — which field of `subject` to
 *                     show in the modal title (default 'mailbox')
 *   - showNotMailboxNotice: if true, render an "info" AlertMessage above
 *                     the form (Profile.jsx case for admin/non-account
 *                     logins). Default false.
 *   - All form state and handlers come from the parent.
 */
const PasswordChangeModal = ({
  subject,
  subjectField = 'mailbox',
  showNotMailboxNotice = false,
  show,
  onClose,
  onSubmit,
  formRef,
  formData,
  formErrors,
  onChange,
}) => {
  return (
    <Modal show={show} onHide={onClose}>
      <Modal.Header closeButton>
        <Modal.Title>
          {Translate('password.changePassword')} - {subject?.[subjectField]}{' '}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {showNotMailboxNotice && (
          <AlertMessage type="info" message="password.notMailbox" />
        )}
        {subject && (
          <form onSubmit={onSubmit} ref={formRef}>
            <FormField
              type="password"
              id="newPassword"
              name="newPassword"
              label="password.newPassword"
              value={formData.newPassword}
              onChange={onChange}
              error={formErrors.newPassword}
              required
            />

            <FormField
              type="password"
              id="confirmPasswordModal"
              name="confirmPassword"
              label="password.confirmPassword"
              value={formData.confirmPassword}
              onChange={onChange}
              error={formErrors.confirmPassword}
              required
            />
          </form>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant="secondary"
          onClick={onClose}
          text="common.cancel"
        />
        <Button
          variant="primary"
          onClick={onSubmit}
          text="password.changePassword"
        />
      </Modal.Footer>
    </Modal>
  );
};

export default PasswordChangeModal;
