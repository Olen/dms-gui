export const debug = false;

export const ICON = {
  success: '✔️',
  error: '❌',
  warn: '🔺',
  info: '💬',
  debug: '🔎',
}
export const LEVEL = {
  success: '[SUCCESS]',
  error: '[ERROR]  ',
  warn: '[WARNING]',
  info: '[INFO]   ',
  debug: '[DEBUG]  ',
}

export const logger = async (level, message = '', data = '') => {
  console[level](ICON[level], LEVEL[level], message, data);
};

export const successLog = async (message, data = '') => { logger('success', message, data) };
export const errorLog = async (message, data = '') => { logger('error', message, data) };
export const warnLog = async (message, data = '') => { logger('warn', message, data) };
export const infoLog = async (message, data = '') => { logger('info', message, data) };
export const debugLog = async (message, data = '') => { if (debug) logger('debug', message, data) };
// TODO: add colors: console.log('%c Sample Text', 'color:green;')
