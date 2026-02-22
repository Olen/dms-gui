import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../frontend.mjs', () => ({
  debugLog: vi.fn(),
}));

vi.mock('./index.jsx', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
  AlertMessage: ({ type, message }) => message ? <div data-testid={`alert-${type}`}>{message}</div> : null,
  Translate: (key) => key,
}));

// Mock react-bootstrap Table and Form
vi.mock('react-bootstrap', () => ({
  Table: ({ children, ...props }) => <table {...props}>{children}</table>,
  Form: {
    Control: (props) => <input {...props} />,
  },
}));

import DataTable from './DataTable.jsx';

const booleanColumns = [
  { key: 'name', label: 'Name' },
  { key: 'enabled', label: 'Enabled' },
  { key: 'count', label: 'Count' },
];

describe('DataTable — boolean value rendering', () => {
  it('renders boolean true as visible text', () => {
    const data = [
      { name: 'Feature A', enabled: true, count: 5 },
    ];

    render(
      <DataTable
        columns={booleanColumns}
        data={data}
        keyExtractor={(item) => item.name}
      />
    );

    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it('renders boolean false as visible text', () => {
    const data = [
      { name: 'Feature B', enabled: false, count: 0 },
    ];

    render(
      <DataTable
        columns={booleanColumns}
        data={data}
        keyExtractor={(item) => item.name}
      />
    );

    expect(screen.getByText('false')).toBeInTheDocument();
  });

  it('renders a mix of boolean true and false values', () => {
    const data = [
      { name: 'Feature A', enabled: true, count: 1 },
      { name: 'Feature B', enabled: false, count: 0 },
    ];

    render(
      <DataTable
        columns={booleanColumns}
        data={data}
        keyExtractor={(item) => item.name}
      />
    );

    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
  });

  it('still renders string and number values normally', () => {
    const data = [
      { name: 'Feature A', enabled: true, count: 42 },
    ];

    render(
      <DataTable
        columns={booleanColumns}
        data={data}
        keyExtractor={(item) => item.name}
      />
    );

    expect(screen.getByText('Feature A')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it('renders empty message when data is empty', () => {
    render(
      <DataTable
        columns={booleanColumns}
        data={[]}
        keyExtractor={(item) => item.name}
        emptyMessage="No data available"
      />
    );

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });
});
