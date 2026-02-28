import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

vi.mock('./index.jsx', () => ({
  Button: ({ onClick, title, ...props }) => (
    <button onClick={onClick} title={title} data-testid={`btn-${props.icon || 'default'}`}>{title}</button>
  ),
  LoadingSpinner: () => <span data-testid="spinner">Loading</span>,
  Translate: (key) => key,
}));

vi.mock('react-bootstrap/Card', () => {
  const Card = ({ children, className }) => <div data-testid="card" className={className}>{children}</div>;
  Card.Header = ({ children }) => <div data-testid="card-header">{children}</div>;
  Card.Title = ({ children, as, className }) => <div data-testid="card-title" className={className}>{children}</div>;
  Card.Body = ({ children, className, id }) => <div data-testid="card-body" className={className} id={id}>{children}</div>;
  Card.Text = ({ children }) => <p>{children}</p>;
  Card.Subtitle = ({ children }) => <h6>{children}</h6>;
  Card.Footer = ({ children }) => <div>{children}</div>;
  Card.Img = (props) => <img {...props} />;
  return { default: Card };
});

vi.mock('react-bootstrap/Collapse', () => ({
  default: ({ children, in: isOpen }) => isOpen !== false ? <div data-testid="collapse">{children}</div> : null,
}));

import Card from './Card.jsx';

describe('Card', () => {
  it('renders title and children', () => {
    render(<Card title="Dashboard">Content here</Card>);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Content here')).toBeInTheDocument();
  });

  it('collapse toggle hides content', () => {
    render(
      <Card title="Test" collapsible={true} startOpen={true}>
        <p>Visible content</p>
      </Card>
    );
    expect(screen.getByText('Visible content')).toBeInTheDocument();

    // Click the collapse button
    fireEvent.click(screen.getByTestId('btn-arrows-collapse'));
    expect(screen.queryByText('Visible content')).not.toBeInTheDocument();
  });

  it('refresh button calls onClickRefresh', () => {
    const handleRefresh = vi.fn();
    render(<Card title="Test" onClickRefresh={handleRefresh}>Content</Card>);
    fireEvent.click(screen.getByTestId('btn-arrow-repeat'));
    expect(handleRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows spinner when isLoading is true', () => {
    render(<Card title="Test" isLoading={true}>Content</Card>);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('renders titleExtra when not loading', () => {
    render(<Card title="Test" titleExtra={<span>badge</span>}>Content</Card>);
    expect(screen.getByText('badge')).toBeInTheDocument();
  });

  it('renders headerContent', () => {
    render(<Card headerContent={<div>Custom header</div>}>Content</Card>);
    expect(screen.getByText('Custom header')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<Card title="Test" className="my-card">Content</Card>);
    expect(screen.getByTestId('card')).toHaveClass('my-card');
  });

  it('applies p-0 class when noPadding is true', () => {
    render(<Card title="Test" noPadding={true}>Content</Card>);
    expect(screen.getByTestId('card-body')).toHaveClass('p-0');
  });
});
