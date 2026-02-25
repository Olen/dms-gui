import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

import {
  forgotPassword,
  validateResetToken,
  resetPassword,
} from '../services/api.mjs';

import {
  AlertMessage,
  Button,
  FormField,
  Card,
} from '../components/index.jsx';


export const ResetPassword = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  // Forgot password form state
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  // Reset password form state
  const [mailbox, setMailbox] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tokenValid, setTokenValid] = useState(null); // null=loading, true, false
  const [resetDone, setResetDone] = useState(false);

  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  // Validate token on mount if present
  useEffect(() => {
    if (token) {
      (async () => {
        try {
          const result = await validateResetToken(token);
          if (result.success) {
            setMailbox(result.mailbox);
            setTokenValid(true);
          } else {
            setTokenValid(false);
            setErrorMessage('resetPassword.invalidToken');
          }
        } catch {
          setTokenValid(false);
          setErrorMessage('resetPassword.invalidToken');
        }
      })();
    }
  }, [token]);

  // Handle "Forgot Password" form submit
  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    try {
      await forgotPassword(email);
      setEmailSent(true);
      setSuccessMessage('resetPassword.emailSent');
    } catch {
      // Always show success to prevent info disclosure
      setEmailSent(true);
      setSuccessMessage('resetPassword.emailSent');
    } finally {
      setLoading(false);
    }
  };

  // Handle "Reset Password" form submit
  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 8) {
      setErrorMessage('password.passwordLength');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('password.passwordsNotMatch');
      return;
    }

    setLoading(true);
    try {
      const result = await resetPassword(token, password);
      if (result.success) {
        setResetDone(true);
        setSuccessMessage('resetPassword.success');
      } else {
        setErrorMessage('resetPassword.failed');
      }
    } catch {
      setErrorMessage('resetPassword.failed');
    } finally {
      setLoading(false);
    }
  };

  // ---- RENDER: Token flow (reset password) ----
  if (token) {
    return (
      <Row className="justify-content-center" style={{ minHeight: '100vh', paddingTop: '12vh' }}>
        <Col md={6}>
          <Card title="resetPassword.title" icon="key" collapsible="false">

            {tokenValid === null && (
              <p>{t('common.loading')}</p>
            )}

            {tokenValid === false && (
              <>
                <AlertMessage type="danger" message={errorMessage} />
                <div className="text-center mt-3">
                  <Link to="/reset-password">{t('resetPassword.tryAgain')}</Link>
                </div>
              </>
            )}

            {tokenValid === true && !resetDone && (
              <>
                <p className="mb-3">{t('resetPassword.resetFor', { mailbox })}</p>
                <form onSubmit={handleResetSubmit}>
                  <FormField
                    type="password"
                    id="password"
                    name="password"
                    label="password.newPassword"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <FormField
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    label="password.confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    icon="key"
                    text="resetPassword.resetButton"
                    disabled={loading}
                  />
                </form>
                <AlertMessage type="danger" message={errorMessage} />
              </>
            )}

            {resetDone && (
              <>
                <AlertMessage type="success" message={successMessage} />
                <div className="text-center mt-3">
                  <Link to="/login">{t('resetPassword.backToLogin')}</Link>
                </div>
              </>
            )}

          </Card>
        </Col>
      </Row>
    );
  }

  // ---- RENDER: Forgot password flow ----
  return (
    <Row className="justify-content-center" style={{ minHeight: '100vh', paddingTop: '12vh' }}>
      <Col md={6}>
        <Card title="resetPassword.forgotTitle" icon="envelope" collapsible="false">

          {!emailSent ? (
            <>
              <p className="mb-3">{t('resetPassword.forgotInstructions')}</p>
              <form onSubmit={handleForgotSubmit}>
                <FormField
                  type="email"
                  id="email"
                  name="email"
                  label="logins.mailbox"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Button
                  type="submit"
                  variant="primary"
                  icon="envelope"
                  text="resetPassword.sendLink"
                  disabled={loading}
                />
              </form>
              <AlertMessage type="danger" message={errorMessage} />
            </>
          ) : (
            <AlertMessage type="success" message={successMessage} />
          )}

        </Card>

        <div className="text-center mt-3">
          <Link to="/login">{t('resetPassword.backToLogin')}</Link>
        </div>
      </Col>
    </Row>
  );
};

export default ResetPassword;
