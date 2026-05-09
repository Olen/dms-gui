import { describe, it, expect } from 'vitest';
import { REST_API_MANIFEST } from './restApiManifest.mjs';

describe('REST_API_MANIFEST (Sprint B — accounts.mjs migration)', () => {
  it('exports an array', () => {
    expect(Array.isArray(REST_API_MANIFEST)).toBe(true);
  });

  it('contains the 12 actions accounts.mjs needs', () => {
    const ids = REST_API_MANIFEST.map((a) => a.id);
    const required = [
      'setup_email_list',
      'setup_email_add',
      'setup_email_del',
      'setup_quota_del',
      'setup_quota_set',
      'doveadm_index',
      'doveadm_mailbox_list',
      'doveadm_mailbox_list_subscribed',
      'doveadm_mailbox_metadata_list',
      'doveadm_mailbox_status',
      'doveadm_force_resync',
      'doveadm_quota_get',
    ];
    for (const id of required) expect(ids).toContain(id);
  });

  it('serialises to valid JSON', () => {
    expect(() => JSON.parse(JSON.stringify(REST_API_MANIFEST))).not.toThrow();
  });
});
