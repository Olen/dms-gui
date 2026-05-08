import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing the component

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      const translations = {
        'aliases.title': 'Aliases Management',
        'aliases.destinationAddress': 'Destination address(es)',
        'aliases.selectDestination': 'Select or type email addresses',
        'aliases.destinationInfo': 'Forward to existing accounts or type external email addresses.',
        'aliases.destinationRequired': 'Destination address is required',
        'aliases.sourceRequired': 'Source address is required',
        'aliases.sourceAlias': 'Source Address (Alias)',
        'aliases.sourceRegex': 'Source Address (Regex)',
        'aliases.sourceInfo': 'This is the address mail will be sent to.',
        'aliases.addAlias': 'Add Alias',
        'aliases.newAlias': 'Add New Alias',
        'aliases.existingAliases': 'Existing Aliases',
        'aliases.noAliases': 'No aliases.',
        'aliases.aliasCreated': 'Alias created!',
        'aliases.invalidSource': 'Invalid email format',
        'aliases.invalidSourceDomain': 'Domain not managed',
        'aliases.addExternal': 'Add',
        'aliases.typeToAdd': 'Type an email address and press Enter',
        'aliases.sourceAlreadyExists': 'An alias with this source address already exists',
        'aliases.sourceIsAccount': 'This address is already a mailbox account',
        'aliases.noRoles': 'No mailboxes available',
        'common.for': `for ${opts?.what || ''}`,
        'common.actions': 'Actions',
      };
      return translations[key] || key;
    },
  }),
}));

vi.mock('../../frontend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
}));

vi.mock('../../../common.mjs', () => ({
  regexEmailRegex: /^\/[\S]+@[\S]+\/$/,
  regexEmailStrict: /^([\w.\-_]+)@([\w.\-_]+)$/,
  regexEmailLax: /^([\S]+)@([\S]+)$/,
  pluck: (array, key) => [...new Set(array.map(item => item[key]))].sort(),
}));

const mockGetAliases = vi.fn();
const mockGetAccounts = vi.fn();
const mockAddAlias = vi.fn();
const mockDeleteAlias = vi.fn();
const mockUpdateAlias = vi.fn();

const mockGetUserSettings = vi.fn();

vi.mock('../services/api.mjs', () => ({
  getAliases: (...args) => mockGetAliases(...args),
  getAccounts: (...args) => mockGetAccounts(...args),
  addAlias: (...args) => mockAddAlias(...args),
  deleteAlias: (...args) => mockDeleteAlias(...args),
  updateAlias: (...args) => mockUpdateAlias(...args),
  getUserSettings: (...args) => mockGetUserSettings(...args),
}));

// Captures from the AliasEditModal mock so tests can drive it.
let _editModalLatestProps = null;

vi.mock('../components/index.jsx', () => ({
  AlertMessage: ({ type, message }) => message ? <div data-testid={`alert-${type}`}>{message}</div> : null,
  AliasEditModal: (props) => {
    _editModalLatestProps = props;
    return props.show
      ? (
          <div data-testid="alias-edit-modal">
            <span data-testid="modal-source">{props.alias?.source}</span>
            <span data-testid="modal-destination">{props.alias?.destination}</span>
          </div>
        )
      : null;
  },
  Button: ({ type, variant, text, icon, onClick, ...rest }) => (
    <button
      type={type}
      className={variant}
      data-icon={icon}
      onClick={onClick}
      {...rest}
    >{text || icon}</button>
  ),
  Card: ({ title, children }) => <div data-testid={`card-${title}`}>{children}</div>,
  DataTable: ({ columns, data, emptyMessage }) => (
    <div data-testid="data-table">
      {data.length === 0 ? <span>{emptyMessage}</span> : data.map((row, i) => (
        <div key={i} data-testid="alias-row" data-source={row.source}>
          <span>{row.source} → {row.destination}</span>
          {(columns || []).filter(c => c.render && c.key === 'actions').map((col) => (
            <span key={col.key} data-testid={`row-${i}-${col.key}`}>{col.render(row)}</span>
          ))}
        </div>
      ))}
    </div>
  ),
  FormField: ({ id, name, value, onChange, placeholder, label, ...rest }) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  ),
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
  Translate: (key) => key,
}));

