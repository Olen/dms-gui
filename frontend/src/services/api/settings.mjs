// Settings + configs + branding (which lives in routes/settings.js
// on the backend too).

import { request } from './_client.mjs';
import { api } from './_client.mjs';

export const getSettings = async (
  plugin,
  containerName,
  name,
  encrypted = false,
  scope
) => {
  const params = { encrypted };
  if (name !== undefined) params.name = name;
  const path = scope
    ? `/settings/${plugin}/${containerName}/${scope}`
    : `/settings/${plugin}/${containerName}`;
  return request('get', path, { requires: { containerName }, params });
};

export const getConfigs = async (plugin, name) => {
  const path = name ? `/configs/${plugin}/${name}` : `/configs/${plugin}`;
  return request('get', path);
};

export const saveSettings = async (
  plugin,
  schema,
  scope,
  containerName,
  jsonArrayOfObjects,
  encrypted = false
) =>
  request('post', `/settings/${plugin}/${schema}/${scope}/${containerName}`, {
    requires: { containerName },
    body: jsonArrayOfObjects,
    params: { encrypted },
  });

export const getUserSettings = async (containerName = null) =>
  request('get', `/user-settings/${containerName}`, {
    requires: { containerName },
  });

// ============================================
// Branding (public — no auth)
// ============================================

export const getBranding = async (containerName) => {
  // Silent-failure: the login page calls this BEFORE the user is
  // authenticated. A 5xx must not break the login screen.
  const path = containerName ? `/branding/${containerName}` : '/branding';
  try {
    return await request('get', path);
  } catch {
    return { success: true, message: [] };
  }
};

export const uploadLogo = async (file, scope) => {
  // Caller owns error handling here — uploadLogo is exclusively
  // called from the admin Settings page, which surfaces failures
  // via its own form-error UI. Routing this through request()
  // (which errorLogs + throws) would double-log every failure.
  // This is the one place that touches `api` directly.
  const formData = new FormData();
  formData.append('logo', file);
  const p = scope ? `/branding/logo/${scope}` : '/branding/logo';
  const response = await api.post(p, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const deleteLogo = async (scope) => {
  // Same contract as uploadLogo — caller handles errors.
  const p = scope ? `/branding/logo/${scope}` : '/branding/logo';
  const response = await api.delete(p);
  return response.data;
};
