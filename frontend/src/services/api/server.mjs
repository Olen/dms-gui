// Server: status + envs + node infos + logs + bounces + count +
// initAPI + killContainer. Mirrors backend/routes/server.js.

import { request } from './_client.mjs';

export const getServerStatus = async (
  plugin,
  containerName,
  test = undefined,
  settings = []
) => {
  const params = {};
  if (test !== undefined) params.test = test;
  return request('post', `/status/${plugin}/${containerName}`, {
    requires: { containerName },
    body: { settings },
    params,
  });
};

export const getServerEnvs = async (
  plugin,
  containerName,
  refresh = false,
  name
) => {
  const params = {};
  if (refresh !== undefined) params.refresh = refresh;
  if (name !== undefined) params.name = name;
  return request('get', `/envs/${plugin}/${containerName}`, {
    requires: { containerName },
    params,
  });
};

export const getNodeInfos = async () => request('get', '/infos');

export const getMailLogs = async (
  containerName = null,
  source = 'mail',
  lines = 100
) =>
  request('get', `/logs/${containerName}`, {
    requires: { containerName },
    params: { source, lines },
  });

export const getMailBounces = async (containerName = null, hours = 48) =>
  request('get', `/bounces/${containerName}`, {
    requires: { containerName },
    params: { hours },
  });

export const getCount = async (table, containerName) =>
  request('get', `/getCount/${table}/${containerName}`, {
    // Both segments interpolate into the URL; require both so a
    // missing arg short-circuits instead of producing
    // `/getCount/<table>/undefined`.
    requires: { table, containerName },
  });

// initAPI to define or generate a new DMS_API_KEY
export const initAPI = async (
  plugin,
  schema,
  containerName,
  dms_api_key_param
) => {
  const params = {};
  if (dms_api_key_param !== undefined)
    params.dms_api_key_param = dms_api_key_param;
  return request('post', `/initAPI/${plugin}/${schema}/${containerName}`, {
    requires: { containerName },
    body: params,
  });
};

// kill will reboot this container
// eslint-disable-next-line no-unused-vars -- args kept for caller-API compatibility while server expects no path/body
export const killContainer = async (plugin, schema, containerName) =>
  request('post', '/killContainer');
