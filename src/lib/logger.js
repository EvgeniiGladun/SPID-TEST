'use strict';

const { DEFAULT_LOG_LEVEL, LOG_LEVELS } = require('../constants');

const formatFields = (fields) => Object.entries(fields)
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  .join(' ');

const createLogger = (levelName = DEFAULT_LOG_LEVEL) => {
  const current = LOG_LEVELS[levelName] ?? LOG_LEVELS[DEFAULT_LOG_LEVEL];

  const write = (level, message, fields) => {
    const levelIsMuted = LOG_LEVELS[level] > current;
    if (levelIsMuted) {
      return;
    }

    const hasFields = fields && Object.keys(fields).length > 0;
    const extra = hasFields ? ` ${formatFields(fields)}` : '';
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${extra}`;
    console.error(line);
  };

  return {
    error: (message, fields) => write('error', message, fields),
    info: (message, fields) => write('info', message, fields),
    debug: (message, fields) => write('debug', message, fields),
  };
};

module.exports = {
  createLogger,
};