// Stable references to prevent infinite re-renders in useEffect
const stableMailservers = [];
const stableSetFn = () => {};

vi.mock('../hooks/useLocalStorage', () => ({
  useLocalStorage: (key) => {
    if (key === 'containerName') return ['test-mailserver', stableSetFn];
    if (key === 'mailservers') return [stableMailservers, stableSetFn];
    return ['', stableSetFn];
  },
}));

let mockUser = { isAdmin: true };
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}));

import Aliases from './Aliases.jsx';

const defaultAccounts = [
  { mailbox: 'alice@example.com', domain: 'example.com', storage: {} },
  { mailbox: 'bob@example.com', domain: 'example.com', storage: {} },
];

const defaultAliases = [
  { source: 'info@example.com', destination: 'alice@example.com', regex: 0 },
];

function setupMocks({ aliases = defaultAliases, accounts = defaultAccounts } = {}) {
  mockGetAliases.mockResolvedValue({ success: true, message: aliases });
  mockGetAccounts.mockResolvedValue({ success: true, message: accounts });
  mockAddAlias.mockResolvedValue({ success: true });
  mockGetUserSettings.mockResolvedValue({ success: true, message: { ALLOW_USER_ALIASES: 'true' } });
}

/** Get the react-select combobox input */
function getSelectInput() {
  return screen.getByRole('combobox');
}

/** Open the react-select dropdown menu via keyboard */
async function openSelectMenu() {
  const input = getSelectInput();
  await act(async () => {
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
  });
}

/** Select an option from the react-select dropdown */
async function selectOption(text) {
  await openSelectMenu();
  await waitFor(() => {
    expect(screen.getByText(text)).toBeInTheDocument();
  });
  await act(async () => {
    fireEvent.click(screen.getByText(text));
  });
}

