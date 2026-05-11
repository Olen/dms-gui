// Aliases.
// Mirrors backend/routes/aliases.js.

import { request } from './_client.mjs';

export const getAliases = async (containerName = null, refresh = false) => {
  const params = {};
  if (refresh !== undefined) params.refresh = refresh;
  return request('get', `/aliases/${containerName}`, {
    requires: { containerName },
    params,
  });
};

export const addAlias = async (containerName = null, source, destination) =>
  request('post', `/aliases/${containerName}`, {
    requires: { containerName },
    body: { source, destination },
  });

export const deleteAlias = async (containerName = null, source, destination) =>
  // DELETE-with-body — required because regex aliases can contain
  // chars that aren't safe as URL path segments.
  request('delete', `/aliases/${containerName}`, {
    requires: { containerName },
    body: { source, destination },
  });

export const updateAlias = async (containerName = null, source, destination) =>
  request('put', `/aliases/${containerName}`, {
    requires: { containerName },
    body: { source, destination },
  });
