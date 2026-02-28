import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

vi.mock('./index.jsx', () => ({
  Translate: vi.fn((key) => key),
}));

// Mock react-bootstrap sub-module imports
vi.mock('react-bootstrap/Form', () => {
  const Control = ({ isInvalid, ...props }) => (
    <input data-testid="form-control" data-invalid={isInvalid || undefined} {...props} />
  );
  Control.Feedback = ({ children, type }) => (
    <div data-testid="feedback" data-type={type}>{children}</div>
  );

  const Check = ({ type, name, label, onChange, checked, defaultChecked, isInvalid, ...rest }) => (
    <div data-testid="form-check">
      <input type={type} name={name} onChange={onChange} checked={checked} defaultChecked={defaultChecked} data-testid="check-input" />
      <span>{label}</span>
    </div>
  );

  const Form = ({ children }) => <div>{children}</div>;
  Form.Group = ({ children, controlId, className }) => (
    <div data-testid={`group-${controlId}`} className={className}>{children}</div>
  );
  Form.Label = ({ children, className }) => (
    <label data-testid="form-label" className={className}>{children}</label>
  );
  Form.Control = Control;
  Form.Check = Check;
  Form.Text = ({ children }) => <small data-testid="help-text">{children}</small>;

  return { default: Form };
});

vi.mock('react-bootstrap/Row', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('react-bootstrap/InputGroup', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

import { Translate } from './index.jsx';
import FormField from './FormField.jsx';

describe('FormField', () => {
  it('renders text input with label', () => {
    render(<FormField id="name" name="name" label="Name" value="" onChange={() => {}} />);
    expect(screen.getByTestId('form-label')).toHaveTextContent('Name');
    expect(screen.getByTestId('form-control')).toBeInTheDocument();
  });

  it('renders checkbox via Form.Check', () => {
    render(<FormField id="active" name="active" type="checkbox" label="Active" onChange={() => {}} />);
    expect(screen.getByTestId('form-check')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByTestId('form-label')).not.toBeInTheDocument();
  });

  it('shows required asterisk', () => {
    render(<FormField id="email" name="email" label="Email" value="" required={true} onChange={() => {}} />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('shows error message when error is set', () => {
    render(<FormField id="email" name="email" label="Email" value="" error="field.required" onChange={() => {}} />);
    expect(screen.getByTestId('feedback')).toHaveTextContent('field.required');
  });

  it('shows help text', () => {
    render(<FormField id="email" name="email" label="Email" value="" helpText="Enter your email" onChange={() => {}} />);
    expect(screen.getByTestId('help-text')).toHaveTextContent('Enter your email');
  });

  it('calls onChange handler when input changes', () => {
    const handleChange = vi.fn();
    render(<FormField id="email" name="email" label="Email" value="" onChange={handleChange} />);
    fireEvent.change(screen.getByTestId('form-control'), { target: { value: 'test@test.com' } });
    expect(handleChange).toHaveBeenCalled();
  });

  it('applies custom groupClass', () => {
    render(<FormField id="test" name="test" label="Test" value="" groupClass="custom-class" onChange={() => {}} />);
    expect(screen.getByTestId('group-test')).toHaveClass('custom-class');
  });

  it('passes translate=true to Translate by default', () => {
    Translate.mockClear();
    render(<FormField id="test" name="test" label="my.label" value="" onChange={() => {}} />);
    expect(Translate).toHaveBeenCalledWith('my.label', true);
  });

  it('renders radio type via Form.Check', () => {
    render(<FormField id="opt" name="opt" type="radio" label="Option A" onChange={() => {}} />);
    expect(screen.getByTestId('form-check')).toBeInTheDocument();
    expect(screen.getByTestId('check-input')).toHaveAttribute('type', 'radio');
  });

  it('renders with default type as text input', () => {
    render(<FormField id="def" name="def" label="Default" value="val" onChange={() => {}} />);
    expect(screen.getByTestId('form-control')).toHaveAttribute('type', 'text');
  });
});