/** Type a custom value and press Enter to create it */
async function typeAndCreateOption(value) {
  const input = getSelectInput();
  await act(async () => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
  });
  await waitFor(() => {
    expect(screen.getByText(new RegExp(`Add.*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument();
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  });
}

async function renderAliases() {
  await act(async () => {
    render(<Aliases />);
  });
  await waitFor(() => {
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
  });
}

describe('Aliases — multi-destination CreatableSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { isAdmin: true };
    setupMocks();
  });

  it('renders the destination label and help text', async () => {
    await renderAliases();
    expect(screen.getByText('Destination address(es)')).toBeInTheDocument();
    expect(screen.getByText('Select or type email addresses')).toBeInTheDocument();
    expect(screen.getByText(/Forward to existing accounts/)).toBeInTheDocument();
  });

  it('shows existing accounts as dropdown options', async () => {
    await renderAliases();
    await openSelectMenu();

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });
  });

  it('allows selecting an existing account from dropdown', async () => {
    await renderAliases();
    await selectOption('alice@example.com');

    // The placeholder should be replaced by the chip
    expect(screen.queryByText('Select or type email addresses')).not.toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('allows creating a custom external email address', async () => {
    await renderAliases();
    await typeAndCreateOption('external@other.com');

    expect(screen.getByText('external@other.com')).toBeInTheDocument();
  });

  it('allows selecting multiple destinations', async () => {
    await renderAliases();

    await selectOption('alice@example.com');
    await selectOption('bob@example.com');

    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('submits comma-separated destinations to addAlias', async () => {
    await renderAliases();

    // Fill source (use address that doesn't exist as alias or account)
    const sourceInput = screen.getByPlaceholderText('alias@domain.com');
    fireEvent.change(sourceInput, { target: { value: 'sales@example.com', name: 'source', type: 'text' } });

    // Select two destinations
    await selectOption('alice@example.com');
    await selectOption('bob@example.com');

    // Submit form
    await act(async () => {
      fireEvent.click(screen.getByText('aliases.addAlias'));
    });

    await waitFor(() => {
      expect(mockAddAlias).toHaveBeenCalledWith(
        'test-mailserver',
        'sales@example.com',
        'alice@example.com,bob@example.com'
      );
    });
  });

  it('submits with a mix of existing and custom destinations', async () => {
    await renderAliases();

    // Fill source (use address that doesn't exist as alias or account)
    const sourceInput = screen.getByPlaceholderText('alias@domain.com');
    fireEvent.change(sourceInput, { target: { value: 'sales@example.com', name: 'source', type: 'text' } });

    // Select an existing account
    await selectOption('alice@example.com');

    // Type a custom external address
    await typeAndCreateOption('external@other.com');

    // Submit form
    await act(async () => {
      fireEvent.click(screen.getByText('aliases.addAlias'));
    });

    await waitFor(() => {
      expect(mockAddAlias).toHaveBeenCalledWith(
        'test-mailserver',
        'sales@example.com',
        'alice@example.com,external@other.com'
      );
    });
  });

  it('shows validation error when destination is empty on submit', async () => {
    await renderAliases();

    // Fill source but leave destination empty
    const sourceInput = screen.getByPlaceholderText('alias@domain.com');
    fireEvent.change(sourceInput, { target: { value: 'info@example.com', name: 'source', type: 'text' } });

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByText('aliases.addAlias'));
    });

    await waitFor(() => {
      expect(screen.getByText('Destination address is required')).toBeInTheDocument();
    });

    expect(mockAddAlias).not.toHaveBeenCalled();
  });

  it('resets destination after successful submit', async () => {
    await renderAliases();

    // Fill source (use address that doesn't exist as alias or account)
    const sourceInput = screen.getByPlaceholderText('alias@domain.com');
    fireEvent.change(sourceInput, { target: { value: 'sales@example.com', name: 'source', type: 'text' } });

    // Select a destination
    await selectOption('alice@example.com');
    expect(screen.queryByText('Select or type email addresses')).not.toBeInTheDocument();

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByText('aliases.addAlias'));
    });

    await waitFor(() => {
      expect(mockAddAlias).toHaveBeenCalled();
    });

    // After successful submit, the placeholder should return (chips cleared)
    await waitFor(() => {
      expect(screen.getByText('Select or type email addresses')).toBeInTheDocument();
    });
  });

  it('rejects invalid email format in custom destination', async () => {
    await renderAliases();

    // Type an invalid value — the "Add: ..." create option should NOT appear
    const input = getSelectInput();
    await act(async () => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'not-an-email' } });
    });

    // Wait a tick for react-select to update
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // The create label should not appear for invalid input
    expect(screen.queryByText(/Add.*not-an-email/)).not.toBeInTheDocument();
  });

  it('accepts valid email format in custom destination', async () => {
    await renderAliases();

    const input = getSelectInput();
    await act(async () => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'valid@other.com' } });
    });

    await waitFor(() => {
      expect(screen.getByText(/Add.*valid@other\.com/)).toBeInTheDocument();
    });
  });

  it('shows error when source already exists as an alias', async () => {
    await renderAliases();

    const sourceInput = screen.getByPlaceholderText('alias@domain.com');
    fireEvent.change(sourceInput, { target: { value: 'info@example.com', name: 'source', type: 'text' } });

    await selectOption('alice@example.com');

    await act(async () => {
      fireEvent.click(screen.getByText('aliases.addAlias'));
    });

    // AlertMessage renders the translation key directly
    await waitFor(() => {
      expect(screen.getByTestId('alert-danger')).toHaveTextContent('aliases.sourceAlreadyExists');
    });
    expect(mockAddAlias).not.toHaveBeenCalled();
  });

  it('shows error when source already exists as an account', async () => {
    await renderAliases();

    const sourceInput = screen.getByPlaceholderText('alias@domain.com');
    fireEvent.change(sourceInput, { target: { value: 'alice@example.com', name: 'source', type: 'text' } });

    await selectOption('bob@example.com');

    await act(async () => {
      fireEvent.click(screen.getByText('aliases.addAlias'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('alert-danger')).toHaveTextContent('aliases.sourceIsAccount');
    });
    expect(mockAddAlias).not.toHaveBeenCalled();
  });

  it('clears destination error when a destination is selected', async () => {
    await renderAliases();

    // Trigger validation error
    const sourceInput = screen.getByPlaceholderText('alias@domain.com');
    fireEvent.change(sourceInput, { target: { value: 'info@example.com', name: 'source', type: 'text' } });

    await act(async () => {
      fireEvent.click(screen.getByText('aliases.addAlias'));
    });

    await waitFor(() => {
      expect(screen.getByText('Destination address is required')).toBeInTheDocument();
    });

    // Select a destination — error should clear
    await selectOption('alice@example.com');

    await waitFor(() => {
      expect(screen.queryByText('Destination address is required')).not.toBeInTheDocument();
    });
  });
});


describe('Aliases — non-admin user restrictions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { isAdmin: false, roles: ['alice@example.com'] };
    setupMocks();
  });

  it('shows only user roles as destination options (not all accounts)', async () => {
    await renderAliases();
    await openSelectMenu();

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
    // bob@example.com is an account but not in user's roles
    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
  });

  it('does not allow typing custom external addresses', async () => {
    await renderAliases();

    const input = getSelectInput();
    await act(async () => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'external@other.com' } });
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // The "Add: ..." create label should not appear for non-admin
    expect(screen.queryByText(/Add.*external@other\.com/)).not.toBeInTheDocument();
  });
});


describe('Aliases — edit flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { isAdmin: true };
    _editModalLatestProps = null;
    setupMocks({
      aliases: [
        { source: 'info@example.com', destination: 'alice@example.com,bob@example.com', regex: 0 },
        { source: '/^postmaster.*/', destination: 'alice@example.com', regex: 1 },
      ],
    });
  });

  it('renders pencil button only for non-regex rows', async () => {
    await renderAliases();
    await waitFor(() => expect(screen.getAllByTestId('alias-row')).toHaveLength(2));

    const row0Actions = screen.getByTestId('row-0-actions');
    const row1Actions = screen.getByTestId('row-1-actions');
    expect(row0Actions.querySelector('[data-icon="pencil"]')).not.toBeNull();
    expect(row1Actions.querySelector('[data-icon="pencil"]')).toBeNull();
    // Trash exists on both rows.
    expect(row0Actions.querySelector('[data-icon="trash"]')).not.toBeNull();
    expect(row1Actions.querySelector('[data-icon="trash"]')).not.toBeNull();
  });

  it('clicking pencil opens the modal with the row prefilled', async () => {
    await renderAliases();
    await waitFor(() => expect(screen.getAllByTestId('alias-row')).toHaveLength(2));

    const pencil = screen.getByTestId('row-0-actions').querySelector('[data-icon="pencil"]');
    await act(async () => { fireEvent.click(pencil); });

    expect(screen.getByTestId('alias-edit-modal')).toBeInTheDocument();
    expect(screen.getByTestId('modal-source').textContent).toBe('info@example.com');
    expect(screen.getByTestId('modal-destination').textContent).toBe('alice@example.com,bob@example.com');
  });

  it('saving from the modal calls updateAlias and refreshes the list', async () => {
    mockUpdateAlias.mockResolvedValue({ success: true, message: 'Alias updated' });

    await renderAliases();
    await waitFor(() => expect(screen.getAllByTestId('alias-row')).toHaveLength(2));

    const pencil = screen.getByTestId('row-0-actions').querySelector('[data-icon="pencil"]');
    await act(async () => { fireEvent.click(pencil); });

    // Drive the captured onSave from the mock — the modal itself is mocked, so
    // we don't actually click an in-modal button; we invoke the onSave prop directly.
    await act(async () => {
      await _editModalLatestProps.onSave('info@example.com', 'alice@example.com,bob@example.com,carol@example.com');
    });

    expect(mockUpdateAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'info@example.com',
      'alice@example.com,bob@example.com,carol@example.com',
    );
    // After save, fetchAliases should have been called again (initial + refresh).
    expect(mockGetAliases).toHaveBeenCalledTimes(2);
  });
});
